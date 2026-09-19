-- Scoopt back end — schema v16: job_state, for the hourly ingest.
--
-- One row per scheduled job. Two jobs it does:
--
--   * running_since — a run marks the job as running and clears it when done.
--     A second run that starts while one is still busy sees the mark and exits
--     instead of overlapping (two runs writing the same offers at once). A mark
--     older than the stale window is ignored, so a crashed run can never block
--     the job for good. A row lock, not an advisory lock: advisory locks are
--     unreliable through Supabase's transaction-mode connection pooler.
--
--   * consecutive_failures — hourly runs mean a single blip (a feed timing out
--     once) would otherwise alert every time. The job exits with an error, so
--     Railway notifies, only from the SECOND failed run in a row.
--
-- Safe to re-run.

begin;

create table if not exists job_state (
  job                  text primary key,
  running_since        timestamptz,
  consecutive_failures integer     not null default 0,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_error           text
);

commit;
