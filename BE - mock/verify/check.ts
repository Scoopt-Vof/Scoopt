/**
 * Behavioural check: run Josh's REAL pure logic (smartBasket.planBasket and
 * profile.personalise) over the new fake data and assert the contract's
 * prose invariants actually hold. Typecheck proves shape; this proves behaviour.
 */
import {
  PRODUCTS, DELIVERY_RULES, getProduct, searchProducts, getCategory,
  basketItemsWithOffers, getPriceHistory, compareBasket,
} from './lib/fakeData';
import { planBasket } from './lib/smartBasket';
import { personalise } from './lib/profile';
import type { ShopperProfile } from './contract/types';

let failures = 0;
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label} ${detail}`); failures++; }
};

console.log('\n── catalogue ─────────────────────────────────────────────');
ok(PRODUCTS.length >= 40, `${PRODUCTS.length} products`);
ok(new Set(PRODUCTS.map((p) => p.id)).size === PRODUCTS.length, 'no duplicate product ids');
ok(new Set(PRODUCTS.map((p) => p.ean)).size === PRODUCTS.length, 'no duplicate EANs');
ok(PRODUCTS.every((p) => /^[0-9]{13}$/.test(p.ean)), 'every EAN is 13 digits');

// EAN-13 check digit must actually validate — the matcher will reject junk.
const checkDigitOk = PRODUCTS.every((p) => {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(p.ean[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(p.ean[12]);
});
ok(checkDigitOk, 'every EAN has a valid check digit');
ok(PRODUCTS.every((p) => p.image.startsWith('data:image/svg+xml')), 'every product has a self-contained image');
ok(PRODUCTS.every((p) => p.specs?.tier && p.specs?.quality && p.specs?.released && p.specs?.level),
   'every product carries the four specs personalisation ranks on');

console.log('\n── offers ────────────────────────────────────────────────');
const withOffers = PRODUCTS.map((p) => getProduct(p.id)!);
ok(withOffers.every((r) => r.offers.length > 0), 'no product has zero offers');
ok(withOffers.every((r) => r.offers.every((o, i) => i === 0 || o.price >= r.offers[i - 1].price)),
   'INVARIANT: offers sorted cheapest-first');
ok(withOffers.every((r) => r.offers.every((o) => o.price > 0 && Number.isFinite(o.price))),
   'no non-positive or NaN prices');
// NB compare with a tolerance — 139.99 * 100 is 13998.999999999998 in binary
// floating point, which is exactly why the real backend stores integer cents.
ok(withOffers.every((r) => r.offers.every((o) => Math.abs(o.price * 100 - Math.round(o.price * 100)) < 1e-6)),
   'every price is a clean 2-decimal number');
ok(withOffers.every((r) => r.offers.every((o) => o.productId === r.product.id)),
   'every offer links back to its product');

const spread: Record<number, number> = {};
for (const r of withOffers) spread[r.offers.length] = (spread[r.offers.length] ?? 0) + 1;
console.log(`    offer spread: ${Object.entries(spread).map(([k, v]) => `${v} products × ${k} store(s)`).join(', ')}`);
const comparable = withOffers.filter((r) => r.offers.length > 1).length;
console.log(`    products with a real comparison (2+ offers): ${comparable}/${PRODUCTS.length}`);
ok(comparable >= 20, 'enough products have a genuine comparison to demo with');

console.log('\n── search & category ─────────────────────────────────────');
ok(searchProducts('').length === PRODUCTS.length, 'empty query returns everything');
ok(searchProducts('nike').length > 0, 'brand search works');
ok(searchProducts('hardlopen').length > 0, 'subcategory search works');
ok(searchProducts('zzzznope').length === 0, 'no match returns empty array');
const sport = getCategory('sport');
ok(sport !== null && sport.subcategories.length === 3, 'sport category has 3 subcategories');
ok(getCategory('home') !== null && getCategory('tech') !== null, 'home/tech resolve (no 404s)');
ok(getCategory('nonsense') === null, 'unknown category returns null');

console.log('\n── basket: Josh\'s real planBasket() over the new data ────');
const basketIds = ['run-pegasus41', 'run-fr265', 'fit-metcon9'];
const items = basketItemsWithOffers(basketIds);
ok(items.length === 3, 'basketItemsWithOffers returns all three');

const plan = planBasket(items, DELIVERY_RULES);
ok(plan.recommended !== undefined, `planner recommends: ${plan.recommended}`);
console.log(`    honestNote: "${plan.honestNote}"`);
if (plan.bestSingleStore) {
  console.log(`    best single store: ${plan.bestSingleStore.stores.join(', ')} — ` +
    `items €${plan.bestSingleStore.itemsTotal.toFixed(2)} + delivery ` +
    `€${plan.bestSingleStore.deliveryTotal.toFixed(2)} = €${plan.bestSingleStore.grandTotal.toFixed(2)}`);
}
if (plan.smartSplit) {
  console.log(`    smart split: ${plan.smartSplit.stores.join(' + ')} — ` +
    `items €${plan.smartSplit.itemsTotal.toFixed(2)} + delivery ` +
    `€${plan.smartSplit.deliveryTotal.toFixed(2)} = €${plan.smartSplit.grandTotal.toFixed(2)}`);
}
ok(plan.savingVsSingle >= 0, `savingVsSingle is non-negative (€${plan.savingVsSingle.toFixed(2)})`);
ok(DELIVERY_RULES.length === 5, 'delivery rules cover all five stores');

const cmp = compareBasket({ items: basketIds });
ok(cmp.totals.length === 5, 'compareBasket returns a total per store');
ok(cmp.totals.every((t, i) => i === 0 || Number(cmp.totals[i - 1].complete) >= Number(t.complete)),
   'INVARIANT: complete baskets ranked before incomplete');

console.log('\n── price history ─────────────────────────────────────────');
let historiesOk = 0;
for (const p of PRODUCTS) {
  const h = getPriceHistory(p.id)!;
  if (h.min30 <= h.currentMin && h.currentMin <= h.max30 &&
      h.points.length === 31 &&
      h.points.every((pt, i) => i === 0 || pt.at >= h.points[i - 1].at)) historiesOk++;
}
ok(historiesOk === PRODUCTS.length,
   `INVARIANT min30 <= currentMin <= max30 and chronological, for all ${PRODUCTS.length} products`,
   `(${historiesOk} passed)`);
const anyLowest = PRODUCTS.filter((p) => getPriceHistory(p.id)!.isLowest30).length;
console.log(`    "laagste in 30 dagen" badge would show on ${anyLowest}/${PRODUCTS.length} products`);

console.log('\n── personalisation: Josh\'s real personalise() ────────────');
const profile: ShopperProfile = {
  categories: ['sport'],
  budget: { sport: 'value' },
  priority: 'price',
  detail: { hardlopen: { niveau: 'beginner' } },
};
const ranked = personalise(PRODUCTS, profile);
ok(ranked.length === PRODUCTS.length, 'ranks every product');
ok(ranked.every((r, i) => i === 0 || r.matchScore <= ranked[i - 1].matchScore), 'sorted by score descending');
ok(ranked.every((r) => r.matchScore >= 0 && r.matchScore <= 100), 'scores clamped 0..100');
ok(new Set(ranked.map((r) => r.matchScore)).size > 3, 'scores actually differentiate between products');
console.log(`    top 3 for a budget-conscious beginner runner:`);
for (const r of ranked.slice(0, 3)) {
  console.log(`      ${r.matchScore}  ${r.product.name}  — ${r.reasons.join(', ') || '(no reasons)'}`);
}
const nullRanked = personalise(PRODUCTS, null);
ok(nullRanked.every((r) => r.matchScore === 50), 'null profile gives a flat 50 (no personalisation)');

console.log(`\n${failures === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
