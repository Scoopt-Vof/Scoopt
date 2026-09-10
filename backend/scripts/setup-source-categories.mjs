/**
 * WIRE UP SOURCE-DRIVEN CATEGORISATION — the whole thing, one command.
 *
 *   npm run categorise:setup                 against .env
 *   node --env-file=.env.prod scripts/setup-source-categories.mjs
 *   node --env-file=.env.prod scripts/setup-source-categories.mjs --dry-run
 *
 * Runs the five steps in the only order that works, stops at the first
 * failure, and finishes by telling you the number that actually matters: how
 * many products were placed by a SOURCE'S OWN TAXONOMY versus by a keyword.
 *
 *   1. migrate            — 010 adds the table that stores each source's own
 *                           category id on the product. Without it, refining a
 *                           mapping can never move anything.
 *   2. import ebay tree   — ~19,000 nodes WITH parent links, so the resolver
 *                           can walk up. Mapping one node covers every leaf
 *                           beneath it, forever. This is why it converges.
 *   3. backfill signals   — existing products never recorded a category id.
 *                           offer.retailer_sku is eBay's itemId, so one call
 *                           per product recovers it. Costs API quota.
 *   4. propose mappings   — drafts them by matching eBay's own category names
 *                           against your tree. You review; you don't author.
 *   5. re-classify        — from the STORED signals. No re-fetch. Publication
 *                           status is left alone (--keep-published).
 *
 * Every step is safe to re-run. Nothing here unpublishes a product.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Read the --env-file paths back out of node's own runtime flags and parse
 * them ourselves.
 *
 * Why: `node --env-file=x script.mjs` loads the file into THIS process, and
 * child processes are supposed to inherit it. On Windows, spawning through a
 * shell (needed to resolve `npx`) does not reliably carry those values into
 * the child — the parent had EBAY_CLIENT_ID and every child insisted it was
 * unset. Rather than debug the shell, pass an explicit environment object.
 */
function envFromFlags() {
  const merged = {};
  for (const flag of process.execArgv) {
    const m = /^--env-file(?:=(.*))?$/.exec(flag);
    if (!m || !m[1]) continue;
    let text;
    try {
      text = readFileSync(m[1], 'utf8');
    } catch {
      continue; // node would already have complained about a missing file
    }
    // Deliberately minimal: KEY=VALUE, one per line, # for comments, optional
    // surrounding quotes. Anything fancier belongs in a real env parser, and
    // node has already applied one to this process.
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // An EMPTY value never wins. A later file saying `EBAY_CLIENT_ID=` with
      // nothing after it must not wipe out a real value an earlier file set —
      // that reads as "unset" everywhere downstream and is near-impossible to
      // spot, because the KEY is still there when you list them.
      if (val === '') continue;
      merged[key] = val;      // later files win, matching node's own behaviour
    }
  }
  return merged;
}

// process.env first, then anything the env files said — so an explicitly
// exported shell variable does not silently beat the file you passed.
const CHILD_ENV = { ...process.env, ...envFromFlags() };

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const flagValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const limit = flagValue('--limit', '200');
const marketplace = flagValue('--marketplace', 'EBAY_NL');

if (!CHILD_ENV.DATABASE_URL) {
  console.error(
    '\nDATABASE_URL is not set.\n' +
    'Run this with an env file, e.g.:\n' +
    '  node --env-file=.env.prod scripts/setup-source-categories.mjs\n'
  );
  process.exit(1);
}

const steps = [
  {
    title: 'Apply migrations (010 stores each source\'s category on the product)',
    cmd: 'node', argv: ['scripts/migrate.mjs'],
  },
  {
    title: `Import eBay's category tree (${marketplace})`,
    cmd: 'npx', argv: ['tsx', 'scripts/import-source-categories.ts', 'ebay', '--marketplace', marketplace],
  },
  {
    title: `Recover the eBay category for existing products (limit ${limit})`,
    cmd: 'npx', argv: ['tsx', 'scripts/backfill-source-categories.ts', '--limit', limit,
                       ...(dryRun ? ['--dry-run'] : [])],
  },
  {
    title: 'Draft mappings from their category names onto your tree',
    cmd: 'npx', argv: ['tsx', 'scripts/propose-source-mappings.ts', 'ebay',
                       ...(dryRun ? ['--dry-run'] : [])],
  },
  {
    title: 'Re-classify from the stored signals',
    cmd: 'npx', argv: ['tsx', 'scripts/backfill-categories.ts', '--force', '--keep-published',
                       ...(dryRun ? ['--dry-run'] : [])],
  },
];

const line = (s = '') => console.log(s);
line();
line('='.repeat(72));
line(`  SOURCE-DRIVEN CATEGORISATION SETUP${dryRun ? '  (DRY RUN)' : ''}`);
line('='.repeat(72));

// Say up front what will be handed to the children, by NAME only. A missing
// credential should be obvious in the first two lines, not in step 3 of 5.
const needed = ['DATABASE_URL', 'EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET'];
const missing = needed.filter((k) => !CHILD_ENV[k]);
const blank = needed.filter((k) => k in CHILD_ENV && CHILD_ENV[k] === '');
line();
line(`  env: ${needed.filter((k) => CHILD_ENV[k]).join(', ') || '(nothing)'}`);
// Name the host too. A stray DATABASE_URL in the shell is invisible otherwise,
// and every step below would run happily against the wrong database.
try {
  const u = new URL(CHILD_ENV.DATABASE_URL);
  line(`  db:  ${decodeURIComponent(u.username)}@${u.hostname}:${u.port || '5432'}${u.pathname}`);
} catch { line('  db:  (unparseable DATABASE_URL)'); }
if (missing.length > 0) {
  line();
  line(`  MISSING: ${missing.join(', ')}`);
  if (blank.length > 0) {
    line();
    line(`  (${blank.join(', ')} exists but is BLANK — a "KEY=" line with no`);
    line('   value. That is why it looks present in a key listing and still');
    line('   reads as unset. Delete that line from the file that has it.)');
  }
  line();
  line('  Pass every file that holds them, in order — later files win:');
  line('    node --env-file=.env --env-file=.env.prod scripts/setup-source-categories.mjs');
  line();
  process.exit(1);
}

for (const [i, step] of steps.entries()) {
  line();
  line(`--- step ${i + 1} of ${steps.length}: ${step.title}`);
  line();

  const res = spawnSync(step.cmd, step.argv, {
    stdio: 'inherit',
    // Windows needs a shell to resolve npx; harmless elsewhere.
    shell: process.platform === 'win32',
    env: CHILD_ENV,
  });

  if (res.status !== 0) {
    line();
    line(`Step ${i + 1} failed (exit ${res.status}). Stopping here rather than`);
    line('running the rest on top of a half-finished state.');
    line();
    line('Everything before this step is already applied and safe to re-run,');
    line('so fix the error above and run this same command again.');
    line();
    process.exit(res.status ?? 1);
  }
}

line();
line('='.repeat(72));
line('  DONE');
line('='.repeat(72));
line();
line('Look at the "placed N by source, M by rule" line above.');
line('  * by source  — eBay\'s own taxonomy decided it. Scales; never needs a keyword.');
line('  * by rule    — a keyword decided it. The fallback, for what the map misses.');
line();
line('The unreviewed mappings are the only thing left to look at:');
line();
line("  select m.external_key, m.external_label, c.path, m.confidence");
line('    from source_category_map m join category c on c.id = m.category_id');
line("   where m.reviewed_by = 'auto' order by m.confidence;");
line();
line('Correct any that are wrong (just change category_id), then re-run this');
line('command. Every product under that mapping moves. No re-fetch, no re-ingest.');
line();
