/**
 * FETCH THE SOURCE CATEGORY FOR PRODUCTS THAT NEVER RECORDED ONE.
 *
 * Products ingested before src/sources/ebay.ts started carrying categoryId
 * have no source signal at all, so they can only ever reach the keyword rules.
 * This is the one-off pass that fixes that WITHOUT re-ingesting everything.
 *
 * It works because offer.retailer_sku already holds eBay's own itemId — the
 * ingest stored it so offers could be re-matched. One getItem call per offer
 * gives us the category id, which goes into product_source_category and stays
 * there. From then on, re-classification is a local re-run.
 *
 *   npx tsx scripts/backfill-source-categories.ts --dry-run --limit 5
 *   npx tsx scripts/backfill-source-categories.ts --limit 200
 *
 * COSTS API CALLS: one per offer, against eBay's default 5,000/day quota.
 * --limit is there so you can do this in batches and stop.
 */
import { sql, connectionLabel } from '../src/lib/db';
import { getAccessToken } from '../src/lib/oauth';
import { requireEnv, fetchJson } from '../src/lib/http';

const args = process.argv.slice(2).filter((a) => a !== '--');
const dryRun = args.includes('--dry-run');
const limit = (() => {
  const i = args.indexOf('--limit');
  return i === -1 ? 200 : Number(args[i + 1]);
})();

const RATE = { minIntervalMs: 200 };
const BROWSE = 'https://api.ebay.com/buy/browse/v1';

const MARKETPLACE_FOR: Record<string, string> = {
  'ebay-nl': 'EBAY_NL', 'ebay-de': 'EBAY_DE', 'ebay-gb': 'EBAY_GB',
  'ebay-fr': 'EBAY_FR', 'ebay-it': 'EBAY_IT', 'ebay-es': 'EBAY_ES',
  'ebay-us': 'EBAY_US',
};

async function main() {
  console.log(`\nconnected to ${connectionLabel()}`);
  const token = await getAccessToken({
    key: 'ebay',
    tokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
    clientId: requireEnv('EBAY_CLIENT_ID', 'developer.ebay.com → Application Keys → App ID'),
    clientSecret: requireEnv('EBAY_CLIENT_SECRET', 'developer.ebay.com → Application Keys → Cert ID'),
    scope: 'https://api.ebay.com/oauth/api_scope',
    rateLimit: RATE,
  });

  // One offer per product is enough — the category is a property of the
  // product, and a second marketplace would only repeat it.
  const rows = await sql<{ product_id: string; retailer_sku: string; slug: string; title: string }[]>`
    select distinct on (o.product_id)
           o.product_id, o.retailer_sku, r.slug, p.title
      from offer o
      join retailer r on r.id = o.retailer_id
      join product  p on p.id = o.product_id
      left join product_source_category psc
        on psc.product_id = o.product_id and psc.source_key = 'ebay'
     where r.slug like 'ebay%' and psc.product_id is null
     order by o.product_id, o.last_seen_at desc
     limit ${limit}`;

  console.log(
    `\n${rows.length} product(s) with an eBay offer but no stored eBay category` +
    `${dryRun ? ' — DRY RUN, nothing will be written' : ''}\n`
  );
  if (rows.length === 0) {
    console.log('Nothing to do. Every eBay product already carries its category.\n');
    return;
  }

  let stored = 0, missing = 0, failed = 0;

  for (const row of rows) {
    const marketplace = MARKETPLACE_FOR[row.slug] ?? 'EBAY_NL';
    const headers = {
      authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
    };

    const detail = await fetchJson<{ categoryId?: string; categoryPath?: string }>(
      `${BROWSE}/item/${encodeURIComponent(row.retailer_sku)}`,
      { headers, rateKey: 'ebay', rateLimit: RATE }
    ).catch((e) => {
      // An item that has since ended returns 404. That is normal and not worth
      // failing the run over — the product keeps its keyword classification.
      console.warn(`  x ${row.retailer_sku}: ${String(e).split('\n')[0].slice(0, 80)}`);
      failed++;
      return null;
    });
    if (!detail) continue;

    const categoryId = detail.data.categoryId;
    if (!categoryId) {
      missing++;
      continue;
    }

    console.log(
      `  ${String(categoryId).padEnd(10)} ${(detail.data.categoryPath ?? '').slice(0, 40).padEnd(42)} ` +
      `${row.title.slice(0, 40)}`
    );

    if (!dryRun) {
      await sql`
        insert into product_source_category
          (product_id, source_key, external_key, external_label, position)
        values (${row.product_id}, 'ebay', ${String(categoryId)},
                ${detail.data.categoryPath ?? null}, 0)
        on conflict (product_id, source_key, external_key) do update
          set external_label = excluded.external_label, last_seen = now()`;

      // Record it as work to do if nothing maps it yet. This is what fills the
      // list that propose-source-mappings.ts then drafts answers for.
      await sql`select note_unmapped_source_category(
        'ebay', ${String(categoryId)}, ${detail.data.categoryPath ?? null},
        ${row.product_id}::bigint)
        where not exists (
          select 1 from source_category_map
           where source_key = 'ebay' and external_key = ${String(categoryId)})`;
    }
    stored++;
  }

  console.log(
    `\n${stored} stored, ${missing} had no category on the item, ${failed} failed.\n`
  );
  if (!dryRun && stored > 0) {
    console.log(
      `Next:\n` +
      `  npx tsx scripts/import-source-categories.ts ebay      (their tree, once)\n` +
      `  npx tsx scripts/propose-source-mappings.ts ebay       (drafts the mappings)\n` +
      `  npx tsx scripts/backfill-categories.ts --force --keep-published\n`
    );
  }
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('\nbackfill failed:', String(err).split('\n')[0]);
    await sql.end();
    process.exit(1);
  });
