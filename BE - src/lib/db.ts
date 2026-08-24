import postgres from 'postgres';

/**
 * One connection pool for the whole process.
 *
 * Supabase connection string: Project → Settings → Database → Connection string
 * → URI. Use the **Session pooler** (port 5432) for the ingestion job and the
 * **Transaction pooler** (port 6543) for the serverless app. Vercel functions
 * are short-lived and will exhaust direct connections otherwise.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and paste your Supabase connection string.'
  );
}

export const sql = postgres(url, {
  max: Number(process.env.PG_POOL_MAX ?? 5),
  idle_timeout: 20,
  // Supabase requires TLS. Local dev over a unix socket / localhost does not.
  ssl: url.includes('supabase.') ? 'require' : false,
  transform: { undefined: null },
});

export type Sql = typeof sql;
