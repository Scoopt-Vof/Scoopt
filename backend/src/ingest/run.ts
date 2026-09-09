import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from '../lib/db';
import { isValidEan13, normaliseEan } from '../lib/ean';
import { isSanePrice } from '../lib/money';
import type { RetailerSource, RawOffer } from '../sources/types';
import { resolveSources, printSources } from '../sources/registry';

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
}

export async function ingest(source: RetailerSource): Promise<IngestSummary> {
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
      const [product] = await sql<{ id: number }[]>`
        insert into product (ean, brand, title, category, image_url, description, status,
                             contract_id, unit, subcategory, specs,
                             created_by_source, category_source)
        values (${ean}, ${raw.brand}, ${raw.title}, ${raw.category},
                ${raw.imageUrl ?? null}, ${raw.description ?? null}, 'published',
                ${raw.contractId ?? null}, ${raw.unit ?? null}, ${raw.subcategory ?? null},
                ${sql.json(raw.specs ?? {})},
                -- Provenance: which pass created the row, and where its
                -- category came from. 'feed' is honest — it's whatever this
                -- retailer claimed, not a manufacturer taxonomy.
                ${source.slug}, 'feed')
        on conflict (ean) do update
          set image_url   = coalesce(product.image_url, excluded.image_url),
              description = coalesce(product.description, excluded.description),
              contract_id = coalesce(product.contract_id, excluded.contract_id),
              unit        = coalesce(product.unit, excluded.unit),
              subcategory = coalesce(product.subcategory, excluded.subcategory),
              -- Merge rather than replace: a second retailer may know a spec the
              -- first one didn't, and losing it would silently degrade ranking.
              specs       = product.specs || excluded.specs,
              -- PROMOTION. discover-icecat.ts creates catalogue rows as 'draft'
              -- precisely because they have no offer, and the API serves only
              -- 'published'. This is the moment that changes: a real retailer
              -- offer is about to attach, so the product becomes buyable and
              -- publishable in the same breath. 'suppressed' is a human
              -- decision and is left alone.
              status      = case when product.status = 'draft' then 'published'
                                 else product.status end,
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

  return { runId: run.id, productsSeen, offersUpserted, observationsWritten, queuedForReview };
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

    let failed = 0;
    for (const source of sources) {
      const started = Date.now();
      try {
        const s = await ingest(source);
        console.log(
          `✓ ${source.slug}: ${s.productsSeen} seen, ${s.offersUpserted} offers, ` +
          `${s.observationsWritten} observations, ${s.queuedForReview} queued ` +
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

    await sql.end();
    if (failed === sources.length && sources.length > 0) process.exit(1);
  })().catch(async (e) => {
    console.error('\ningest failed:', String(e));
    await sql.end();
    process.exit(1);
  });
}
