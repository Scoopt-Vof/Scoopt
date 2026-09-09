import type { Sql } from '../lib/db';
import type { Taxonomy } from './taxonomy';
import type { ClassificationResult } from './types';

/**
 * Writing a decision back.
 *
 * Three rules govern this file, and all three exist because of how the old
 * behaviour failed:
 *
 *   1. MACHINE NEVER CLOBBERS HUMAN. If any category row for this product was
 *      set by a person, the classifier adds tags and leaves the categories
 *      alone. The previous scheme was first-machine-writer-wins forever, which
 *      is why migration 006 had to guess categories back from brand names.
 *
 *   2. EVERY ROW IS ATTRIBUTABLE. Each assignment records its stage, its
 *      confidence and the ingest run that produced it, so a bad rule can be
 *      reverted by exactly the rows it created.
 *
 *   3. UNPLACEABLE MEANS DRAFT. A product the classifier could not place with
 *      enough confidence is not published. It goes to the one review queue and
 *      waits for a person.
 */

export interface PersistOptions {
  ingestRunId?: number | null;
  /** Set true only for a deliberate admin re-classification. */
  overwriteManual?: boolean;
  /** Off for a dry run. */
  writeAudit?: boolean;
  /** Promote to 'published' when the classifier is confident. */
  managePublication?: boolean;
}

export async function persistClassification(
  sql: Sql,
  taxonomy: Taxonomy,
  result: ClassificationResult,
  opts: PersistOptions = {}
): Promise<void> {
  const productId = Number(result.productId);
  const runId = opts.ingestRunId ?? null;
  const writeAudit = opts.writeAudit !== false;
  const managePublication = opts.managePublication !== false;

  const existing = await sql<{ category_id: string; stage: string }[]>`
    select category_id, stage from product_category where product_id = ${productId}`;
  const humanCurated = existing.some((r) => r.stage === 'manual');

  if (humanCurated && !opts.overwriteManual) {
    await upsertTags(sql, taxonomy, productId, result, runId);
    if (writeAudit) {
      await writeAuditRow(sql, productId, result, runId, { skippedCategories: 'manual override' });
    }
    return;
  }

  if (result.categoryId) {
    // Replace only what the machine wrote. A human's rows are protected above,
    // and this delete is scoped so a future 'secondary' relation survives.
    await sql`
      delete from product_category
       where product_id = ${productId}
         and stage <> 'manual'
         and relation in ('primary', 'ancestor')`;

    await sql`
      insert into product_category
        (product_id, category_id, relation, confidence, stage, ingest_run_id)
      values (${productId}, ${result.categoryId}, 'primary',
              ${result.confidence}, ${result.stage}, ${runId})
      on conflict (product_id, category_id) do update
        set relation = 'primary', confidence = excluded.confidence,
            stage = excluded.stage, ingest_run_id = excluded.ingest_run_id`;

    // Every ancestor too, so "everything under tech" is one index scan rather
    // than a recursive walk at request time.
    for (const ancestorId of result.ancestorIds) {
      await sql`
        insert into product_category
          (product_id, category_id, relation, confidence, stage, ingest_run_id)
        values (${productId}, ${ancestorId}, 'ancestor',
                ${result.confidence}, 'inherited', ${runId})
        on conflict (product_id, category_id) do nothing`;
    }

    // Keep the legacy columns in step. toProduct() in api/contract-queries.ts
    // and everything downstream still read them, so the frontend keeps working
    // unchanged while the new endpoints are rolled out. Remove both columns —
    // and this mirror — in the release after that.
    const parts = (result.categoryPath ?? '').split('/');
    if (parts[0]) {
      await sql`
        update product
           set category    = ${parts[0]},
               subcategory = ${parts[1] ?? parts[0]},
               updated_at  = now()
         where id = ${productId}`;
    }
  }

  await upsertTags(sql, taxonomy, productId, result, runId);

  if (managePublication) await applyPublicationGate(sql, productId, result);
  if (writeAudit) await writeAuditRow(sql, productId, result, runId, {});
}

async function upsertTags(
  sql: Sql, taxonomy: Taxonomy, productId: number,
  result: ClassificationResult, runId: number | null
): Promise<void> {
  const manual = await sql<{ tag_id: string }[]>`
    select tag_id from product_tag where product_id = ${productId} and stage = 'manual'`;
  const manualIds = new Set(manual.map((r) => Number(r.tag_id)));

  for (const tag of result.tags) {
    const tagId = taxonomy.tagId(tag.slug);
    if (tagId === null || manualIds.has(tagId)) continue;
    await sql`
      insert into product_tag (product_id, tag_id, confidence, stage, ingest_run_id)
      values (${productId}, ${tagId}, ${tag.confidence}, ${tag.stage}, ${runId})
      on conflict (product_id, tag_id) do update
        set confidence = excluded.confidence,
            stage = excluded.stage,
            ingest_run_id = excluded.ingest_run_id
        where product_tag.stage <> 'manual'`;
  }
}

/**
 * The publish gate. This is the behaviour change: nothing the classifier could
 * not place reaches a shopper. Products already 'suppressed' by a person stay
 * suppressed — that is a human decision and not ours to undo.
 */
async function applyPublicationGate(
  sql: Sql, productId: number, result: ClassificationResult
): Promise<void> {
  if (result.categoryId && !result.needsReview) {
    await sql`
      update product set status = 'published', updated_at = now()
       where id = ${productId} and status = 'draft'`;
  } else {
    await sql`
      update product set status = 'draft', updated_at = now()
       where id = ${productId} and status = 'published'`;

    await sql`
      insert into match_review_queue
        (kind, product_id, retailer_id, retailer_sku, raw_title,
         raw_brand, raw_ean, price_cents, candidate_product_id, confidence, reason)
      values ('category', ${productId}, null, null, null, null, null, null,
              ${result.categoryId}, ${Math.round(result.confidence * 100)},
              ${result.reason ?? 'low_confidence'})`;
  }
}

async function writeAuditRow(
  sql: Sql, productId: number, result: ClassificationResult,
  runId: number | null, extra: Record<string, unknown>
): Promise<void> {
  await sql`
    insert into product_classification
      (product_id, category_id, stage, confidence, agreement, tags,
       needs_review, input_hash, detail, ingest_run_id)
    values (${productId}, ${result.categoryId}, ${result.stage}, ${result.confidence},
            ${result.agreement}, ${result.tags.map((t) => t.slug)},
            ${result.needsReview}, ${result.inputHash},
            ${sql.json({ ...result.detail, ...extra, reason: result.reason })}, ${runId})`;
}

/**
 * Has this exact product already been classified by this exact classifier?
 * Used by the backfill so a nightly pass over ten thousand products does
 * almost no work.
 */
export async function alreadyClassified(
  sql: Sql, productId: number, inputHash: string
): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    select id from product_classification
     where product_id = ${productId} and input_hash = ${inputHash}
     limit 1`;
  return Boolean(row);
}
