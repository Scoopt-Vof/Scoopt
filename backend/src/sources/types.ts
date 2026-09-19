/**
 * THE SWAP POINT.
 *
 * Everything downstream of this interface — normalisation, EAN matching, the
 * review queue, price_observation, the API routes — is retailer-agnostic and
 * never changes. Adding a retailer, or replacing a stand-in source with a real
 * licensed feed, means writing ONE new file that implements RetailerSource.
 *
 * That is the whole point of the trial run: prove the machine works, so the
 * only thing left to change is where the rows come from.
 */

/** A single product+price as the retailer expresses it, before any normalisation. */
export interface RawOffer {
  /** The retailer's own product identifier. Stable across runs; used to re-match. */
  retailerSku: string;
  /** As supplied. May be absent, may be junk — validated downstream, not here. */
  ean?: string | null;
  brand: string;
  title: string;
  /**
   * The front-end contract allows exactly 'home' | 'sport' | 'tech'. Anything
   * else is quietly rewritten to 'sport' further down, so a search phrase or a
   * retailer's own breadcrumb belongs in `subcategory`, never here.
   */
  category: string;
  /** Integer cents. Adapters convert; nothing downstream ever sees euros. */
  priceCents: number;
  shippingCents?: number;
  /** ISO 4217. Ingest refuses anything that is not 'EUR' - nothing in this
   *  codebase converts between currencies, so a non-euro row would be ranked
   *  against euro ones as if the numbers matched. */
  currency?: string;
  inStock: boolean;
  productUrl: string;
  imageUrl?: string | null;
  description?: string | null;

  // ---- Fields the FRONT-END contract needs that a raw price feed does not
  //      supply. A real retailer feed has no idea what Josh's Product.id is,
  //      so for real sources these stay undefined and get filled in by the
  //      matching/enrichment step. Seed sources supply them directly. ----
  /** Josh's Product.id — a readable slug like "run-pegasus41". */
  contractId?: string;
  /** Product.unit — short descriptor, e.g. "Hardloopschoen · dagelijks". */
  unit?: string;
  /** Product.subcategory — "hardlopen" | "fietsen" | "fitness". */
  subcategory?: string;
  /** Product.specs — the key/value bag personalisation ranks on. */
  specs?: Record<string, string>;

  // ---- Source category signal (added with the categorisation system) -------
  // The source's OWN category key for this row, passed straight through to
  // the classifier's stage 1. Never interpreted here: 'ebay' means an eBay
  // category id, and what it maps to is a row in source_category_map, not a
  // decision this adapter is allowed to make.
  /** The source's own numeric category id or breadcrumb key, as text. */
  sourceCategoryKey?: string | null;
  /** Human-readable label for that key, e.g. eBay's categoryPath. */
  sourceCategoryLabel?: string | null;
  /** Condition as the source states it — becomes a tag, not a category. */
  condition?: string | null;
  /**
   * Built from a price refresh of an offer we already know (e.g. an eBay
   * search result), not from a full product record. Ingest updates the offer
   * and price history but does not re-classify the product or touch its
   * details: the partial record must not overwrite what the full one said.
   */
  refreshOnly?: boolean;
}

export interface FetchResult {
  offers: RawOffer[];
  /**
   * The untouched payload exactly as received, archived BEFORE parsing.
   * If normalisation has a bug you can replay history instead of losing it.
   */
  rawPayload: string;
}

/**
 * What the ingest job already knows about this retailer, handed to fetch() so
 * a source can skip expensive calls for items it has seen before (eBay: the
 * getItem call that is only needed to learn an item's EAN).
 */
export interface FetchContext {
  /** retailer_sku -> the EAN of the product that offer is attached to. */
  knownEans: Map<string, string>;
}

export interface RetailerSource {
  /** Must match a `retailer.slug` row in the database. */
  readonly slug: string;
  readonly name: string;
  readonly homepageUrl: string;
  /** Recorded on every ingest_run so provenance is queryable. */
  readonly sourceKind: 'official_api' | 'affiliate_feed' | 'fixture';
  readonly affiliateNetwork?: string;

  fetch(ctx?: FetchContext): Promise<FetchResult>;
}
