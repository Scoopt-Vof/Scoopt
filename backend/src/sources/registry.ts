import type { RetailerSource } from './types';
import { EbaySource } from './ebay';

/**
 * Every source, keyed by the name you pass on the command line:
 *
 *   npm run ingest -- ebay-nl
 *   npm run ingest -- ebay-nl ebay-de   (comparison rows appear here)
 *   npm run ingest -- all
 *
 * `credentials` says what you need before it will run.
 *
 * `synthetic` marks a source whose PRICES ARE INVENTED. Those must never reach
 * the database that serves scoopt.nl: `all` skips them, and naming one on the
 * command line is refused unless ALLOW_SYNTHETIC_SOURCES=1 is set. Any source
 * added later with made-up prices must carry this flag. There are none today.
 *
 * NOTE: Icecat is deliberately not in here. It is not a retailer and has no
 * prices — it enriches products that already exist with images, descriptions
 * and specs. It runs as its own pass: `npm run enrich:icecat`.
 */

export interface SourceEntry {
  build: () => RetailerSource;
  credentials: string[];
  blurb: string;
  /** Invented prices — excluded from `all`. Local/throwaway databases only. */
  synthetic?: boolean;
}

export const SOURCES: Record<string, SourceEntry> = {
  'ebay-nl': {
    build: () => new EbaySource('EBAY_NL'),
    credentials: ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET'],
    blurb: 'Real Dutch prices in EUR, with GTIN. The backbone of the proof of concept.',
  },
  'ebay-de': {
    build: () => new EbaySource('EBAY_DE'),
    credentials: ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET'],
    blurb: 'Same products, German marketplace — this is where comparison rows come from.',
  },
  // ebay-gb was removed: eBay UK prices in GBP, ingest refuses non-EUR offers
  // (nothing converts currency), so every call spent eBay quota for nothing.
  // Re-add it only together with currency conversion.

  // ── Further affiliate programmes plug in here, one entry each. Every source
  //    must return prices a retailer actually charges. Anything with invented
  //    prices carries `synthetic: true`, which keeps it out of `all` and
  //    refuses to run without an explicit override. ─────────────────────────
};

export function resolveSources(names: string[]): RetailerSource[] {
  if (names.length === 0 || names[0] === 'all') {
    return Object.entries(SOURCES)
      .filter(([, e]) => !e.synthetic && e.credentials.every((c) => process.env[c]))
      .map(([, e]) => e.build());
  }

  return names.map((name) => {
    const entry = SOURCES[name];
    if (!entry) {
      throw new Error(
        `Unknown source "${name}".\nAvailable: ${Object.keys(SOURCES).join(', ')}`
      );
    }
    const missing = entry.credentials.filter((c) => !process.env[c]);
    if (missing.length) {
      throw new Error(
        `Source "${name}" needs ${missing.join(' and ')} in your .env file.\n  ${entry.blurb}`
      );
    }
    if (entry.synthetic && process.env.ALLOW_SYNTHETIC_SOURCES !== '1') {
      throw new Error(
        `Source "${name}" has INVENTED prices and is refused by default.\n` +
        `Set ALLOW_SYNTHETIC_SOURCES=1 to run it against a local or throwaway database.\n` +
        `Never set it for the database that serves scoopt.nl.`
      );
    }
    return entry.build();
  });
}

export function printSources(): void {
  console.log('\nAvailable sources:\n');
  for (const [name, e] of Object.entries(SOURCES)) {
    const ready = e.credentials.every((c) => process.env[c]);
    const state = e.credentials.length === 0 ? 'no setup' : ready ? 'ready' : `needs ${e.credentials.join(', ')}`;
    const tag = e.synthetic ? ' ⚠️ INVENTED PRICES — excluded from `all`' : '';
    console.log(`  ${name.padEnd(18)} [${state}]${tag}`);
    console.log(`  ${''.padEnd(18)} ${e.blurb}\n`);
  }
}
