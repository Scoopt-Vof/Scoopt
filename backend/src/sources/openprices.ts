import { fetchJson } from '../lib/http';
import type { RetailerSource, FetchResult, RawOffer } from './types';

/**
 * Open Prices adapter — REAL prices, REAL Dutch shops, NO API KEY AT ALL.
 *
 * This is the zero-friction option: no signup, no credentials, no approval.
 * Crowd-sourced prices (photographed shelf tags and receipts) attached to Open
 * Food Facts products, so every record already carries a valid EAN-13. That
 * makes it the single best source for exercising the EAN matching path.
 *
 * Instantiate one per chain — `new OpenPricesSource('Albert Heijn')` — so the
 * comparison page shows real Dutch retailer names side by side.
 *
 * ⚠️  TWO LIMITS, BE HONEST ABOUT BOTH:
 *
 *   1. VOLUME. At the time of writing there are roughly 285 Dutch price points
 *      across ~94 locations, mostly Albert Heijn and Jumbo groceries. Enough to
 *      prove the pipeline; nowhere near a product.
 *
 *   2. ⚠️ ODbL LICENCE — THIS AFFECTS YOUR SCHEMA DESIGN, DECIDE IT NOW.
 *      Open Food Facts / Open Prices data is ODbL 1.0. Loading it into Postgres
 *      creates a "Derivative Database" (ODbL §4.4b). Publishing a website built
 *      from it counts as publicly using that derivative (§4.4c), which triggers
 *      share-alike (§4.4a) AND an obligation to hand out a machine-readable copy
 *      of the derivative database on request (§4.6).
 *
 *      The escape hatch is §4.5(a), the Collective Database clause: keep this
 *      data UNMODIFIED in its own tables, keep your own commercially-collected
 *      offers in separate tables you authored, and join only at query time.
 *      Do that and only these tables are ODbL — which they already were.
 *
 *      The thing that breaks it: merging Open Prices fields into your canonical
 *      `product` table. Do that and the whole database arguably becomes ODbL,
 *      and you owe the public a free copy of it.
 *
 *      → For the PoC this is fine. Before this touches production, either
 *        segregate the tables or drop the source. See README-LIVE-APIS.md.
 *
 *      Attribution is required wherever it is displayed:
 *      "Contains information from Open Food Facts, which is made available
 *       here under the Open Database License (ODbL)."
 */

const BASE = 'https://prices.openfoodfacts.org/api/v1';
/** No documented rate limit; 1 req/s is simple courtesy to a volunteer project. */
const RATE = { minIntervalMs: 1000 };

interface OpenPrice {
  price?: number;
  currency?: string;
  date?: string;
  price_is_discounted?: boolean;
  product_code?: string;
  product_name?: string;
  product?: { product_name?: string; brands?: string; image_url?: string; categories_tags?: string[] };
  location?: {
    osm_name?: string;
    osm_address_city?: string;
    osm_address_country?: string;
  };
}

export class OpenPricesSource implements RetailerSource {
  readonly slug: string;
  readonly name: string;
  readonly homepageUrl = 'https://prices.openfoodfacts.org';
  readonly sourceKind = 'official_api' as const;

  constructor(
    /** Chain name to match, case-insensitive substring of the OSM store name. */
    private readonly chain = 'Albert Heijn',
    private readonly country = 'Nederland',
    private readonly maxPages = Number(process.env.OPENPRICES_MAX_PAGES ?? 6)
  ) {
    this.slug = 'op-' + chain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    this.name = chain;
  }

  async fetch(): Promise<FetchResult> {
    const offers: RawOffer[] = [];
    const rawParts: unknown[] = [];
    const seenCodes = new Set<string>();

    for (let page = 1; page <= this.maxPages; page++) {
      const url = `${BASE}/prices?size=100&page=${page}&order_by=-date`;
      const { data, raw } = await fetchJson<{ items?: OpenPrice[]; total?: number }>(url, {
        rateKey: 'openprices', rateLimit: RATE,
      });
      rawParts.push({ page, response: JSON.parse(raw) });

      const items = data.items ?? [];
      if (items.length === 0) break;

      for (const p of items) {
        if (!matchesChain(p, this.chain, this.country)) continue;
        const offer = toRawOffer(p, this.name);
        if (!offer) continue;
        // One offer per product per retailer — the DB enforces this anyway,
        // but de-duplicating here keeps the ingest counts honest.
        if (seenCodes.has(offer.ean!)) continue;
        seenCodes.add(offer.ean!);
        offers.push(offer);
      }
    }

    console.log(`  [${this.slug}] ${offers.length} priced products matched "${this.chain}"`);

    return {
      offers,
      rawPayload: JSON.stringify(
        {
          chain: this.chain,
          country: this.country,
          fetchedAt: new Date().toISOString(),
          licence: 'ODbL 1.0 — Contains information from Open Food Facts',
          parts: rawParts,
        }, null, 2
      ),
    };
  }
}

function matchesChain(p: OpenPrice, chain: string, country: string): boolean {
  const name = p.location?.osm_name ?? '';
  const c = p.location?.osm_address_country ?? '';
  if (!name.toLowerCase().includes(chain.toLowerCase())) return false;
  if (country && c && !c.toLowerCase().includes(country.toLowerCase())) return false;
  return true;
}

function toRawOffer(p: OpenPrice, retailerName: string): RawOffer | null {
  if (!p.price || p.price <= 0 || !p.product_code) return null;

  const title = p.product?.product_name || p.product_name || `EAN ${p.product_code}`;
  const brands = p.product?.brands ?? '';
  const city = p.location?.osm_address_city ? ` ${p.location.osm_address_city}` : '';

  return {
    retailerSku: `${p.product_code}@${retailerName}${city}`.slice(0, 120),
    ean: p.product_code,
    brand: brands.split(',')[0]?.trim() || 'Onbekend',
    title,
    // The contract allows exactly home | sport | tech, and an Open Food Facts
    // tag is none of those - it belongs in subcategory.
    category: process.env.OPENPRICES_CATEGORY ?? 'home',
    subcategory: p.product?.categories_tags?.[0]?.replace(/^[a-z]{2}:/, '') ?? 'boodschappen',
    priceCents: Math.round(p.price * 100),
    shippingCents: 0,
    currency: p.currency ?? 'EUR',
    inStock: true,
    // Open Prices has no merchant deep link — point at the product page.
    productUrl: `https://world.openfoodfacts.org/product/${p.product_code}`,
    imageUrl: p.product?.image_url ?? null,
    description: 'Contains information from Open Food Facts, available under the ODbL.',
  };
}
