import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RetailerSource, FetchResult, RawOffer } from '../../src/sources/types';

/**
 * A retailer that exists ONLY for the test suite.
 *
 * It lives under tests/ rather than src/ deliberately: nothing here ships, and
 * nothing here is registered in src/sources/registry.ts, so it cannot be named
 * on the command line and cannot reach a production database. The ingest guard
 * in src/ingest/run.ts refuses sourceKind 'fixture' unless
 * ALLOW_SYNTHETIC_SOURCES=1, which only tests/setup.ts sets.
 *
 * The catalogue it reads contains invented brands, invented prices and EANs
 * with a non-issuable 000 prefix. No real retailer, brand or price appears in
 * it — that is the whole point.
 */
export class TestCatalogueSource implements RetailerSource {
  readonly sourceKind = 'fixture' as const;

  constructor(
    readonly slug = 'testshop',
    readonly name = 'TestShop',
    readonly homepageUrl = 'https://testshop.invalid',
    /** Multiply every price, so one catalogue can stand in for several retailers. */
    private readonly priceFactor = 1,
    private readonly path = fileURLToPath(new URL('../fixtures/catalogue.json', import.meta.url))
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
      productUrl: p.productUrl.replace('retailer.invalid', `${this.slug}.invalid`),
    }));

    return { offers, rawPayload };
  }
}
