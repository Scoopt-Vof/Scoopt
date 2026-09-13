-- Scoopt back end — schema v12: make "no free-delivery threshold" expressible.
--
-- 002 added retailer.free_above_cents as NOT NULL DEFAULT 0. The contract's
-- DeliveryRule.freeAbove means "the fee is waived once the store subtotal
-- reaches this", so a 0 there reads as "free above €0" — delivery was always
-- free for every retailer, and the smart-split comparison ignored delivery
-- entirely.
--
-- NULL now means "no threshold: the fee always applies". Existing zeros are
-- converted, because no retailer row was ever deliberately given a €0
-- threshold — 0 was only ever the default.
--
-- Safe to re-run.

begin;

alter table retailer alter column free_above_cents drop not null;
alter table retailer alter column free_above_cents drop default;

update retailer set free_above_cents = null where free_above_cents = 0;

commit;
