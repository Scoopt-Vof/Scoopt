-- Scoopt back end — schema v7
--
-- Two related changes, both about WHERE a product's category comes from.
--
-- 1. source_category_map — the mapping layer, as data instead of code.
--
--    Every source that will ever hand us products has its own taxonomy:
--    Icecat has numeric category ids, Awin merchants have their own strings,
--    Bol has yet another tree. Keeping those mappings inline in each ingest
--    script (as ICECAT_CATEGORY_MAP used to be) means a mapping change is a
--    code change and a redeploy, and it guarantees two scripts eventually
--    hold two different copies of the same map. One table, keyed by
--    (source, source_category_id), is read by every pass that needs it.
--
--    This is stage 1 of the categorisation design — source category maps,
--    then keyword rules, then a model fallback. Stages 2 and 3 land later;
--    this table is the one stage 1 reads.
--
-- 2. Provenance on product.
--
--    icecat_category_id / icecat_category_name
--      The RAW value Icecat gave us, stored as-is. This is the important
--      one: if the mapping is stored but not the raw id, then refining the
--      map means re-fetching every product from Icecat. With the raw id on
--      the row, a mapping change is a re-run over our own database.
--
--    created_by_source
--      Which pass created this row ('icecat' | 'ebay-nl' | ...). Makes
--      "remove everything the Icecat discovery pass ever created" a single
--      query rather than an archaeology exercise. After the fixture-offer
--      cleanup, being able to undo a bulk write in one statement is not
--      optional.
--
--    category_source
--      Which stage decided the primary category: 'source-map' (a source's
--      own taxonomy, e.g. Icecat), 'keyword', 'model', 'feed' (whatever the
--      retailer feed claimed) or 'manual'. Lets us measure how much of the
--      catalogue is genuinely manufacturer-classified versus guessed.
--
-- Safe to re-run.

begin;

create table if not exists source_category_map (
  source              text        not null,          -- 'icecat' | 'awin' | 'bol' | ...
  source_category_id  text        not null,          -- their id, as a string
  source_category_name text,                         -- their label, for humans
  category            text        not null
                      check (category in ('home', 'sport', 'tech')),
  subcategory         text        not null,          -- must match SUBCATEGORY_META
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  primary key (source, source_category_id)
);

create index if not exists source_category_map_target_idx
  on source_category_map (category, subcategory);

alter table product add column if not exists icecat_category_id   text;
alter table product add column if not exists icecat_category_name text;
alter table product add column if not exists created_by_source    text;
alter table product add column if not exists category_source      text;

-- Both of these are queried as "everything from one source" / "everything
-- still unmapped", so they earn an index even at a small row count.
create index if not exists product_created_by_source_idx on product (created_by_source);
create index if not exists product_icecat_category_idx   on product (icecat_category_id);

comment on column product.icecat_category_id is
  'Raw Icecat category id as returned by Icecat. Never derived from our own map — the map is applied FROM this value, so remapping is a local re-run.';
comment on column product.created_by_source is
  'Which ingest pass created this row. Used to bulk-undo a discovery run.';
comment on column product.category_source is
  'Which stage set category/subcategory: source-map | keyword | model | feed | manual.';

commit;

-- ---------------------------------------------------------------------------
-- Backfill: rows that already exist came from a retailer feed, and their
-- category came from whatever that feed claimed. Recording that honestly now
-- means the "how much is manufacturer-classified" number is not flattered by
-- a pile of unlabelled legacy rows.
-- ---------------------------------------------------------------------------
begin;

update product
   set category_source = 'feed'
 where category_source is null;

commit;
