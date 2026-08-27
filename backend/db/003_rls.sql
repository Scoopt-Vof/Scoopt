-- Scoopt back end - schema v3: lock the tables against Supabase's public API.
--
-- Supabase serves every table in the `public` schema over PostgREST, reachable
-- by anyone holding the anon key - and the anon key ships inside the front-end
-- bundle, so it is public by design. Without row level security that makes the
-- whole catalogue, every price observation and the review queue world-readable
-- and world-writable.
--
-- Enabling RLS with NO policies attached denies all access through that route.
-- The back end is unaffected: it connects over plain Postgres as the table
-- owner, and the owner bypasses row level security.
--
-- If the front end ever needs to read Supabase directly instead of going
-- through the API, add explicit read-only policies here. Do not turn RLS off.
--
-- Safe to re-run.

begin;

alter table retailer            enable row level security;
alter table product             enable row level security;
alter table offer               enable row level security;
alter table price_observation   enable row level security;
alter table ingest_run          enable row level security;
alter table match_review_queue  enable row level security;

commit;
