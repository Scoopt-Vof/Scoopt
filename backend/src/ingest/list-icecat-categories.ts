/**
 * ICECAT CATEGORY REFERENCE — a read-only helper, not part of the ingest pipeline.
 * -----------------------------------------------------------------------------
 * Two jobs:
 *
 *   1. `fetchIcecatCategoryNames()` — used by discover-icecat.ts's report mode
 *      to put a human-readable name next to each Icecat category id it found,
 *      so filling in the map is reading a list rather than guessing.
 *
 *   2. A CLI to search that reference list by name, for when you have a name
 *      and want the id (the reverse of the usual direction).
 *
 * NOTE ON WORKFLOW — this is no longer the way to build the category map.
 * Searching thirteen guessed terms up front maps ids that may not appear in
 * this account's catalogue at all, and misses the ones that dominate it. The
 * better order is:
 *
 *     npm run discover:icecat            # report only: which ids actually occur
 *     npm run icecat:map -- --set 4=tech/smartphones
 *
 * i.e. let the real data tell you which ids matter, in descending order of how
 * many products carry them. This CLI stays useful as a lookup — "what id is
 * 'Coffee machine'?" — not as the starting point.
 *
 * Run:
 *   npm run icecat:categories -- --search Smartphone
 *   npm run icecat:categories                        (prints everything — long)
 *
 * UNVERIFIED: the reference file path below is from Icecat's published manuals
 * (https://iceclog.com/open-catalog-interface-oci-open-icecat-xml-and-full-icecat-xml-repositories/),
 * not confirmed against a live download. If the fetch fails, the fallback is
 * reading category names/ids straight from a product page in MyIcecat.
 */

import { gunzipSync } from 'node:zlib';

// Open Icecat vs Full Icecat both publish the same reference files; this path
// is documented as the general (not brand-specific) categories reference.
const CATEGORIES_URL = 'https://data.icecat.biz/export/freexml.int/refs/CategoriesList.xml.gz';

export interface CategoryRow {
  id: string;
  name: string;
}

/** Minimal, dependency-free extraction of <Category ID="..."><Name ...
 *  Value="..."/></Category>-shaped rows. No XML parser is in package.json
 *  yet, and this file only needs id+name pairs, not a full parse — if
 *  Icecat's real shape differs, this regex is the first thing to adjust. */
export function extractCategories(xml: string): CategoryRow[] {
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

export async function fetchCategoryRows(): Promise<CategoryRow[]> {
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
  const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  return extractCategories(xml);
}

/** id -> English name, for annotating a report. Never throws: a missing
 *  reference file should degrade a report to "ids without names", not kill it. */
export async function fetchIcecatCategoryNames(): Promise<Map<string, string>> {
  try {
    const rows = await fetchCategoryRows();
    return new Map(rows.map((r) => [r.id, r.name]));
  } catch (err) {
    console.warn(
      `  (couldn't fetch Icecat's category names: ${String(err).split('\n')[0]} — ` +
      `showing ids only)`
    );
    return new Map();
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const searchFlag = args.indexOf('--search');
  const search = searchFlag !== -1 ? args[searchFlag + 1]?.toLowerCase() : null;

  console.log(`\nFetching Icecat's category reference list...`);
  console.log(`  ${CATEGORIES_URL}\n`);

  const rows = await fetchCategoryRows();
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
    `\nStore a mapping with:\n` +
    `  npm run icecat:map -- --set <id>=<category>/<subcategory>\n` +
    `(Mappings live in the source_category_map table, not in code.)\n`
  );
}

const isMain =
  process.argv[1]?.endsWith('list-icecat-categories.ts') ||
  process.argv[1]?.endsWith('list-icecat-categories.js');

if (isMain) {
  main().catch((err) => {
    console.error('\nfailed:', String(err));
    process.exit(1);
  });
}
