/**
 * Applies db/*.sql files in filename order, each one ONCE.
 *
 * Applied files are recorded in schema_migrations. Previously every run
 * re-executed every file, including data-changing UPDATEs, which only worked
 * as long as every file stayed perfectly idempotent forever.
 *
 * Bootstrapping an existing database: the first time this runs against a
 * database that has no schema_migrations table, it applies every file exactly
 * as the old script did (they were all written to be re-runnable) and records
 * them. From then on only new files run.
 *
 * Each file manages its own begin/commit, so files are executed as written and
 * recorded only after they succeed. A failing file stops the run and is NOT
 * recorded, so fixing it and re-running picks up where it stopped.
 *
 *   npm run db:migrate            apply pending files
 *   npm run db:migrate -- --list  show applied / pending without changing anything
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set — copy .env.example to .env'); process.exit(1); }

const listOnly = process.argv.includes('--list');
const sql = postgres(url, {
  ssl: url.includes('supabase.') ? 'require' : false,
  max: 1,
  onnotice: (n) => console.log(`\n  notice: ${n.message}`),
});
const dir = fileURLToPath(new URL('../db/', import.meta.url));

try {
  // --list must be read-only: never create the tracking table just to look.
  const [{ exists }] = await sql`select to_regclass('public.schema_migrations') is not null as exists`;
  if (!exists && !listOnly) {
    await sql`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )`;
    // Internal bookkeeping — keep it off Supabase's public API like everything else.
    await sql`alter table schema_migrations enable row level security`;
  }

  const applied = exists || !listOnly
    ? new Set((await sql`select filename from schema_migrations`).map((r) => r.filename))
    : new Set();
  if (listOnly && !exists) {
    console.log('(no schema_migrations table yet — the first real run applies every file once and records them)');
  }
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));

  if (listOnly) {
    for (const f of files) console.log(`${applied.has(f) ? 'applied' : 'pending'}  ${f}`);
  } else if (pending.length === 0) {
    console.log('schema up to date — nothing to apply');
  } else {
    for (const file of pending) {
      process.stdout.write(`applying ${file} ... `);
      await sql.unsafe(await readFile(dir + file, 'utf8'));
      await sql`insert into schema_migrations (filename) values (${file}) on conflict do nothing`;
      console.log('ok');
    }
    console.log(`schema up to date — applied ${pending.length} file(s)`);
  }
} catch (err) {
  console.error('\nmigration failed:', err.message ?? err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
