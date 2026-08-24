/**
 * THE TRIAL RUN'S CENTRAL CLAIM, TESTED.
 *
 * The same 49 products reach the front end two ways — from lib/fakeData.ts and
 * from Postgres — and the site cannot tell which. This asserts that directly:
 * it runs both implementations over the same inputs and diffs the results.
 *
 * If this passes, flipping the front end from the file to the database is safe.
 * If it fails, it prints exactly which field diverged, which is the only thing
 * you actually need to know.
 *
 * Run:  npm run trial:verify     (needs DATABASE_URL and a seeded database)
 */
import {
  PRODUCTS as FAKE_PRODUCTS, getProduct as fakeGetProduct,
  searchProducts as fakeSearch, getCategory as fakeGetCategory,
  basketItemsWithOffers as fakeBasket, getPriceHistory as fakeHistory,
  compareBasket as fakeCompare, DELIVERY_RULES as FAKE_RULES,
} from './lib/fakeData';
import * as db from '../../src/api/contract-queries';
import { sql } from '../../src/lib/db';

let failures = 0;
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}${detail ? '\n      ' + detail : ''}`); failures++; }
};

/** Timestamps legitimately differ (one is generation time, one is ingest time). */
const stripVolatile = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v), (k, val) =>
    k === 'lastChecked' || k === 'at' ? '<ts>' : val);

/**
 * Deep key-sort before comparing. Postgres returns columns in schema order and
 * the TypeScript file builds objects in literal order, so two identical
 * payloads stringify differently. Comparing raw JSON.stringify reports a
 * difference that does not exist — which is worse than useless, because it
 * hides the real ones underneath it.
 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object).sort().map((k) => [k, canonical((v as any)[k])])
    );
  }
  return v;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(stripVolatile(a))) === JSON.stringify(canonical(stripVolatile(b)));

function firstDiff(a: any, b: any, path = ''): string {
  const A = canonical(stripVolatile(a)) as any, B = canonical(stripVolatile(b)) as any;
  const walk = (x: any, y: any, p: string): string | null => {
    if (JSON.stringify(x) === JSON.stringify(y)) return null;
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) {
      return `${p}: file=${JSON.stringify(x)} db=${JSON.stringify(y)}`;
    }
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) {
      const r = walk(x[k], y[k], p ? `${p}.${k}` : k);
      if (r) return r;
    }
    return null;
  };
  return walk(A, B, path) ?? '(structurally equal)';
}

console.log('\n══ file-backed vs database-backed ═══════════════════════════\n');

console.log('── catalogue ─────────────────────────────────────────────');
const dbAll = await db.searchProducts('');
ok(dbAll.length === FAKE_PRODUCTS.length,
   `same product count (${dbAll.length} vs ${FAKE_PRODUCTS.length})`);

const fakeIds = new Set(FAKE_PRODUCTS.map((p) => p.id));
const dbIds = new Set(dbAll.map((p) => p.id));
const missing = [...fakeIds].filter((i) => !dbIds.has(i));
ok(missing.length === 0, 'every product id round-tripped through the database',
   missing.length ? `missing: ${missing.slice(0, 5).join(', ')}` : '');

console.log('\n── product pages (all 49, offers included) ───────────────');
let productMatches = 0;
const productDiffs: string[] = [];
for (const p of FAKE_PRODUCTS) {
  const a = fakeGetProduct(p.id)!;
  const b = await db.getProduct(p.id);
  if (!b) { productDiffs.push(`${p.id}: missing from database`); continue; }

  // The image is generated in the TS file and not stored in the DB, so compare
  // everything else — that difference is expected and documented.
  const stripImg = (x: any) => ({ ...x, product: { ...x.product, image: '' } });
  if (same(stripImg(a), stripImg(b))) productMatches++;
  else productDiffs.push(`${p.id}: ${firstDiff(stripImg(a), stripImg(b))}`);
}
ok(productMatches === FAKE_PRODUCTS.length,
   `all ${FAKE_PRODUCTS.length} product pages identical (offers, prices, order, stock)`,
   productDiffs.slice(0, 3).join('\n      '));

console.log('\n── offer counts per product ──────────────────────────────');
const fakeSpread: Record<number, number> = {}, dbSpread: Record<number, number> = {};
for (const p of FAKE_PRODUCTS) {
  const n = fakeGetProduct(p.id)!.offers.length;
  fakeSpread[n] = (fakeSpread[n] ?? 0) + 1;
  const d = (await db.getProduct(p.id))?.offers.length ?? 0;
  dbSpread[d] = (dbSpread[d] ?? 0) + 1;
}
ok(JSON.stringify(fakeSpread) === JSON.stringify(dbSpread),
   `offer spread identical: ${JSON.stringify(fakeSpread)}`);

console.log('\n── search ────────────────────────────────────────────────');
for (const q of ['nike', 'garmin', 'hardlopen', 'kiprun', 'zzzznope']) {
  const a = fakeSearch(q).map((p) => p.id).sort();
  const b = (await db.searchProducts(q)).map((p) => p.id).sort();
  ok(JSON.stringify(a) === JSON.stringify(b), `search "${q}" → ${a.length} results, identical`,
     JSON.stringify(a) === JSON.stringify(b) ? '' : `file=${a.length} db=${b.length}`);
}

console.log('\n── category ──────────────────────────────────────────────');
const fc = fakeGetCategory('sport')!, dc = (await db.getCategory('sport'))!;
ok(dc !== null && dc.subcategories.length === fc.subcategories.length,
   `sport has ${dc?.subcategories.length} subcategories in both`);
ok(JSON.stringify(fc.subcategories.map((s) => s.id).sort()) ===
   JSON.stringify(dc.subcategories.map((s) => s.id).sort()), 'same subcategory ids');
ok((await db.getCategory('nonsense')) === null, 'unknown category → null in both');

console.log('\n── basket ────────────────────────────────────────────────');
const basket = ['run-pegasus41', 'run-fr265', 'fit-metcon9'];
const fb = fakeBasket(basket), dbb = await db.basketItemsWithOffers(basket);
ok(same(fb, dbb), 'basket items + offers identical', same(fb, dbb) ? '' : firstDiff(fb, dbb));
ok(JSON.stringify(dbb.map((i) => i.productId)) === JSON.stringify(basket),
   'basket preserves the order the user added items in');

const fcmp = fakeCompare({ items: basket }), dcmp = await db.compareBasket({ items: basket });
ok(same(fcmp, dcmp), 'basket comparison totals identical',
   same(fcmp, dcmp) ? '' : firstDiff(fcmp, dcmp));
console.log(`    winner both ways: ${dcmp.cheapestComplete?.store} @ €${dcmp.cheapestComplete?.total.toFixed(2)}`);

const dbRules = await db.getDeliveryRules();
ok(dbRules.length === FAKE_RULES.length, `delivery rules for all ${dbRules.length} stores`);
const rulesMatch = FAKE_RULES.every((r) => {
  const d = dbRules.find((x) => x.store === r.store);
  return d && d.fee === r.fee && d.freeAbove === r.freeAbove;
});
ok(rulesMatch, 'delivery fees and thresholds identical');

console.log('\n── price history ─────────────────────────────────────────');
// History legitimately differs — the file synthesises 31 days, the database has
// only the observations actually recorded. What must hold is the CONTRACT.
const h = (await db.getPriceHistory('run-pegasus41'))!;
ok(h !== null, 'history returns for a known product');
ok(h.min30 <= h.currentMin && h.currentMin <= h.max30, 'INVARIANT min30 <= currentMin <= max30');
ok(h.points.every((p, i) => i === 0 || p.at >= h.points[i - 1].at), 'points chronological');
ok(h.points.every((p) => typeof p.store === 'string' && p.store.length > 0),
   'every point names the retailer it came from');
console.log(`    ${h.points.length} observation day(s) so far — the file fakes 31, the database` +
            ` has only what has actually been ingested. That gap closes on its own.`);
const fh = fakeHistory('run-pegasus41')!;
ok(Math.abs(fh.currentMin - h.currentMin) < 0.001,
   `currentMin agrees: file €${fh.currentMin.toFixed(2)} / db €${h.currentMin.toFixed(2)}`);

console.log('\n── personalise ───────────────────────────────────────────');
const ids = ['run-pegasus41', 'run-kiprunks500', 'run-alphafly3', 'run-kalenjiactive'];
const ranked = await db.personalise(ids, {
  categories: ['sport'], budget: { sport: 'value' }, priority: 'price',
  detail: { hardlopen: { niveau: 'beginner' } },
});
ok(ranked.length === ids.length, 'ranks every requested product');
ok(ranked.every((r, i) => i === 0 || r.matchScore <= ranked[i - 1].matchScore), 'sorted by score');
ok(new Set(ranked.map((r) => r.matchScore)).size > 1, 'scores differentiate');
for (const r of ranked) console.log(`    ${String(r.matchScore).padStart(3)}  ${r.product.name} — ${r.reasons.join(", ")}`);
const flat = await db.personalise(ids, null);
ok(flat.every((r) => r.matchScore === 50), 'null profile → flat 50');

console.log(`\n${failures === 0
  ? '✓ EQUIVALENT — the front end cannot tell the file from the database'
  : `✗ ${failures} DIFFERENCE(S) — do not flip the front end yet`}\n`);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
