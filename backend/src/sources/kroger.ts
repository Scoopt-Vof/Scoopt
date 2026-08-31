import { fetchJson, requireEnv } from '../lib/http';
import { getAccessToken } from '../lib/oauth';
import type { RetailerSource, FetchResult, RawOffer } from './types';

/**
 * Kroger adapter — REAL LIVE PRICES, and the FASTEST possible first success.
 *
 * Kroger is a US supermarket chain, so this is useless as a Scoopt retailer.
 * It is here for one reason: it is the only API we found where you go from
 * zero to a real live price with a real UPC in under an hour, with no approval
 * step, no business verification and no live website. If you want to prove the
 * pipeline works against a genuine third-party API TODAY, this is the one.
 *
 * SETUP:
 *   1. developer.kroger.com/create-account — instant, free
 *   2. Register an application → CLIENT_ID + CLIENT_SECRET
 *   3. Put KROGER_CLIENT_ID / KROGER_CLIENT_SECRET in .env
 *   4. npm run ingest -- kroger
 *
 * THE ONE GOTCHA: prices are per-store. Without a locationId the API returns
 * products with NO price at all. This adapter resolves a location first, which
 * is why it makes an extra call before any product call.
 *
 * Quota: Products 10,000/day, Locations 1,600/day.
 *
 * NOTE ON TERMS: Kroger's developer terms are robots-blocked to automated
 * readers, so their stance on aggregation is UNVERIFIED. Read them yourself
 * before doing anything beyond a private prototype.
 */

const TOKEN_URL = 'https://api.kroger.com/v1/connect/oauth2/token';
const BASE = 'https://api.kroger.com/v1';
const RATE = { minIntervalMs: 250 };

interface KrogerProduct {
  productId: string;
  upc: string;
  brand?: string;
  description: string;
  categories?: string[];
  images?: Array<{ perspective?: string; featured?: boolean; sizes?: Array<{ size?: string; url?: string }> }>;
  items?: Array<{
    itemId?: string;
    price?: { regular?: number; promo?: number };
    size?: string;
    fulfillment?: { curbside?: boolean; delivery?: boolean; inStore?: boolean; shipToHome?: boolean };
    inventory?: { stockLevel?: string };
  }>;
}

export class KrogerSource implements RetailerSource {
  readonly slug = 'kroger';
  readonly name = 'Kroger';
  readonly homepageUrl = 'https://www.kroger.com';
  readonly sourceKind = 'official_api' as const;

  constructor(
    private readonly terms: string[] = defaultTerms(),
    /** US ZIP used to resolve a store. Cincinnati is Kroger's home market. */
    private readonly zipCode = process.env.KROGER_ZIP ?? '45202',
    private readonly limitPerTerm = Number(process.env.KROGER_LIMIT ?? 10)
  ) {}

  private async token(): Promise<string> {
    return getAccessToken({
      key: 'kroger',
      tokenUrl: TOKEN_URL,
      clientId: requireEnv('KROGER_CLIENT_ID', 'developer.kroger.com → your app → Client ID'),
      clientSecret: requireEnv('KROGER_CLIENT_SECRET', 'developer.kroger.com → your app → Client Secret'),
      scope: 'product.compact',
      rateLimit: RATE,
    });
  }

  async fetch(): Promise<FetchResult> {
    const token = await this.token();
    const headers = { authorization: `Bearer ${token}` };
    const rawParts: unknown[] = [];

    // Step 1 — a store, without which every price comes back empty.
    const loc = await fetchJson<{ data?: Array<{ locationId: string; name?: string }> }>(
      `${BASE}/locations?filter.zipCode.near=${encodeURIComponent(this.zipCode)}&filter.limit=1`,
      { headers, rateKey: 'kroger', rateLimit: RATE }
    );
    rawParts.push({ locations: JSON.parse(loc.raw) });

    const locationId = loc.data.data?.[0]?.locationId;
    if (!locationId) throw new Error(`kroger: no store found near ZIP ${this.zipCode}`);
    console.log(`  [kroger] using store ${locationId} (${loc.data.data?.[0]?.name ?? '?'})`);

    // Step 2 — products, now with prices attached.
    const offers: RawOffer[] = [];
    for (const term of this.terms) {
      const url =
        `${BASE}/products?filter.term=${encodeURIComponent(term)}` +
        `&filter.locationId=${locationId}&filter.limit=${this.limitPerTerm}`;

      const { data, raw } = await fetchJson<{ data?: KrogerProduct[] }>(url, {
        headers, rateKey: 'kroger', rateLimit: RATE,
      });
      rawParts.push({ term, response: JSON.parse(raw) });

      const products = data.data ?? [];
      console.log(`  [kroger] "${term}" → ${products.length} products`);

      for (const p of products) {
        const offer = toRawOffer(p, term);
        if (offer) offers.push(offer);
      }
    }

    return {
      offers,
      rawPayload: JSON.stringify(
        { locationId, fetchedAt: new Date().toISOString(), parts: rawParts }, null, 2
      ),
    };
  }
}

function toRawOffer(p: KrogerProduct, term: string): RawOffer | null {
  const item = p.items?.[0];
  // promo beats regular when present — promo is what the shopper actually pays.
  const price = item?.price?.promo && item.price.promo > 0
    ? item.price.promo
    : item?.price?.regular;
  if (!price || price <= 0) return null;

  const featured = p.images?.find((i) => i.featured) ?? p.images?.[0];
  const imageUrl =
    featured?.sizes?.find((s) => s.size === 'large')?.url ?? featured?.sizes?.[0]?.url ?? null;

  const f = item?.fulfillment;
  const inStock = f ? Boolean(f.inStore || f.delivery || f.curbside || f.shipToHome) : true;

  return {
    // Kroger UPCs are 13-digit strings already; normaliseEan handles 12 vs 13.
    retailerSku: p.productId,
    ean: p.upc,
    brand: p.brand ?? 'Kroger',
    title: p.description,
    // The contract allows exactly home | sport | tech, and Kroger's own
    // grocery categories are none of those. Its prices are USD too, so ingest
    // rejects them - this just keeps the shape right if that ever changes.
    category: process.env.KROGER_CATEGORY ?? 'home',
    subcategory: p.categories?.[0] ?? term,
    priceCents: Math.round(price * 100),
    shippingCents: 0,
    currency: 'USD',
    inStock,
    productUrl: `https://www.kroger.com/p/${slugify(p.description)}/${p.upc}`,
    imageUrl,
    description: null,
  };
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'product';

function defaultTerms(): string[] {
  const fromEnv = process.env.KROGER_TERMS;
  if (fromEnv) return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  return ['coffee', 'olive oil', 'cereal', 'shampoo', 'protein bar'];
}
