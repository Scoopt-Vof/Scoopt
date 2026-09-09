-- Scoopt back end — schema v7: the category tree and the tag vocabulary.
--
-- Replaces the two unconstrained text columns (product.category and
-- product.subcategory, added in 002) with a real hierarchy, so that a product
-- has one clear home and the site can grow deeper than two levels.
--
-- Design notes that matter when reading this file:
--
--   * Hierarchy is an adjacency list (parent_id) PLUS a materialised `path`.
--     parent_id keeps edits simple; the path column turns "everything under
--     tech" into an index scan rather than a recursive CTE at request time.
--
--   * `path` and `depth` are maintained by trigger, never written by hand.
--     Two triggers do it, and the split between them is deliberate — see the
--     comment above categories_cascade_path().
--
--   * Roots are 'home', 'sport' and 'tech'. They are NOT chosen freely: the
--     front-end contract (frontend/contract/types.ts) declares
--     `type Category = "home" | "sport" | "tech"` and routes on it, so the
--     tree is re-rooted onto those three and depth grows beneath them.
--     Changing a root slug breaks every live URL.
--
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- category
-- ---------------------------------------------------------------------------
create table if not exists category (
  id          bigserial primary key,
  parent_id   bigint references category(id) on delete restrict,
  slug        text        not null,
  name        text        not null,
  path        text        not null default '',   -- maintained by trigger
  depth       int         not null default 0,    -- maintained by trigger
  position    int         not null default 0,    -- manual sort order in menus
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint category_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint category_no_self_parent
    check (parent_id is null or parent_id <> id)
);

-- A slug must be unique among SIBLINGS, not globally: two "accessories" nodes
-- under different parents are fine, two under the same one are not.
-- coalesce(parent_id, 0) because a null never equals a null in a unique index.
create unique index if not exists category_parent_slug_uniq
  on category (coalesce(parent_id, 0), slug);

create unique index if not exists category_path_uniq on category (path);

-- text_pattern_ops so `path like 'tech/%'` can use the index under any locale.
create index if not exists category_path_prefix_idx
  on category (path text_pattern_ops);

-- ---------------------------------------------------------------------------
-- path maintenance, part 1 of 2 — compute
-- ---------------------------------------------------------------------------
-- Fires only when the node's own identity in the tree changes (insert, or a
-- changed slug/parent). It deliberately does NOT fire for a bare path update,
-- because that is how the cascade below rewrites descendants: the cascade sets
-- `path` explicitly and this trigger must leave that value alone.
create or replace function category_set_path() returns trigger
language plpgsql as $$
declare
  parent_path  text;
  parent_depth int;
begin
  if tg_op = 'UPDATE'
     and new.parent_id is not distinct from old.parent_id
     and new.slug is not distinct from old.slug then
    -- Nothing about this node's position changed. If `path` was set by the
    -- cascade, keep it; otherwise keep what was already there.
    new.updated_at := now();
    return new;
  end if;

  if new.parent_id is null then
    new.path  := new.slug;
    new.depth := 0;
  else
    select c.path, c.depth into parent_path, parent_depth
      from category c where c.id = new.parent_id;

    if parent_path is null then
      raise exception 'category %: parent_id % does not exist', new.slug, new.parent_id;
    end if;

    -- A node may not be moved underneath one of its own descendants. Without
    -- this the tree becomes a cycle and every path query hangs or lies.
    if tg_op = 'UPDATE' and old.path <> '' and parent_path like old.path || '/%' then
      raise exception
        'category %: cannot move node under its own descendant (% is below %)',
        new.slug, parent_path, old.path;
    end if;

    new.path  := parent_path || '/' || new.slug;
    new.depth := parent_depth + 1;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists category_set_path_trg on category;
create trigger category_set_path_trg
  before insert or update on category
  for each row execute function category_set_path();

-- ---------------------------------------------------------------------------
-- path maintenance, part 2 of 2 — cascade
-- ---------------------------------------------------------------------------
-- Rewrites every descendant's path when a node's own path changes.
--
-- NB: `after update OF path` would NOT fire here. The path column is set by
-- the BEFORE trigger above, not by the UPDATE statement's SET list, and
-- `OF path` tests the statement's column list rather than what actually
-- changed. Fire on any update and filter with WHEN instead. This is a real
-- bug that was found in testing: renaming a parent left every child with a
-- stale path, silently, because the trigger never fired.
--
-- The rewrite is a prefix substitution computed from each row's OWN current
-- path, so it is correct regardless of the order rows are processed in.
-- The AFTER triggers this update queues re-fire against paths that no longer
-- match old.path, so they are no-ops rather than a recursion.
create or replace function category_cascade_path() returns trigger
language plpgsql as $$
begin
  update category
     set path       = new.path || substring(path from length(old.path) + 1),
         depth      = depth + (new.depth - old.depth),
         updated_at = now()
   where path like old.path || '/%';
  return null;
end $$;

drop trigger if exists category_cascade_path_trg on category;
create trigger category_cascade_path_trg
  after update on category
  for each row when (new.path is distinct from old.path)
  execute function category_cascade_path();

-- ---------------------------------------------------------------------------
-- tag — flat, typed, many-to-many (join table lives in 008)
-- ---------------------------------------------------------------------------
-- `kind` exists so the UI can group filters sensibly instead of showing one
-- undifferentiated wall of checkboxes. `is_facet` separates tags offered as
-- filters from internal bookkeeping ones.
do $$ begin
  create type tag_kind as enum (
    'brand', 'attribute', 'audience', 'material', 'colour',
    'use_case', 'season', 'condition', 'price_band', 'other');
exception when duplicate_object then null;
end $$;

create table if not exists tag (
  id        bigserial primary key,
  slug      text     not null unique,
  label     text     not null,
  kind      tag_kind not null default 'attribute',
  is_facet  boolean  not null default true,
  is_active boolean  not null default true,
  -- Alternative spellings the rule engine should also match on the way in.
  synonyms  text[]   not null default '{}',

  constraint tag_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

commit;

-- ---------------------------------------------------------------------------
-- Seed: the three roots and their existing children.
-- ---------------------------------------------------------------------------
-- These are exactly the ids and display names that were previously hardcoded
-- in src/api/contract-queries.ts (CATEGORY_META and SUBCATEGORY_META), so
-- every URL the site serves today — /category/sport/running and the rest —
-- resolves against this tree unchanged.
--
-- Everything is seeded ACTIVE, matching current behaviour. See the note at the
-- bottom of this file about pruning to the verticals actually being published.
begin;

insert into category (parent_id, slug, name, position) values
  (null, 'home',  'Home & Furniture', 1),
  (null, 'sport', 'Sport',            2),
  (null, 'tech',  'Technology',       3)
on conflict (coalesce(parent_id, 0), slug) do nothing;

insert into category (parent_id, slug, name, position)
select p.id, v.slug, v.name, v.position
  from (values
    -- ---- Sport ----
    ('sport', 'running',           'Running',                 1),
    ('sport', 'cycling',           'Cycling',                 2),
    ('sport', 'hiking-outdoor',    'Hiking & Outdoor',        3),
    ('sport', 'fitness-gym',       'Fitness & Gym',           4),
    ('sport', 'swimming',          'Swimming',                5),
    ('sport', 'team-sports',       'Team Sports',             6),
    ('sport', 'racket-sports',     'Racket Sports',           7),
    ('sport', 'winter-sports',     'Winter Sports',           8),
    -- ---- Home & Furniture ----
    ('home',  'furniture',         'Furniture',               1),
    ('home',  'kitchen-dining',    'Kitchen & Dining',        2),
    ('home',  'bedroom',           'Bedroom',                 3),
    ('home',  'lighting',          'Lighting',                4),
    ('home',  'home-decor',        'Home Decor',              5),
    ('home',  'storage',           'Storage & Organisation',  6),
    ('home',  'home-textiles',     'Home Textiles',           7),
    ('home',  'garden-outdoor',    'Garden & Outdoor',        8),
    -- ---- Technology ----
    ('tech',  'smartphones',       'Smartphones',             1),
    ('tech',  'laptops-computers', 'Laptops & Computers',     2),
    ('tech',  'wearables',         'Wearables & Smartwatches',3),
    ('tech',  'audio-headphones',  'Audio & Headphones',      4),
    ('tech',  'tv-video',          'TV & Video',              5),
    ('tech',  'cameras',           'Cameras',                 6),
    ('tech',  'gaming',            'Gaming',                  7),
    ('tech',  'home-appliances',   'Home Appliances',         8)
  ) as v(parent_slug, slug, name, position)
  join category p on p.path = v.parent_slug
on conflict (coalesce(parent_id, 0), slug) do nothing;

-- A small starting tag vocabulary. Deliberately short: tags earn their place
-- by being used as filters, and an unused facet is worse than a missing one.
insert into tag (slug, label, kind) values
  ('wireless',         'Wireless',          'attribute'),
  ('noise-cancelling', 'Noise cancelling',  'attribute'),
  ('waterproof',       'Waterproof',        'attribute'),
  ('gps',              'GPS',               'attribute'),
  ('bluetooth',        'Bluetooth',         'attribute'),
  ('smart',            'Smart',             'attribute'),
  ('gaming',           'Gaming',            'use_case'),
  ('portable',         'Portable',          'attribute'),
  ('rechargeable',     'Rechargeable',      'attribute'),
  ('refurbished',      'Refurbished',       'condition'),
  ('used',             'Used',              'condition'),
  ('new',              'New',               'condition')
on conflict (slug) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- PRUNING — a decision for Lorenzo and Josh, not a migration.
-- ---------------------------------------------------------------------------
-- While eBay is the only feed, the catalogue should go narrow rather than
-- broad: pick the two or three verticals where eBay's Dutch supply and Icecat
-- coverage are both good, and switch the rest off. Empty category pages hurt
-- visitors and search ranking alike.
--
-- Everything above is seeded ACTIVE so that this migration does not silently
-- remove twenty-one categories from a live site. To prune, run this by hand
-- once the verticals are chosen — for example:
--
--   update category set is_active = false
--    where path not like 'tech%'
--      and path not in ('home', 'sport');
--   update category set is_active = false
--    where path like 'tech/%'
--      and slug not in ('audio-headphones', 'laptops-computers', 'home-appliances');
--
-- Reversible at any time: set is_active = true again.
