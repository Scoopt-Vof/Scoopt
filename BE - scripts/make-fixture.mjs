/**
 * Generates data/decathlon-products.json — the stand-in Decathlon catalogue.
 *
 * The product names and brands are real Decathlon house brands so the data
 * looks like the real thing in the UI. THE PRICES AND EANs ARE INVENTED.
 * They are here to exercise the pipeline, not to be shown to a user.
 *
 * EAN check digits are computed properly, because the matcher validates them
 * and we want the happy path to actually pass.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

/** Standard EAN-13 check digit: weights 1,3 alternating, mod 10. */
function ean13(first12) {
  if (!/^[0-9]{12}$/.test(first12)) throw new Error('need 12 digits');
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return first12 + String((10 - (sum % 10)) % 10);
}

const items = [
  ['Kalenji',  'Run Active Heren Hardloopschoenen',            'hardlopen', 3499,  'run-active-heren'],
  ['Kalenji',  'Kiprun KS500 Dames Hardloopschoenen',          'hardlopen', 5999,  'kiprun-ks500-dames'],
  ['Kalenji',  'Dry 500 Hardloopshirt Heren',                  'hardlopen', 1299,  'dry-500-shirt-heren'],
  ['Quechua',  'MH100 Wandelschoenen Heren',                   'wandelen',  3999,  'mh100-wandelschoenen'],
  ['Quechua',  'MH500 Waterdichte Wandeljas Dames',            'wandelen',  6999,  'mh500-jas-dames'],
  ['Forclaz',  'MT100 Trekkingrugzak 50L',                     'wandelen',  8999,  'mt100-rugzak-50l'],
  ['Domyos',   'Fitnessmat 8mm Comfort',                       'fitness',   1999,  'fitnessmat-8mm'],
  ['Domyos',   'Verstelbare Dumbbellset 20kg',                 'fitness',  12999,  'dumbbellset-20kg'],
  ['Kipsta',   'F500 Voetbal Maat 5',                          'voetbal',   1499,  'f500-voetbal-maat-5'],
  ['Kipsta',   'Viralto I Voetbalschoenen FG',                 'voetbal',   4499,  'viralto-i-fg'],
  ['Btwin',    'Riverside 500 Hybride Fiets',                  'fietsen',  39999,  'riverside-500'],
  ['Btwin',    '500 Fietshelm Volwassenen',                    'fietsen',   2499,  'helm-500-volwassenen'],
  ['Nabaiji',  'Zwembril Spirit Maat L',                       'zwemmen',    999,  'zwembril-spirit-l'],
  ['Artengo',  'TR160 Tennisracket Volwassenen',               'tennis',    3499,  'tr160-tennisracket'],
  ['Wedze',    'Ski-jas Freeride 500 Heren',                   'wintersport', 14999, 'freeride-500-jas'],
];

const products = items.map(([brand, title, category, priceCents, slug], i) => ({
  retailerSku: `DK-${String(100000 + i * 37)}`,
  // 871 = a Netherlands GS1 prefix. Invented body, correct check digit.
  ean: ean13('871' + String(1000000000 + i * 7919).slice(0, 9)),
  brand,
  title,
  category,
  priceCents,
  shippingCents: priceCents >= 5000 ? 0 : 399, // free shipping over €50
  currency: 'EUR',
  inStock: i % 7 !== 3, // one product out of stock, so the UI path gets exercised
  productUrl: `https://www.decathlon.nl/p/${slug}/_/R-p-${300000 + i}`,
  imageUrl: `https://placehold.co/600x600?text=${encodeURIComponent(brand)}`,
  description: `${brand} ${title}. Stand-in record for back-end testing.`,
}));

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../data/decathlon-products.json', import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), source: 'FIXTURE — invented prices', products }, null, 2)
);
console.log(`wrote ${products.length} fixture products`);
