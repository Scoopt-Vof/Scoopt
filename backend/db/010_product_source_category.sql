-- Scoopt back end — schema v10: remember each source's OWN category per product.
--
-- THE GAP THIS CLOSES.
--
-- 009 gave us a mapping layer keyed on (source_key, external_key), and the
-- classifier's stage 1 reads it. But a product only reaches stage 1 if we know
-- which source category it came from — and that value was passed straight
-- through the ingest into the classifier and then thrown away. So every
-- re-classification fell back to keyword rules, and the mapping layer sat
-- empty and unused.
--
-- Storing the raw signal is what makes the whole design work the way it was
-- meant to: refine a mapping, re-run the classifier over our OWN database, and
-- every product under that source category moves. No re-fetching, no
-- re-ingesting, no keyword whack-a-mole.
--
-- This is the same principle as keeping icecat_category_id on the product
-- (see 007_source_category_map.sql), generalised to every source.
--
-- Safe to re-run.

begin;

create table if not exists product_source_category (
  product_id   bigint not null references product(id) on delete cascade,
  source_key   text   not null references source(source_key) on delete cascade,
  -- The source's own id or breadcrumb, exactly as they gave it to us. NEVER
  -- our interpretation of it — the mapping is applied FROM this value, so
  -- remapping is a local re-run rather than a re-fetch.
  external_key text   not null,
  external_label text,
  -- Most specific first when a source gives several (Icecat virtual
  -- categories are more specific than its main one).
  position     int    not null default 0,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),

  primary key (product_id, source_key, external_key)
);

create index if not exists product_source_category_key_idx
  on product_source_category (source_key, external_key);

alter table product_source_category enable row level security;

-- Convenience: every signal a product carries, most specific first, in the
-- shape the classifier's ProductInput.sourceCategories wants.
create or replace function product_source_signals(p_product_id bigint)
returns table (source_key text, external_key text, label text)
language sql stable as $$
  select psc.source_key, psc.external_key, psc.external_label
    from product_source_category psc
   where psc.product_id = p_product_id
   order by psc.position, psc.source_key;
$$;

commit;

-- ---------------------------------------------------------------------------
-- Backfill from what we already stored under the old Icecat-specific columns.
-- ---------------------------------------------------------------------------
-- 007_source_category_map.sql added product.icecat_category_id for exactly
-- this purpose before the general table existed. Carry it across rather than
-- re-fetching from Icecat.
begin;

insert into product_source_category (product_id, source_key, external_key, external_label, position)
select p.id, 'icecat', p.icecat_category_id, p.icecat_category_name, 0
  from product p
 where p.icecat_category_id is not null
   and trim(p.icecat_category_id) <> ''
on conflict (product_id, source_key, external_key) do nothing;

commit;
