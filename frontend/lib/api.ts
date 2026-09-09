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

// Where the frontend looks for its API.
//   • In the browser, a relative path ("") works fine.
//   • On the SERVER (e.g. the product page rendering), fetch needs an ABSOLUTE
//     URL, so we fall back to localhost:3000 in dev.
//   • To point at Larry's real backend later, set NEXT_PUBLIC_API_BASE in a
//     .env.local file (e.g. http://localhost:4000) and it takes over.
const base =
  process.env.NEXT_PUBLIC_API_BASE ??
  (typeof window === "undefined" ? "http://localhost:3000" : "");

export async function fetchProduct(id: string): Promise<ProductWithOffers | null> {
  const res = await fetch(`${base}/api/product/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchProduct failed: ${res.status}`);
  return res.json();
}

export async function searchProducts(q: string): Promise<Product[]> {
  const res = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`searchProducts failed: ${res.status}`);
  return res.json();
}

export async function fetchCategory(cat: string): Promise<CategoryPage | null> {
  const res = await fetch(`${base}/api/category/${cat}`, { cache: "no-store" });
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

  const res = await fetch(`${base}/api/categories/${path}/products${query}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  // A misconfigured or unreachable backend returns 502/503 here. Return null
  // rather than throwing: the category page still has its subcategory tiles to
  // render, and an empty product grid is honest.
  if (!res.ok) return null;
  return res.json();
}

export async function compareBasket(items: string[]): Promise<BasketResult> {
  const body: BasketRequest = { items };
  const res = await fetch(`${base}/api/basket/compare`, {
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
  const res = await fetch(`${base}/api/basket/plan`, {
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
  const res = await fetch(`${base}/api/price-history/${id}`, { cache: "no-store" });
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
  const res = await fetch(`${base}/api/personalise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`personaliseServer failed: ${res.status}`);
  return res.json();
}
