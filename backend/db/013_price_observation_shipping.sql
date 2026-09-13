-- Scoopt back end — schema v13: record shipping and currency on price history.
--
-- price_observation stored the item price only. The API's "current minimum"
-- is price + shipping (that is what leaves the shopper's bank account), so the
-- 30-day low/high were computed on a different basis from the current price,
-- and "cheapest in 30 days" could be wrong in either direction.
--
-- Both columns are NULLABLE: rows written before this migration genuinely do
-- not know their shipping or currency, and the table is append-only (the
-- forbid_mutation trigger), so they are never backfilled. Readers treat a NULL
-- shipping as 0 and a NULL currency as EUR — ingest refused non-EUR rows long
-- before this migration, so that is accurate for history.
--
-- ALTER TABLE ... ADD COLUMN does not fire row triggers, so this is compatible
-- with the append-only rule.
--
-- Safe to re-run.

begin;

alter table price_observation add column if not exists shipping_cents integer;
alter table price_observation add column if not exists currency       char(3);

do $$ begin
  alter table price_observation
    add constraint price_obs_shipping_not_neg check (shipping_cents is null or shipping_cents >= 0);
exception when duplicate_object then null;
end $$;

commit;
