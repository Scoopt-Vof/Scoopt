/**
 * LOCAL COPY of the shapes this back end returns.
 *
 * ⚠️  When you drop this into the real Scoopt repo, DELETE this file and change
 *     the imports to `contract/types.ts` — Josh's 321-line shared contract.
 *     That file is the seam between front end and back end; a mismatch there
 *     must stay a compile error, which only works if there is exactly one copy.
 *
 * These are written to be a structural subset of the real contract, so
 * `tsc --noEmit` will tell you immediately if they have drifted apart.
 */

export type Money = number; // integer cents. Never a float. Never euros.

export interface Retailer {
  slug: string;
  name: string;
}

export interface Offer {
  retailer: Retailer;
  priceCents: Money;
  shippingCents: Money;
  totalCents: Money; // priceCents + shippingCents, precomputed for the UI
  inStock: boolean;
  url: string;
  lastSeenAt: string; // ISO 8601
}

export interface Product {
  id: string;
  ean: string | null;
  brand: string;
  title: string;
  category: string;
  imageUrl: string | null;
  /** Cheapest current offer total, or null if the product has no live offers. */
  fromCents: Money | null;
}

export interface ProductWithOffers extends Product {
  description: string | null;
  /** INVARIANT: sorted cheapest-first by totalCents. Enforced in tests. */
  offers: Offer[];
}

export interface PricePoint {
  date: string; // YYYY-MM-DD
  priceCents: Money;
}

export interface PriceHistory {
  productId: string;
  points: PricePoint[];
  /** INVARIANT: min30 <= currentMin <= max30. Enforced in tests. */
  min30: Money;
  max30: Money;
  currentMin: Money;
}
