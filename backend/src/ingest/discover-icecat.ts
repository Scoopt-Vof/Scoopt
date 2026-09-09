import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from '../lib/db';
import { isValidEan13, normaliseEan } from '../lib/ean';
import { fetchIcecatProduct } from '../sources/icecat';
import { requireEnv } from '../lib/http';
import { loadCategoryMap } from './source-category-map';
import { fetchIcecatCategoryNames } from './list-icecat-categories';

/**
 * ICECAT CATALOGUE DISCOVERY — parked capability, report-first by default.
 * =============================================================================
 *
 * WHAT ICECAT IS FOR, DAY TO DAY
 * ------------------------------
 * Icecat's job on scoopt is to supply the product IMAGE, specs and the
 * manufacturer's own CATEGORY for products that already exist — products that
 * arrived from eBay today, and from Awin, Bol and other feeds later. That job
 * is done by `npm run enrich:icecat`, which looks each product up by the EAN we
 * already hold. It needs no product index and no category filtering.
 *
 * WHAT THIS SCRIPT IS FOR
 * -----------------------
 * This is the other, optional half: walking Icecat's own catalogue index and
 * CREATING product rows that no retailer feed has produced yet. It is kept
 * because it buys three things later, not because the site needs it now:
 *
 *   - a canonical product spine keyed by EAN, so when Awin, Bol and eBay all
 *     carry the same television their offers land on ONE product row instead of
 *     three near-duplicates matched by fuzzy title;
 *   - a catalogue to show affiliate networks when applying, and pages that can
 *     age in search before offers exist;
 *   - watchlist / price-alert candidates: a product nobody currently offers is
 *     exactly what a shopper wants to be told about when it appears.
 *
 * WHY IT DOES NOT WRITE BY DEFAULT
 * --------------------------------
 * A product row with no offer is a dead end on a site whose entire purpose is
 * sending someone to where they can buy the thing. So:
 *
 *   - running this with no flags REPORTS ONLY — it downloads/loads the index,
 *     archives it, and prints which Icecat category ids actually occur and in
 *     what volume. Nothing is written to the database.
 *   - writing requires --yes-create-products, explicitly, every time.
 *   - rows it creates are status 'draft', so the API (which serves only
 *     'published') never shows a priceless product. run.ts promotes a draft to
 *     'published' the moment a real retailer offer attaches to it.
 *   - every row is stamped created_by_source = 'icecat', so the whole run can
 *     be undone in one statement. See README-ICECAT.md.
 *
 * THE CATEGORY MAP IS DATA, NOT CODE
 * ----------------------------------
 * Mappings live in the source_category_map table (db/007), keyed by source, so
 * the same map serves this script, enrich-icecat.ts and the classifier, and so
 * Awin's and Bol's taxonomies slot in beside Icecat's without touching any
 * script. Build it from the report this script prints — the ids that actually
 * occur, most frequent first — rather than from guessed search terms:
 *
 *     npm run discover:icecat                              # report only
 *     npm run icecat:map -- --set 4=tech/smartphones
 *     npm run icecat:map -- --list
 *
 * USAGE
 * -----
 *   npm run discover:icecat                                  report only
 *   npm run discover:icecat -- --from-file raw/icecat-index/1234.xml
 *                                                            replay an archive
 *   npm run discover:icecat -- --limit 20 --category 4 --yes-create-products
 *                                                            actually write
 *
 * (Windows: if PowerShell's execution policy blocks `npm`, use `npm.cmd`.)
 *
 * NOT YET VERIFIED — read before relying on it
 * --------------------------------------------
 * parseIndexRows() and INDEX_URL below were written from Icecat's published
 * manuals, not a live response. The parser handles both shapes the manuals
 * describe (<file> elements with nested <EAN_UPC>, and flat <Product> rows), so
 * it has two chances to be right — but neither is confirmed. Report mode exists
 * precisely so that finding out costs one command and no database rows: if it
 * prints "0 rows parsed", open the archived file it names, look at one real
 * element, and fix the attribute names in parseIndexRows(). Don't invest in the
 * mapping until the report shows real ids.
 */

// Documented for the general Icecat XML export; the free/Open tier is
// reported to use the same repository structure with restricted content.
// See https://iceclog.com/open-catalog-interface-oci-open-icecat-xml-and-full-icecat-xml-repositories/
const INDEX_URL = 'https://data.icecat.biz/export/freexml.int/files.index.xml.gz';

const DEFAULT_LIMIT = Number(process.env.ICECAT_DISCOVER_LIMIT ?? 20);
const SOURCE = 'icecat';

export interface IndexRow {
  gtin: string;
  icecatCategoryId: string;
  brand: string | null;
}

/**
 * Extracts {gtin, categoryId, brand} from Icecat's product index.
 *
 * TWO SHAPES, both handled, because which one this account gets is still
 * unverified:
 *
 *   1. The documented OCI index shape — one <file> element per product, with
 *      Catid and Supplier_name as attributes and the barcodes nested:
 *
 *        <file path="..." Product_ID="12345" Catid="151" Supplier_id="1"
 *              Supplier_name="Apple" Model_Name="...">
 *          <EAN_UPCS><EAN_UPC Value="0194253715214"/></EAN_UPCS>
 *        </file>
 *
 *   2. A flat <Product ... GTIN="..." Category_ID="..." /> shape.
 *
 * A product can list several barcodes; the first one that survives EAN-13
 * validation wins, since a junk barcode matched against a retailer feed is the
 * one failure a comparison site cannot survive (see lib/ean.ts).
 *
 * If a live download parses to zero rows, this function is the only thing that
 * needs changing — open the archived file the run names and compare a real
 * element's attribute names against the ones below.
 */
export function parseIndexRows(xml: string): IndexRow[] {
  const rows: IndexRow[] = [];

  const attr = (block: string, ...names: string[]): string | undefined => {
    for (const name of names) {
      const m = block.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
      if (m?.[1]) return m[1];
    }
    return undefined;
  };

  const pushRow = (openTag: string, body: string) => {
    const categoryId = attr(openTag, 'Catid', 'Category_ID', 'CategoryID');
    if (!categoryId) return;
    const brand = attr(openTag, 'Supplier_name', 'Supplier') ?? null;

    // Barcodes: attributes on the element itself, then nested <EAN_UPC Value>.
    const candidates: string[] = [];
    const inline = attr(openTag, 'GTIN', 'GTIN_1', 'EAN', 'EAN_UPC');
    if (inline) candidates.push(inline);
    for (const m of body.matchAll(/<EAN_UPC\b[^>]*\bValue="([^"]+)"/gi)) {
      if (m[1]) candidates.push(m[1]);
    }

    const gtin = candidates.find((c) => isValidEan13(c)) ?? candidates[0];
    if (gtin) rows.push({ gtin, icecatCategoryId: categoryId, brand });
  };

  // Shape 1: <file ...> ... </file>, including self-closing <file ... />.
  const fileTags = [...xml.matchAll(/<file\b[^>]*>/gi)];
  for (let i = 0; i < fileTags.length; i++) {
    const openTag = fileTags[i]![0];
    const start = fileTags[i]!.index! + openTag.length;
    if (openTag.endsWith('/>')) {
      pushRow(openTag, '');
      continue;
    }
    const close = xml.indexOf('</file>', start);
    const nextOpen = fileTags[i + 1]?.index ?? xml.length;
    const end = close === -1 ? nextOpen : Math.min(close, nextOpen);
    pushRow(openTag, xml.slice(start, end));
  }

  // Shape 2: flat <Product ... /> rows.
  for (const m of xml.matchAll(/<Product\b[^>]*\/?>/gi)) {
    pushRow(m[0], '');
  }

  // One row per barcode: the same product appearing in both shapes, or listing
  // a barcode twice, must not be looked up twice.
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.gtin) ? false : (seen.add(r.gtin), true)));
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

/** Loads the index: either an archived copy (--from-file) or a fresh download.
 *  Fresh downloads are archived before parsing, same discipline as run.ts —
 *  a parsing bug found next week can be replayed instead of re-downloaded. */
async function loadIndexXml(fromFile: string | undefined): Promise<{ xml: string; origin: string }> {
  if (fromFile) {
    console.log(`Reading archived index from ${fromFile}`);
    const buf = await readFile(fromFile);
    const xml = fromFile.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return { xml, origin: fromFile };
  }

  console.log(`\nDownloading Icecat's product index...`);
  console.log(`  ${INDEX_URL}`);
  console.log(`  (covers the whole catalogue your account can see — it can be large)\n`);

  const res = await fetch(INDEX_URL, {
    headers: { 'user-agent': process.env.HTTP_USER_AGENT ?? 'Scoopt/0.1' },
  });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} fetching the Icecat index. See "NOT YET VERIFIED" at the ` +
      `top of this file — the free-tier index may be served from a different path.`
    );
  }
  const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');

  const archiveDir = join(process.cwd(), 'raw', 'icecat-index');
  await mkdir(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, `${Date.now()}.xml`);
  await writeFile(archivePath, xml, 'utf8');
  console.log(`Archived raw index to ${archivePath}`);
  return { xml, origin: archivePath };
}

/** THE MAP-BUILDING STEP: what's actually in the index, by volume, annotated
 *  with Icecat's own names and with whether we've mapped it yet. This is what
 *  replaces guessing thirteen search terms. */
async function report(rows: IndexRow[], origin: string): Promise<void> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.icecatCategoryId, (counts.get(r.icecatCategoryId) ?? 0) + 1);

  if (counts.size === 0) {
    console.log(
      `\nNo category ids found — so parseIndexRows() didn't recognise this file's shape.\n` +
      `Open ${origin} and look at one real <Product .../> line: the attribute names\n` +
      `there are what parseIndexRows() needs to match. Nothing was written to the\n` +
      `database, and no mapping work is wasted.\n`
    );
    return;
  }

  const [names, map] = await Promise.all([fetchIcecatCategoryNames(), loadCategoryMap(SOURCE)]);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`\n${counts.size} distinct Icecat category ids in the index, most common first:\n`);
  console.log(`  ${'id'.padEnd(10)}${'products'.padEnd(10)}${'mapped to'.padEnd(28)}Icecat's name`);
  console.log(`  ${'-'.repeat(76)}`);
  for (const [id, count] of ranked.slice(0, 60)) {
    const mapped = map.get(id);
    const target = mapped ? `${mapped.category}/${mapped.subcategory}` : '— unmapped —';
    console.log(
      `  ${id.padEnd(10)}${String(count).padEnd(10)}${target.padEnd(28)}${names.get(id) ?? ''}`
    );
  }
  if (ranked.length > 60) console.log(`  ... and ${ranked.length - 60} more ids.`);

  const mappedRows = rows.filter((r) => map.has(r.icecatCategoryId)).length;
  console.log(
    `\n${mappedRows} of ${rows.length} index rows fall in a category you've already mapped.\n\n` +
    `Next:\n` +
    `  npm run icecat:map -- --set <id>=<category>/<subcategory>     store a mapping\n` +
    `  npm run icecat:map -- --list                                  see the map\n` +
    `  npm run discover:icecat -- --limit 20 --yes-create-products    create draft rows\n`
  );
}

async function createProducts(rows: IndexRow[], limit: number): Promise<void> {
  requireEnv('ICECAT_USERNAME', 'MyIcecat -> My profile.');
  requireEnv('ICECAT_API_TOKEN', 'MyIcecat -> Access details -> Manage Access Tokens -> Add API Access Token.');
  requireEnv('ICECAT_CONTENT_TOKEN', 'MyIcecat -> Access details -> Manage Access Tokens -> Add Content Access Token.');

  const map = await loadCategoryMap(SOURCE);
  if (map.size === 0) {
    console.error(
      `\nsource_category_map has no rows for source "${SOURCE}", so there is nothing to\n` +
      `create. Run this script with no flags to see which category ids actually occur,\n` +
      `then store mappings with:\n` +
      `  npm run icecat:map -- --set <id>=<category>/<subcategory>\n`
    );
    process.exit(1);
  }

  const matched = rows.filter((r) => map.has(r.icecatCategoryId));
  const toProcess = matched.slice(0, limit);
  console.log(
    `\n${matched.length} index rows are in a mapped category; ` +
    `looking up the first ${toProcess.length} at Icecat (limit ${limit})...\n`
  );

  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const row of toProcess) {
    const ean = normaliseEan(row.gtin);
    if (!isValidEan13(ean)) { skipped++; continue; }

    const mapping = map.get(row.icecatCategoryId)!;
    try {
      const info = await fetchIcecatProduct(ean!);
      if (!info || !info.title) { skipped++; continue; }

      const [existing] = await sql<{ id: number }[]>`select id from product where ean = ${ean}`;

      // Idempotent on EAN, and deliberately conservative on conflict: a row a
      // retailer feed already created keeps its own title, category, status and
      // provenance. This pass only ever fills gaps and refreshes Icecat's own
      // columns, so re-running it can never reshuffle live products.
      await sql`
        insert into product (ean, brand, title, category, image_url, description, status,
                             subcategory, specs, icecat_checked_at,
                             icecat_category_id, icecat_category_name,
                             created_by_source, category_source)
        values (${ean}, ${row.brand ?? 'Unknown'}, ${info.title}, ${mapping.category},
                ${info.imageUrl}, ${info.description},
                -- 'draft', NOT 'published': no offer exists yet, and the API
                -- serves only published rows. run.ts promotes it when a real
                -- retailer offer attaches.
                'draft',
                ${mapping.subcategory}, ${sql.json(info.specs ?? {})}, now(),
                ${info.categoryId ?? row.icecatCategoryId},
                ${info.categoryName ?? mapping.sourceCategoryName},
                ${SOURCE}, 'source-map')
        on conflict (ean) do update
          set image_url            = coalesce(product.image_url, excluded.image_url),
              description          = coalesce(product.description, excluded.description),
              subcategory          = coalesce(product.subcategory, excluded.subcategory),
              specs                = product.specs || excluded.specs,
              icecat_category_id   = coalesce(excluded.icecat_category_id, product.icecat_category_id),
              icecat_category_name = coalesce(excluded.icecat_category_name, product.icecat_category_name),
              icecat_checked_at    = now(),
              updated_at           = now()
      `;

      if (existing) updated++; else created++;
    } catch (err) {
      failed++;
      console.error(`  x GTIN ${ean} failed: ${String(err).split('\n')[0]}`);
    }
  }

  console.log(
    `\nDone: ${created} created (as drafts), ${updated} updated, ` +
    `${skipped} skipped (no Icecat data or bad EAN), ${failed} failed.\n\n` +
    `These products have NO price and are not visible on the site — they are\n` +
    `status 'draft' until a retailer offer attaches to the same EAN, which\n` +
    `npm run ingest does automatically.\n\n` +
    `Check whether that is actually happening:  npm run icecat:verify\n` +
    `Undo this run entirely:                    see README-ICECAT.md\n`
  );
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const limit = Number(argValue(args, '--limit') ?? DEFAULT_LIMIT);
  const onlyCategory = argValue(args, '--category');
  const fromFile = argValue(args, '--from-file');
  const write = args.includes('--yes-create-products');

  const { xml, origin } = await loadIndexXml(fromFile);
  let rows = parseIndexRows(xml);
  console.log(`Parsed ${rows.length} product rows from the index.`);

  if (onlyCategory) {
    rows = rows.filter((r) => r.icecatCategoryId === onlyCategory);
    console.log(`Filtered to Icecat category ${onlyCategory}: ${rows.length} rows.`);
  }

  if (!write) {
    await report(rows, origin);
    console.log(
      `REPORT ONLY — nothing was written. Add --yes-create-products to create rows.\n`
    );
    return;
  }

  await createProducts(rows, limit);
}

const isMain =
  process.argv[1]?.endsWith('discover-icecat.ts') || process.argv[1]?.endsWith('discover-icecat.js');

if (isMain) {
  main()
    .then(() => sql.end())
    .catch(async (err) => {
      console.error('\nfailed:', String(err));
      await sql.end();
      process.exit(1);
    });
}
