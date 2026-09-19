import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from '../lib/db';
import { tryStartJob, finishJob } from '../lib/job-state';

/**
 * DATA RETENTION — what we are allowed, and want, to keep (db/017_retention.sql).
 *
 *   1. Price history of sources that may not keep it (retailer.keeps_price_history
 *      = false; eBay) is deleted. Ingest no longer writes it, so after the first
 *      run this only catches rows from before the change.
 *   2. The classification audit log keeps CLASSIFICATION_AUDIT_DAYS (90) days,
 *      plus the newest row per product at any age.
 *   3. Raw archived API responses of those sources are deleted after
 *      RAW_ARCHIVE_DAYS_NO_HISTORY (7) days — long enough to debug a bad run,
 *      no longer (eBay licence 3.1: copies only as long as necessary).
 *
 * Both tables are append-only. The deletes run in a transaction that sets
 * scoopt.retention = 'on' (`set local` — it ends with the transaction), the one
 * thing the forbid_mutation trigger lets through. Nothing else in the code base
 * sets it.
 *
 * Runs once a day from the hourly ingest (see maybeRunRetention), or by hand:
 *   npm run retention
 */

const AUDIT_DAYS = Math.max(1, Number(process.env.CLASSIFICATION_AUDIT_DAYS ?? 90));
const ARCHIVE_DAYS = Math.max(1, Number(process.env.RAW_ARCHIVE_DAYS_NO_HISTORY ?? 7));
const JOB = 'retention';

export interface RetentionResult {
  priceRowsDeleted: number;
  auditRowsDeleted: number;
  archiveFilesDeleted: number;
}

export async function runRetention(now: Date = new Date()): Promise<RetentionResult> {
  const { priceRowsDeleted, auditRowsDeleted } = await sql.begin(async (tx) => {
    await tx`set local scoopt.retention = 'on'`;

    const price = await tx`
      delete from price_observation po
       using retailer r
       where r.id = po.retailer_id and not r.keeps_price_history`;

    const audit = await tx`
      delete from product_classification pc
       where pc.created_at < ${now}::timestamptz - make_interval(days => ${AUDIT_DAYS}::int)
         and exists (
           select 1 from product_classification newer
            where newer.product_id = pc.product_id
              and (newer.created_at > pc.created_at
                   or (newer.created_at = pc.created_at and newer.id > pc.id)))`;

    return { priceRowsDeleted: price.count, auditRowsDeleted: audit.count };
  });

  // Raw payloads live on the ingest host's disk (see run.ts, step 2).
  let archiveFilesDeleted = 0;
  const root = process.env.RAW_ARCHIVE_DIR ?? join(process.cwd(), 'raw');
  const noHistory = await sql<{ slug: string }[]>`
    select slug from retailer where not keeps_price_history`;
  const cutoff = now.getTime() - ARCHIVE_DAYS * 86_400_000;
  for (const { slug } of noHistory) {
    const dir = join(root, slug);
    let files: string[] = [];
    try { files = await readdir(dir); } catch { continue; }   // no archive here
    for (const f of files) {
      const path = join(dir, f);
      try {
        if ((await stat(path)).mtimeMs < cutoff) { await unlink(path); archiveFilesDeleted++; }
      } catch { /* vanished or unreadable: skip */ }
    }
  }

  return { priceRowsDeleted, auditRowsDeleted, archiveFilesDeleted };
}

/**
 * Called at the end of every hourly ingest: runs retention if it has not
 * succeeded in the last ~day. Returns an error message, or null (ran fine or
 * wasn't due).
 */
export async function maybeRunRetention(): Promise<string | null> {
  const [due] = await sql<{ due: boolean }[]>`
    select coalesce(max(last_success_at) < now() - interval '23 hours', true) as due
      from job_state where job = ${JOB}`;
  if (!due?.due) return null;
  if (!(await tryStartJob(JOB))) return null;
  try {
    const r = await runRetention();
    await finishJob(JOB, true);
    console.log(
      `✓ retention: ${r.priceRowsDeleted} no-history price rows, ${r.auditRowsDeleted} old ` +
      `classification rows, ${r.archiveFilesDeleted} old raw archive files deleted`);
    return null;
  } catch (e) {
    const msg = `retention failed: ${String(e).split('\n')[0]}`;
    await finishJob(JOB, false, msg).catch(() => {});
    console.error(`✗ ${msg}`);
    return msg;
  }
}

const isMain = process.argv[1]?.endsWith('retention.ts') || process.argv[1]?.endsWith('retention.js');
if (isMain) {
  runRetention()
    .then(async (r) => { console.log(r); await sql.end(); })
    .catch(async (e) => { console.error(String(e)); await sql.end(); process.exit(1); });
}
