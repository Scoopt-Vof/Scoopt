/**
 * ICECAT CATEGORY LOOKUP — a read-only helper, not part of the ingest pipeline.
 * -----------------------------------------------------------------------------
 * discover-icecat.ts (the actual catalogue pull) needs to know which Icecat
 * category IDs correspond to Scoopt's subcategories ("Smartphones", "Laptops
 * & Computers", ...). Those numeric IDs are Icecat's own and must come from
 * Icecat's real reference data — guessing them would risk silently pulling
 * the wrong vertical (or nothing at all) into a subcategory.
 *
 * This script fetches Icecat's public category reference file and prints
 * every category whose name matches your search term, with its numeric ID,
 * so you can fill in ICECAT_CATEGORY_MAP in discover-icecat.ts with real
 * values instead of placeholders.
 *
 * Run:
 *   npm run icecat:categories -- --search Smartphone
 *   npm run icecat:categories -- --search "Notebook"
 *   npm run icecat:categories                        (prints everything — long)
 *
 * UNVERIFIED — same caveat as ../sources/icecat.ts and README-ICECAT.md: this
 * is written from Icecat's published manuals (the reference file is documented
 * at https://iceclog.com/open-catalog-interface-oci-open-icecat-xml-and-full-icecat-xml-repositories/),
 * not confirmed against a live download. If the fetch fails or the shape
 * printed below looks wrong, that manual is the next thing to check, and the
 * fallback is reading the category names/IDs straight from a product page in
 * your MyIcecat account instead.
 */

import { gunzipSync } from 'node:zlib';

// Open Icecat vs Full Icecat both publish the same reference files; this path
// is documented as the general (not brand-specific) categories reference.
const CATEGORIES_URL = 'https://data.icecat.biz/export/freexml.int/refs/CategoriesList.xml.gz';

interface CategoryRow {
  id: string;
  name: string;
}

/** Minimal, dependency-free extraction of <Category ID="..."><Name ...
 *  Value="..."/></Category>-shaped rows. No XML parser is in package.json
 *  yet, and this file only needs id+name pairs, not a full parse — if
 *  Icecat's real shape differs, this regex is the first thing to adjust. */
function extractCategories(xml: string): CategoryRow[] {
  const rows: CategoryRow[] = [];
  const categoryBlocks = xml.match(/<Category\b[^>]*>[\s\S]*?<\/Category>/g) ?? [];
  for (const block of categoryBlocks) {
    const id = block.match(/\bID="(\d+)"/)?.[1];
    // Prefer an English name; fall back to the first Name element present.
    const name =
      block.match(/<Name[^>]*langid="1"[^>]*Value="([^"]*)"/)?.[1] ??
      block.match(/<Name[^>]*Value="([^"]*)"/)?.[1];
    if (id && name) rows.push({ id, name });
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const searchFlag = args.indexOf('--search');
  const search = searchFlag !== -1 ? args[searchFlag + 1]?.toLowerCase() : null;

  console.log(`\nFetching Icecat's category reference list...`);
  console.log(`  ${CATEGORIES_URL}\n`);

  const res = await fetch(CATEGORIES_URL, {
    headers: { 'user-agent': process.env.HTTP_USER_AGENT ?? 'Scoopt/0.1' },
  });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} fetching the categories reference file.\n` +
      `This endpoint is documented but not verified live — see the header comment ` +
      `in this file. If it 404s or times out, the fallback is reading category ` +
      `names/IDs directly from a product page in your MyIcecat account.`
    );
  }
  const gz = Buffer.from(await res.arrayBuffer());
  const xml = gunzipSync(gz).toString('utf8');

  const rows = extractCategories(xml);
  console.log(`Parsed ${rows.length} categories.\n`);

  const filtered = search ? rows.filter((r) => r.name.toLowerCase().includes(search)) : rows;
  if (search && filtered.length === 0) {
    console.log(`No category name contains "${search}". Try a shorter or different term.`);
  }
  for (const r of filtered.slice(0, 200)) {
    console.log(`  ${r.id.padEnd(10)} ${r.name}`);
  }
  if (filtered.length > 200) {
    console.log(`  ... and ${filtered.length - 200} more. Narrow with --search.`);
  }
  console.log(
    `\nCopy the IDs you need into ICECAT_CATEGORY_MAP in src/ingest/discover-icecat.ts.`
  );
}

main().catch((err) => {
  console.error('\nfailed:', String(err));
  process.exit(1);
});
