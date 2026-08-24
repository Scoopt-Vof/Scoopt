import { readFile } from 'node:fs/promises';
import type { RetailerSource, FetchResult, RawOffer } from './types';

/**
 * A retailer backed by a JSON file. Useful for two things:
 *
 *   1. Tests — a second and third "retailer" carrying the SAME EANs at
 *      different prices, which is the only way to exercise the comparison
 *      path deterministically.
 *   2. Any retailer whose feed you download by hand. When the Decathlon
 *      affiliate feed arrives from Odyssey, dropping the CSV/XML through a
 *      parser into this shape is the whole integration.
 */
export class FixtureSource implements RetailerSource {
  readonly sourceKind = 'fixture' as const;

  constructor(
    readonly slug: string,
    readonly name: string,
    readonly homepageUrl: string,
    private readonly path: string,
    /** Multiply every price, so one fixture can stand in for several retailers. */
    private readonly priceFactor = 1
  ) {}

  async fetch(): Promise<FetchResult> {
    const rawPayload = await readFile(this.path, 'utf8');
    const parsed = JSON.parse(rawPayload) as { products: RawOffer[] };
    if (!Array.isArray(parsed.products)) {
      throw new Error(`${this.slug}: payload has no products array`);
    }

    const offers = parsed.products.map((p) => ({
      ...p,
      retailerSku: `${this.slug}-${p.retailerSku}`,
      priceCents: Math.max(50, Math.round(p.priceCents * this.priceFactor)),
      productUrl: p.productUrl.replace('www.decathlon.nl', `www.${this.slug}.example`),
    }));

    return { offers, rawPayload };
  }
}
