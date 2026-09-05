import { sql } from '../lib/db';
import { fetchIcecatProduct } from '../sources/icecat';

/**
 * ICECAT ENRICHMENT — a separate pass from the retailer ingest in run.ts.
  *
   * Icecat has no price or stock, so it doesn't fit the RetailerSource /
    * resolveSources() shape run.ts uses. This pass instead walks products that
     * a retailer feed already created (matched by EAN) and fills in the
      * manufacturer's own image, description and specs.
       *
        * Priority is the opposite of run.ts's retailer-vs-retailer rule: run.ts
         * deliberately keeps the FIRST writer's image/description (coalesce), so
          * that two retailers describing the same EAN don't flap the record every
           * run. Icecat is different — a manufacturer data sheet is categorically
            * better than an incidental listing photo, so this pass OVERWRITES
             * image_url/description with whatever Icecat returns, and only falls back
              * to the existing value when Icecat has none.
               *
                * Requires ICECAT_USERNAME, ICECAT_API_TOKEN and ICECAT_CONTENT_TOKEN — see
                 * ../sources/icecat.ts and README-ICECAT.md for how to get them. Fails
                  * cleanly with a clear error if they're not set, same as the retailer
                   * sources in resolveSources() do.
                    *
                     * Run:  npm run enrich:icecat
                      *       npm run enrich:icecat -- --limit 50
                       */

                       const DEFAULT_BATCH_SIZE = Number(process.env.ICECAT_BATCH_SIZE ?? 200);

                       async function main() {
                         const args = process.argv.slice(2).filter((a) => a !== '--');
                           const limitFlag = args.indexOf('--limit');
                             const limit = limitFlag !== -1 ? Number(args[limitFlag + 1]) : DEFAULT_BATCH_SIZE;

                               // Products with no image yet go first; after that, the longest since we
                                 // last checked. That way a partial or interrupted run still makes
                                   // forward progress through the catalogue instead of re-checking the
                                     // same head of the list every time.
                                       const products = await sql<{ id: number; ean: string }[]>`
                                           select id, ean
                                               from product
                                                   where ean is not null
                                                       order by (image_url is null) desc, icecat_checked_at asc nulls first
                                                           limit ${limit}
                                                             `;

                                                               console.log(`\nEnriching ${products.length} product(s) from Icecat...\n`);

                                                                 let enriched = 0;
                                                                   let skipped = 0;
                                                                     let failed = 0;

                                                                       for (const product of products) {
                                                                           try {
                                                                                 const info = await fetchIcecatProduct(product.ean);

                                                                                       if (!info) {
                                                                                               skipped++;
                                                                                                       await sql`update product set icecat_checked_at = now() where id = ${product.id}`;
                                                                                                               continue;
                                                                                                                     }
                                                                                                                     
                                                                                                                           await sql`
                                                                                                                                   update product
                                                                                                                                           set image_url = coalesce(${info.imageUrl}, image_url),
                                                                                                                                                       description = coalesce(${info.description}, description),
                                                                                                                                                                   specs = specs || ${sql.json(info.specs)},
                                                                                                                                                                               icecat_checked_at = now(),
                                                                                                                                                                                           updated_at = now()
                                                                                                                                                                                                   where id = ${product.id}
                                                                                                                                                                                                         `;
                                                                                                                                                                                                               enriched++;
                                                                                                                                                                                                                   } catch (err) {
                                                                                                                                                                                                                         // One bad lookup must not abort the rest, same principle as run.ts's
                                                                                                                                                                                                                               // per-source try/catch.
                                                                                                                                                                                                                                     failed++;
                                                                                                                                                                                                                                           console.error(`x product ${product.id} (EAN ${product.ean}) failed: ${String(err).split('\n')[0]}`);
                                                                                                                                                                                                                                               }
                                                                                                                                                                                                                                                 }
                                                                                                                                                                                                                                                 
                                                                                                                                                                                                                                                   console.log(`\nDone: ${enriched} enriched, ${skipped} skipped (no Icecat data), ${failed} failed.\n`);
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
