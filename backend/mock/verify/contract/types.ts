// ============================================================================
//  SCOOPT — THE API CONTRACT
// ----------------------------------------------------------------------------
//  This file is the single agreed "seam" between the two halves of Scoopt.
//
//    YOU (frontend)  build the UI against these shapes.
//    LARRY (backend) builds the API to PRODUCE these shapes.
//
//  Agree any change to this file TOGETHER. If one of you edits a shape here,
//  the other sees it immediately (both halves import from this one file), so
//  you catch mismatches at edit time instead of at merge time.
// ============================================================================

// The three MVP categories. Home leads (best commission), sport differentiates,
// tech is carried for credibility. See the business plan.
export type Category = "home" | "sport" | "tech";

// ---------------------------------------------------------------------------
// A PRODUCT — one real-world item, matched across every retailer that sells it.
// The `ean` (barcode) is the key that lets the backend know that
// "Nike Alphafly 3 heren" at one shop and "Alphafly 3 M" at another
// are the SAME product.
// ---------------------------------------------------------------------------
export interface Product {
  id: string;                 // Scoopt's own internal id, e.g. "run-alphafly3"
  ean: string;                // barcode / GTIN — the matching key
  brand: string;              // "Nike"
  name: string;               // canonical Dutch name shown to users
  unit: string;               // short descriptor, e.g. "Hardloopschoen · wedstrijd"
  category: Category;
  subcategory: string;        // e.g. "hardlopen"
  image: string;              // licensed (Icecat) or retailer-feed image URL
  specs?: Record<string, string>; // optional key/value specs
}

// ---------------------------------------------------------------------------
// An OFFER — one retailer selling one product, at a price, right now.
// A product typically has several offers (one per store that stocks it).
// ---------------------------------------------------------------------------
export interface Offer {
  productId: string;          // links back to Product.id
  store: string;              // "bol.com", "amazon.nl", ...
  price: number;              // EUR, incl. VAT
  currency: "EUR";
  inStock: boolean;
  url: string;                // affiliate-tagged click-out link
  lastChecked: string;        // ISO timestamp of the last price refresh
}

// A product together with all its offers, cheapest first.
// This is what the product page and the compare view receive.
export interface ProductWithOffers {
  product: Product;
  offers: Offer[];            // sorted cheapest → dearest by the backend
}

// ---------------------------------------------------------------------------
// CATEGORY + SUBCATEGORY shapes for the browse pages.
// ---------------------------------------------------------------------------
export interface Subcategory {
  id: string;                 // "hardlopen"
  name: string;               // "Hardlopen"
  icon: string;               // icon key the frontend maps to an SVG
  essentials: string[];       // the "what you need" list, e.g. ["Hardloopschoenen", ...]
}

export interface CategoryPage {
  category: Category;
  name: string;               // "Sport"
  blurb: string;
  subcategories: Subcategory[];
}

// ---------------------------------------------------------------------------
// BASKET comparison — the differentiator. The user picks several products;
// the backend returns the total per store, ranked, with COMPLETE baskets
// (a store that has everything) ranked above incomplete ones.
// ---------------------------------------------------------------------------
export interface BasketRequest {
  items: string[];            // array of Product.id
}

export interface StoreBasketTotal {
  store: string;
  total: number;              // EUR — sum of available items only
  complete: boolean;          // does this store carry EVERY requested item?
  missing: string[];          // names of items this store does not carry
}

export interface BasketResult {
  totals: StoreBasketTotal[]; // complete baskets first, then by cheapest total
  cheapestComplete?: StoreBasketTotal; // convenience: the winner, if any store is complete
}

// ---------------------------------------------------------------------------
// SMART MULTI-STORE SPLIT — Scoopt's revolutionary basket.
// ---------------------------------------------------------------------------
//  The genuinely cheapest way to buy a basket is often to split it across
//  stores — but ONLY if the item savings beat the extra delivery costs. This
//  computes the honest answer: it compares buying everything at one store
//  against an optimal split, and recommends whichever actually wins.
//
//  Delivery is modelled per store (a flat fee, waived above a threshold).
//  The backend supplies real delivery rules later; the shape stays the same.

export interface DeliveryRule {
  store: string;
  fee: number;                 // EUR delivery fee
  freeAbove?: number;          // fee waived if the store's subtotal >= this
}

// One line in a plan: buy this product at this store for this price.
export interface PlanLine {
  productId: string;
  productName: string;
  store: string;
  price: number;
}

// A complete way to buy the whole basket.
export interface BasketPlan {
  kind: "single-store" | "smart-split";
  lines: PlanLine[];           // where each item is bought
  stores: string[];            // distinct stores involved
  itemsTotal: number;          // sum of item prices
  deliveryTotal: number;       // sum of delivery fees across the stores used
  grandTotal: number;          // itemsTotal + deliveryTotal
  complete: boolean;           // could every item be sourced?
  missing: string[];           // items no available store carries
}

export interface SmartBasketResult {
  bestSingleStore?: BasketPlan; // cheapest way to buy everything at ONE store
  smartSplit?: BasketPlan;      // cheapest optimal split across stores
  recommended: "single-store" | "smart-split" | "none";
  savingVsSingle: number;       // how much the split saves vs best single store (>= 0)
  honestNote: string;           // plain-language verdict shown to the shopper
}

// ===========================================================================
//  THE SHOPPER PROFILE — Scoopt's USP.
// ---------------------------------------------------------------------------
//  Built from two sources (per the business plan):
//    1. STATED   — the sign-up questionnaire (what they tell us).
//    2. OBSERVED  — buying/browsing habits (what they do). Stubbed for now;
//                   Larry's backend fills this in later. Same shape either way.
//
//  The profile drives two things on the frontend today:
//    - re-ranking products to match the shopper
//    - a "voor jou" (for you) line explaining WHY each pick fits them
// ===========================================================================

// What the shopper cares about most. Drives ranking + explanations.
export type Priority = "price" | "quality" | "newest";

// Rough budget band, per category. Keeps ranking sensible without asking for exact euros.
export type BudgetBand = "value" | "mid" | "premium";

// Per-category extra detail (the "deeper questionnaire" answers).
// Open-ended so each category can ask what's relevant without new types.
export type CategoryDetail = Record<string, string>;

export interface ShopperProfile {
  // --- stated (from the questionnaire) ---
  name?: string;
  categories: Category[];                 // which categories they shop
  budget: Partial<Record<Category, BudgetBand>>; // budget band per chosen category
  priority: Priority;                     // their single biggest driver
  detail: Record<string, CategoryDetail>; // keyed by subcategory id, e.g.
                                          //   { hardlopen: { afstand: "10-25km",
                                          //                  niveau: "gevorderd" } }

  // --- progressive insight areas (filled a bit at sign-up, deepened as they
  //     shop). All optional so a brand-new profile is valid with none of them.
  //     Each area maps to a customer-facing insight (see the sign-up flow):
  //       rightSizing → "won't fit / you already own this"
  //       timing      → "wait, it usually drops" / "time to replace"
  //       values      → rank by durability/sustainability, brand stance
  //       lifeContext → family-sized / rental-friendly relevance
  rightSizing?: Record<string, string>;   // e.g. { shoeSize:"44", roomWidth:"large" }
  timing?: Record<string, string>;        // e.g. { replaceRunShoes:"3-6m" }
  values?: string[];                      // e.g. ["sustainable","buy-it-for-life"]
  lifeContext?: Record<string, string>;   // e.g. { household:"family", home:"rent", pets:"dog" }

  // --- observed (filled by backend later; safe to be empty now) ---
  viewedProductIds?: string[];
  purchasedProductIds?: string[];

  completedAt?: string;                   // ISO timestamp when questionnaire finished
}

// ===========================================================================
//  ACCOUNT — the signed-in shopper.
// ---------------------------------------------------------------------------
//  The frontend owns the sign-in/sign-up SCREENS and this shape. Real auth
//  (verifying passwords, sessions, OAuth with Google/Apple) is Larry's backend
//  work — it is security-sensitive and must not live in the browser. Today the
//  frontend keeps a fake "signed-in" Account in localStorage so the whole
//  experience works; later these fields come from a real POST /api/auth/* that
//  returns the same shape.
export type AuthProvider = "email" | "google" | "apple";

export interface Account {
  id: string;                 // backend user id (fake uuid today)
  email: string;
  name?: string;
  provider: AuthProvider;     // how they signed in
  createdAt: string;          // ISO timestamp
  // NOTE: passwords are NEVER stored here or anywhere on the frontend.
  // The backend handles credentials; the frontend only ever holds this
  // non-sensitive Account record plus a session token it treats as opaque.
}

// A product paired with WHY it suits this shopper — what the "for you" line shows.
export interface PersonalisedProduct {
  product: Product;
  matchScore: number;                     // 0..100, higher = better fit
  reasons: string[];                      // short human reasons, e.g.
                                          //   ["Past bij je budget", "Voor gevorderde lopers"]
}

// ===========================================================================
//  OBSERVED BEHAVIOUR — the tracking event shape (agreed by BOTH halves).
// ---------------------------------------------------------------------------
//  The FRONTEND detects behaviour and emits these events through one function
//  (lib/track.ts). Today that function stores them in the browser; later the
//  BACKEND persists them (tied to a real account) via POST /api/track.
//  Either way the SHAPE is this — so neither half surprises the other.
//
//  Keep the event list small and meaningful. Each event is a signal that can
//  sharpen the profile: what someone views, compares and buys says as much as
//  what they told us in the questionnaire.
// ===========================================================================

export type TrackEventType =
  | "view_product"     // opened a product page
  | "click_out"        // clicked through to a retailer (strong intent)
  | "add_to_basket"    // added to the compare basket
  | "purchase";        // completed a buy (backend-confirmed later)

export interface TrackEvent {
  type: TrackEventType;
  productId: string;
  at: string;          // ISO timestamp
  // Optional context — handy for backend analysis, safe to omit on the client.
  category?: Category;
  store?: string;      // for click_out / purchase
}

// The rolled-up signals the personalisation engine actually consumes.
// The frontend derives this from stored events today; the backend can compute
// a richer version later. Same shape → the engine doesn't care who produced it.
export interface ObservedSignals {
  viewedProductIds: string[];      // most-recent-first, de-duplicated
  clickedOutProductIds: string[];
  purchasedProductIds: string[];
  // simple derived tastes, e.g. how often each category/brand shows up
  categoryAffinity: Partial<Record<Category, number>>;
}

// ===========================================================================
//  PRICE HISTORY — store every price observation from day one.
// ---------------------------------------------------------------------------
//  The business plan is explicit: price history is a revenue stream (the data /
//  price-index subscriptions) and it CANNOT be recreated later. So the shape
//  exists from the first commit, and the backend writes a row every time it
//  refreshes a price. The frontend reads it for "cheapest in 30 days"-style
//  honest signals.

export interface PricePoint {
  at: string;          // ISO date/time of the observation
  store: string;
  price: number;       // EUR
}

export interface PriceHistory {
  productId: string;
  points: PricePoint[];        // chronological, oldest → newest
  // convenience summaries the frontend uses for honest signals:
  currentMin: number;          // cheapest current offer
  min30: number;               // lowest price seen in the last 30 days
  max30: number;               // highest price seen in the last 30 days
  isLowest30: boolean;         // is the current min the lowest in 30 days?
}

// ===========================================================================
//  PERSONALISE (server-side option) — same result shape as the client engine.
// ---------------------------------------------------------------------------
//  Today personalisation runs on the client (lib/profile.ts). This request/
//  response lets Larry move it server-side later — where it can also use
//  OBSERVED behaviour stored per-account — WITHOUT changing PersonalisedProduct.

export interface PersonaliseRequest {
  productIds: string[];        // the products to rank
  profile: ShopperProfile | null;
  observed?: ObservedSignals | null;
}

// Response is simply PersonalisedProduct[] (already defined above).

// ---------------------------------------------------------------------------
// The endpoints the frontend calls (documented here so both halves agree):
//
//   GET  /api/product/:id     -> ProductWithOffers
//   GET  /api/search?q=...     -> Product[]
//   GET  /api/category/:cat    -> CategoryPage
//   POST /api/basket/compare   -> BasketResult          (body: BasketRequest)
//   POST /api/basket/plan      -> { items, deliveryRules } (body: BasketRequest)
//   GET  /api/price-history/:id -> PriceHistory
//   POST /api/track            -> { ok: true }          (body: TrackEvent)
//   POST /api/personalise      -> PersonalisedProduct[] (body: PersonaliseRequest)
//
//   Personalisation runs client-side today (lib/profile.ts) and tracking is
//   browser-stored today (lib/track.ts). The /api/personalise and /api/track
//   routes exist now as fake-backed stubs so Larry can swap their innards for
//   real DB calls without the frontend changing.
//
// While the backend is being built, these are served from fake data
// (see lib/fakeData.ts). Larry swaps the fake source for the real database
// WITHOUT changing these shapes — so your frontend keeps working unchanged.
// ---------------------------------------------------------------------------
