/**
 * Nightly refresh — clears the website's cache and redeploys it at 03:00
 * Amsterdam time.
 *
 * Runs as its own Railway cron service (see docs/caching-and-nightly-refresh.md).
 * Railway cron schedules are in UTC and do not follow daylight saving, and
 * 03:00 in Amsterdam is 01:00 UTC in summer but 02:00 UTC in winter. So the
 * service is scheduled for BOTH (`0 1,2 * * *`) and this script only does the
 * work on the run where it is actually 03:00 in Amsterdam; the other run
 * exits straight away. Set FORCE_REFRESH=1 to run it at any hour (for testing).
 *
 * Steps:
 *   1. Clear the site's catalogue cache (same call ingest makes).
 *   2. Trigger a fresh production deployment of the site via a Vercel Deploy
 *      Hook (VERCEL_DEPLOY_HOOK_URL). A deployment rebuilds the site from the
 *      current `main` branch and starts with an empty cache.
 *
 * Env: SITE_URL, REVALIDATE_SECRET, VERCEL_DEPLOY_HOOK_URL, optional FORCE_REFRESH.
 */
import { clearSiteCache } from '../lib/site-cache';

export function amsterdamHour(now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return Number(h);
}

export function shouldRunNow(now: Date = new Date(), force = false): boolean {
  return force || amsterdamHour(now) === 3;
}

async function triggerRedeploy(): Promise<boolean> {
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hook) {
    console.error('✗ redeploy skipped: VERCEL_DEPLOY_HOOK_URL is not set.');
    return false;
  }
  try {
    const res = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.error(`✗ redeploy failed: Vercel answered ${res.status}`);
      return false;
    }
    console.log('✓ redeploy triggered — Vercel is building a fresh production deployment.');
    return true;
  } catch (e) {
    console.error(`✗ redeploy failed: ${String(e).split('\n')[0]}`);
    return false;
  }
}

const isMain = process.argv[1]?.endsWith('nightly-refresh.ts') || process.argv[1]?.endsWith('nightly-refresh.js');
if (isMain) {
  (async () => {
    const now = new Date();
    const force = process.env.FORCE_REFRESH === '1';
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam', dateStyle: 'short', timeStyle: 'short',
    }).format(now);

    if (!shouldRunNow(now, force)) {
      console.log(`nightly refresh: it is ${local} in Amsterdam, not 03:xx — nothing to do on this run.`);
      return;
    }

    console.log(`nightly refresh starting (${local} Amsterdam${force ? ', forced' : ''})`);
    const cleared = await clearSiteCache('nightly refresh');
    const redeployed = await triggerRedeploy();
    if (!cleared || !redeployed) process.exit(1);
  })().catch((e) => {
    console.error('nightly refresh failed:', String(e));
    process.exit(1);
  });
}
