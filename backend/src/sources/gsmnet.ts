import { gunzipSync } from 'node:zlib';
import type { RetailerSource, FetchResult, RawOffer } from './types';

/**
 * GSM Net (gsm-net.nl) — Awin affiliate PRODUCT FEED adapter.
 *
 * The first affiliate-network retailer on Scoopt, alongside the eBay API
 * sources. Everything downstream of RetailerSource is retailer-agnostic (see
 * ./types.ts), so this is the ONE new file the design asks for: it turns
 * GSM Net's Awin product feed into RawOffers and the machine does the rest.
 *
 * WHY A FEED, NOT AN API. Awin does not expose GSM Net's catalogue as a live
 * API. Instead you generate a product feed in the Awin UI and Awin hosts it at
 * a URL you poll. That one file carries BOTH halves of what Scoopt needs:
 *   • the product data to display (name, EAN, price, image, stock), and
 *   • the tracked click-out link (`aw_deep_link`) that earns commission.
 * The deep link already has your publisher id stitched in by Awin, so storing
 * it as the offer's product_url is the whole of "begin earning commission" —
 * every click-out from the site then attributes to Scoopt.
 *
 * SETUP (see README-AWIN.md for the click-by-click):
 *   1. Awin → Toolbox → Create-a-Feed. Advertiser: GSM Net. Format: CSV,
 *      gzip. Include AT LEAST these columns (canonical Awin names):
 *        aw_product_id, product_name, brand_name, ean,
 *        search_price, currency, in_stock, aw_deep_link, aw_image_url,
 *        merchant_category, description
 *   2. Copy the generated feed URL.
 *   3. Put it in .env as  GSMNET_FEED_URL=...   (and in Railway for prod).
 *   4. Run:  npm run ingest -- gsm-net
 *
 * WHAT PUBLISHES. A product only goes live once the classifier can place it
 * (src/categorisation). GSM Net is a phone/telecom retailer, so its rows are
 * tagged category 'tech' and the keyword rules (rules.seed.json already has
 * smartphones, wearables, audio, laptops, accessories) place most of them by
 * title. Rows the classifier cannot place stay 'draft' — invisible to shoppers,
 * visible to you in the review queue — which is the safe default, not a bug.
 *
 * ROBUSTNESS. Create-a-Feed lets you rename and reorder columns, so this maps
 * by HEADER NAME (case-insensitive, with common aliases), never by position.
 * It auto-detects the delimiter and transparently gunzips a gzipped feed. A row
 * missing an EAN or a usable price is not dropped silently: it flows on and the
 * ingest job files it in match_review_queue like any other unmatchable row.
 */

/** Prices outside this feed's currency are refused downstream; we default EUR. */
const DEFAULT_CATEGORY = (process.env.GSMNET_CATEGORY ?? 'tech').toLowerCase();

/** Column aliases, in priority order. First non-empty cell wins. All lower-case. */
const COLUMNS = {
  sku: ['aw_product_id', 'merchant_product_id', 'product_id', 'mpn', 'ean'],
  ean: ['ean', 'gtin', 'product_gtin', 'ean_code', 'product_ean', 'gtin_ean'],
  brand: ['brand_name', 'brand', 'manufacturer', 'brand_id'],
  title: ['product_name', 'product_title', 'title', 'product_short_description'],
  price: ['search_price', 'store_price', 'price', 'product_price', 'display_price', 'price_incl_vat'],
  shipping: ['delivery_cost', 'shipping_cost', 'delivery_charges'],
  currency: ['currency', 'curr', 'price_currency'],
  inStock: ['in_stock', 'stock_status', 'is_in_stock', 'availability', 'stock'],
  url: ['aw_deep_link', 'deep_link', 'merchant_deep_link', 'aw_product_url', 'product_url'],
  image: ['aw_image_url', 'merchant_image_url', 'large_image', 'image_url', 'aw_thumb_url', 'image'],
  description: ['description', 'product_short_description', 'specifications', 'product_description'],
  category: ['merchant_category', 'category_name', 'merchant_product_category', 'product_type', 'category'],
} as const;

export class GsmNetSource implements RetailerSource {
  readonly slug = 'gsm-net';
  readonly name = 'GSM Net';
  readonly homepageUrl = 'https://www.gsm-net.nl';
  readonly sourceKind = 'affiliate_feed' as const;
  readonly affiliateNetwork = 'awin';

  constructor(
    private readonly feedUrl: string = requireFeedUrl(),
    /** Override the delimiter if auto-detection ever guesses wrong. */
    private readonly delimiter: string | null = process.env.GSMNET_FEED_DELIMITER ?? null
  ) {}

  async fetch(): Promise<FetchResult> {
    const text = await downloadFeed(this.feedUrl);

    const delimiter = this.delimiter ?? detectDelimiter(text);
    const rows = parseCsv(text, delimiter);
    if (rows.length < 2) {
      throw new Error(
        `GSM Net feed at ${hostOf(this.feedUrl)} had no data rows ` +
        `(${rows.length} line(s) parsed). Check the feed URL and that the feed has products.`
      );
    }

    const header = rows[0].map(normaliseHeader);
    const index = buildIndex(header);
    // aw_deep_link is the commission-bearing link. Without a URL column the feed
    // is useless for Scoopt's purpose, so fail loudly rather than import dead rows.
    if (col(index, COLUMNS.url) < 0) {
      throw new Error(
        `GSM Net feed has no deep-link column. Add "aw_deep_link" in Create-a-Feed ` +
        `(header seen: ${header.join(', ')}).`
      );
    }

    const offers: RawOffer[] = [];
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const offer = toRawOffer(rows[i], index);
      if (offer) offers.push(offer);
      else skipped++;
    }
    console.log(`  [${this.slug}] ${offers.length} offers parsed, ${skipped} rows skipped (no url/price)`);

    return {
      offers,
      // Archived verbatim BEFORE normalisation so a parsing bug can be replayed.
      rawPayload: text,
    };
  }
}

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

function requireFeedUrl(): string {
  const url = process.env.GSMNET_FEED_URL;
  if (!url) {
    throw new Error(
      'GSMNET_FEED_URL is not set.\n' +
      '  → Awin → Toolbox → Create-a-Feed → GSM Net → copy the feed URL into .env'
    );
  }
  return url;
}

const UA =
  process.env.HTTP_USER_AGENT ??
  'Scoopt/0.1 (price comparison; +https://scoopt.nl; contact@scoopt.nl)';

async function downloadFeed(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading GSM Net feed from ${hostOf(url)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // gzip magic bytes 0x1f 0x8b — Awin serves gzip whether or not the URL says .gz.
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const bytes = isGzip ? gunzipSync(buf) : buf;
  // Strip a UTF-8 BOM if present so the first header cell matches cleanly.
  return bytes.toString('utf8').replace(/^﻿/, '');
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quotes, escaped "" quotes, embedded commas/newlines)
// ---------------------------------------------------------------------------

/** Guess the delimiter from the header line: the candidate that splits it into
 *  the most fields wins. Awin defaults to comma but pipe feeds exist. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) >= 0 ? text.search(/\r?\n/) : text.length);
  const candidates = [',', '|', '\t', ';'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = countUnquoted(firstLine, d);
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

function countUnquoted(line: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === delimiter && !inQuotes) count++;
  }
  return count;
}

/** Parse the whole document into rows of string cells. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field); field = '';
      // Skip fully blank lines rather than emitting an empty row.
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  // Flush the final field/row if the file did not end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// header mapping + row → RawOffer
// ---------------------------------------------------------------------------

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/^﻿/, '').replace(/^"|"$/g, '');
}

type ColIndex = Map<string, number>;

function buildIndex(header: string[]): ColIndex {
  const m: ColIndex = new Map();
  header.forEach((h, i) => { if (!m.has(h)) m.set(h, i); });
  return m;
}

/** Index of the first alias present in the header, or -1. */
function col(index: ColIndex, aliases: readonly string[]): number {
  for (const a of aliases) {
    const i = index.get(a);
    if (i !== undefined) return i;
  }
  return -1;
}

/** First non-empty cell across the alias list. */
function pick(row: string[], index: ColIndex, aliases: readonly string[]): string {
  for (const a of aliases) {
    const i = index.get(a);
    if (i !== undefined) {
      const v = (row[i] ?? '').trim();
      if (v) return v;
    }
  }
  return '';
}

function toRawOffer(row: string[], index: ColIndex): RawOffer | null {
  const url = pick(row, index, COLUMNS.url);
  if (!url.startsWith('http')) return null; // no tracked link → nothing to earn/show

  const priceCents = parsePriceToCents(pick(row, index, COLUMNS.price));
  if (priceCents === null) return null;

  const title = pick(row, index, COLUMNS.title);
  if (!title) return null;

  const eanRaw = pick(row, index, COLUMNS.ean);
  const shippingStr = pick(row, index, COLUMNS.shipping);
  const shippingCents = shippingStr ? (parsePriceToCents(shippingStr) ?? 0) : 0;
  const currency = (pick(row, index, COLUMNS.currency) || 'EUR').toUpperCase();
  const categoryLabel = pick(row, index, COLUMNS.category);

  return {
    retailerSku: pick(row, index, COLUMNS.sku) || eanRaw || url,
    ean: eanRaw || null,
    brand: pick(row, index, COLUMNS.brand) || 'Onbekend',
    title,
    // Contract category is one of home|sport|tech; the classifier owns the real
    // placement from the title. GSM Net is telecom, so 'tech' is the seed.
    category: DEFAULT_CATEGORY,
    priceCents,
    shippingCents,
    currency,
    inStock: parseInStock(pick(row, index, COLUMNS.inStock)),
    productUrl: url,
    imageUrl: pick(row, index, COLUMNS.image) || null,
    description: pick(row, index, COLUMNS.description) || null,
    // The source's OWN category, passed to the classifier's stage 1 as a signal
    // (never a decision here). Unmapped keys surface in the ingest "map these
    // next" list; classification still falls back to the title rules meanwhile.
    sourceCategoryKey: categoryLabel || null,
    sourceCategoryLabel: categoryLabel || null,
  };
}

/**
 * Parse a feed price string to integer cents, tolerating the formats a product
 * feed can emit: "1299.00", "1.299,00", "1299,00", "€ 1299", "1299".
 */
export function parsePriceToCents(input: string): number | null {
  if (!input) return null;
  let s = input.replace(/[^\d.,-]/g, '').trim(); // strip currency symbols/spaces
  if (!s) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // The LAST separator is the decimal one; the other groups thousands.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // Lone comma: decimal if it looks like ",dd", else a thousands separator.
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const value = Number(s);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

const IN_STOCK_TRUE = new Set(['1', 'y', 'yes', 'true', 't', 'in stock', 'instock', 'in_stock', 'op voorraad', 'available', 'leverbaar']);
const IN_STOCK_FALSE = new Set(['0', 'n', 'no', 'false', 'f', 'out of stock', 'outofstock', 'uit voorraad', 'unavailable', 'niet leverbaar', 'nietopvoorraad']);

/** Feeds spell stock a dozen ways. Unknown → assume buyable (default true). */
export function parseInStock(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  if (IN_STOCK_TRUE.has(v)) return true;
  if (IN_STOCK_FALSE.has(v)) return false;
  // Numeric stock count: >0 is in stock.
  const n = Number(v);
  if (Number.isFinite(n)) return n > 0;
  return true;
}
