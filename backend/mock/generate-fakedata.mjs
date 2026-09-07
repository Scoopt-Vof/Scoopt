/**
 * Generates lib/fakeData.ts — a drop-in replacement for Josh's stand-in data.
 *
 * Same seven exports, same signatures, same return shapes. Real Dutch sports
 * products and real Dutch sports retailers. THE PRICES AND EANs ARE INVENTED.
 *
 * Run:  node mock/generate-fakedata.mjs
 * Out:  mock/out/fakeData.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';

// ---------------------------------------------------------------------------
// EAN-13 with a correct check digit. Structurally valid, factually invented —
// so the matching logic exercises properly without claiming to be real barcodes.
// ---------------------------------------------------------------------------
function ean13(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return first12 + String((10 - (sum % 10)) % 10);
}
let eanSeq = 0;
const nextEan = () => ean13('871' + String(2000000000 + (eanSeq++ * 7919)).slice(0, 9));

// ---------------------------------------------------------------------------
// The retailers. Dutch sports only, per the launch scope.
// ---------------------------------------------------------------------------
const STORES = ['decathlon.nl', 'jdsports.nl', 'bever.nl', 'intersport.nl', 'bol.com'];

const DELIVERY_RULES = [
  { store: 'decathlon.nl', fee: 3.99, freeAbove: 30 },
  { store: 'jdsports.nl',  fee: 3.95, freeAbove: 70 },
  { store: 'bever.nl',     fee: 4.95, freeAbove: 50 },
  { store: 'intersport.nl',fee: 4.95, freeAbove: 50 },
  { store: 'bol.com',      fee: 0,    freeAbove: 0  },
];

/**
 * WHICH STORE CARRIES WHICH BRAND — the single most important thing in this file.
 *
 * Decathlon's catalogue is overwhelmingly own-brand (Kiprun, Kalenji, B'Twin,
 * Van Rysel, Domyos, Corength) and those barcodes exist nowhere else. So a
 * Decathlon-only product has exactly ONE offer and no comparison. The comparison
 * engine only has anything to do on the third-party brands that several
 * retailers carry — Nike, adidas, Asics, Garmin and so on.
 *
 * Modelling that honestly here means the demo shows the real dynamic: some
 * products have four competing offers, some have one. A mock where everything
 * has five offers would flatter the product and teach you nothing.
 */
const STOCKS = {
  'decathlon.nl': ['Kiprun','Kalenji','B\'Twin','Van Rysel','Domyos','Corength','Garmin','Polar','Shimano','Continental'],
  'jdsports.nl':  ['Nike','adidas','Reebok','Under Armour','Asics','New Balance','Hoka','On'],
  'bever.nl':     ['Salomon','Hoka','On','Osprey','Garmin','Leki','Polar'],
  'intersport.nl':['Nike','adidas','Asics','Brooks','Hoka','Saucony','Abus','Giro','Salomon','On',
                   'Garmin','Polar','Under Armour','New Balance'],
  'bol.com':      ['Nike','adidas','Asics','Brooks','Hoka','On','Saucony','Garmin','Polar','Abus','Giro',
                   'Shimano','Continental','Salomon','Bowflex','TRX','Therabody','Reebok','Under Armour',
                   'New Balance','Lezyne','Castelli'],
};

// ---------------------------------------------------------------------------
// The catalogue. [id, brand, name, unit, subcategory, rrp, tier, quality, released, level]
// RRPs are plausible market prices, invented. Not scraped, not quoted.
// ---------------------------------------------------------------------------
const CATALOGUE = [
  // ── hardlopen ────────────────────────────────────────────────────────────
  ['run-pegasus41',    'Nike','Nike Pegasus 41','Hardloopschoen · dagelijks','hardlopen',139.99,'mid','4','2025','beginner'],
  ['run-vomero18',     'Nike','Nike Vomero 18','Hardloopschoen · demping','hardlopen',159.99,'mid','4','2026','beginner'],
  ['run-vaporfly3',    'Nike','Nike Vaporfly 3','Hardloopschoen · wedstrijd','hardlopen',274.99,'premium','5','2025','gevorderd'],
  ['run-alphafly3',    'Nike','Nike Alphafly 3','Hardloopschoen · wedstrijd','hardlopen',299.99,'premium','5','2026','gevorderd'],
  ['run-structure25',  'Nike','Nike Structure 25','Hardloopschoen · stabiliteit','hardlopen',129.99,'mid','3','2025','beginner'],
  ['run-boston12',     'adidas','adidas Adizero Boston 12','Hardloopschoen · tempo','hardlopen',169.95,'premium','4','2025','gevorderd'],
  ['run-supernova',    'adidas','adidas Supernova Rise','Hardloopschoen · dagelijks','hardlopen',129.95,'mid','3','2025','beginner'],
  ['run-ultraboost',   'adidas','adidas Ultraboost Light','Hardloopschoen · demping','hardlopen',189.95,'premium','4','2025','beginner'],
  ['run-nimbus26',     'Asics','Asics Gel-Nimbus 26','Hardloopschoen · demping','hardlopen',189.99,'premium','5','2025','beginner'],
  ['run-kayano31',     'Asics','Asics Gel-Kayano 31','Hardloopschoen · stabiliteit','hardlopen',199.99,'premium','5','2026','gevorderd'],
  ['run-novablast4',   'Asics','Asics Novablast 4','Hardloopschoen · dagelijks','hardlopen',149.99,'mid','4','2025','beginner'],
  ['run-ghost16',      'Brooks','Brooks Ghost 16','Hardloopschoen · dagelijks','hardlopen',149.95,'mid','4','2025','beginner'],
  ['run-glycerin21',   'Brooks','Brooks Glycerin 21','Hardloopschoen · demping','hardlopen',179.95,'premium','4','2025','gevorderd'],
  ['run-clifton9',     'Hoka','Hoka Clifton 9','Hardloopschoen · demping','hardlopen',149.99,'mid','4','2025','beginner'],
  ['run-speedgoat5',   'Hoka','Hoka Speedgoat 5','Trailschoen · technisch','hardlopen',144.99,'mid','4','2025','gevorderd'],
  ['run-cloudmonster', 'On','On Cloudmonster','Hardloopschoen · demping','hardlopen',179.95,'premium','4','2025','beginner'],
  ['run-cloudsurfer6', 'On','On Cloudsurfer 6','Hardloopschoen · dagelijks','hardlopen',169.95,'premium','4','2026','beginner'],
  ['run-endorphin4',   'Saucony','Saucony Endorphin Speed 4','Hardloopschoen · tempo','hardlopen',179.95,'premium','5','2026','gevorderd'],
  ['run-speedcross6',  'Salomon','Salomon Speedcross 6','Trailschoen · zacht terrein','hardlopen',139.95,'mid','4','2025','gevorderd'],
  ['run-kiprunkd900',  'Kiprun','Kiprun KD900X LD','Hardloopschoen · wedstrijd','hardlopen',129.99,'mid','4','2025','gevorderd'],
  ['run-kiprunks500',  'Kiprun','Kiprun KS500 2','Hardloopschoen · instap','hardlopen',59.99,'value','3','2025','beginner'],
  ['run-kalenjiactive','Kalenji','Kalenji Run Active','Hardloopschoen · instap','hardlopen',34.99,'value','2','2025','beginner'],
  ['run-fr265',        'Garmin','Garmin Forerunner 265','GPS-hardloophorloge','hardlopen',449.99,'premium','5','2025','gevorderd'],
  ['run-fr965',        'Garmin','Garmin Forerunner 965','GPS-hardloophorloge','hardlopen',649.99,'premium','5','2025','gevorderd'],
  ['run-vantagev3',    'Polar','Polar Vantage V3','GPS-multisporthorloge','hardlopen',599.90,'premium','5','2026','gevorderd'],
  ['run-h10',          'Polar','Polar H10 Hartslagsensor','Hartslagband · borst','hardlopen',89.90,'mid','5','2024','beginner'],

  // ── fietsen ──────────────────────────────────────────────────────────────
  ['bike-edge540',     'Garmin','Garmin Edge 540','Fietscomputer · GPS','fietsen',379.99,'premium','5','2025','gevorderd'],
  ['bike-edge840',     'Garmin','Garmin Edge 840','Fietscomputer · GPS touch','fietsen',499.99,'premium','5','2025','gevorderd'],
  ['bike-varia515',    'Garmin','Garmin Varia RTL515','Achterlicht · radar','fietsen',199.99,'premium','5','2024','gevorderd'],
  ['bike-aduro',       'Abus','Abus Aduro 2.0','Fietshelm · stad','fietsen',64.95,'mid','4','2024','beginner'],
  ['bike-gamechanger', 'Abus','Abus GameChanger 2.0','Fietshelm · racen','fietsen',179.95,'premium','5','2025','gevorderd'],
  ['bike-girosyntax',  'Giro','Giro Syntax MIPS','Fietshelm · racen','fietsen',129.95,'mid','4','2024','gevorderd'],
  ['bike-gp5000',      'Continental','Continental Grand Prix 5000','Buitenband · 700x25c','fietsen',74.95,'premium','5','2024','gevorderd'],
  ['bike-pdm520',      'Shimano','Shimano PD-M520','Klikpedalen · SPD','fietsen',49.99,'mid','4','2023','beginner'],
  ['bike-macrodrive',  'Lezyne','Lezyne Macro Drive 1300','Koplamp · 1300 lumen','fietsen',89.95,'mid','4','2024','beginner'],
  ['bike-espresso',    'Castelli','Castelli Espresso Bibshort','Fietsbroek · lange rit','fietsen',159.95,'premium','4','2025','gevorderd'],
  ['bike-riverside500','B\'Twin','B\'Twin Riverside 500','Hybride fiets · 28 inch','fietsen',399.99,'value','3','2025','beginner'],
  ['bike-vanrysel',    'Van Rysel','Van Rysel RCR Rival AXS','Racefiets · carbon','fietsen',2499.00,'premium','5','2026','gevorderd'],

  // ── fitness ──────────────────────────────────────────────────────────────
  ['fit-metcon9',      'Nike','Nike Metcon 9','Trainingsschoen · kracht','fitness',149.99,'mid','4','2025','gevorderd'],
  ['fit-freemetcon6',  'Nike','Nike Free Metcon 6','Trainingsschoen · veelzijdig','fitness',129.99,'mid','4','2025','beginner'],
  ['fit-dropset3',     'adidas','adidas Dropset 3','Trainingsschoen · kracht','fitness',129.95,'mid','4','2025','gevorderd'],
  ['fit-nanox4',       'Reebok','Reebok Nano X4','Trainingsschoen · crossfit','fitness',139.95,'mid','4','2025','gevorderd'],
  ['fit-projectrock',  'Under Armour','Under Armour Project Rock 6','Trainingsschoen · kracht','fitness',159.95,'premium','4','2025','gevorderd'],
  ['fit-bowflex552',   'Bowflex','Bowflex SelectTech 552','Verstelbare dumbbells · 2x24kg','fitness',449.00,'premium','5','2024','gevorderd'],
  ['fit-trxhome2',     'TRX','TRX Home2 System','Suspension trainer','fitness',179.95,'premium','4','2024','beginner'],
  ['fit-theragunprime','Therabody','Theragun Prime','Massage gun','fitness',299.00,'premium','4','2025','beginner'],
  ['fit-domyosdumbbell','Domyos','Domyos Dumbbellset 20kg','Halterset · verstelbaar','fitness',129.99,'value','3','2024','beginner'],
  ['fit-corengthkb',   'Corength','Corength Kettlebell 12kg','Kettlebell · gietijzer','fitness',34.99,'value','3','2024','beginner'],
  ['fit-domyosmat',    'Domyos','Domyos Fitnessmat 8mm','Fitnessmat · comfort','fitness',19.99,'value','2','2024','beginner'],
];

// ---------------------------------------------------------------------------
// Deterministic per-store price. Realistic rather than uniform: a retailer that
// owns the brand undercuts, marketplaces run keen, monobrand stores sit at RRP.
// ---------------------------------------------------------------------------
const STORE_BIAS = {
  'decathlon.nl': 0.96, 'bol.com': 0.975, 'intersport.nl': 1.01,
  'jdsports.nl': 1.0,   'bever.nl': 1.02,
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

function priceFor(id, rrp, store) {
  // ±4% deterministic jitter on top of the store's structural bias.
  const jitter = 1 + (((hash(id + store) % 81) - 40) / 1000);
  const own = STOCKS['decathlon.nl'].length && store === 'decathlon.nl';
  const p = rrp * (STORE_BIAS[store] ?? 1) * jitter * (own ? 0.97 : 1);
  return Math.round(p * 100) / 100;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
const products = CATALOGUE.map(([id, brand, name, unit, subcategory, rrp, tier, quality, released, level]) => ({
  id, ean: nextEan(), brand, name, unit,
  category: 'sport', subcategory,
  rrp, specs: { tier, quality, released, level },
}));

// Sanity: every product must be stocked somewhere, or it can never be shown.
for (const p of products) {
  const stores = STORES.filter((s) => STOCKS[s].includes(p.brand));
  if (stores.length === 0) throw new Error(`${p.id}: brand "${p.brand}" is in no STOCKS list`);
}

const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
for (const p of products) {
  counts[STORES.filter((s) => STOCKS[s].includes(p.brand)).length]++;
}

const lines = [];
const L = (s = '') => lines.push(s);

L('// ============================================================================');
L('//  FAKE DATA — real Dutch sports products, INVENTED prices.');
L('// ----------------------------------------------------------------------------');
L('//  Drop-in replacement for the original lib/fakeData.ts. Identical exports,');
L('//  identical signatures, identical return shapes — every one of the eight API');
L('//  routes keeps working with no other change.');
L('//');
L('//  ⚠️  THE PRICES AND EANs IN THIS FILE ARE MADE UP.');
L('//      Brands, product names and RRP ballparks are real so the site looks like');
L('//      the real thing while you build it. The numbers are not real and must');
L('//      never reach a public site — invented prices on a live comparison site');
L('//      are misleading to consumers under the ACM Leidraad, and any retailer');
L('//      reviewing an affiliate application will spot-check one.');
L('//      Local development and demos only.');
L('//');
L(`//  ${products.length} products · 3 subcategories · ${STORES.length} Dutch sports retailers`);
L('//  Offers per product: ' + Object.entries(counts).map(([k, v]) => `${v}×${k}-store`).join(', '));
L('// ============================================================================');
L();
L('import type {');
L('  Product, Offer, ProductWithOffers, CategoryPage, Category,');
L('  BasketRequest, BasketResult, StoreBasketTotal, PriceHistory, PricePoint,');
L('} from "@/contract/types";');
L();
L('// ---- Dutch sports retailers. All five have a route to a sanctioned feed:');
L('//      Decathlon via Odyssey Partnerships, JD Sports + Bever via Awin,');
L('//      Intersport via Daisycon, bol.com via its own affiliate programme. ----');
L(`const STORES = ${JSON.stringify(STORES)};`);
L();
L('// ---- Delivery rules per store (illustrative; the real feeds supply these) ----');
L('export const DELIVERY_RULES = [');
for (const r of DELIVERY_RULES) {
  L(`  { store: ${JSON.stringify(r.store)}, fee: ${r.fee.toFixed(2)}, freeAbove: ${r.freeAbove} },`);
}
L('];');
L();
L('// ---- WHICH STORE CARRIES WHICH BRAND ----------------------------------------');
L('//  This is the most important table in the file, and it is modelled honestly.');
L('//');
L('//  Decathlon\'s catalogue is overwhelmingly own-brand — Kiprun, Kalenji,');
L('//  B\'Twin, Van Rysel, Domyos, Corength — and those barcodes exist nowhere');
L('//  else. So those products get exactly ONE offer and no comparison at all.');
L('//  The comparison engine only has work to do on the third-party brands that');
L('//  several retailers carry: Nike, adidas, Asics, Garmin and so on.');
L('//');
L('//  A mock where every product had five offers would flatter the product and');
L('//  teach you nothing. This one shows the real dynamic, which is also the');
L('//  reason the retailer set has to be chosen for brand overlap.');
L('const STOCKS: Record<string, string[]> = {');
for (const [store, brands] of Object.entries(STOCKS)) {
  L(`  ${JSON.stringify(store)}: ${JSON.stringify(brands)},`);
}
L('};');
L();
L('// ---- Recommended retail prices (invented, plausible). Per-store prices are');
L('//      derived from these deterministically, so numbers are stable across');
L('//      page loads and between the two of you. ----');
L('const RRP: Record<string, number> = {');
for (const p of products) L(`  ${JSON.stringify(p.id)}: ${p.rrp.toFixed(2)},`);
L('};');
L();
L('// ---- Product images: self-contained SVG data URIs. No external requests, no');
L('//      licensing question, and obviously a placeholder rather than a photo. ----');
L('const BRAND_HUE: Record<string, number> = {};');
L('function imageFor(p: { brand: string; name: string; subcategory: string }): string {');
L('  let h = 0;');
L('  for (const ch of p.brand) h = (h * 31 + ch.charCodeAt(0)) >>> 0;');
L('  const hue = h % 360;');
L('  const label = p.brand.replace(/[<>&]/g, "");');
L('  const svg =');
L('    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">` +');
L('    `<rect width="600" height="600" fill="hsl(${hue} 32% 92%)"/>` +');
L('    `<circle cx="300" cy="248" r="118" fill="hsl(${hue} 42% 80%)"/>` +');
L('    `<text x="300" y="272" font-family="system-ui,sans-serif" font-size="86" font-weight="700" ` +');
L('    `fill="hsl(${hue} 45% 32%)" text-anchor="middle">${label.slice(0, 2).toUpperCase()}</text>` +');
L('    `<text x="300" y="430" font-family="system-ui,sans-serif" font-size="34" ` +');
L('    `fill="hsl(${hue} 30% 38%)" text-anchor="middle">${label}</text>` +');
L('    `<text x="300" y="478" font-family="system-ui,sans-serif" font-size="24" ` +');
L('    `fill="hsl(${hue} 20% 52%)" text-anchor="middle">${p.subcategory}</text></svg>`;');
L('  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);');
L('}');
L();
L('// ---- The catalogue ----------------------------------------------------------');
L('const RAW: Omit<Product, "image">[] = [');
for (const p of products) {
  L(`  { id: ${JSON.stringify(p.id)}, ean: ${JSON.stringify(p.ean)}, brand: ${JSON.stringify(p.brand)},`);
  L(`    name: ${JSON.stringify(p.name)}, unit: ${JSON.stringify(p.unit)},`);
  L(`    category: "sport", subcategory: ${JSON.stringify(p.subcategory)},`);
  L(`    specs: { tier: ${JSON.stringify(p.specs.tier)}, quality: ${JSON.stringify(p.specs.quality)}, released: ${JSON.stringify(p.specs.released)}, level: ${JSON.stringify(p.specs.level)} } },`);
}
L('];');
L();
L('export const PRODUCTS: Product[] = RAW.map((p) => ({ ...p, image: imageFor(p) }));');
L();
L('// ---- Deterministic per-store pricing ----------------------------------------');
L('const STORE_BIAS: Record<string, number> = {');
for (const [s, b] of Object.entries(STORE_BIAS)) L(`  ${JSON.stringify(s)}: ${b},`);
L('};');
L();
L('function hash(str: string): number {');
L('  let h = 2166136261;');
L('  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }');
L('  return h >>> 0;');
L('}');
L();
L('// A product is offered by a store only if the store carries the brand — which');
L('// is why some products have four competing offers and some have one.');
L('function offersFor(p: Product): Offer[] {');
L('  const rrp = RRP[p.id] ?? 100;');
L('  const now = new Date().toISOString();');
L('  return STORES');
L('    .filter((store) => STOCKS[store].includes(p.brand))');
L('    .map((store) => {');
L('      const jitter = 1 + (((hash(p.id + store) % 81) - 40) / 1000); // ±4%');
L('      const own = store === "decathlon.nl";');
L('      const price = Math.round(rrp * (STORE_BIAS[store] ?? 1) * jitter * (own ? 0.97 : 1) * 100) / 100;');
L('      return {');
L('        productId: p.id,');
L('        store,');
L('        price,');
L('        currency: "EUR" as const,');
L('        // A little realistic scarcity, deterministic so it does not flicker.');
L('        inStock: hash(p.id + store + "stock") % 11 !== 0,');
L('        url: `https://example.invalid/out?store=${store}&pid=${p.id}`,');
L('        lastChecked: now,');
L('      };');
L('    })');
L('    .sort((a, b) => a.price - b.price); // cheapest first — the backend guarantees this');
L('}');
L();
L('// ---- The seven functions the API routes import. Signatures unchanged. -------');
L();
L('export function getProduct(id: string): ProductWithOffers | null {');
L('  const product = PRODUCTS.find((p) => p.id === id);');
L('  if (!product) return null;');
L('  return { product, offers: offersFor(product) };');
L('}');
L();
L('export function searchProducts(q: string): Product[] {');
L('  const needle = q.trim().toLowerCase();');
L('  if (!needle) return PRODUCTS;');
L('  return PRODUCTS.filter(');
L('    (p) =>');
L('      p.name.toLowerCase().includes(needle) ||');
L('      p.brand.toLowerCase().includes(needle) ||');
L('      p.subcategory.toLowerCase().includes(needle) ||');
L('      p.unit.toLowerCase().includes(needle)');
L('  );');
L('}');
L();
L('const CATEGORY_PAGES: Record<Category, CategoryPage> = {');
L('  sport: {');
L('    category: "sport", name: "Sport",');
L('    blurb: "Vind de juiste spullen voor de sport die je écht doet — met de prijs van elke winkel naast elkaar.",');
L('    subcategories: [');
L('      { id: "hardlopen", name: "Hardlopen", icon: "shoe",');
L('        essentials: ["Hardloopschoenen", "GPS-horloge", "Hardloopsokken", "Hartslagband"] },');
L('      { id: "fietsen", name: "Fietsen", icon: "bike",');
L('        essentials: ["Fiets", "Helm", "Fietsbroek", "Verlichting"] },');
L('      { id: "fitness", name: "Fitness", icon: "dumbbell",');
L('        essentials: ["Trainingsschoenen", "Dumbbells", "Fitnessmat", "Weerstandsbanden"] },');
L('    ],');
L('  },');
L('  // Home and tech are deliberately empty for the sports-first launch. The pages');
L('  // still resolve (no 404s) so navigation works; they simply have no products');
L('  // until a retailer set exists for them.');
L('  home: {');
L('    category: "home", name: "Wonen",');
L('    blurb: "Binnenkort — we beginnen met sport en breiden daarna uit.",');
L('    subcategories: [],');
L('  },');
L('  tech: {');
L('    category: "tech", name: "Techniek",');
L('    blurb: "Binnenkort — we beginnen met sport en breiden daarna uit.",');
L('    subcategories: [],');
L('  },');
L('};');
L();
L('export function getCategory(cat: string): CategoryPage | null {');
L('  return CATEGORY_PAGES[cat as Category] ?? null;');
L('}');
L();
L('export function basketItemsWithOffers(ids: string[]) {');
L('  return ids');
L('    .map((id) => {');
L('      const product = PRODUCTS.find((p) => p.id === id);');
L('      if (!product) return null;');
L('      return { productId: product.id, productName: product.name, offers: offersFor(product) };');
L('    })');
L('    .filter(');
L('      (x): x is { productId: string; productName: string; offers: Offer[] } => x !== null');
L('    );');
L('}');
L();
L('// A 31-point daily history for the cheapest store. The real backend replaces');
L('// this with stored observations — one row per refresh, from day one, because');
L('// price history cannot be recreated retrospectively.');
L('export function getPriceHistory(id: string): PriceHistory | null {');
L('  const product = PRODUCTS.find((p) => p.id === id);');
L('  if (!product) return null;');
L('  const offers = offersFor(product);');
L('  if (offers.length === 0) {');
L('    return { productId: id, points: [], currentMin: 0, min30: 0, max30: 0, isLowest30: false };');
L('  }');
L('  const currentMin = offers[0].price;');
L('  const store = offers[0].store;');
L('  const points: PricePoint[] = [];');
L('  const now = Date.now();');
L('  const day = 24 * 60 * 60 * 1000;');
L('');
L('  // Roughly a quarter of products are genuinely AT their 30-day low right now.');
L('  // Without this, every historical point wobbles below the current price and');
L('  // `isLowest30` is false for everything — which silently kills the "laagste in');
L('  // 30 dagen" badge, one of the honest signals the whole proposition rests on.');
L('  // For those products history stays at or above today; for the rest it dips.');
L('  const atLow = hash(id + ":low") % 4 === 0;');
L('');
L('  for (let d = 30; d >= 0; d--) {');
L('    // Deterministic per product AND per day, so different products have');
L('    // genuinely different-looking charts rather than one shared wobble.');
L('    const raw = ((hash(id + ":" + d) % 161) - 80) / 1000; // ±8%');
L('    const w = atLow ? Math.abs(raw) : raw;');
L('    points.push({');
L('      at: new Date(now - d * day).toISOString(),');
L('      store,');
L('      price: Math.round(currentMin * (1 + w) * 100) / 100,');
L('    });');
L('  }');
L('  points[points.length - 1] = { at: new Date(now).toISOString(), store, price: currentMin };');
L('  const prices = points.map((p) => p.price);');
L('  const min30 = Math.min(...prices);');
L('  const max30 = Math.max(...prices);');
L('  return {');
L('    productId: id, points, currentMin, min30, max30,');
L('    isLowest30: currentMin <= min30 + 0.001,');
L('  };');
L('}');
L();
L('export function compareBasket(req: BasketRequest): BasketResult {');
L('  const chosen = req.items');
L('    .map((id) => PRODUCTS.find((p) => p.id === id))');
L('    .filter((p): p is Product => Boolean(p));');
L();
L('  const totals: StoreBasketTotal[] = STORES.map((store) => {');
L('    let total = 0;');
L('    const missing: string[] = [];');
L('    for (const p of chosen) {');
L('      const offer = offersFor(p).find((o) => o.store === store && o.inStock);');
L('      if (offer) total += offer.price;');
L('      else missing.push(p.name);');
L('    }');
L('    return {');
L('      store,');
L('      total: Math.round(total * 100) / 100,');
L('      complete: chosen.length > 0 && missing.length === 0,');
L('      missing,');
L('    };');
L('  }).sort((a, b) => Number(b.complete) - Number(a.complete) || a.total - b.total);');
L();
L('  return { totals, cheapestComplete: totals.find((t) => t.complete) };');
L('}');
L();

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/fakeData.ts', import.meta.url), lines.join('\n'));

console.log(`wrote ${products.length} products, ${lines.length} lines`);
console.log('offers per product:', counts);

