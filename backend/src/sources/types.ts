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
  category: string;
  /** Integer cents. Adapters convert; nothing downstream ever sees euros. */
  priceCents: number;
  shippingCents?: number;
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
}

export interface FetchResult {
  offers: RawOffer[];
  /**
   * The untouched payload exactly as received, archived BEFORE parsing.
   * If normalisation has a bug you can replay history instead of losing it.
   */
  rawPayload: string;
}

export interface RetailerSource {
  /** Must match a `retailer.slug` row in the database. */
  readonly slug: string;
  readonly name: string;
  readonly homepageUrl: string;
  /** Recorded on every ingest_run so provenance is queryable. */
  readonly sourceKind: 'official_api' | 'affiliate_feed' | 'fixture';
  readonly affiliateNetwork?: string;

  fetch(): Promise<FetchResult>;
}
