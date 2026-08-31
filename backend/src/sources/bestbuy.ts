import { fetchJson, requireEnv } from '../lib/http';
import type { RetailerSource, FetchResult, RawOffer } from './types';

/**
 * Best Buy adapter — REAL LIVE PRICES + UPC, simplest auth of the whole set
 * (an API key in the query string, no OAuth dance at all).
 *
 * ⚠️  READ BEFORE USING BEYOND A PRIVATE PROTOTYPE.
 *
 * Best Buy's developer terms forbid using the service "on behalf of or for the
 * benefit of any third party (such as other retailers) for the purposes of
 * analyzing, receiving or reviewing information regarding Best Buy pricing,
 * products or services", and require that a site offering commerce place Best
 * Buy "in the first or primary tier of options".
 *
 * A neutral price-comparison site is against the grain of both. This adapter
 * exists to exercise the pipeline against a fourth auth style and a genuinely
 * different response shape — NOT as a foundation for Scoopt. Do not ship it.
 *
 * SETUP:
 *   1. developer.bestbuy.com → Get API Key
 *   2. ⚠️  Best Buy's published policy refuses free email domains (Gmail,
 *      Yahoo). Use a company address on your own domain, or expect rejection.
 *   3. Put BESTBUY_API_KEY in .env
 *
 * Quota: 50,000 calls/day, 5 calls/second.
 */

const BASE = 'https://api.bestbuy.com/v1';
const RATE = { minIntervalMs: 250 }; // 4/s, under the 5/s ceiling

const SHOW = [
  'sku', 'upc', 'name', 'manufacturer', 'salePrice', 'regularPrice',
  'image', 'url', 'onlineAvailability', 'shippingCost', 'categoryPath.name',
].join(',');

interface BestBuyProduct {
  sku: number;
  upc?: string;
  name: string;
  manufacturer?: string;
  salePrice?: number;
  regularPrice?: number;
  image?: string;
  url?: string;
  onlineAvailability?: boolean;
  shippingCost?: number;
  categoryPath?: Array<{ name: string }>;
}

export class BestBuySource implements RetailerSource {
  readonly slug = 'bestbuy';
  readonly name = 'Best Buy';
  readonly homepageUrl = 'https://www.bestbuy.com';
  readonly sourceKind = 'official_api' as const;

  constructor(
    private readonly searches: string[] = defaultSearches(),
    private readonly pageSize = Number(process.env.BESTBUY_PAGE_SIZE ?? 10)
  ) {}

  async fetch(): Promise<FetchResult> {
    const key = requireEnv('BESTBUY_API_KEY', 'developer.bestbuy.com → Get API Key');
    const offers: RawOffer[] = [];
    const rawParts: unknown[] = [];

    for (const term of this.searches) {
      // Best Buy's query syntax: /products((search=a&search=b))
      const clause = term.split(/\s+/).map((w) => `search=${encodeURIComponent(w)}`).join('&');
      const url =
        `${BASE}/products((${clause}))?apiKey=${encodeURIComponent(key)}` +
        `&format=json&show=${SHOW}&pageSize=${this.pageSize}`;

      const { data, raw } = await fetchJson<{ products?: BestBuyProduct[] }>(url, {
        rateKey: 'bestbuy', rateLimit: RATE,
      });
      rawParts.push({ term, response: JSON.parse(raw) });

      const products = data.products ?? [];
      console.log(`  [bestbuy] "${term}" → ${products.length} products`);

      for (const p of products) {
        const offer = toRawOffer(p, term);
        if (offer) offers.push(offer);
      }
    }

    return {
      offers,
      rawPayload: JSON.stringify(
        { fetchedAt: new Date().toISOString(), parts: rawParts }, null, 2
      ),
    };
  }
}

function toRawOffer(p: BestBuyProduct, term: string): RawOffer | null {
  const price = p.salePrice ?? p.regularPrice;
  if (!price || price <= 0) return null;

  return {
    retailerSku: String(p.sku),
    ean: p.upc ?? null, // 12-digit UPC-A; normaliseEan() pads it to EAN-13
    brand: p.manufacturer ?? 'Onbekend',
    title: p.name,
    // The contract allows exactly home | sport | tech. Best Buy is electronics,
    // and its own breadcrumb makes a much better subcategory than a category.
    // Its prices are USD, so ingest rejects these rows regardless.
    category: process.env.BESTBUY_CATEGORY ?? 'tech',
    subcategory: p.categoryPath?.at(-1)?.name ?? term,
    priceCents: Math.round(price * 100),
    shippingCents: Math.round((p.shippingCost ?? 0) * 100),
    currency: 'USD',
    inStock: p.onlineAvailability ?? true,
    productUrl: p.url ?? `https://www.bestbuy.com/site/searchpage.jsp?st=${p.sku}`,
    imageUrl: p.image ?? null,
    description: null,
  };
}

function defaultSearches(): string[] {
  const fromEnv = process.env.BESTBUY_SEARCHES;
  if (fromEnv) return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  return ['garmin forerunner', 'fitbit charge', 'bluetooth headphones'];
}
