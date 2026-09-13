-- Scoopt back end — schema v11: close the RLS gap on the category tree.
--
-- 007_category_tree.sql created `category` and `tag` without enabling row
-- level security, unlike every other table (see 003_rls.sql for why that
-- matters). The Supabase anon key ships inside the front-end bundle, so without
-- RLS anyone could rename, deactivate or delete every category through
-- Supabase's public REST API and empty every category page on the site.
--
-- No policies are attached: nothing outside the back end reads these tables
-- directly, and the back end connects as the table owner, which bypasses RLS.
--
-- The loop at the end covers any *_legacy tables 009_sources.sql renamed
-- aside; they were created by an earlier design and may predate RLS too.
--
-- Safe to re-run.

begin;

alter table category enable row level security;
alter table tag      enable row level security;

do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname like '%\_legacy%' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'enabled row level security on legacy table %', t.relname;
  end loop;
end $$;

commit;
