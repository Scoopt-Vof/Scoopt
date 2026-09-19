-- Scoopt back end — schema v17: data retention.
--
-- Two decisions (Lorenzo, 19 Sep 2026):
--
--   1. eBay is removed from price history. eBay's API License Agreement allows
--      copies of eBay content only "as necessary" (3.1) and forbids deriving
--      historical price data without written permission (8.1(d)). Retailers
--      now carry keeps_price_history; for eBay it is false: ingest writes no
--      history rows for it, the history API ignores it, and the retention job
--      deletes the rows already stored. Its CURRENT price (offer) is unaffected.
--
--   2. The classification audit log (product_classification) keeps 90 days,
--      plus the newest row per product at any age (it explains the product's
--      current placement).
--
-- Both tables are append-only (forbid_mutation trigger). That stays true for
-- normal code: UPDATE is always refused, and DELETE is refused unless the
-- transaction explicitly sets scoopt.retention = 'on' — which only the
-- retention job (src/jobs/retention.ts) does, with `set local`.
--
-- Safe to re-run.

begin;

alter table retailer add column if not exists keeps_price_history boolean not null default true;
update retailer set keeps_price_history = false where slug like 'ebay-%';

create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('scoopt.retention', true) = 'on' then
    return old;
  end if;
  raise exception '% is append-only (attempted %)', tg_table_name, tg_op;
end;
$$;

commit;
