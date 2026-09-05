-- Scoopt back end — schema v3
--
-- Icecat enrichment (a separate pass, see src/ingest/enrich-icecat.ts) needs
-- its own "last checked" timestamp per product. Without one, every run would
-- re-request every product from Icecat's API again instead of making forward
-- progress through the catalogue and re-checking the oldest entries first.
--
--   icecat_checked_at   Set every time the enrichment pass looks a product
--                        up at Icecat, whether or not Icecat had data for
--                        it. Deliberately separate from updated_at, which
--                        any retailer ingest can also touch.
--
-- Safe to re-run.

begin;

alter table product add column if not exists icecat_checked_at timestamptz;

commit;
