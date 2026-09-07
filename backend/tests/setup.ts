/**
 * Runs before any test file is imported (see vitest.config.ts setupFiles).
 *
 * The suite truncates every table, so it must never be handed the connection
 * string the application uses. Tests read TEST_DATABASE_URL instead, and this
 * file is the only place that value reaches src/lib/db.ts.
 */
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. The tests truncate every table, so they ' +
      'need their own throwaway database - never your live Supabase project.'
  );
}

if (testUrl === process.env.DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL must not point at the same database as DATABASE_URL.'
  );
}

// src/lib/db.ts reads DATABASE_URL, so point it at the test database here.
process.env.DATABASE_URL = testUrl;

// The suite ingests a test-only catalogue of invented products (sourceKind
// 'fixture'), which src/ingest/run.ts refuses by default. This is the ONLY
// place that override is set, and it applies only to TEST_DATABASE_URL.
process.env.ALLOW_SYNTHETIC_SOURCES = '1';
