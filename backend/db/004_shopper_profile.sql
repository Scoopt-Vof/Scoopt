-- Scoopt back end -- schema v4: cross-device shopper profile storage.
--
-- Today loadProfileAsync/saveProfile (frontend/lib/profile.ts) only read and
-- write the browser's localStorage, so a returning shopper on a new device
-- gets sent through the sign-up questionnaire again even though they already
-- answered it. This table is where their answers follow them.
--
-- One row per signed-in shopper, keyed by their Supabase auth user id. The
-- whole ShopperProfile (frontend/contract/types.ts) is stored as JSONB so the
-- shape can keep evolving without a migration each time -- the same pattern
-- the frontend already uses for the local copy.
--
-- Unlike the tables in 001/003, the front end talks to this table DIRECTLY
-- with the shopper's own session (not through the back end), so it needs
-- real RLS policies rather than "no policies = deny all": a signed-in
-- shopper may read and write ONLY their own row.
--
-- Safe to re-run.

begin;

create table if not exists shopper_profile (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  profile    jsonb not null,
  updated_at timestamptz not null default now()
  );

alter table shopper_profile enable row level security;

drop policy if exists "select own profile" on shopper_profile;
create policy "select own profile" on shopper_profile
for select using (auth.uid() = user_id);

drop policy if exists "insert own profile" on shopper_profile;
create policy "insert own profile" on shopper_profile
for insert with check (auth.uid() = user_id);

drop policy if exists "update own profile" on shopper_profile;
create policy "update own profile" on shopper_profile
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
