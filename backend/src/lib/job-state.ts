import { sql } from './db';

/**
 * Bookkeeping for a scheduled job (see db/016_job_state.sql): a "running" mark
 * so hourly runs never overlap, and a failure streak so one blip doesn't alert.
 */

/** A mark older than this is from a run that crashed; it no longer blocks. */
const STALE_MINUTES = Number(process.env.JOB_STALE_MINUTES ?? 50);

/** Claim the job. Returns false if another run holds a fresh mark. */
export async function tryStartJob(job: string): Promise<boolean> {
  await sql`insert into job_state (job) values (${job}) on conflict (job) do nothing`;
  const rows = await sql`
    update job_state set running_since = now()
     where job = ${job}
       and (running_since is null
            or running_since < now() - make_interval(mins => ${STALE_MINUTES}::int))
    returning job`;
  return rows.length === 1;
}

/**
 * Release the job and record how it went. Returns the failure streak after
 * this run (0 after a success).
 */
export async function finishJob(job: string, ok: boolean, error?: string): Promise<number> {
  const [row] = await sql<{ consecutive_failures: number }[]>`
    update job_state
       set running_since = null,
           consecutive_failures = case when ${ok} then 0 else consecutive_failures + 1 end,
           last_success_at = case when ${ok} then now() else last_success_at end,
           last_failure_at = case when ${ok} then last_failure_at else now() end,
           last_error = case when ${ok} then last_error else ${error ?? null} end
     where job = ${job}
    returning consecutive_failures`;
  return row?.consecutive_failures ?? 0;
}

/** Alert (exit non-zero) from this many failed runs in a row. */
export const ALERT_AFTER_FAILURES = Math.max(1, Number(process.env.ALERT_AFTER_FAILURES ?? 2));
