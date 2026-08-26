import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RetailerSource, FetchResult, RawOffer } from './types';

/**
 * DECATHLON SOURCE ADAPTER
 * ────────────────────────────────────────────────────────────────────────────
 * Reads the stand-in catalogue in data/decathlon-products.json.
 *
 * WHY NOT LIVE DECATHLON DATA — read this before changing it:
 *
 *   1. Decathlon publishes no product or pricing API. Their developer portal
 *      (developers.decathlon.com) covers sport activities, places, activity
 *      tracking and SSO. There is nothing to call.
 *
 *   2. decathlon.nl/robots.txt line 2 is `Disallow: /api/*` — the storefront
 *      JSON endpoints are explicitly closed to automated clients. That is the
 *      site operator's own machine-readable instruction, and it is what a
 *      court looks at first.
 *
 *   3. Ryanair v PR Aviation (CJEU C-30/14): where a database attracts neither
 *      copyright nor the sui generis right, the Database Directive's
 *      lawful-user protections do not apply, so the site's T&Cs bind as an
 *      ordinary contract. PR Aviation was a Dutch price-comparison site. It lost.
 *
 * The legitimate route to Decathlon pricing is their affiliate programme, which
 * ships a licensed product feed. That is Wave 4 in the plan — after launch,
 * because a live site with traffic is a far stronger application.
 *
 * WHEN THAT FEED ARRIVES: write `decathlon-feed.ts` implementing RetailerSource,
 * change one line in ingest/run.ts, set sourceKind to 'affiliate_feed'. Nothing
 * else in this codebase moves. That is what this trial run is proving.
 */
export class DecathlonSource implements RetailerSource {
  readonly slug = 'decathlon';
  readonly name = 'Decathlon';
  readonly homepageUrl = 'https://www.decathlon.nl';
  readonly sourceKind = 'fixture' as const;

  constructor(private readonly fixturePath?: string) {}

  async fetch(): Promise<FetchResult> {
    const path =
      this.fixturePath ??
      fileURLToPath(new URL('../../data/decathlon-products.json', import.meta.url));

    const rawPayload = await readFile(path, 'utf8');
    const parsed = JSON.parse(rawPayload) as { products: RawOffer[] };

    if (!Array.isArray(parsed.products)) {
      throw new Error('decathlon source: payload has no products array');
    }

    // Optional: nudge prices a few percent per run so that running ingestion
    // repeatedly builds a price history you can actually see on a chart.
    // Off by default. Never enable against a real feed.
    const drift = process.env.SIMULATE_PRICE_DRIFT === '1';

    const offers: RawOffer[] = parsed.products.map((p) => ({
      ...p,
      priceCents: drift ? applyDrift(p.priceCents, p.retailerSku) : p.priceCents,
    }));

    return { offers, rawPayload };
  }
}

/** Deterministic per-SKU pseudo-random drift of -8%..+8%, re-seeded each hour. */
function applyDrift(cents: number, sku: string): number {
  const hourSeed = Math.floor(Date.now() / 3_600_000);
  let h = hourSeed;
  for (const ch of sku) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const factor = 0.92 + ((h % 1601) / 1600) * 0.16;
  return Math.max(50, Math.round(cents * factor));
}
