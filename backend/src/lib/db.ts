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

/**
 * A one-line, safe description of where DATABASE_URL actually points.
 *
 * Every script prints this before doing anything. An afternoon was once lost
 * to a stray DATABASE_URL left in the shell silently beating --env-file:
 * node's --env-file does NOT override a variable that is already set, so the
 * scripts connected happily, ran to completion, and reported zero rows — which
 * is indistinguishable from an empty catalogue. Naming the host removes that
 * whole class of ambiguity for the price of one line of output.
 *
 * The password is never included.
 */
export function connectionLabel(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return '(DATABASE_URL not set)';
  try {
    const u = new URL(raw);
    const db = u.pathname.replace(/^\//, '') || '(default)';
    return `${decodeURIComponent(u.username)}@${u.hostname}:${u.port || '5432'}/${db}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}
