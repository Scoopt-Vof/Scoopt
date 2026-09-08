-- Scoopt back end — schema v6
--
-- Fixes the root cause behind "Sport doesn't show Running, Cycling etc.":
-- src/sources/ebay.ts used to set `subcategory` to the literal eBay search
-- phrase ("Garmin Forerunner 265"), not a real subcategory id. That adapter
-- is now fixed (see src/sources/ebay.ts DEFAULT_QUERIES) so every FUTURE
-- ingest run assigns a correct id. This migration is the one-time fix for
-- the rows a previous run already wrote with the old, wrong values, and
-- moves the three original Dutch ids (hardlopen/fietsen/fitness) to the
-- English ones contract-queries.ts SUBCATEGORY_META now uses.
--
-- Safe to re-run: every branch only touches rows that still hold an old
-- value, so running it twice is a no-op the second time.

begin;

-- Old Dutch ids -> new English ids (in case any row already used them).
update product set subcategory = 'running'     where subcategory = 'hardlopen';
update product set subcategory = 'cycling'     where subcategory = 'fietsen';
update product set subcategory = 'fitness-gym' where subcategory = 'fitness';

-- The actual bug: rows whose subcategory is a product search phrase / model
-- name from the old ebay.ts, not a real subcategory id. Matched by brand,
-- since that survived ingestion correctly even when subcategory didn't.
update product set subcategory = 'running'
 where category = 'sport' and brand in ('Garmin', 'adidas', 'Adidas', 'Salomon')
   and subcategory not in (
     'running','cycling','hiking-outdoor','fitness-gym','swimming',
     'team-sports','racket-sports','winter-sports'
   );

update product set subcategory = 'cycling'
 where category = 'sport' and brand = 'Osprey' and title ilike '%talon 22%'
   and subcategory not in (
     'running','cycling','hiking-outdoor','fitness-gym','swimming',
     'team-sports','racket-sports','winter-sports'
   );

update product set subcategory = 'hiking-outdoor'
 where category = 'sport' and brand = 'Osprey' and title ilike '%velocity%'
   and subcategory not in (
     'running','cycling','hiking-outdoor','fitness-gym','swimming',
     'team-sports','racket-sports','winter-sports'
   );

commit;
