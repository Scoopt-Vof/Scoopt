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

// Server Components can call the route handlers directly on the same origin.
// Using a relative base keeps it working in dev and in production unchanged.
const base = "";

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
