import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from '../lib/db';
import { isValidEan13, normaliseEan } from '../lib/ean';
import { fetchIcecatProduct } from '../sources/icecat';
import { requireEnv } from '../lib/http';

/**
 * ICECAT CATALOGUE DISCOVERY — a different job from enrich-icecat.ts.
 * -----------------------------------------------------------------------------
 * enrich-icecat.ts only touches products a retailer feed (eBay etc.) already
 * created — it adds a manufacturer image/description/specs to a row that
 * exists. It never creates a NEW product, so it cannot fill a subcategory
 * that has no eBay-matched product in it yet.
 *
 * This script does the other half: it walks Icecat's own catalogue, filtered
 * to the categories Scoopt cares about (ICECAT_CATEGORY_MAP below), and
 * CREATES a product row for every GTIN Icecat has data for — with a real
 * manufacturer title, image and specs, but genuinely no price or offer yet.
 * That is the deliberate order the site is built around: Icecat supplies the
 * catalogue entry, and a retailer/affiliate feed (run.ts, matching on the
 * same EAN) supplies the price whenever it finds that product. A product
 * with zero offers is an honest state — no price is ever invented here.
 *
 * -----------------------------------------------------------------------------
 * SETUP — two things, both one-time:
 * -----------------------------------------------------------------------------
 *   1. ICECAT_USERNAME / ICECAT_API_TOKEN / ICECAT_CONTENT_TOKEN in .env —
 *      same tokens enrich-icecat.ts uses. See README-ICECAT.md.
 *   2. ICECAT_CATEGORY_MAP below — which Icecat category IDs map to which
 *      Scoopt subcategory. These are Icecat's own numeric IDs and this file
 *      deliberately ships with the map EMPTY rather than guessed values —
 *      run `npm run icecat:categories -- --search <term>` (see
 *      list-icecat-categories.ts) to find the real IDs for the subcategories
 *      you want filled, for the brands your Icecat account actually covers,
 *      and add them below.
 *
 * Run:
 *   npm run discover:icecat -- --limit 100
 *   npm run discover:icecat                    (default limit, see below)
 *
 * -----------------------------------------------------------------------------
 * NOT YET VERIFIED — read this before relying on it.
 * -----------------------------------------------------------------------------
 * Same situation as ../sources/icecat.ts and README-ICECAT.md: this was
 * written from Icecat's published manuals, not a live response, because
 * generating tokens and confirming coverage is a step only your MyIcecat
 * account can do. Two things specifically need checking on the first real
 * run, both isolated to parseIndexRow() below so they're a small fix if wrong:
 *   - The exact attribute names on each <Product> row in the index file
 *     (GTIN, category id, brand/supplier).
 *   - Whether Open Icecat's index is served from the URL below at all, vs. a
 *     different path for the free tier — see INDEX_URL.
 * A run that logs "0 rows parsed" or "0 matched your category map" almost
 * always means one of those two things needs adjusting, not that the account
 * has no data.
 */

// Documented for the general Icecat XML export; the free/Open tier is
// reported to use the same repository structure with restricted content.
// See https://iceclog.com/open-catalog-interface-oci-open-icecat-xml-and-full-icecat-xml-repositories/
const INDEX_URL = 'https://data.icecat.biz/export/freexml.int/files.index.xml.gz';

const DEFAULT_LIMIT = Number(process.env.ICECAT_DISCOVER_LIMIT ?? 200);

/**
 * Icecat category ID -> Scoopt category/subcategory.
 *
 * DELIBERATELY EMPTY. Fill this in with real IDs from
 * `npm run icecat:categories -- --search <term>` — see the header comment.
 * Example shape once populated (these numbers are illustrative, NOT verified
 * real Icecat IDs — do not ship this file with numbers nobody checked):
 *
 *   '4': { category: 'tech', subcategory: 'smartphones' },
 *   '118': { category: 'tech', subcategory: 'laptops-computers' },
 */
const ICECAT_CATEGORY_MAP: Record<string, { category: 'home' | 'sport' | 'tech'; subcategory: string }> = {
  // Add mapped Icecat category IDs here.
};

interface IndexRow {
  gtin: string;
  icecatCategoryId: string;
  brand: string | null;
}

/** Extracts {gtin, categoryId, brand} from each <Product> row in the index.
 *  UNVERIFIED — see the header comment. Adjust the attribute names here if a
 *  real download's shape differs; nothing else in this file needs to change. */
function parseIndexRows(xml: string): IndexRow[] {
  const rows: IndexRow[] = [];
  const blocks = xml.match(/<Product\b[^>]*\/?>/g) ?? [];
  for (const block of blocks) {
    const gtin =
      block.match(/\bGTIN(?:_\d+)?="([^"]+)"/)?.[1] ??
      block.match(/\bEAN="([^"]+)"/)?.[1];
    const categoryId =
      block.match(/\bCategory_ID="(\d+)"/)?.[1] ?? block.match(/\bCatid="(\d+)"/)?.[1];
    const brand = block.match(/\bSupplier_id="[^"]*"\s+Supplier_name="([^"]+)"/)?.[1] ?? null;
    if (gtin && categoryId) rows.push({ gtin, icecatCategoryId: categoryId, brand });
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const limitFlag = args.indexOf('--limit');
  const limit = limitFlag !== -1 ? Number(args[limitFlag + 1]) : DEFAULT_LIMIT;

  requireEnv('ICECAT_USERNAME', 'MyIcecat -> My profile.');
  requireEnv('ICECAT_API_TOKEN', 'MyIcecat -> Access details -> Manage Access Tokens -> Add API Access Token.');
  requireEnv('ICECAT_CONTENT_TOKEN', 'MyIcecat -> Access details -> Manage Access Tokens -> Add Content Access Token.');

  const mappedIds = Object.keys(ICECAT_CATEGORY_MAP);
  if (mappedIds.length === 0) {
    console.error(
      '\nICECAT_CATEGORY_MAP in this file is empty, so there is nothing to discover.\n' +
      'Run `npm run icecat:categories -- --search <term>` to find real Icecat\n' +
      'category IDs for the subcategories you want filled, then add them to\n' +
      'ICECAT_CATEGORY_MAP in src/ingest/discover-icecat.ts and run this again.\n'
    );
    process.exit(1);
  }

  console.log(`\nDownloading Icecat's product index...`);
  console.log(`  ${INDEX_URL}`);
  console.log(`  (this file covers the whole catalogue your account can see — it can be large)\n`);

  const res = await fetch(INDEX_URL, {
    headers: { 'user-agent': process.env.HTTP_USER_AGENT ?? 'Scoopt/0.1' },
  });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} fetching the Icecat index. See the "NOT YET VERIFIED" note ` +
      `at the top of this file — the free-tier index may be served from a different path.`
    );
  }
  const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');

  // Archive the raw download before parsing — same discipline as run.ts, so a
  // parsing bug found later can be replayed instead of re-downloaded blind.
  const archiveDir = join(process.cwd(), 'raw', 'icecat-index');
  await mkdir(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, `${Date.now()}.xml`);
  await writeFile(archivePath, xml, 'utf8');
  console.log(`Archived raw index to ${archivePath}`);

  const rows = parseIndexRows(xml);
  console.log(`Parsed ${rows.length} product rows from the index.`);

  const matched = rows.filter((r) => ICECAT_CATEGORY_MAP[r.icecatCategoryId]);
  console.log(`${matched.length} rows fall in a mapped category (out of ${mappedIds.length} mapped IDs).`);

  if (rows.length === 0 || matched.length === 0) {
    console.log(
      `\nIf this is 0, see "NOT YET VERIFIED" at the top of this file — the index's real\n` +
      `attribute names likely differ from parseIndexRows()'s guesses, or the category IDs\n` +
      `in ICECAT_CATEGORY_MAP don't appear in this account's index.\n`
    );
  }

  const toProcess = matched.slice(0, limit);
  console.log(`\nLooking up ${toProcess.length} product(s) at Icecat (limit ${limit})...\n`);

  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const row of toProcess) {
    const ean = normaliseEan(row.gtin);
    if (!isValidEan13(ean)) { skipped++; continue; }

    const mapping = ICECAT_CATEGORY_MAP[row.icecatCategoryId];
    try {
      const info = await fetchIcecatProduct(ean!);
      if (!info || !info.title) { skipped++; continue; }

      const [existing] = await sql<{ id: number; category_id_set: boolean }[]>`
        select id, (category is not null) as category_id_set from product where ean = ${ean}
      `;

      await sql`
        insert into product (ean, brand, title, category, image_url, description, status,
                             subcategory, specs, icecat_checked_at)
        values (${ean}, ${row.brand ?? 'Icecat'}, ${info.title}, ${mapping.category},
                ${info.imageUrl}, ${info.description}, 'published',
                ${mapping.subcategory}, ${sql.json(info.specs ?? {})}, now())
        on conflict (ean) do update
          set image_url   = coalesce(product.image_url, excluded.image_url),
              description = coalesce(product.description, excluded.description),
              subcategory = coalesce(product.subcategory, excluded.subcategory),
              specs       = product.specs || excluded.specs,
              icecat_checked_at = now(),
              updated_at  = now()
      `;

      if (existing) updated++; else created++;
    } catch (err) {
      failed++;
      console.error(`  x GTIN ${ean} failed: ${String(err).split('\n')[0]}`);
    }
  }

  console.log(
    `\nDone: ${created} created, ${updated} updated, ${skipped} skipped (no data or bad EAN), ${failed} failed.\n` +
    `Reminder: these products have no price yet. Run the retailer ingest (npm run ingest)\n` +
    `to attach real offers to any of these EANs a retailer also sells.\n`
  );
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('\nfailed:', String(err));
    await sql.end();
    process.exit(1);
  });
