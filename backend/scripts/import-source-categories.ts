/**
 * IMPORT A SOURCE'S OWN CATEGORY TREE.
 *
 * This is the script that ends the keyword treadmill.
 *
 * Keyword rules are per-PRODUCT: every new way a seller phrases something
 * needs another term, forever. Source category mappings are per-TAXONOMY, and
 * they converge — because the resolver walks UP the source's tree, mapping one
 * node covers every category beneath it, including ones eBay adds next year.
 * Map "Consumer Electronics > Portable Audio & Headphones" once and every leaf
 * under it resolves, at a slightly reduced confidence per hop.
 *
 * That is why this table is worth importing in full: ~19,000 eBay nodes, of
 * which you will ever hand-check a few dozen.
 *
 *   npx tsx scripts/import-source-categories.ts ebay
 *   npx tsx scripts/import-source-categories.ts ebay --marketplace EBAY_DE
 *   npx tsx scripts/import-source-categories.ts icecat
 *
 * Needs the same EBAY_CLIENT_ID / EBAY_CLIENT_SECRET the Browse adapter uses.
 * The Taxonomy API is documented as taking an application (client-credentials)
 * token on the basic api_scope — the same token src/lib/oauth.ts already
 * fetches. If eBay refuses it, the error will say so on the first call rather
 * than silently importing nothing.
 */
import { gunzipSync } from 'node:zlib';
import { sql, connectionLabel } from '../src/lib/db';
import { getAccessToken } from '../src/lib/oauth';
import { requireEnv, fetchJson } from '../src/lib/http';

const args = process.argv.slice(2).filter((a) => a !== '--');
const source = args[0];
const value = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : String(args[i + 1]);
};

const RATE = { minIntervalMs: 200 };

// ---------------------------------------------------------------------------
// eBay
// ---------------------------------------------------------------------------
interface EbayNode {
  category: { categoryId: string; categoryName: string };
  childCategoryTreeNodes?: EbayNode[];
  leafCategoryTreeNode?: boolean;
}

async function ebayToken(): Promise<string> {
  return getAccessToken({
    key: 'ebay',
    tokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
    clientId: requireEnv('EBAY_CLIENT_ID', 'developer.ebay.com → Application Keys → App ID'),
    clientSecret: requireEnv('EBAY_CLIENT_SECRET', 'developer.ebay.com → Application Keys → Cert ID'),
    scope: 'https://api.ebay.com/oauth/api_scope',
    rateLimit: RATE,
  });
}

async function importEbay(marketplace: string): Promise<void> {
  const token = await ebayToken();
  const headers = { authorization: `Bearer ${token}` };
  const base = 'https://api.ebay.com/commerce/taxonomy/v1';

  console.log(`\nasking eBay for the ${marketplace} category tree id...`);
  const { data: idRes } = await fetchJson<{ categoryTreeId: string }>(
    `${base}/get_default_category_tree_id?marketplace_id=${encodeURIComponent(marketplace)}`,
    { headers, rateKey: 'ebay', rateLimit: RATE }
  );
  const treeId = idRes.categoryTreeId;
  console.log(`  tree id ${treeId} — downloading (this is the whole tree, it is large)`);

  const { data: tree } = await fetchJson<{ rootCategoryNode: EbayNode }>(
    `${base}/category_tree/${encodeURIComponent(treeId)}`,
    { headers, rateKey: 'ebay', rateLimit: RATE }
  );

  // Flatten depth-first, remembering each node's parent so resolve_source_category
  // can walk upwards later. The parent link is the whole point.
  const rows: { key: string; parent: string | null; label: string }[] = [];
  const walk = (node: EbayNode, parent: string | null) => {
    const key = String(node.category.categoryId);
    rows.push({ key, parent, label: node.category.categoryName });
    for (const child of node.childCategoryTreeNodes ?? []) walk(child, key);
  };
  walk(tree.rootCategoryNode, null);

  console.log(`  ${rows.length} categories parsed. Writing...`);
  await upsertSourceCategories('ebay', rows);
}

// ---------------------------------------------------------------------------
// Icecat
// ---------------------------------------------------------------------------
const ICECAT_CATEGORIES = 'https://data.icecat.biz/export/freexml.int/refs/CategoriesList.xml.gz';

async function importIcecat(): Promise<void> {
  console.log(`\ndownloading Icecat's category reference...\n  ${ICECAT_CATEGORIES}`);
  const res = await fetch(ICECAT_CATEGORIES, {
    headers: { 'user-agent': process.env.HTTP_USER_AGENT ?? 'Scoopt/0.1' },
  });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} fetching Icecat's category list. The free-tier path may ` +
      `differ — see README-ICECAT.md. Nothing was written.`
    );
  }
  const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');

  const rows: { key: string; parent: string | null; label: string }[] = [];
  for (const block of xml.match(/<Category\b[^>]*>[\s\S]*?<\/Category>/g) ?? []) {
    const id = block.match(/\bID="(\d+)"/)?.[1];
    const parent = block.match(/<ParentCategory[^>]*\bID="(\d+)"/)?.[1] ?? null;
    const name =
      block.match(/<Name[^>]*langid="1"[^>]*Value="([^"]*)"/)?.[1] ??
      block.match(/<Name[^>]*Value="([^"]*)"/)?.[1];
    if (id && name) rows.push({ key: id, parent, label: decodeXml(name) });
  }

  console.log(`  ${rows.length} categories parsed. Writing...`);
  if (rows.length === 0) {
    console.log(
      `  Nothing parsed — Icecat's real shape differs from the regex above.\n` +
      `  That regex is the ONLY thing that needs adjusting; nothing else does.`
    );
    return;
  }
  await upsertSourceCategories('icecat', rows);
}

const decodeXml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// ---------------------------------------------------------------------------
async function upsertSourceCategories(
  sourceKey: string,
  rows: { key: string; parent: string | null; label: string }[]
): Promise<void> {
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await sql`
      insert into source_category ${sql(
        slice.map((r) => ({
          source_key: sourceKey,
          external_key: r.key,
          parent_key: r.parent,
          label: r.label,
        })),
        'source_key', 'external_key', 'parent_key', 'label'
      )}
      on conflict (source_key, external_key) do update
        set parent_key = excluded.parent_key, label = excluded.label`;
    written += slice.length;
    process.stdout.write(`\r  ${written}/${rows.length}`);
  }
  console.log(`\n\nDone. ${written} categories stored for "${sourceKey}".`);
  console.log(`Next: npx tsx scripts/propose-source-mappings.ts ${sourceKey}\n`);
}

async function main() {
  console.log(`\nconnected to ${connectionLabel()}`);
  if (!source || !['ebay', 'icecat'].includes(source)) {
    console.error(
      `\nUsage: npx tsx scripts/import-source-categories.ts <ebay|icecat> [--marketplace EBAY_NL]\n`
    );
    process.exit(1);
  }
  const [row] = await sql<{ source_key: string }[]>`
    select source_key from source where source_key = ${source}`;
  if (!row) throw new Error(`Source "${source}" is not in the source table — run the migrations first.`);

  if (source === 'ebay') await importEbay(value('--marketplace', 'EBAY_NL'));
  else await importIcecat();
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('\nimport failed:', String(err).split('\n')[0]);
    await sql.end();
    process.exit(1);
  });
