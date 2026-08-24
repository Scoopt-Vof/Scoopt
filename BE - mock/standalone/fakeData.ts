// ============================================================================
//  FAKE DATA — real Dutch sports products, INVENTED prices.
// ----------------------------------------------------------------------------
//  Drop-in replacement for the original lib/fakeData.ts. Identical exports,
//  identical signatures, identical return shapes — every one of the eight API
//  routes keeps working with no other change.
//
//  ⚠️  THE PRICES AND EANs IN THIS FILE ARE MADE UP.
//      Brands, product names and RRP ballparks are real so the site looks like
//      the real thing while you build it. The numbers are not real and must
//      never reach a public site — invented prices on a live comparison site
//      are misleading to consumers under the ACM Leidraad, and any retailer
//      reviewing an affiliate application will spot-check one.
//      Local development and demos only.
//
//  49 products · 3 subcategories · 5 Dutch sports retailers
//  Offers per product: 13×1-store, 9×2-store, 16×3-store, 11×4-store, 0×5-store
// ============================================================================

import type {
  Product, Offer, ProductWithOffers, CategoryPage, Category,
  BasketRequest, BasketResult, StoreBasketTotal, PriceHistory, PricePoint,
} from "./types";

// ---- Dutch sports retailers. All five have a route to a sanctioned feed:
//      Decathlon via Odyssey Partnerships, JD Sports + Bever via Awin,
//      Intersport via Daisycon, bol.com via its own affiliate programme. ----
const STORES = ["decathlon.nl","jdsports.nl","bever.nl","intersport.nl","bol.com"];

// ---- Delivery rules per store (illustrative; the real feeds supply these) ----
export const DELIVERY_RULES = [
  { store: "decathlon.nl", fee: 3.99, freeAbove: 30 },
  { store: "jdsports.nl", fee: 3.95, freeAbove: 70 },
  { store: "bever.nl", fee: 4.95, freeAbove: 50 },
  { store: "intersport.nl", fee: 4.95, freeAbove: 50 },
  { store: "bol.com", fee: 0.00, freeAbove: 0 },
];

// ---- WHICH STORE CARRIES WHICH BRAND ----------------------------------------
//  This is the most important table in the file, and it is modelled honestly.
//
//  Decathlon's catalogue is overwhelmingly own-brand — Kiprun, Kalenji,
//  B'Twin, Van Rysel, Domyos, Corength — and those barcodes exist nowhere
//  else. So those products get exactly ONE offer and no comparison at all.
//  The comparison engine only has work to do on the third-party brands that
//  several retailers carry: Nike, adidas, Asics, Garmin and so on.
//
//  A mock where every product had five offers would flatter the product and
//  teach you nothing. This one shows the real dynamic, which is also the
//  reason the retailer set has to be chosen for brand overlap.
const STOCKS: Record<string, string[]> = {
  "decathlon.nl": ["Kiprun","Kalenji","B'Twin","Van Rysel","Domyos","Corength","Garmin","Polar","Shimano","Continental"],
  "jdsports.nl": ["Nike","adidas","Reebok","Under Armour","Asics","New Balance","Hoka","On"],
  "bever.nl": ["Salomon","Hoka","On","Osprey","Garmin","Leki","Polar"],
  "intersport.nl": ["Nike","adidas","Asics","Brooks","Hoka","Saucony","Abus","Giro","Salomon","On","Garmin","Polar","Under Armour","New Balance"],
  "bol.com": ["Nike","adidas","Asics","Brooks","Hoka","On","Saucony","Garmin","Polar","Abus","Giro","Shimano","Continental","Salomon","Bowflex","TRX","Therabody","Reebok","Under Armour","New Balance","Lezyne","Castelli"],
};

// ---- Recommended retail prices (invented, plausible). Per-store prices are
//      derived from these deterministically, so numbers are stable across
//      page loads and between the two of you. ----
const RRP: Record<string, number> = {
  "run-pegasus41": 139.99,
  "run-vomero18": 159.99,
  "run-vaporfly3": 274.99,
  "run-alphafly3": 299.99,
  "run-structure25": 129.99,
  "run-boston12": 169.95,
  "run-supernova": 129.95,
  "run-ultraboost": 189.95,
  "run-nimbus26": 189.99,
  "run-kayano31": 199.99,
  "run-novablast4": 149.99,
  "run-ghost16": 149.95,
  "run-glycerin21": 179.95,
  "run-clifton9": 149.99,
  "run-speedgoat5": 144.99,
  "run-cloudmonster": 179.95,
  "run-cloudsurfer6": 169.95,
  "run-endorphin4": 179.95,
  "run-speedcross6": 139.95,
  "run-kiprunkd900": 129.99,
  "run-kiprunks500": 59.99,
  "run-kalenjiactive": 34.99,
  "run-fr265": 449.99,
  "run-fr965": 649.99,
  "run-vantagev3": 599.90,
  "run-h10": 89.90,
  "bike-edge540": 379.99,
  "bike-edge840": 499.99,
  "bike-varia515": 199.99,
  "bike-aduro": 64.95,
  "bike-gamechanger": 179.95,
  "bike-girosyntax": 129.95,
  "bike-gp5000": 74.95,
  "bike-pdm520": 49.99,
  "bike-macrodrive": 89.95,
  "bike-espresso": 159.95,
  "bike-riverside500": 399.99,
  "bike-vanrysel": 2499.00,
  "fit-metcon9": 149.99,
  "fit-freemetcon6": 129.99,
  "fit-dropset3": 129.95,
  "fit-nanox4": 139.95,
  "fit-projectrock": 159.95,
  "fit-bowflex552": 449.00,
  "fit-trxhome2": 179.95,
  "fit-theragunprime": 299.00,
  "fit-domyosdumbbell": 129.99,
  "fit-corengthkb": 34.99,
  "fit-domyosmat": 19.99,
};

// ---- Product images: self-contained SVG data URIs. No external requests, no
//      licensing question, and obviously a placeholder rather than a photo. ----
const BRAND_HUE: Record<string, number> = {};
function imageFor(p: { brand: string; name: string; subcategory: string }): string {
  let h = 0;
  for (const ch of p.brand) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const label = p.brand.replace(/[<>&]/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">` +
    `<rect width="600" height="600" fill="hsl(${hue} 32% 92%)"/>` +
    `<circle cx="300" cy="248" r="118" fill="hsl(${hue} 42% 80%)"/>` +
    `<text x="300" y="272" font-family="system-ui,sans-serif" font-size="86" font-weight="700" ` +
    `fill="hsl(${hue} 45% 32%)" text-anchor="middle">${label.slice(0, 2).toUpperCase()}</text>` +
    `<text x="300" y="430" font-family="system-ui,sans-serif" font-size="34" ` +
    `fill="hsl(${hue} 30% 38%)" text-anchor="middle">${label}</text>` +
    `<text x="300" y="478" font-family="system-ui,sans-serif" font-size="24" ` +
    `fill="hsl(${hue} 20% 52%)" text-anchor="middle">${p.subcategory}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// ---- The catalogue ----------------------------------------------------------
const RAW: Omit<Product, "image">[] = [
  { id: "run-pegasus41", ean: "8712000000004", brand: "Nike",
    name: "Nike Pegasus 41", unit: "Hardloopschoen · dagelijks",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "4", released: "2025", level: "beginner" } },
  { id: "run-vomero18", ean: "8712000007911", brand: "Nike",
    name: "Nike Vomero 18", unit: "Hardloopschoen · demping",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "4", released: "2026", level: "beginner" } },
  { id: "run-vaporfly3", ean: "8712000015831", brand: "Nike",
    name: "Nike Vaporfly 3", unit: "Hardloopschoen · wedstrijd",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "5", released: "2025", level: "gevorderd" } },
  { id: "run-alphafly3", ean: "8712000023751", brand: "Nike",
    name: "Nike Alphafly 3", unit: "Hardloopschoen · wedstrijd",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "5", released: "2026", level: "gevorderd" } },
  { id: "run-structure25", ean: "8712000031671", brand: "Nike",
    name: "Nike Structure 25", unit: "Hardloopschoen · stabiliteit",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "3", released: "2025", level: "beginner" } },
  { id: "run-boston12", ean: "8712000039592", brand: "adidas",
    name: "adidas Adizero Boston 12", unit: "Hardloopschoen · tempo",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "run-supernova", ean: "8712000047511", brand: "adidas",
    name: "adidas Supernova Rise", unit: "Hardloopschoen · dagelijks",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "3", released: "2025", level: "beginner" } },
  { id: "run-ultraboost", ean: "8712000055431", brand: "adidas",
    name: "adidas Ultraboost Light", unit: "Hardloopschoen · demping",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "4", released: "2025", level: "beginner" } },
  { id: "run-nimbus26", ean: "8712000063351", brand: "Asics",
    name: "Asics Gel-Nimbus 26", unit: "Hardloopschoen · demping",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "5", released: "2025", level: "beginner" } },
  { id: "run-kayano31", ean: "8712000071271", brand: "Asics",
    name: "Asics Gel-Kayano 31", unit: "Hardloopschoen · stabiliteit",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "5", released: "2026", level: "gevorderd" } },
  { id: "run-novablast4", ean: "8712000079192", brand: "Asics",
    name: "Asics Novablast 4", unit: "Hardloopschoen · dagelijks",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "4", released: "2025", level: "beginner" } },
  { id: "run-ghost16", ean: "8712000087104", brand: "Brooks",
    name: "Brooks Ghost 16", unit: "Hardloopschoen · dagelijks",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "4", released: "2025", level: "beginner" } },
  { id: "run-glycerin21", ean: "8712000095024", brand: "Brooks",
    name: "Brooks Glycerin 21", unit: "Hardloopschoen · demping",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "run-clifton9", ean: "8712000102944", brand: "Hoka",
    name: "Hoka Clifton 9", unit: "Hardloopschoen · demping",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "4", released: "2025", level: "beginner" } },
  { id: "run-speedgoat5", ean: "8712000110864", brand: "Hoka",
    name: "Hoka Speedgoat 5", unit: "Trailschoen · technisch",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "run-cloudmonster", ean: "8712000118785", brand: "On",
    name: "On Cloudmonster", unit: "Hardloopschoen · demping",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "4", released: "2025", level: "beginner" } },
  { id: "run-cloudsurfer6", ean: "8712000126704", brand: "On",
    name: "On Cloudsurfer 6", unit: "Hardloopschoen · dagelijks",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "4", released: "2026", level: "beginner" } },
  { id: "run-endorphin4", ean: "8712000134624", brand: "Saucony",
    name: "Saucony Endorphin Speed 4", unit: "Hardloopschoen · tempo",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "5", released: "2026", level: "gevorderd" } },
  { id: "run-speedcross6", ean: "8712000142544", brand: "Salomon",
    name: "Salomon Speedcross 6", unit: "Trailschoen · zacht terrein",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "run-kiprunkd900", ean: "8712000150464", brand: "Kiprun",
    name: "Kiprun KD900X LD", unit: "Hardloopschoen · wedstrijd",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "run-kiprunks500", ean: "8712000158385", brand: "Kiprun",
    name: "Kiprun KS500 2", unit: "Hardloopschoen · instap",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "value", quality: "3", released: "2025", level: "beginner" } },
  { id: "run-kalenjiactive", ean: "8712000166298", brand: "Kalenji",
    name: "Kalenji Run Active", unit: "Hardloopschoen · instap",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "value", quality: "2", released: "2025", level: "beginner" } },
  { id: "run-fr265", ean: "8712000174217", brand: "Garmin",
    name: "Garmin Forerunner 265", unit: "GPS-hardloophorloge",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "5", released: "2025", level: "gevorderd" } },
  { id: "run-fr965", ean: "8712000182137", brand: "Garmin",
    name: "Garmin Forerunner 965", unit: "GPS-hardloophorloge",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "5", released: "2025", level: "gevorderd" } },
  { id: "run-vantagev3", ean: "8712000190057", brand: "Polar",
    name: "Polar Vantage V3", unit: "GPS-multisporthorloge",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "premium", quality: "5", released: "2026", level: "gevorderd" } },
  { id: "run-h10", ean: "8712000197971", brand: "Polar",
    name: "Polar H10 Hartslagsensor", unit: "Hartslagband · borst",
    category: "sport", subcategory: "hardlopen",
    specs: { tier: "mid", quality: "5", released: "2024", level: "beginner" } },
  { id: "bike-edge540", ean: "8712000205898", brand: "Garmin",
    name: "Garmin Edge 540", unit: "Fietscomputer · GPS",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "premium", quality: "5", released: "2025", level: "gevorderd" } },
  { id: "bike-edge840", ean: "8712000213817", brand: "Garmin",
    name: "Garmin Edge 840", unit: "Fietscomputer · GPS touch",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "premium", quality: "5", released: "2025", level: "gevorderd" } },
  { id: "bike-varia515", ean: "8712000221737", brand: "Garmin",
    name: "Garmin Varia RTL515", unit: "Achterlicht · radar",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "premium", quality: "5", released: "2024", level: "gevorderd" } },
  { id: "bike-aduro", ean: "8712000229658", brand: "Abus",
    name: "Abus Aduro 2.0", unit: "Fietshelm · stad",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "mid", quality: "4", released: "2024", level: "beginner" } },
  { id: "bike-gamechanger", ean: "8712000237578", brand: "Abus",
    name: "Abus GameChanger 2.0", unit: "Fietshelm · racen",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "premium", quality: "5", released: "2025", level: "gevorderd" } },
  { id: "bike-girosyntax", ean: "8712000245481", brand: "Giro",
    name: "Giro Syntax MIPS", unit: "Fietshelm · racen",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "mid", quality: "4", released: "2024", level: "gevorderd" } },
  { id: "bike-gp5000", ean: "8712000253400", brand: "Continental",
    name: "Continental Grand Prix 5000", unit: "Buitenband · 700x25c",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "premium", quality: "5", released: "2024", level: "gevorderd" } },
  { id: "bike-pdm520", ean: "8712000261320", brand: "Shimano",
    name: "Shimano PD-M520", unit: "Klikpedalen · SPD",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "mid", quality: "4", released: "2023", level: "beginner" } },
  { id: "bike-macrodrive", ean: "8712000269241", brand: "Lezyne",
    name: "Lezyne Macro Drive 1300", unit: "Koplamp · 1300 lumen",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "mid", quality: "4", released: "2024", level: "beginner" } },
  { id: "bike-espresso", ean: "8712000277161", brand: "Castelli",
    name: "Castelli Espresso Bibshort", unit: "Fietsbroek · lange rit",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "premium", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "bike-riverside500", ean: "8712000285081", brand: "B'Twin",
    name: "B'Twin Riverside 500", unit: "Hybride fiets · 28 inch",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "value", quality: "3", released: "2025", level: "beginner" } },
  { id: "bike-vanrysel", ean: "8712000293000", brand: "Van Rysel",
    name: "Van Rysel RCR Rival AXS", unit: "Racefiets · carbon",
    category: "sport", subcategory: "fietsen",
    specs: { tier: "premium", quality: "5", released: "2026", level: "gevorderd" } },
  { id: "fit-metcon9", ean: "8712000300920", brand: "Nike",
    name: "Nike Metcon 9", unit: "Trainingsschoen · kracht",
    category: "sport", subcategory: "fitness",
    specs: { tier: "mid", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "fit-freemetcon6", ean: "8712000308841", brand: "Nike",
    name: "Nike Free Metcon 6", unit: "Trainingsschoen · veelzijdig",
    category: "sport", subcategory: "fitness",
    specs: { tier: "mid", quality: "4", released: "2025", level: "beginner" } },
  { id: "fit-dropset3", ean: "8712000316761", brand: "adidas",
    name: "adidas Dropset 3", unit: "Trainingsschoen · kracht",
    category: "sport", subcategory: "fitness",
    specs: { tier: "mid", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "fit-nanox4", ean: "8712000324674", brand: "Reebok",
    name: "Reebok Nano X4", unit: "Trainingsschoen · crossfit",
    category: "sport", subcategory: "fitness",
    specs: { tier: "mid", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "fit-projectrock", ean: "8712000332594", brand: "Under Armour",
    name: "Under Armour Project Rock 6", unit: "Trainingsschoen · kracht",
    category: "sport", subcategory: "fitness",
    specs: { tier: "premium", quality: "4", released: "2025", level: "gevorderd" } },
  { id: "fit-bowflex552", ean: "8712000340513", brand: "Bowflex",
    name: "Bowflex SelectTech 552", unit: "Verstelbare dumbbells · 2x24kg",
    category: "sport", subcategory: "fitness",
    specs: { tier: "premium", quality: "5", released: "2024", level: "gevorderd" } },
  { id: "fit-trxhome2", ean: "8712000348434", brand: "TRX",
    name: "TRX Home2 System", unit: "Suspension trainer",
    category: "sport", subcategory: "fitness",
    specs: { tier: "premium", quality: "4", released: "2024", level: "beginner" } },
  { id: "fit-theragunprime", ean: "8712000356354", brand: "Therabody",
    name: "Theragun Prime", unit: "Massage gun",
    category: "sport", subcategory: "fitness",
    specs: { tier: "premium", quality: "4", released: "2025", level: "beginner" } },
  { id: "fit-domyosdumbbell", ean: "8712000364274", brand: "Domyos",
    name: "Domyos Dumbbellset 20kg", unit: "Halterset · verstelbaar",
    category: "sport", subcategory: "fitness",
    specs: { tier: "value", quality: "3", released: "2024", level: "beginner" } },
  { id: "fit-corengthkb", ean: "8712000372194", brand: "Corength",
    name: "Corength Kettlebell 12kg", unit: "Kettlebell · gietijzer",
    category: "sport", subcategory: "fitness",
    specs: { tier: "value", quality: "3", released: "2024", level: "beginner" } },
  { id: "fit-domyosmat", ean: "8712000380113", brand: "Domyos",
    name: "Domyos Fitnessmat 8mm", unit: "Fitnessmat · comfort",
    category: "sport", subcategory: "fitness",
    specs: { tier: "value", quality: "2", released: "2024", level: "beginner" } },
];

export const PRODUCTS: Product[] = RAW.map((p) => ({ ...p, image: imageFor(p) }));

// ---- Deterministic per-store pricing ----------------------------------------
const STORE_BIAS: Record<string, number> = {
  "decathlon.nl": 0.96,
  "bol.com": 0.975,
  "intersport.nl": 1.01,
  "jdsports.nl": 1,
  "bever.nl": 1.02,
};

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// A product is offered by a store only if the store carries the brand — which
// is why some products have four competing offers and some have one.
function offersFor(p: Product): Offer[] {
  const rrp = RRP[p.id] ?? 100;
  const now = new Date().toISOString();
  return STORES
    .filter((store) => STOCKS[store].includes(p.brand))
    .map((store) => {
      const jitter = 1 + (((hash(p.id + store) % 81) - 40) / 1000); // ±4%
      const own = store === "decathlon.nl";
      const price = Math.round(rrp * (STORE_BIAS[store] ?? 1) * jitter * (own ? 0.97 : 1) * 100) / 100;
      return {
        productId: p.id,
        store,
        price,
        currency: "EUR" as const,
        // A little realistic scarcity, deterministic so it does not flicker.
        inStock: hash(p.id + store + "stock") % 11 !== 0,
        url: `https://example.invalid/out?store=${store}&pid=${p.id}`,
        lastChecked: now,
      };
    })
    .sort((a, b) => a.price - b.price); // cheapest first — the backend guarantees this
}

// ---- The seven functions the API routes import. Signatures unchanged. -------

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
      p.brand.toLowerCase().includes(needle) ||
      p.subcategory.toLowerCase().includes(needle) ||
      p.unit.toLowerCase().includes(needle)
  );
}

const CATEGORY_PAGES: Record<Category, CategoryPage> = {
  sport: {
    category: "sport", name: "Sport",
    blurb: "Vind de juiste spullen voor de sport die je écht doet — met de prijs van elke winkel naast elkaar.",
    subcategories: [
      { id: "hardlopen", name: "Hardlopen", icon: "shoe",
        essentials: ["Hardloopschoenen", "GPS-horloge", "Hardloopsokken", "Hartslagband"] },
      { id: "fietsen", name: "Fietsen", icon: "bike",
        essentials: ["Fiets", "Helm", "Fietsbroek", "Verlichting"] },
      { id: "fitness", name: "Fitness", icon: "dumbbell",
        essentials: ["Trainingsschoenen", "Dumbbells", "Fitnessmat", "Weerstandsbanden"] },
    ],
  },
  // Home and tech are deliberately empty for the sports-first launch. The pages
  // still resolve (no 404s) so navigation works; they simply have no products
  // until a retailer set exists for them.
  home: {
    category: "home", name: "Wonen",
    blurb: "Binnenkort — we beginnen met sport en breiden daarna uit.",
    subcategories: [],
  },
  tech: {
    category: "tech", name: "Techniek",
    blurb: "Binnenkort — we beginnen met sport en breiden daarna uit.",
    subcategories: [],
  },
};

export function getCategory(cat: string): CategoryPage | null {
  return CATEGORY_PAGES[cat as Category] ?? null;
}

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

// A 31-point daily history for the cheapest store. The real backend replaces
// this with stored observations — one row per refresh, from day one, because
// price history cannot be recreated retrospectively.
export function getPriceHistory(id: string): PriceHistory | null {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) return null;
  const offers = offersFor(product);
  if (offers.length === 0) {
    return { productId: id, points: [], currentMin: 0, min30: 0, max30: 0, isLowest30: false };
  }
  const currentMin = offers[0].price;
  const store = offers[0].store;
  const points: PricePoint[] = [];
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Roughly a quarter of products are genuinely AT their 30-day low right now.
  // Without this, every historical point wobbles below the current price and
  // `isLowest30` is false for everything — which silently kills the "laagste in
  // 30 dagen" badge, one of the honest signals the whole proposition rests on.
  // For those products history stays at or above today; for the rest it dips.
  const atLow = hash(id + ":low") % 4 === 0;

  for (let d = 30; d >= 0; d--) {
    // Deterministic per product AND per day, so different products have
    // genuinely different-looking charts rather than one shared wobble.
    const raw = ((hash(id + ":" + d) % 161) - 80) / 1000; // ±8%
    const w = atLow ? Math.abs(raw) : raw;
    points.push({
      at: new Date(now - d * day).toISOString(),
      store,
      price: Math.round(currentMin * (1 + w) * 100) / 100,
    });
  }
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
      const offer = offersFor(p).find((o) => o.store === store && o.inStock);
      if (offer) total += offer.price;
      else missing.push(p.name);
    }
    return {
      store,
      total: Math.round(total * 100) / 100,
      complete: chosen.length > 0 && missing.length === 0,
      missing,
    };
  }).sort((a, b) => Number(b.complete) - Number(a.complete) || a.total - b.total);

  return { totals, cheapestComplete: totals.find((t) => t.complete) };
}
