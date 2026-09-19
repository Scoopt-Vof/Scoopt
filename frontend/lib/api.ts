// ============================================================================
//  FRONTEND API CLIENT
// ----------------------------------------------------------------------------
//  The ONE place the frontend talks to the backend. Every page/component calls
//  these functions instead of using fetch() directly, so if an endpoint ever
//  changes, you fix it here once. Return types come straight from the contract.
// ============================================================================

import type {
  ProductWithOffers, Product, CategoryPage, BasketRequest, BasketResult,
  Offer, DeliveryRule, PriceHistory, PersonalisedProduct, PersonaliseRequest,
  ShopperProfile, ObservedSignals,
} from "@/contract/types";
import { catalogFetchInit } from "@/lib/catalogCache";

// Where the frontend looks for its API. One rule, so dev and production behave
// the same and the backend's address is never shipped to the browser:
//   • In the BROWSER we always call the relative "/api/..." path, which hits the
//     Next.js proxy routes (app/api/*), and the proxy forwards to BACKEND_URL.
//   • On the SERVER (product, search, category pages render server-side) fetch
//     needs an absolute URL, so we call the backend directly via BACKEND_URL —
//     the same paths the proxy forwards to. BACKEND_URL has no NEXT_PUBLIC_
//     prefix, so it is only ever readable here on the server, never in the
//     browser bundle.
// Set BACKEND_URL in frontend/.env.local for dev (http://localhost:3002) and in
// the Vercel project's Environment Variables for production. See .env.example.
const base =
  typeof window === "undefined"
    ? (process.env.BACKEND_URL?.replace(/\/$/, "") ?? "")
    : "";

// A server render with no BACKEND_URL set would otherwise try to fetch a
// relative URL (no host) and throw an opaque parse error. Fail loudly and
// clearly instead — app/error.tsx turns this into a friendly page.
function resolve(path: string): string {
  if (typeof window === "undefined" && !base) {
    throw new Error(
      "BACKEND_URL is not set — the server cannot reach the backend. " +
      "Set it in the environment (see frontend/.env.example)."
    );
  }
  return `${base}${path}`;
}

// Catalogue reads (product, category, category products, price history) are
// cached — see lib/catalogCache.ts for how long and how they are cleared.
// Anything personal or user-specific (basket, search, personalise) stays
// uncached below.

export async function fetchProduct(id: string): Promise<ProductWithOffers | null> {
  const res = await fetch(resolve(`/api/product/${id}`), catalogFetchInit(`/api/product/${id}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchProduct failed: ${res.status}`);
  return res.json();
}

export async function searchProducts(q: string): Promise<Product[]> {
  const res = await fetch(resolve(`/api/search?q=${encodeURIComponent(q)}`), { cache: "no-store" });
  if (!res.ok) throw new Error(`searchProducts failed: ${res.status}`);
  return res.json();
}

export async function fetchCategory(cat: string): Promise<CategoryPage | null> {
  const res = await fetch(resolve(`/api/category/${cat}`), catalogFetchInit(`/api/category/${cat}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchCategory failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Category browse (the taxonomy read path)
// ---------------------------------------------------------------------------
// Replaces the old pattern of calling searchProducts("") and filtering the
// result in JavaScript. That call returns the 200 OLDEST products in the whole
// catalogue, so categories silently empty out as new products are ingested.
// This asks the database for the category, with paging.

export interface CategoryProductsPage {
  path: string;
  total: number;
  limit: number;
  offset: number;
  products: (Product & { tags: string[]; minPrice: number | null; offerCount: number })[];
}

export async function fetchCategoryProducts(
  path: string,
  opts: { limit?: number; offset?: number; tags?: string[] } = {}
): Promise<CategoryProductsPage | null> {
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
  if (opts.offset !== undefined) qs.set("offset", String(opts.offset));
  if (opts.tags?.length) qs.set("tags", opts.tags.join(","));
  const query = qs.toString() ? `?${qs}` : "";

  const res = await fetch(resolve(`/api/categories/${path}/products${query}`), catalogFetchInit(`/api/categories/${path}/products${query}`));
  if (res.status === 404) return null;
  // A misconfigured or unreachable backend returns 502/503 here. Throw rather
  // than return an empty grid: this page is cached, and an empty grid rendered
  // during a brief backend hiccup would be served to everyone for the whole
  // cache window. Throwing makes Next.js keep serving the last good version.
  if (!res.ok) throw new Error(`fetchCategoryProducts failed: ${res.status}`);
  return res.json();
}

export async function compareBasket(items: string[]): Promise<BasketResult> {
  const body: BasketRequest = { items };
  const res = await fetch(resolve(`/api/basket/compare`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`compareBasket failed: ${res.status}`);
  return res.json();
}

// Data for the smart-split planner: each basket product + its offers, plus the
// delivery rules. The planning itself happens in lib/smartBasket.ts.
export interface BasketPlanData {
  items: { productId: string; productName: string; offers: Offer[] }[];
  deliveryRules: DeliveryRule[];
}

export async function fetchBasketPlanData(items: string[]): Promise<BasketPlanData> {
  const body: BasketRequest = { items };
  const res = await fetch(resolve(`/api/basket/plan`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`fetchBasketPlanData failed: ${res.status}`);
  return res.json();
}

// Price history for a product — powers "cheapest in 30 days" honest signals.
export async function fetchPriceHistory(id: string): Promise<PriceHistory | null> {
  const res = await fetch(resolve(`/api/price-history/${id}`), catalogFetchInit(`/api/price-history/${id}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchPriceHistory failed: ${res.status}`);
  return res.json();
}

// Server-side personalisation (optional path). The client engine in
// lib/profile.ts is used today; this is here so the frontend can switch to
// server ranking later with no shape changes.
export async function personaliseServer(
  productIds: string[],
  profile: ShopperProfile | null,
  observed?: ObservedSignals | null
): Promise<PersonalisedProduct[]> {
  const body: PersonaliseRequest = { productIds, profile, observed };
  const res = await fetch(resolve(`/api/personalise`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`personaliseServer failed: ${res.status}`);
  return res.json();
}
