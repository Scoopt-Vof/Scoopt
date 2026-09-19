-- Scoopt back end — schema v15: price history is written on CHANGE, not on every run.
--
-- Until now ingest appended one price_observation row per product per run,
-- even when nothing had changed. At ~33,500 rows (~5 MB) per run that fills the
-- free Supabase database within weeks at one run a day, and within a day at the
-- planned hourly refresh.
--
-- From now on a row is appended only when the price, shipping, stock or
-- currency changed, or when the offer had not been seen for a while (a gap —
-- the product left the feed and came back). Between rows the price is known to
-- have been constant: the offer's last_seen_at says until when it was confirmed.
--
-- prev_seen_at records, on each NEW row, when the previous state of this offer
-- was last confirmed. That tells a reader exactly where the previous period
-- ended, so a gap is never drawn as a flat line — without ever updating an old
-- row. The table stays append-only (forbid_mutation trigger).
--
-- ADD COLUMN does not fire row triggers. Nullable: older rows don't know it,
-- and readers fall back to the next row's observed_at.
--
-- Safe to re-run.

begin;

alter table price_observation add column if not exists prev_seen_at timestamptz;

-- The history query walks one product's rows per retailer in time order.
create index if not exists price_obs_product_retailer_time_idx
  on price_observation (product_id, retailer_id, observed_at);

commit;
