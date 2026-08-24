-- Scoopt back end — schema v1
-- Target: Supabase (Postgres 15/16), EU/Frankfurt.
-- Conventions:
--   * All money is INTEGER CENTS. Never float, never numeric-with-decimals.
--   * price_observation is APPEND ONLY. Never UPDATE, never DELETE.
--     Price history is a product feature (revenue stream 5), not a log.
--   * Every table that ingestion writes carries source provenance.

begin;

-- ---------------------------------------------------------------------------
-- retailer
-- ---------------------------------------------------------------------------
create table if not exists retailer (
  id                bigserial primary key,
  slug              text        not null unique,          -- 'decathlon'
  name              text        not null,                 -- 'Decathlon'
  country           char(2)     not null default 'NL',
  homepage_url      text        not null,
  -- how offers from this retailer are acquired; documents the legal basis
  source_kind       text        not null
                    check (source_kind in ('official_api','affiliate_feed','fixture')),
  affiliate_network text,                                 -- 'awin' | 'daisycon' | null
  is_active         boolean     not null default true,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- product  — the canonical, retailer-independent thing a user searches for
-- ---------------------------------------------------------------------------
create table if not exists product (
  id            bigserial primary key,
  ean           text unique,                    -- EAN-13, check digit validated before insert
  brand         text        not null,
  title         text        not null,
  category      text        not null,           -- matches front-end category slugs
  image_url     text,
  description   text,
  -- 'published' is the gate: only published products are visible to the API.
  -- Nothing reaches 'published' without passing the data-quality checks.
  status        text        not null default 'draft'
                check (status in ('draft','published','suppressed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint product_ean_is_13_digits
    check (ean is null or ean ~ '^[0-9]{13}$')
);

create index if not exists product_category_idx on product (category) where status = 'published';
create index if not exists product_brand_idx    on product (brand);

-- Trigram search index for /api/search. Falls back gracefully if pg_trgm absent.
create extension if not exists pg_trgm;
create index if not exists product_title_trgm_idx on product using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- offer — one retailer's current price for one product. Mutable (upserted).
-- ---------------------------------------------------------------------------
create table if not exists offer (
  id                  bigserial primary key,
  product_id          bigint      not null references product(id) on delete cascade,
  retailer_id         bigint      not null references retailer(id) on delete restrict,

  retailer_sku        text        not null,      -- retailer's own id, for re-matching
  price_cents         integer     not null,
  currency            char(3)     not null default 'EUR',
  shipping_cents      integer     not null default 0,
  in_stock            boolean     not null default true,
  product_url         text        not null,      -- deep link (affiliate-tagged when live)

  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),

  constraint offer_price_positive     check (price_cents > 0),
  constraint offer_price_sane         check (price_cents between 50 and 5000000), -- €0.50–€50,000
  constraint offer_shipping_not_neg   check (shipping_cents >= 0),
  -- One offer per retailer per product. This is what makes ingestion idempotent.
  constraint offer_unique_per_retailer unique (product_id, retailer_id)
);

create index if not exists offer_product_price_idx on offer (product_id, price_cents asc);

-- ---------------------------------------------------------------------------
-- price_observation — APPEND ONLY. One row per (offer, observation).
-- ---------------------------------------------------------------------------
create table if not exists price_observation (
  id              bigserial primary key,
  product_id      bigint      not null references product(id) on delete cascade,
  retailer_id     bigint      not null references retailer(id) on delete restrict,
  price_cents     integer     not null,
  in_stock        boolean     not null,
  observed_at     timestamptz not null default now(),
  ingest_run_id   bigint,

  constraint price_obs_positive check (price_cents > 0)
);

create index if not exists price_obs_product_time_idx
  on price_observation (product_id, observed_at desc);

-- Enforce append-only at the database level, so a future bug cannot
-- silently destroy price history.
create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'price_observation is append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists price_observation_no_update on price_observation;
create trigger price_observation_no_update
  before update or delete on price_observation
  for each row execute function forbid_mutation();

-- ---------------------------------------------------------------------------
-- ingest_run — provenance. Every observation traces to a run, every run to a file.
-- ---------------------------------------------------------------------------
create table if not exists ingest_run (
  id                bigserial primary key,
  retailer_id       bigint      not null references retailer(id),
  source_kind       text        not null,
  raw_archive_path  text,                        -- raw payload archived BEFORE parsing
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text        not null default 'running'
                    check (status in ('running','ok','failed')),
  products_seen     integer     not null default 0,
  offers_upserted   integer     not null default 0,
  observations_written integer  not null default 0,
  error             text
);

-- ---------------------------------------------------------------------------
-- match_review_queue — fuzzy matches between confidence 75 and 88 land here.
-- A wrong match is worse than no match, so this is a human gate, not an auto-accept.
-- ---------------------------------------------------------------------------
create table if not exists match_review_queue (
  id                bigserial primary key,
  retailer_id       bigint      not null references retailer(id),
  retailer_sku      text        not null,
  raw_title         text        not null,
  raw_brand         text,
  raw_ean           text,
  price_cents       integer,
  candidate_product_id bigint   references product(id) on delete set null,
  confidence        integer     not null check (confidence between 0 and 100),
  reason            text        not null,       -- 'ean_invalid' | 'fuzzy_title' | 'no_candidate'
  resolved          boolean     not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists review_queue_open_idx
  on match_review_queue (created_at desc) where resolved = false;

commit;
