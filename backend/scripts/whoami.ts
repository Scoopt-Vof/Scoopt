/**
 * DIAGNOSTIC — what does this connection actually see?
 *
 * Not part of the pipeline. It answers one question: when a script connects
 * with DATABASE_URL, which database, which role, and which schema does it
 * land in, and how many rows can it read from there?
 *
 *   npx tsx --env-file=.env.prod scripts/whoami.ts
 *
 * Reads only. Writes nothing.
 */
import { sql } from '../src/lib/db';

async function main() {
  const [who] = await sql<Record<string, string>[]>`
    select current_user, session_user, current_database() as database,
           current_schema() as schema, current_setting('search_path') as search_path,
           inet_server_addr()::text as server`;
  console.log('\n--- connection');
  console.log(who);

  const [where] = await sql<Record<string, string>[]>`
    select (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where c.oid = 'product'::regclass)  as product_resolves_to,
           (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where c.oid = 'category'::regclass) as category_resolves_to`;
  console.log('\n--- which schema do the unqualified names resolve to');
  console.log(where);

  const [counts] = await sql<Record<string, string>[]>`
    select (select count(*) from product)              as product,
           (select count(*) from public.product)       as public_product,
           (select count(*) from category)             as category,
           (select count(*) from offer)                as offer,
           (select count(*) from product_category)     as product_category`;
  console.log('\n--- row counts through THIS connection');
  console.log(counts);

  const rows = await sql<Record<string, unknown>[]>`
    select p.id, p.status, left(p.title, 40) as title
      from product p
     where p.status <> 'suppressed'
     order by p.updated_at asc
     limit 3`;
  console.log(`\n--- sample of the exact rows backfill looks for: ${rows.length} row(s)`);
  for (const r of rows) console.log(r);
  console.log();
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('\nwhoami failed:', String(err).split('\n')[0]);
    await sql.end();
    process.exit(1);
  });
