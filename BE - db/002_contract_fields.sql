-- Scoopt back end — schema v2
--
-- Adds the fields Josh's contract/types.ts requires that the v1 schema had no
-- home for. Without these the database can hold a product but cannot serve it
-- to the front end, which is the gap this migration closes.
--
--   contract_id  Josh's Product.id — a readable slug ("run-pegasus41"), not our
--                bigserial. The front end routes on it, so it must round-trip.
--   unit         Product.unit — the short descriptor under the title.
--   subcategory  Product.subcategory — "hardlopen" etc. v1 conflated this with
--                category; the contract has both, and category is constrained
--                to exactly home | sport | tech.
--   specs        Product.specs — the key/value bag personalisation ranks on.
--
-- Safe to re-run.

begin;

alter table product add column if not exists contract_id text;
alter table product add column if not exists unit        text;
alter table product add column if not exists subcategory text;
alter table product add column if not exists specs       jsonb not null default '{}'::jsonb;

-- The front end fetches /api/product/run-pegasus41, so this lookup must be fast
-- and unique. Partial, because rows ingested from a real feed before matching
-- won't have one yet.
create unique index if not exists product_contract_id_key
  on product (contract_id) where contract_id is not null;

commit;

-- Delivery rules live on the retailer, because /api/basket/plan must return
-- them and the smart-split maths is meaningless without them.
begin;
alter table retailer add column if not exists delivery_fee_cents integer not null default 0;
alter table retailer add column if not exists free_above_cents   integer not null default 0;
commit;
