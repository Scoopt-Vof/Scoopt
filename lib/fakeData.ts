// ============================================================================
//  FAKE DATA — temporary stand-in for Larry's real backend.
// ----------------------------------------------------------------------------
//  Everything here produces the shapes defined in contract/types.ts.
//  When the real backend is ready, the API routes stop importing from this
//  file and start reading from the database instead — and because the SHAPES
//  are identical, the frontend never notices the switch.
//
//  This is the whole point of agreeing the contract first: the frontend can
//  be fully built and tested against this fake data with no backend at all.
// ============================================================================

import type {
  Product, Offer, ProductWithOffers, CategoryPage, Category,
  BasketRequest, BasketResult, StoreBasketTotal, PriceHistory, PricePoint,
} from "@/contract/types";

// ---- Stores (only ones with a sanctioned affiliate feed; see business plan) ----
const STORES = ["bol.com", "amazon.nl", "coolblue", "mediamarkt", "wehkamp"];

// ---- Delivery rules per store (illustrative; backend supplies real ones) ----
// Each store charges a flat fee, waived above a threshold — the classic pattern
// that makes the smart-split maths non-trivial and worth doing honestly.
export const DELIVERY_RULES = [
  { store: "bol.com", fee: 0, freeAbove: 0 },        // free delivery (Select-style)
  { store: "amazon.nl", fee: 1.99, freeAbove: 30 },
  { store: "coolblue", fee: 0, freeAbove: 0 },
  { store: "mediamarkt", fee: 2.95, freeAbove: 50 },
  { store: "wehkamp", fee: 3.95, freeAbove: 40 },
];

// ---- A small launch-style product set (home + sport lead the MVP) ----
//
// The `specs` carry the attributes personalisation reasons over. Three keys are
// meaningful to the ranking (all optional, so real feed data can omit them):
//   tier:    "value" | "mid" | "premium"   → matched against the shopper's budget
//   quality: "1".."5" (string)             → rewarded when priority = quality
//   released:"2026" etc.                    → rewarded when priority = newest
//   level:   e.g. "gevorderd"               → matched against questionnaire detail
export const PRODUCTS: Product[] = [
  {
    id: "run-alphafly3", ean: "0196969321001", brand: "Nike",
    name: "Nike Alphafly 3", unit: "Running shoe · race day",
    category: "sport", subcategory: "hardlopen", image: "",
    specs: { gebruik: "wedstrijd", plaat: "carbon", tier: "premium", quality: "5", released: "2026", level: "gevorderd" },
  },
  {
    id: "run-pegasus41", ean: "0196969118002", brand: "Nike",
    name: "Nike Pegasus 41", unit: "Running shoe · daily",
    category: "sport", subcategory: "hardlopen", image: "",
    specs: { gebruik: "dagelijks", tier: "mid", quality: "4", released: "2025", level: "beginner" },
  },
  {
    id: "run-cloud6", ean: "7630451001003", brand: "On",
    name: "On Cloudsurfer 6", unit: "Running shoe · daily",
    category: "sport", subcategory: "hardlopen", image: "",
    specs: { gebruik: "dagelijks", tier: "premium", quality: "4", released: "2026", level: "beginner" },
  },
  {
    id: "run-wave", ean: "8712345000123", brand: "Decathlon Kiprun",
    name: "Kiprun KS500 2", unit: "Running shoe · entry",
    category: "sport", subcategory: "hardlopen", image: "",
    specs: { gebruik: "dagelijks", tier: "value", quality: "3", released: "2025", level: "beginner" },
  },
  {
    id: "run-garmin265", ean: "0753759301002", brand: "Garmin",
    name: "Garmin Forerunner 265", unit: "GPS running watch",
    category: "sport", subcategory: "hardlopen", image: "",
    specs: { tier: "premium", quality: "5", released: "2026", level: "gevorderd" },
  },
  {
    id: "home-linensofa", ean: "8712345678901", brand: "Scoopt Living",
    name: "3-zits linnen bank", unit: "Sofa · living room",
    category: "home", subcategory: "woonkamer", image: "",
    specs: { tier: "mid", quality: "4", released: "2025" },
  },
  {
    id: "home-oaktable", ean: "8712345678902", brand: "Scoopt Living",
    name: "Eiken salontafel", unit: "Coffee table · living room",
    category: "home", subcategory: "woonkamer", image: "",
    specs: { tier: "value", quality: "3", released: "2024" },
  },
];

// ---- Fake offers: give each product a spread of prices across some stores ----
// (Deterministic so the numbers are stable between page loads.)
function offersFor(p: Product): Offer[] {
  const base: Record<string, number> = {
    "run-alphafly3": 279.99, "run-pegasus41": 139.99, "run-garmin265": 399.0,
    "run-cloud6": 179.99, "run-wave": 59.99,
    "home-linensofa": 899.0, "home-oaktable": 249.0,
  };
  const basePrice = base[p.id] ?? 100;
  const now = new Date().toISOString();
  return STORES
    .map((store, i) => {
      // vary availability — not every store carries every item
      if ((p.id.length + i) % 4 === 3) return null;
      const wobble = 1 + (((i * 7) % 11) - 5) / 100; // -5%..+5%
      return {
        productId: p.id,
        store,
        price: Math.round(basePrice * wobble * 100) / 100,
        currency: "EUR" as const,
        inStock: true,
        url: `https://example.com/out?store=${store}&pid=${p.id}`,
        lastChecked: now,
      };
    })
    .filter((o): o is Offer => o !== null)
    .sort((a, b) => a.price - b.price); // cheapest first — backend guarantees this
}

// ---- The functions the API routes call. Larry replaces the guts of these
//      with real database queries; the RETURN SHAPES stay identical. ----

export function getProduct(id: string): ProductWithOffers | null {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) return null;
  return { product, offers: offersFor(product) };
}

export function searchProducts(q: string): Product[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return PRODUCTS;
  return PRODUCTS.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      p.brand.toLowerCase().includes(needle)
  );
}

const CATEGORY_PAGES: Record<Category, CategoryPage> = {
  home: {
    category: "home", name: "Home & furniture",
    blurb: "Furnish every room without keeping ten tabs open.",
    subcategories: [
      { id: "woonkamer", name: "Living room", icon: "sofa", essentials: ["Sofa", "Coffee table", "TV stand", "Rug"] },
      { id: "slaapkamer", name: "Bedroom", icon: "bed", essentials: ["Bed frame", "Mattress", "Wardrobe", "Bedside table"] },
      { id: "keuken", name: "Kitchen", icon: "pan", essentials: ["Cookware set", "Kettle", "Blender", "Cutlery"] },
    ],
  },
  sport: {
    category: "sport", name: "Sport",
    blurb: "Find the right gear for the sport you actually do.",
    subcategories: [
      { id: "hardlopen", name: "Running", icon: "shoe", essentials: ["Running shoes", "GPS watch", "Running socks", "Running belt"] },
      { id: "fietsen", name: "Cycling", icon: "bike", essentials: ["Bike", "Helmet", "Cycling shorts", "Lights"] },
      { id: "fitness", name: "Fitness", icon: "dumbbell", essentials: ["Training shoes", "Resistance bands", "Dumbbells", "Gym bag"] },
    ],
  },
  tech: {
    category: "tech", name: "Technology",
    blurb: "See what a laptop or phone really costs across every store.",
    subcategories: [
      { id: "laptops", name: "Laptops", icon: "laptop", essentials: ["Laptop", "Sleeve", "Mouse", "Adapter"] },
      { id: "smartphones", name: "Smartphones", icon: "phone", essentials: ["Phone", "Case", "Screen protector"] },
    ],
  },
};

export function getCategory(cat: string): CategoryPage | null {
  return CATEGORY_PAGES[cat as Category] ?? null;
}

// Returns each requested product together with all its offers — the input the
// smart-split planner needs.
export function basketItemsWithOffers(ids: string[]) {
  return ids
    .map((id) => {
      const product = PRODUCTS.find((p) => p.id === id);
      if (!product) return null;
      return { productId: product.id, productName: product.name, offers: offersFor(product) };
    })
    .filter(
      (x): x is { productId: string; productName: string; offers: Offer[] } => x !== null
    );
}

// Generates a plausible 30-day price history for a product, so the frontend's
// "cheapest in 30 days" honest signals work. The backend replaces this with
// real stored observations — writing one row per price refresh from day one.
export function getPriceHistory(id: string): PriceHistory | null {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) return null;
  const offers = offersFor(product);
  if (offers.length === 0) {
    return { productId: id, points: [], currentMin: 0, min30: 0, max30: 0, isLowest30: false };
  }
  const currentMin = offers[0].price;
  const points: PricePoint[] = [];
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  // 30 daily observations for the cheapest store, wobbling around currentMin
  const store = offers[0].store;
  for (let d = 30; d >= 0; d--) {
    const wobble = 1 + (((d * 13) % 17) - 8) / 100; // deterministic ±8%
    points.push({
      at: new Date(now - d * day).toISOString(),
      store,
      price: Math.round(currentMin * wobble * 100) / 100,
    });
  }
  // ensure today's point equals the real current min
  points[points.length - 1] = { at: new Date(now).toISOString(), store, price: currentMin };
  const prices = points.map((p) => p.price);
  const min30 = Math.min(...prices);
  const max30 = Math.max(...prices);
  return {
    productId: id, points, currentMin, min30, max30,
    isLowest30: currentMin <= min30 + 0.001,
  };
}

export function compareBasket(req: BasketRequest): BasketResult {
  const chosen = req.items
    .map((id) => PRODUCTS.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));

  const totals: StoreBasketTotal[] = STORES.map((store) => {
    let total = 0;
    const missing: string[] = [];
    for (const p of chosen) {
      const offer = offersFor(p).find((o) => o.store === store);
      if (offer) total += offer.price;
      else missing.push(p.name);
    }
    return {
      store,
      total: Math.round(total * 100) / 100,
      complete: missing.length === 0,
      missing,
    };
  }).sort((a, b) => Number(b.complete) - Number(a.complete) || a.total - b.total);

  return { totals, cheapestComplete: totals.find((t) => t.complete) };
}
