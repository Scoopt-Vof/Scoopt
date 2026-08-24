import { fetchJson, requireEnv } from '../lib/http';
import { getAccessToken } from '../lib/oauth';
import type { RetailerSource, FetchResult, RawOffer } from './types';

/**
 * eBay Browse API adapter — REAL LIVE PRICES, self-service credentials.
 *
 * This is the one to start with. It is the only genuinely open API we found
 * that returns real prices in EUR from a Dutch marketplace AND carries a GTIN,
 * which is what Scoopt matches on.
 *
 * SETUP (see README-LIVE-APIS.md for the click-by-click):
 *   1. Register at developer.ebay.com  → ~1 business day for account approval
 *   2. Create a PRODUCTION keyset      → App ID (Client ID) + Cert ID (Secret)
 *   3. Resolve the marketplace-account-deletion notification step (see README)
 *   4. Put EBAY_CLIENT_ID / EBAY_CLIENT_SECRET in .env
 *
 * TWO DESIGN CONSTRAINTS THE API IMPOSES — both are handled below:
 *
 *   a) `gtin` is NOT returned by item_summary/search. It only appears on
 *      getItem. So every product costs 1 search slot + 1 getItem call. With a
 *      default quota of 5,000 calls/day that is the binding limit on the whole
 *      pipeline, which is why MAX_ITEMS_PER_QUERY is deliberately small.
 *
 *   b) Search-by-GTIN is documented as UPC-only, so you cannot reliably go
 *      EAN → item. The flow is therefore keyword → items → getItem → EAN,
 *      not EAN → item.
 *
 * WHY THIS GIVES YOU REAL COMPARISON ROWS: instantiate it three times with
 * EBAY_NL, EBAY_DE and EBAY_GB. Same branded products, three marketplaces,
 * three different prices against ONE EAN. That is the only way in this whole
 * source set to demonstrate an actual multi-offer comparison — see the note in
 * README-LIVE-APIS.md about the overlap problem.
 */

const OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE = 'https://api.ebay.com/buy/browse/v1';

/** 5,000 calls/day default quota ≈ 1 every 17s if spread evenly. 200ms is a
 *  courtesy floor; the real limiter is MAX_ITEMS_PER_QUERY below. */
const RATE = { minIntervalMs: 200 };

export type EbayMarketplace =
  | 'EBAY_NL' | 'EBAY_DE' | 'EBAY_GB' | 'EBAY_FR' | 'EBAY_IT' | 'EBAY_ES' | 'EBAY_US';

const MARKETPLACE_NAMES: Record<string, string> = {
  EBAY_NL: 'eBay Netherlands', EBAY_DE: 'eBay Germany', EBAY_GB: 'eBay UK',
  EBAY_FR: 'eBay France', EBAY_IT: 'eBay Italy', EBAY_ES: 'eBay Spain',
  EBAY_US: 'eBay US',
};

interface ItemSummary { itemId: string; title: string; epid?: string }
interface EbayItem {
  itemId: string;
  title: string;
  gtin?: string;
  mpn?: string;
  brand?: string;
  categoryPath?: string;
  itemWebUrl: string;
  image?: { imageUrl?: string };
  shortDescription?: string;
  condition?: string;
  price?: { value?: string; currency?: string };
  shippingOptions?: Array<{ shippingCost?: { value?: string; currency?: string } }>;
  estimatedAvailabilities?: Array<{ estimatedAvailabilityStatus?: string }>;
  product?: { brand?: string; gtins?: string[]; mpns?: string[] };
}

export class EbaySource implements RetailerSource {
  readonly slug: string;
  readonly name: string;
  readonly homepageUrl: string;
  readonly sourceKind = 'official_api' as const;

  constructor(
    private readonly marketplace: EbayMarketplace = 'EBAY_NL',
    /** Keyword searches to run. Keep the SAME list across marketplaces so the
     *  same branded products surface and you get real comparison rows. */
    private readonly queries: string[] = defaultQueries(),
    private readonly maxItemsPerQuery = Number(process.env.EBAY_MAX_ITEMS_PER_QUERY ?? 8)
  ) {
    const suffix = marketplace.replace('EBAY_', '').toLowerCase();
    this.slug = `ebay-${suffix}`;
    this.name = MARKETPLACE_NAMES[marketplace] ?? marketplace;
    this.homepageUrl = `https://www.ebay.${suffix === 'gb' ? 'co.uk' : suffix === 'us' ? 'com' : suffix}`;
  }

  private async token(): Promise<string> {
    return getAccessToken({
      key: 'ebay',
      tokenUrl: OAUTH_URL,
      clientId: requireEnv('EBAY_CLIENT_ID', 'developer.ebay.com → Application Keys → App ID'),
      clientSecret: requireEnv('EBAY_CLIENT_SECRET', 'developer.ebay.com → Application Keys → Cert ID'),
      scope: 'https://api.ebay.com/oauth/api_scope',
      rateLimit: RATE,
    });
  }

  async fetch(): Promise<FetchResult> {
    const token = await this.token();
    const headers = {
      authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': this.marketplace,
    };

    const offers: RawOffer[] = [];
    const rawParts: unknown[] = [];
    const seenItemIds = new Set<string>();

    for (const q of this.queries) {
      const url =
        `${BROWSE}/item_summary/search?q=${encodeURIComponent(q)}` +
        `&limit=${this.maxItemsPerQuery}&filter=buyingOptions:{FIXED_PRICE}`;

      const { data, raw } = await fetchJson<{ itemSummaries?: ItemSummary[] }>(url, {
        headers, rateKey: 'ebay', rateLimit: RATE,
      });
      rawParts.push({ query: q, marketplace: this.marketplace, response: JSON.parse(raw) });

      const summaries = data.itemSummaries ?? [];
      console.log(`  [${this.slug}] "${q}" → ${summaries.length} items`);

      for (const s of summaries) {
        if (seenItemIds.has(s.itemId)) continue;
        seenItemIds.add(s.itemId);

        // The GTIN only exists on getItem — this is the expensive call.
        const detail = await fetchJson<EbayItem>(
          `${BROWSE}/item/${encodeURIComponent(s.itemId)}`,
          { headers, rateKey: 'ebay', rateLimit: RATE }
        ).catch((e) => {
          console.warn(`  [${this.slug}] getItem ${s.itemId} failed: ${String(e).slice(0, 120)}`);
          return null;
        });
        if (!detail) continue;

        rawParts.push({ itemId: s.itemId, detail: JSON.parse(detail.raw) });

        const offer = toRawOffer(detail.data, q);
        // No GTIN means it cannot join the EAN graph. The ingest job will file
        // it in match_review_queue rather than silently dropping it.
        if (offer) offers.push(offer);
      }
    }

    return {
      offers,
      rawPayload: JSON.stringify(
        { marketplace: this.marketplace, fetchedAt: new Date().toISOString(), parts: rawParts },
        null, 2
      ),
    };
  }
}

function toRawOffer(item: EbayItem, query: string): RawOffer | null {
  const priceValue = Number(item.price?.value);
  if (!Number.isFinite(priceValue) || priceValue <= 0) return null;

  const shippingValue = Number(item.shippingOptions?.[0]?.shippingCost?.value ?? 0);
  const gtin = item.gtin ?? item.product?.gtins?.[0] ?? null;
  const availability = item.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus;

  return {
    retailerSku: item.itemId,
    ean: gtin,
    brand: item.brand ?? item.product?.brand ?? 'Onbekend',
    title: item.title,
    // eBay's categoryPath is a long breadcrumb; the seeding query is a far more
    // useful category for a sports comparison site than "Sporting Goods|...".
    category: query,
    priceCents: Math.round(priceValue * 100),
    shippingCents: Number.isFinite(shippingValue) ? Math.round(shippingValue * 100) : 0,
    currency: item.price?.currency ?? 'EUR',
    inStock: availability ? availability !== 'OUT_OF_STOCK' : true,
    productUrl: item.itemWebUrl,
    imageUrl: item.image?.imageUrl ?? null,
    description: item.shortDescription ?? null,
  };
}

/** Sports products likely to carry GTINs and to exist in several marketplaces. */
function defaultQueries(): string[] {
  const fromEnv = process.env.EBAY_QUERIES;
  if (fromEnv) return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  return [
    'Garmin Forerunner 265',
    'Nike Pegasus 41',
    'Adidas Ultraboost 22',
    'Salomon Speedcross 6',
    'Osprey Talon 22',
  ];
}
