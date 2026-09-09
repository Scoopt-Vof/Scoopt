-- Scoopt back end — schema v9: the mapping layer, and the read helpers.
--
-- THIS IS THE HEART OF THE SYSTEM.
--
-- The point is that we classify TAXONOMIES, not products. A feed with fifty
-- thousand products has a couple of hundred distinct category keys. Map those
-- once and the whole feed — including everything that source adds next month —
-- is classified for free. Per-product classification (rules, and later a
-- model) is the fallback, not the mechanism.
--
-- The map is keyed on (source_key, external_key) rather than being hardcoded
-- to one provider, because each source publishes its own key: today a numeric
-- id from Icecat or eBay, later possibly a breadcrumb string from a retailer
-- feed. Adding a source becomes a data job rather than a schema change.
--
-- ONLY TWO SOURCES EXIST TODAY: icecat and ebay. Nothing else is seeded here.
-- Bol, Awin advertisers and direct retailers are the reason for the shape of
-- this table, not rows in it.
--
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- FIRST: get out of the way of an earlier categorisation attempt.
-- ---------------------------------------------------------------------------
-- A previous design used the same table NAMES with a different shape — a flat
-- source_category_map keyed on (source, source_category_id), holding category
-- and subcategory as plain text. `create table if not exists` sees the name,
-- assumes the table is ours, skips creation, and then everything downstream
-- fails on a column that is not there: "column m.source_key does not exist".
--
-- So: any table carrying one of our names that does NOT have the column we
-- expect is RENAMED ASIDE, never dropped. Whatever mapping work is in it
-- survives and stays inspectable, and the rows that can be translated are
-- copied into the new table at the end of this file.
--
-- Safe to re-run: after the first pass the real tables have the right columns,
-- so this block does nothing on every later run.
do $$
declare
  t      record;
  target text;
  n      int;
begin
  for t in
    select * from (values
      ('source',             'source_key'),
      ('source_category',    'source_key'),
      ('source_category_map','source_key')
    ) as v(tbl, required_column)
  loop
    if to_regclass('public.' || t.tbl) is not null
       and not exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = t.tbl
            and column_name = t.required_column)
    then
      target := t.tbl || '_legacy';
      n := 0;
      while to_regclass('public.' || target) is not null loop
        n := n + 1;
        target := t.tbl || '_legacy_' || n;
      end loop;

      execute format('alter table public.%I rename to %I', t.tbl, target);
      raise notice
        'renamed pre-existing "%" (no % column) to "%" - its rows are kept; see the end of this migration',
        t.tbl, t.required_column, target;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- source
-- ---------------------------------------------------------------------------
create table if not exists source (
  source_key      text primary key
                    check (source_key ~ '^[a-z0-9]+(?:[-:][a-z0-9]+)*$'),
  display_name    text not null,
  kind            text not null default 'feed'
                    check (kind in ('enrichment', 'feed')),
  base_confidence numeric(4,3) not null default 0.850,
  -- Mirrors the guard in src/sources/registry.ts. A source whose prices are
  -- invented must never reach the database that serves scoopt.nl, and putting
  -- the flag here means the refusal does not depend on which code path ran.
  is_synthetic    boolean not null default false,
  is_active       boolean not null default true
);

insert into source (source_key, display_name, kind, base_confidence) values
  ('icecat', 'Icecat', 'enrichment', 0.950),
  ('ebay',   'eBay',   'feed',       0.820)
on conflict (source_key) do nothing;

-- ---------------------------------------------------------------------------
-- source_category — a mirror of each source's own taxonomy
-- ---------------------------------------------------------------------------
create table if not exists source_category (
  source_key   text not null references source(source_key) on delete cascade,
  external_key text not null,          -- '1001', '112529', 'Wonen>Keuken'
  parent_key   text,
  label        text,
  label_nl     text,
  primary key (source_key, external_key)
);

create index if not exists source_category_parent_idx
  on source_category (source_key, parent_key);

-- ---------------------------------------------------------------------------
-- source_category_map — one of their nodes, tied to one of ours
-- ---------------------------------------------------------------------------
create table if not exists source_category_map (
  source_key     text not null references source(source_key) on delete cascade,
  external_key   text not null,
  external_label text,
  category_id    bigint not null references category(id) on delete restrict,
  implied_tags   text[] not null default '{}',
  confidence     numeric(4,3) not null default 0.900,
  reviewed_by    text,
  created_at     timestamptz not null default now(),
  primary key (source_key, external_key)
);

-- ---------------------------------------------------------------------------
-- the resolver
-- ---------------------------------------------------------------------------
-- Walks up the SOURCE's own tree until it finds a mapped ancestor, losing five
-- confidence points per hop and floored at 0.50.
--
-- This is what makes partial mapping viable: one mapping high in a source's
-- tree covers everything beneath it while the detailed mappings are still
-- being filled in, at an honestly reduced confidence.
create or replace function resolve_source_category(
  p_source_key text, p_external_key text)
returns table (category_id bigint, matched_key text, hops integer, confidence numeric)
language sql stable as $$
  with recursive up as (
    select sc.external_key, sc.parent_key, 0 as hops
      from source_category sc
     where sc.source_key = p_source_key and sc.external_key = p_external_key
    union all
    select p.external_key, p.parent_key, up.hops + 1
      from source_category p
      join up on up.parent_key = p.external_key
     where p.source_key = p_source_key and up.hops < 12
  )
  select m.category_id, up.external_key, up.hops,
         greatest(0.50, m.confidence - (up.hops * 0.05))::numeric(4,3)
    from up
    join source_category_map m
      on m.source_key = p_source_key and m.external_key = up.external_key
   order by up.hops
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- the work queue — what to map next
-- ---------------------------------------------------------------------------
-- Anything unresolved is recorded rather than dropped, ordered by how many
-- products each unmapped key is blocking, so effort goes where it buys most.
create table if not exists source_category_unmapped (
  source_key        text not null references source(source_key) on delete cascade,
  external_key      text not null,
  external_label    text,
  hits              integer not null default 1,
  sample_product_id bigint references product(id) on delete set null,
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),
  primary key (source_key, external_key)
);

create or replace function note_unmapped_source_category(
  p_source_key text, p_external_key text,
  p_label text default null, p_product_id bigint default null)
returns void language sql as $$
  insert into source_category_unmapped
    (source_key, external_key, external_label, sample_product_id)
  values (p_source_key, p_external_key, p_label, p_product_id)
  on conflict (source_key, external_key) do update
    set hits           = source_category_unmapped.hits + 1,
        external_label = coalesce(excluded.external_label,
                                  source_category_unmapped.external_label),
        last_seen      = now();
$$;

-- ---------------------------------------------------------------------------
-- precedence — which source wins where
-- ---------------------------------------------------------------------------
-- Per branch, longest matching prefix first, held in a table so that changing
-- policy is an UPDATE rather than a deploy.
--
-- With two sources the honest table is ONE row. Icecat is a manufacturer data
-- sheet, so it is better than eBay everywhere it has coverage — and where it
-- has none it produces no signal at all, which the resolver already handles.
-- There is no branch today where eBay should outrank it. Per-branch rows get
-- added when there is a second feed to have an opinion about.
create table if not exists category_source_precedence (
  path_prefix  text primary key,
  source_order text[] not null            -- best first
);

insert into category_source_precedence (path_prefix, source_order) values
  ('', array['icecat', 'ebay'])
on conflict (path_prefix) do nothing;

create or replace function source_rank(p_path text, p_source_key text)
returns integer language sql stable as $$
  select coalesce(
    (select coalesce(array_position(p.source_order, p_source_key), 99)
       from category_source_precedence p
      where p.path_prefix = '' or p_path like p.path_prefix || '%'
      order by length(p.path_prefix) desc
      limit 1), 99);
$$;

-- ---------------------------------------------------------------------------
-- read helpers
-- ---------------------------------------------------------------------------
-- One row per product, even when it matches the node AND a descendant of it.
-- Getting this wrong is how a category page ends up showing the same product
-- three times.
create or replace function products_in_category(p_path text)
returns table (product_id bigint, is_primary boolean)
language sql stable as $$
  select pc.product_id, bool_or(pc.relation = 'primary')
    from product_category pc
    join category c on c.id = pc.category_id
   where c.path = p_path or c.path like p_path || '/%'
   group by pc.product_id;
$$;

-- Facet counts for a category page: which tags are worth offering as filters
-- here, and how many products each one would leave.
create or replace function category_tag_facets(p_path text)
returns table (tag_slug text, tag_label text, tag_kind tag_kind, product_count bigint)
language sql stable as $$
  select t.slug, t.label, t.kind, count(distinct pt.product_id)
    from products_in_category(p_path) pic
    join product_tag pt on pt.product_id = pic.product_id
    join tag t on t.id = pt.tag_id and t.is_active and t.is_facet
    join product p on p.id = pic.product_id and p.status = 'published'
   group by t.slug, t.label, t.kind
   order by count(distinct pt.product_id) desc, t.label;
$$;

-- Mapping coverage per source: the number to alert on. A feed that normally
-- maps ninety-four percent of its keys and suddenly maps sixty has changed
-- shape, and we want to know that day rather than next month.
-- ---------------------------------------------------------------------------
-- Carry across whatever the earlier attempt had mapped.
-- ---------------------------------------------------------------------------
-- The old shape stored category/subcategory as two text columns; the new one
-- points at a real node in the tree. A legacy row is copied when its
-- category/subcategory resolve to a path that actually exists AND its source
-- is one we know about. Anything that does not resolve is LEFT IN THE LEGACY
-- TABLE rather than guessed at - an unresolved row is a question for a person,
-- not something to invent an answer for.
do $$
declare
  legacy text;
  copied bigint;
  total  bigint;
begin
  select c.relname into legacy
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname like 'source\_category\_map\_legacy%'
   order by c.relname limit 1;

  if legacy is null then return; end if;

  execute format('select count(*) from public.%I', legacy) into total;

  execute format(
    'insert into source_category_map '
    '  (source_key, external_key, external_label, category_id, confidence, reviewed_by) '
    'select l.source, l.source_category_id, l.source_category_name, cat.id, 0.900, %L '
    '  from public.%I l '
    '  join source s on s.source_key = l.source '
    '  join category cat on cat.path = case '
    '       when coalesce(l.subcategory, %L) = %L then l.category '
    '       else l.category || %L || l.subcategory end '
    ' where l.source_category_id is not null '
    'on conflict (source_key, external_key) do nothing',
    'carried over from ' || legacy, legacy, '', '', '/');

  get diagnostics copied = row_count;
  raise notice
    'carried over % of % row(s) from "%" into source_category_map; the rest stay there for review',
    copied, total, legacy;
end $$;

-- security_invoker: a view runs with the DEFINER's rights by default, which
-- would read straight past the row level security enabled below. This makes
-- the caller's own permissions apply instead.
create or replace view v_source_mapping_coverage
  with (security_invoker = true) as
  select s.source_key,
         (select count(*) from source_category_map m
           where m.source_key = s.source_key) as mapped_keys,
         (select count(*) from source_category_unmapped u
           where u.source_key = s.source_key) as unmapped_keys,
         (select coalesce(sum(u.hits), 0) from source_category_unmapped u
           where u.source_key = s.source_key) as unmapped_hits
    from source s;

commit;

-- ---------------------------------------------------------------------------
-- Lock these tables against Supabase's public API — see 003_rls.sql.
-- ---------------------------------------------------------------------------
-- The mapping layer is internal: nothing outside the back end should read it,
-- and the unmapped queue in particular is an operational work list.
begin;
alter table source                    enable row level security;
alter table source_category           enable row level security;
alter table source_category_map       enable row level security;
alter table source_category_unmapped  enable row level security;
alter table category_source_precedence enable row level security;
commit;
