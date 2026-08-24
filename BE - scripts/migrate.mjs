/** Applies every db/*.sql file in order. Safe to re-run — all statements are idempotent. */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set — copy .env.example to .env'); process.exit(1); }

const sql = postgres(url, { ssl: url.includes('supabase.') ? 'require' : false, max: 1 });
const dir = fileURLToPath(new URL('../db/', import.meta.url));

for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  process.stdout.write(`applying ${file} ... `);
  await sql.unsafe(await readFile(dir + file, 'utf8'));
  console.log('ok');
}
await sql.end();
console.log('schema up to date');
