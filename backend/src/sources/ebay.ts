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
 *
 * ---------------------------------------------------------------------------
 * CATEGORY + SUBCATEGORY ASSIGNMENT — changed from the original version.
 * ---------------------------------------------------------------------------
 * The original adapter set `subcategory: query` — the literal search phrase —
 * which worked fine as a stand-in with 5 model-specific queries ("Garmin
 * Forerunner 265"), but meant the browse page showed a shopper's model name
 * ("Garmin Forerunner 265") where a real subcategory ("Running") belonged.
 * That is the bug this rewrite fixes.
 *
 * Each entry in the query list now carries its own {category, subcategory}
 * tag (see DEFAULT_QUERIES below), so every offer this adapter creates lands
 * in a real, browsable subcategory — matching the ids in
 * ../api/contract-queries.ts SUBCATEGORY_META and the front end's
 * lib/subcategoryQuestions.ts. The default list deliberately uses GENERIC
 * search terms ("running shoes", "road bike") rather than specific models, so
 * one ingest run surfaces a genuine spread of real products per subcategory —
 * this is what lets the catalogue fill itself instead of someone typing in
 * product names one at a time.
 *
 * A legacy EBAY_QUERIES env var (a flat comma list, no category/subcategory)
 * is still honoured if set, so an existing .env keeps working, but every term
 * from it is tagged sport/running and a warning is printed — the structured
 * DEFAULT_QUERIES list below is what actually gives full category coverage.
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

/** One search term, tagged with where its results belong on the site.
 *  `category` matches the front-end contract's Category ('home'|'sport'|'tech');
 *  `subcategory` matches an id in contract-queries.ts SUBCATEGORY_META. */
export interface EbayQuery {
  term: string;
  category: 'home' | 'sport' | 'tech';
  subcategory: string;
}

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
    /** Tagged searches to run. Keep the SAME list across marketplaces so the
     *  same branded products surface and you get real comparison rows. */
    private readonly queries: EbayQuery[] = defaultQueries(),
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
        `${BROWSE}/item_summary/search?q=${encodeURIComponent(q.term)}` +
        `&limit=${this.maxItemsPerQuery}&filter=buyingOptions:{FIXED_PRICE}`;

      const { data, raw } = await fetchJson<{ itemSummaries?: ItemSummary[] }>(url, {
        headers, rateKey: 'ebay', rateLimit: RATE,
      });
      rawParts.push({ query: q.term, marketplace: this.marketplace, response: JSON.parse(raw) });

      const summaries = data.itemSummaries ?? [];
      console.log(`  [${this.slug}] "${q.term}" (${q.category}/${q.subcategory}) → ${summaries.length} items`);

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

function toRawOffer(item: EbayItem, q: EbayQuery): RawOffer | null {
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
    category: q.category,
    subcategory: q.subcategory,
    priceCents: Math.round(priceValue * 100),
    shippingCents: Number.isFinite(shippingValue) ? Math.round(shippingValue * 100) : 0,
    currency: item.price?.currency ?? 'EUR',
    inStock: availability ? availability !== 'OUT_OF_STOCK' : true,
    productUrl: item.itemWebUrl,
    imageUrl: item.image?.imageUrl ?? null,
    description: item.shortDescription ?? null,
  };
}

/**
 * The full subcategory spread, one or two GENERIC search terms each — not
 * specific models. This is what lets `npm run ingest -- ebay-nl` populate
 * every subcategory on the site with a real, varied set of products with no
 * one adding products by hand. Coverage will vary: eBay has deep stock in
 * Sport and Technology, and is thinner for made-to-order furniture, which is
 * a real-world limit of this source, not a bug — Icecat enrichment/discovery
 * (see ../ingest/discover-icecat.ts) is the other half of the plan for the
 * categories eBay covers less well.
 */
const DEFAULT_QUERIES: EbayQuery[] = [
  // ---- Sport ----
  { term: 'running shoes', category: 'sport', subcategory: 'running' },
  { term: 'GPS running watch', category: 'sport', subcategory: 'running' },
  { term: 'road bike', category: 'sport', subcategory: 'cycling' },
  { term: 'bike helmet', category: 'sport', subcategory: 'cycling' },
  { term: 'hiking backpack', category: 'sport', subcategory: 'hiking-outdoor' },
  { term: 'hiking boots', category: 'sport', subcategory: 'hiking-outdoor' },
  { term: 'adjustable dumbbells', category: 'sport', subcategory: 'fitness-gym' },
  { term: 'yoga mat', category: 'sport', subcategory: 'fitness-gym' },
  { term: 'swimming goggles', category: 'sport', subcategory: 'swimming' },
  { term: 'swim fins', category: 'sport', subcategory: 'swimming' },
  { term: 'football boots', category: 'sport', subcategory: 'team-sports' },
  { term: 'basketball', category: 'sport', subcategory: 'team-sports' },
  { term: 'tennis racket', category: 'sport', subcategory: 'racket-sports' },
  { term: 'padel racket', category: 'sport', subcategory: 'racket-sports' },
  { term: 'ski goggles', category: 'sport', subcategory: 'winter-sports' },
  { term: 'snowboard', category: 'sport', subcategory: 'winter-sports' },

  // ---- Home & Furniture ----
  { term: 'sofa 3 seater', category: 'home', subcategory: 'furniture' },
  { term: 'dining table', category: 'home', subcategory: 'furniture' },
  { term: 'kitchen mixer', category: 'home', subcategory: 'kitchen-dining' },
  { term: 'dinner plate set', category: 'home', subcategory: 'kitchen-dining' },
  { term: 'bed frame', category: 'home', subcategory: 'bedroom' },
  { term: 'mattress', category: 'home', subcategory: 'bedroom' },
  { term: 'floor lamp', category: 'home', subcategory: 'lighting' },
  { term: 'pendant light', category: 'home', subcategory: 'lighting' },
  { term: 'wall art canvas', category: 'home', subcategory: 'home-decor' },
  { term: 'decorative cushion', category: 'home', subcategory: 'home-decor' },
  { term: 'storage shelving unit', category: 'home', subcategory: 'storage' },
  { term: 'storage boxes', category: 'home', subcategory: 'storage' },
  { term: 'bedding duvet set', category: 'home', subcategory: 'home-textiles' },
  { term: 'curtains', category: 'home', subcategory: 'home-textiles' },
  { term: 'garden furniture set', category: 'home', subcategory: 'garden-outdoor' },
  { term: 'outdoor parasol', category: 'home', subcategory: 'garden-outdoor' },

  // ---- Technology ----
  { term: 'smartphone unlocked', category: 'tech', subcategory: 'smartphones' },
  { term: 'laptop', category: 'tech', subcategory: 'laptops-computers' },
  { term: 'smartwatch', category: 'tech', subcategory: 'wearables' },
  { term: 'wireless earbuds', category: 'tech', subcategory: 'audio-headphones' },
  { term: 'bluetooth headphones', category: 'tech', subcategory: 'audio-headphones' },
  { term: '4k television', category: 'tech', subcategory: 'tv-video' },
  { term: 'streaming media player', category: 'tech', subcategory: 'tv-video' },
  { term: 'mirrorless camera', category: 'tech', subcategory: 'cameras' },
  { term: 'gaming console', category: 'tech', subcategory: 'gaming' },
  { term: 'gaming controller', category: 'tech', subcategory: 'gaming' },
  { term: 'robot vacuum cleaner', category: 'tech', subcategory: 'home-appliances' },
  { term: 'air fryer', category: 'tech', subcategory: 'home-appliances' },
];

/** Sports products likely to carry GTINs and to exist in several marketplaces. */
function defaultQueries(): EbayQuery[] {
  const fromEnv = process.env.EBAY_QUERIES;
  if (fromEnv) {
    console.warn(
      '[ebay] EBAY_QUERIES is set — using it instead of the built-in DEFAULT_QUERIES list.\n' +
      '       Every term from it is tagged sport/running, since that is a flat list with no\n' +
      '       category/subcategory of its own. Remove EBAY_QUERIES from .env to get the full\n' +
      '       Sport/Home & Furniture/Technology spread in src/sources/ebay.ts instead.'
    );
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean)
      .map((term) => ({ term, category: 'sport' as const, subcategory: 'running' }));
  }
  return DEFAULT_QUERIES;
}
