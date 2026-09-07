import type { RetailerSource } from './types';
import { DecathlonSource } from './decathlon';
import { EbaySource } from './ebay';
import { KrogerSource } from './kroger';
import { BestBuySource } from './bestbuy';
import { OpenPricesSource } from './openprices';

/**
 * Every source, keyed by the name you pass on the command line:
 *
 *   npm run ingest -- ebay-nl
 *   npm run ingest -- ebay-nl ebay-de ebay-gb   (comparison rows appear here)
 *   npm run ingest -- all
 *
 * `credentials` says what you need before it will run.
 *
 * `synthetic` marks a source whose PRICES ARE INVENTED. Those must never reach
 * the database that serves scoopt.nl: `all` skips them, and naming one on the
 * command line is refused unless ALLOW_SYNTHETIC_SOURCES=1 is set. Any source
 * added later with made-up prices must carry this flag.
 */

export interface SourceEntry {
  build: () => RetailerSource;
  credentials: string[];
  blurb: string;
  /** Invented prices — excluded from `all`. Local/throwaway databases only. */
  synthetic?: boolean;
}

export const SOURCES: Record<string, SourceEntry> = {
  // ── Tier 0: real prices, nothing to sign up for ──────────────────────────
  'openprices-ah': {
    build: () => new OpenPricesSource('Albert Heijn'),
    credentials: [],
    blurb: 'Real Dutch prices, no API key at all. Small volume. ODbL — read the header.',
  },
  'openprices-jumbo': {
    build: () => new OpenPricesSource('Jumbo'),
    credentials: [],
    blurb: 'As above, Jumbo stores.',
  },

  // ── Tier 1: instant self-service credentials ─────────────────────────────
  kroger: {
    build: () => new KrogerSource(),
    credentials: ['KROGER_CLIENT_ID', 'KROGER_CLIENT_SECRET'],
    blurb: 'US supermarket. Instant signup, real prices + UPC. Fastest real API to first call.',
  },

  // ── Tier 2: ~1 day, and the one that actually matters ────────────────────
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
  'ebay-gb': {
    build: () => new EbaySource('EBAY_GB'),
    credentials: ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET'],
    blurb: 'Third price against the same EAN.',
  },

  // ── Next affiliate programmes plug in here. One entry each, real prices,
  //    no `synthetic` flag. ────────────────────────────────────────────────

  // ── Tier 3: works, but the terms do not survive a real comparison site ───
  bestbuy: {
    build: () => new BestBuySource(),
    credentials: ['BESTBUY_API_KEY'],
    blurb: 'US electronics. ⚠️ Terms forbid comparison use — prototype only, never ship.',
  },

  // ── Synthetic. Invented prices against real Decathlon house-brand names.
  //    Pipeline smoke-testing only, against a throwaway database. ──────────
  decathlon: {
    build: () => new DecathlonSource(),
    credentials: [],
    blurb: 'Stand-in catalogue, INVENTED prices. No network. Pipeline smoke test only.',
    synthetic: true,
  },
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