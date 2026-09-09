import { sql } from '../lib/db';
import { fetchIcecatProduct } from '../sources/icecat';
import { loadCategoryMap } from './source-category-map';

/**
 * ICECAT ENRICHMENT — the pass that matters day to day.
 * =============================================================================
 * This is Icecat's actual job on scoopt: for products that already exist —
 * created by eBay today, by Awin/Bol feeds later — look each one up by the EAN
 * we already hold and take three things from the manufacturer's data sheet:
 *
 *   1. THE IMAGE. The primary reason Icecat is here. Feed images are seller
 *      photos: inconsistent framing, watermarks, occasionally a used item.
 *      One manufacturer image source makes the grid coherent.
 *   2. Description and specs.
 *   3. Icecat's own CATEGORY — stage 1 of categorisation. It comes from the
 *      manufacturer's data sheet rather than a seller's dropdown choice, which
 *      is exactly why eBay's category ids were rejected as a mapping source
 *      and this one wasn't.
 *
 * No product index, no category filtering, no new rows: it walks OUR catalogue
 * and asks Icecat about each EAN. (Creating rows from Icecat's own catalogue is
 * the separate, parked discover-icecat.ts.)
 *
 * IMAGE PRIORITY — deliberately the opposite of run.ts's rule. run.ts keeps the
 * FIRST retailer's image so two feeds describing one EAN don't flap the record
 * every run. Here Icecat is allowed to win, because a manufacturer data sheet
 * beats an incidental listing photo. But the feed's own image is never thrown
 * away: it stays in image_url whenever Icecat has nothing, so a product always
 * has something to show and a later Icecat miss can't blank a page.
 *
 * CATEGORY PRIORITY — Icecat sets category/subcategory only where the product
 * doesn't have one yet, and records category_source = 'source-map' when it
 * does. It never overwrites a category a human set ('manual'). Coverage is the
 * reason to expect gaps rather than treat them as failure: Open Icecat is
 * sponsored by electronics, computing and appliance brands, so smartphones and
 * televisions resolve well while running shoes and home textiles mostly won't,
 * and those fall through to the later keyword/model stages.
 *
 * The raw Icecat category id is stored on the row (icecat_category_id). That's
 * what makes refining the map a re-run over our own database instead of a
 * re-fetch of the whole catalogue from Icecat.
 *
 * Requires ICECAT_USERNAME, ICECAT_API_TOKEN and ICECAT_CONTENT_TOKEN — see
 * ../sources/icecat.ts and README-ICECAT.md.
 *
 * Run:  npm run enrich:icecat
 *       npm run enrich:icecat -- --limit 50
 */

const DEFAULT_BATCH_SIZE = Number(process.env.ICECAT_BATCH_SIZE ?? 200);
const SOURCE = 'icecat';

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const limitFlag = args.indexOf('--limit');
  const limit = limitFlag !== -1 ? Number(args[limitFlag + 1]) : DEFAULT_BATCH_SIZE;

  const categoryMap = await loadCategoryMap(SOURCE);

  // Products with no image yet go first; after that, the longest since we last
  // checked. A partial or interrupted run still makes forward progress through
  // the catalogue instead of re-checking the same head of the list every time.
  const products = await sql<
    { id: number; ean: string; subcategory: string | null; category_source: string | null }[]
  >`
    select id, ean, subcategory, category_source
      from product
     where ean is not null
     order by (image_url is null) desc, icecat_checked_at asc nulls first
     limit ${limit}
  `;

  console.log(`\nEnriching ${products.length} product(s) from Icecat...`);
  if (categoryMap.size === 0) {
    console.log(
      `  (source_category_map has no "${SOURCE}" rows yet, so categories won't be\n` +
      `   derived — images and specs still are. Store mappings with\n` +
      `   npm run icecat:map -- --set <id>=<category>/<subcategory>)`
    );
  }
  console.log('');

  let enriched = 0;
  let categorised = 0;
  let skipped = 0;
  let failed = 0;

  for (const product of products) {
    try {
      const info = await fetchIcecatProduct(product.ean);

      if (!info) {
        // Stamp the check anyway: an unstamped miss would be re-requested on
        // every future run and starve the rest of the catalogue.
        skipped++;
        await sql`update product set icecat_checked_at = now() where id = ${product.id}`;
        continue;
      }

      // Stage 1 categorisation: only where the product has no subcategory yet,
      // and never over a human decision.
      const mapping = info.categoryId ? categoryMap.get(info.categoryId) : undefined;
      const shouldCategorise =
        Boolean(mapping) && !product.subcategory && product.category_source !== 'manual';

      await sql`
        update product
           set image_url            = coalesce(${info.imageUrl}, image_url),
               description          = coalesce(${info.description}, description),
               specs                = specs || ${sql.json(info.specs)},
               icecat_category_id   = coalesce(${info.categoryId}, icecat_category_id),
               icecat_category_name = coalesce(${info.categoryName}, icecat_category_name),
               category             = ${shouldCategorise ? mapping!.category : sql`category`},
               subcategory          = ${shouldCategorise ? mapping!.subcategory : sql`subcategory`},
               category_source      = ${shouldCategorise ? 'source-map' : sql`category_source`},
               icecat_checked_at    = now(),
               updated_at           = now()
         where id = ${product.id}
      `;

      enriched++;
      if (shouldCategorise) categorised++;
    } catch (err) {
      // One bad lookup must not abort the rest, same principle as run.ts's
      // per-source try/catch.
      failed++;
      console.error(
        `x product ${product.id} (EAN ${product.ean}) failed: ${String(err).split('\n')[0]}`
      );
    }
  }

  console.log(
    `\nDone: ${enriched} enriched, ${categorised} of those also categorised from ` +
    `Icecat's category, ${skipped} skipped (no Icecat data), ${failed} failed.\n` +
    `See how much of the catalogue Icecat now covers:  npm run icecat:verify\n`
  );
}

const isMain =
  process.argv[1]?.endsWith('enrich-icecat.ts') || process.argv[1]?.endsWith('enrich-icecat.js');

if (isMain) {
  main()
    .then(() => sql.end())
    .catch(async (err) => {
      console.error(err);
      await sql.end();
      process.exit(1);
    });
}
