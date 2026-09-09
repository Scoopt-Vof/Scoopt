-- Scoopt back end — schema v8: how a product is attached to the tree.
--
-- Three things live here, and keeping them separate is the point:
--
--   product_category / product_tag   the ASSIGNMENTS — current state
--   product_classification           the AUDIT — append-only, never rewritten
--   match_review_queue (extended)    the WORK LIST — one queue, not two
--
-- Every assignment records which stage produced it, how confident that stage
-- was, and which ingest run it came from. That last column is what makes a bad
-- rule reversible: you can delete exactly the rows one run created without
-- touching a human's corrections.
--
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type classification_stage as enum
    ('source', 'rule', 'llm', 'manual', 'inherited');
exception when duplicate_object then null;
end $$;

-- 'primary'   the one shelf this product lives on
-- 'ancestor'  written automatically for every ancestor of the primary, so that
--             "everything under tech" is one index scan
-- 'secondary' a genuine second shelf in another branch. Nothing writes these
--             today (dual shelving is out of scope) — the value exists so that
--             enabling it later is a code change, not a migration.
do $$ begin
  create type category_relation as enum ('primary', 'ancestor', 'secondary');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- product_category
-- ---------------------------------------------------------------------------
create table if not exists product_category (
  product_id    bigint not null references product(id) on delete cascade,
  category_id   bigint not null references category(id) on delete cascade,
  relation      category_relation not null default 'primary',
  confidence    numeric(4,3) not null default 1.000,
  stage         classification_stage not null default 'manual',
  ingest_run_id bigint references ingest_run(id),
  created_at    timestamptz not null default now(),

  primary key (product_id, category_id),
  constraint product_category_confidence_range check (confidence between 0 and 1)
);

-- Exactly one primary category per product, enforced by the database, because
-- "one clear home" is only useful if it is guaranteed rather than hoped for.
create unique index if not exists product_category_one_primary
  on product_category (product_id) where relation = 'primary';

create index if not exists product_category_category_idx
  on product_category (category_id);

-- ---------------------------------------------------------------------------
-- product_tag
-- ---------------------------------------------------------------------------
create table if not exists product_tag (
  product_id    bigint not null references product(id) on delete cascade,
  tag_id        bigint not null references tag(id) on delete cascade,
  confidence    numeric(4,3) not null default 1.000,
  stage         classification_stage not null default 'manual',
  ingest_run_id bigint references ingest_run(id),
  created_at    timestamptz not null default now(),

  primary key (product_id, tag_id),
  constraint product_tag_confidence_range check (confidence between 0 and 1)
);

create index if not exists product_tag_tag_idx on product_tag (tag_id);

-- ---------------------------------------------------------------------------
-- product_classification — the audit trail. APPEND ONLY.
-- ---------------------------------------------------------------------------
-- `detail` keeps the whole decision: which sources spoke, what each said,
-- which rules fired, what was rejected. A wrong answer can then be explained
-- rather than guessed at.
--
-- `input_hash` lets an unchanged product be skipped on the next run instead of
-- re-classified, which is what keeps a nightly backfill cheap.
--
-- Append-only is enforced by the same trigger function price_observation uses
-- (forbid_mutation(), defined in 001_schema.sql), for the same reason: a
-- future bug must not be able to silently rewrite the record of what happened.
create table if not exists product_classification (
  id                 bigserial primary key,
  product_id         bigint not null references product(id) on delete cascade,
  category_id        bigint references category(id) on delete set null,
  stage              classification_stage not null,
  confidence         numeric(4,3) not null,
  agreement          text,           -- single | agree | refine | conflict | null
  tags               text[] not null default '{}',
  needs_review       boolean not null default false,
  input_hash         text,
  detail             jsonb  not null default '{}'::jsonb,
  classifier_version text   not null default 'v1',
  ingest_run_id      bigint references ingest_run(id),
  created_at         timestamptz not null default now()
);

create index if not exists product_classification_product_idx
  on product_classification (product_id, created_at desc);

create index if not exists product_classification_review_idx
  on product_classification (created_at desc) where needs_review;

drop trigger if exists product_classification_no_update on product_classification;
create trigger product_classification_no_update
  before update or delete on product_classification
  for each row execute function forbid_mutation();

-- ---------------------------------------------------------------------------
-- match_review_queue — extended, not duplicated
-- ---------------------------------------------------------------------------
-- 001 created this for products whose EAN or price could not be trusted. A
-- product whose CATEGORY could not be trusted is the same kind of problem and
-- the same kind of work, so it goes in the same list. Two review queues is one
-- too many for a two-person team.
alter table match_review_queue
  add column if not exists kind text not null default 'match';

do $$ begin
  alter table match_review_queue
    add constraint match_review_queue_kind_valid
    check (kind in ('match', 'category'));
exception when duplicate_object then null;
end $$;

alter table match_review_queue
  add column if not exists product_id bigint references product(id) on delete cascade;

-- retailer_sku and raw_title are NOT NULL from 001 and describe a feed row.
-- A category review names a product that already exists, so those two have
-- nothing meaningful to say. Relax them rather than storing filler.
alter table match_review_queue alter column retailer_id  drop not null;
alter table match_review_queue alter column retailer_sku drop not null;
alter table match_review_queue alter column raw_title    drop not null;

create index if not exists review_queue_category_open_idx
  on match_review_queue (created_at desc)
  where resolved = false and kind = 'category';

-- ---------------------------------------------------------------------------
-- product.category — close the silent-coercion gap
-- ---------------------------------------------------------------------------
-- toProduct() in src/api/contract-queries.ts rewrites any unrecognised value
-- to 'sport' rather than failing, so a broken ingest has been able to show up
-- as sport quietly filling with junk. Make the database refuse it instead.
--
-- Guarded: if existing rows violate it the constraint is skipped and a notice
-- is raised, so a re-run on a dirty database does not abort the whole chain.
do $$ begin
  alter table product add constraint product_category_valid
    check (category in ('home', 'sport', 'tech'));
exception
  when duplicate_object then null;
  when check_violation then
    raise notice 'product_category_valid not added: existing rows hold a category outside home/sport/tech. Fix those rows, then re-run this migration.';
end $$;

commit;
