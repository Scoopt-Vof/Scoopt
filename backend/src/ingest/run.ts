import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from '../lib/db';
import { isValidEan13, normaliseEan } from '../lib/ean';
import { isSanePrice } from '../lib/money';
import type { RetailerSource, RawOffer } from '../sources/types';
import { resolveSources, printSources } from '../sources/registry';
import {
  createClassifier, persistClassification, type Classifier,
} from '../categorisation/index';

/**
 * THE INGESTION JOB — four stages, in this order, always:
 *
 *   1. acquire    — ask the source for its payload
 *   2. archive    — write the raw payload to disk BEFORE parsing it
 *   3. normalise  — validate, convert, reject junk into the review queue
 *   4. match+store— upsert product + offer, APPEND price_observation
 *
 * Stage 2 is the one people skip and regret. If normalisation has a bug you
 * discover in three weeks, an archived payload lets you replay history. Without
 * it, the data is simply gone — and price history is the product.
 *
 * Run:  npm run ingest
 */

export interface IngestSummary {
  runId: number;
  productsSeen: number;
  offersUpserted: number;
  observationsWritten: number;
  queuedForReview: number;
  /** Placed on the tree with enough confidence to publish. */
  classified: number;
}

export interface IngestOptions {
  /**
   * Built once per process by the CLI below and passed in, because loading the
   * taxonomy per product would issue thousands of lookups for a table of
   * twenty-seven rows. Omit it to skip classification entirely (the tests that
   * only care about price data do exactly that).
   */
  classifier?: Classifier | null;
  /**
   * Which row in `source` this feed's category keys belong to. Distinct from
   * source.slug: three eBay marketplaces are three retailers but ONE taxonomy.
   */
  sourceKey?: string | null;
}

export async function ingest(
  source: RetailerSource,
  options: IngestOptions = {}
): Promise<IngestSummary> {
  const classifier = options.classifier ?? null;
  const sourceKey = options.sourceKey ?? defaultSourceKey(source.slug);
  // ---- refuse invented prices, on the WRITE path ---------------------------
  // The registry guards which sources you can NAME. This guards what actually
  // reaches the database, so a source constructed directly — as the old
  // DecathlonSource was, in tests — cannot route around it. Invented prices
  // attributed to a real retailer are a legal liability, not a dev convenience.
  if (source.sourceKind === 'fixture' && process.env.ALLOW_SYNTHETIC_SOURCES !== '1') {
    throw new Error(
      `Source "${source.slug}" is a fixture with INVENTED prices. Refusing to ` +
      `write it to the database.\n` +
      `Set ALLOW_SYNTHETIC_SOURCES=1 only for a throwaway or test database. ` +
      `Never for the database that serves scoopt.nl.`
    );
  }

  // ---- retailer row (idempotent) -----------------------------------------
  // Delivery rules are optional on the interface — only sources that know them
  // (the Dutch seed retailers) supply them; a raw price API has no idea.
  const deliveryFee = (source as { deliveryFeeCents?: number }).deliveryFeeCents ?? 0;
  const freeAbove = (source as { freeAboveCents?: number }).freeAboveCents ?? 0;

  const [retailer] = await sql<{ id: number }[]>`
    insert into retailer (slug, name, homepage_url, source_kind, affiliate_network,
                          delivery_fee_cents, free_above_cents)
    values (${source.slug}, ${source.name}, ${source.homepageUrl},
            ${source.sourceKind}, ${source.affiliateNetwork ?? null},
            ${deliveryFee}, ${freeAbove})
    on conflict (slug) do update
      set name = excluded.name,
          source_kind = excluded.source_kind,
          affiliate_network = excluded.affiliate_network,
          delivery_fee_cents = excluded.delivery_fee_cents,
          free_above_cents = excluded.free_above_cents
    returning id
  `;

  const [run] = await sql<{ id: number }[]>`
    insert into ingest_run (retailer_id, source_kind)
    values (${retailer.id}, ${source.sourceKind})
    returning id
  `;

  let productsSeen = 0;
  let offersUpserted = 0;
  let observationsWritten = 0;
  let queuedForReview = 0;
  let classified = 0;

  try {
    // ---- 1. acquire ------------------------------------------------------
    const { offers, rawPayload } = await source.fetch();
    productsSeen = offers.length;

    // ---- 2. archive raw BEFORE parsing ----------------------------------
    const archiveDir = join(process.cwd(), 'raw', source.slug);
    await mkdir(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, `${run.id}-${Date.now()}.json`);
    await writeFile(archivePath, rawPayload, 'utf8');
    await sql`update ingest_run set raw_archive_path = ${archivePath} where id = ${run.id}`;

    // ---- 3 + 4. normalise, match, store ---------------------------------
    for (const raw of offers) {
      const rejection = validate(raw);
      if (rejection) {
        await queueForReview(retailer.id, raw, rejection);
        queuedForReview++;
        continue;
      }

      const ean = normaliseEan(raw.ean)!;

      // Tier 1 matching: EAN. Tiers 2 (brand+MPN) and 3 (fuzzy title, gated at
      // confidence 88 with a 75–88 review band) attach here when a second
      // retailer arrives. With one retailer, EAN is sufficient and exact.
      // FIRST WRITER WINS on title/brand/category, deliberately.
      // With several retailers describing the same EAN, last-writer-wins makes
      // the product name flap on every run — "Nike Pegasus 41" one hour and
      // "NIKE AIR ZOOM PEGASUS 41 MENS RUNNING SHOE NEW!!" the next. Only
      // backfill the fields that are genuinely missing; improving a bad title
      // is a job for the review queue, not for whichever feed ran last.
      // NOTE ON category / subcategory: this insert seeds them from the feed's
      // discovery tag ONLY so the NOT NULL column has a value. The classifier
      // owns both columns from here on (see src/categorisation/persist.ts) and
      // rewrites them from the primary category path. They are deliberately
      // NOT in the do-update list: a second retailer describing the same EAN
      // must not get a vote on where the product lives.
      //
      // Status is 'draft', not 'published'. A product is only promoted once
      // the classifier has placed it with enough confidence — an unplaceable
      // product should be invisible to shoppers and visible to us.
      const [product] = await sql<{ id: number }[]>`
        insert into product (ean, brand, title, category, image_url, description, status,
                             contract_id, unit, subcategory, specs)
        values (${ean}, ${raw.brand}, ${raw.title}, ${raw.category},
                ${raw.imageUrl ?? null}, ${raw.description ?? null}, 'draft',
                ${raw.contractId ?? null}, ${raw.unit ?? null}, ${raw.subcategory ?? null},
                ${sql.json(raw.specs ?? {})})
        on conflict (ean) do update
          set image_url   = coalesce(product.image_url, excluded.image_url),
              description = coalesce(product.description, excluded.description),
              contract_id = coalesce(product.contract_id, excluded.contract_id),
              unit        = coalesce(product.unit, excluded.unit),
              -- Merge rather than replace: a second retailer may know a spec the
              -- first one didn't, and losing it would silently degrade ranking.
              specs       = product.specs || excluded.specs,
              updated_at  = now()
        returning id
      `;

      // The offer is mutable current state...
      await sql`
        insert into offer (product_id, retailer_id, retailer_sku, price_cents,
                           currency, shipping_cents, in_stock, product_url)
        values (${product.id}, ${retailer.id}, ${raw.retailerSku}, ${raw.priceCents},
                ${raw.currency ?? 'EUR'}, ${raw.shippingCents ?? 0},
                ${raw.inStock}, ${raw.productUrl})
        on conflict (product_id, retailer_id) do update
          set price_cents    = excluded.price_cents,
              shipping_cents = excluded.shipping_cents,
              in_stock       = excluded.in_stock,
              product_url    = excluded.product_url,
              retailer_sku   = excluded.retailer_sku,
              last_seen_at   = now()
      `;
      offersUpserted++;

      // ...price_observation is the permanent record. Every run, every product,
      // unconditionally. Never conditional on "did the price change" — a flat
      // line is information, and gaps make a chart lie.
      await sql`
        insert into price_observation (product_id, retailer_id, price_cents, in_stock, ingest_run_id)
        values (${product.id}, ${retailer.id}, ${raw.priceCents}, ${raw.inStock}, ${run.id})
      `;
      observationsWritten++;

      // ---- 5. classify --------------------------------------------------
      // Runs AFTER validate() and BEFORE publication. Never blocks and never
      // calls a model: stage 1 is a table lookup, stage 2 is string matching,
      // and anything neither can place stays draft with a queue entry. Model
      // calls, if ever enabled, run in the backfill against unmapped KEYS
      // rather than against individual products.
      if (classifier) {
        try {
          // Store the source's OWN category before classifying. This is what
          // makes a mapping change a local re-run instead of a re-fetch: the
          // raw signal stays on the product forever.
          if (sourceKey && raw.sourceCategoryKey) {
            await sql`
              insert into product_source_category
                (product_id, source_key, external_key, external_label, position)
              values (${product.id}, ${sourceKey}, ${raw.sourceCategoryKey},
                      ${raw.sourceCategoryLabel ?? null}, 0)
              on conflict (product_id, source_key, external_key) do update
                set external_label = excluded.external_label, last_seen = now()`;
          }

          const result = await classifier.classify({
            productId: String(product.id),
            title: raw.title,
            brand: raw.brand,
            description: raw.description ?? null,
            sourceCategories: sourceKey && raw.sourceCategoryKey
              ? [{ sourceKey, externalKey: raw.sourceCategoryKey, label: raw.sourceCategoryLabel }]
              : [],
            specs: raw.specs,
            condition: raw.condition ?? null,
          });
          await persistClassification(sql, classifier.taxonomy, result, { ingestRunId: run.id });
          if (result.categoryId && !result.needsReview) classified++;
          else queuedForReview++;
        } catch (err) {
          // A classifier fault must not cost the price data. The product stays
          // draft, which is the safe state, and the error is visible.
          console.warn(`  [classify] product ${product.id} failed: ${String(err).split('\n')[0]}`);
        }
      }
    }

    await sql`
      update ingest_run
         set status = 'ok', finished_at = now(),
             products_seen = ${productsSeen},
             offers_upserted = ${offersUpserted},
             observations_written = ${observationsWritten}
       where id = ${run.id}
    `;
  } catch (err) {
    await sql`
      update ingest_run
         set status = 'failed', finished_at = now(), error = ${String(err)}
       where id = ${run.id}
    `;
    throw err;
  }

  return {
    runId: run.id, productsSeen, offersUpserted, observationsWritten,
    queuedForReview, classified,
  };
}

/**
 * A retailer slug is per-marketplace ('ebay-nl', 'ebay-de'); a source key is
 * per-taxonomy ('ebay'). Three eBay marketplaces share one category tree, so
 * mapping a key once covers all of them.
 */
function defaultSourceKey(retailerSlug: string): string | null {
  if (retailerSlug.startsWith('ebay')) return 'ebay';
  return null;
}

/** Returns a rejection reason, or null if the row is good. */
function validate(raw: RawOffer): string | null {
  if (!isValidEan13(raw.ean)) return 'ean_invalid';
  if (!isSanePrice(raw.priceCents)) return 'price_out_of_range';
  // Offers are ranked on raw cents with no conversion anywhere, so a non-euro
  // offer would be compared against euro ones as if the numbers meant the same
  // thing. Refuse it rather than publish a confidently wrong "cheapest".
  if ((raw.currency ?? 'EUR').toUpperCase() !== 'EUR') return 'currency_not_eur';
  if (!raw.title?.trim()) return 'missing_title';
  if (!raw.productUrl?.startsWith('http')) return 'bad_url';
  return null;
}

async function queueForReview(retailerId: number, raw: RawOffer, reason: string) {
  await sql`
    insert into match_review_queue
      (retailer_id, retailer_sku, raw_title, raw_brand, raw_ean, price_cents, confidence, reason)
    values (${retailerId}, ${raw.retailerSku}, ${raw.title ?? ''}, ${raw.brand ?? null},
            ${raw.ean ?? null}, ${raw.priceCents ?? null}, 0, ${reason})
  `;
}

// ---- CLI entry point -------------------------------------------------------
//   npm run ingest -- ebay-nl          → one live source
//   npm run ingest -- ebay-nl ebay-de  → two, and comparison rows appear
//   npm run ingest -- all              → every source you have credentials for
//   npm run ingest -- --list           → what's available and what it needs
const isMain = process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js');
if (isMain) {
  const args = process.argv.slice(2).filter((a) => a !== '--');

  (async () => {
    if (args.includes('--list') || args.includes('-l')) {
      printSources();
      await sql.end();
      return;
    }

    const sources = resolveSources(args);
    console.log(`\ningesting from: ${sources.map((s) => s.slug).join(', ')}\n`);

    // Once per process, never per product: the taxonomy is twenty-seven rows
    // that change about once a month.
    const classifier = await createClassifier(sql);
    console.log(`classifier ready: ${classifier.taxonomy.size} categories\n`);

    let failed = 0;
    for (const source of sources) {
      const started = Date.now();
      try {
        const s = await ingest(source, { classifier });
        console.log(
          `✓ ${source.slug}: ${s.productsSeen} seen, ${s.offersUpserted} offers, ` +
          `${s.observationsWritten} observations, ${s.classified} classified, ` +
          `${s.queuedForReview} queued ` +
          `(${((Date.now() - started) / 1000).toFixed(1)}s)\n`
        );
      } catch (e) {
        // One bad source must not abort the rest — a rate limit at eBay should
        // not cost you the Kroger run.
        failed++;
        console.error(`✗ ${source.slug} failed: ${String(e).split('\n')[0]}\n`);
      }
    }

    // With more than one source in play, the interesting number is how many
    // products now carry offers from two or more retailers. That count IS the
    // proof of concept — one retailer is a catalogue, two is a comparison.
    const [cmp] = await sql<{ c: string }[]>`
      select count(*) as c from (
        select product_id from offer group by product_id having count(distinct retailer_id) > 1
      ) t`;
    console.log(`products with 2+ retailer offers (real comparisons): ${cmp.c}`);

    // The work list. Mapping the busiest key next is the single highest-value
    // thing anyone can do for classification accuracy, so print it every run.
    const unmapped = await sql<{ source_key: string; external_key: string; external_label: string | null; hits: number }[]>`
      select source_key, external_key, external_label, hits
        from source_category_unmapped order by hits desc limit 10`;
    if (unmapped.length > 0) {
      console.log(`\ntop unmapped source categories (map these next):`);
      for (const u of unmapped) {
        console.log(`  ${u.source_key.padEnd(8)} ${u.external_key.padEnd(12)} ${String(u.hits).padStart(4)} hits  ${u.external_label ?? ''}`);
      }
    }

    const [draft] = await sql<{ c: string }[]>`
      select count(*) as c from product where status = 'draft'`;
    console.log(`\nproducts awaiting classification review (draft): ${draft.c}`);

    await sql.end();
    if (failed === sources.length && sources.length > 0) process.exit(1);
  })().catch(async (e) => {
    console.error('\ningest failed:', String(e));
    await sql.end();
    process.exit(1);
  });
}
