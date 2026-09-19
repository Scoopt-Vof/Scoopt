/**
 * Tells the website (Vercel) to throw away its cached catalogue.
 *
 * The frontend caches products, categories and prices so visitors don't wait
 * on the database. That cache must be cleared whenever the data changes, or
 * the site would show old prices. The data only changes when ingest runs, so
 * ingest calls this at the end of every run.
 *
 * Needs two env vars (set on the Railway service that runs ingest):
 *   SITE_URL           e.g. https://scoopt.nl
 *   REVALIDATE_SECRET  the same value as REVALIDATE_SECRET in Vercel
 *
 * Never throws: a failed cache clear must not fail an ingest run that has
 * already written good data. It logs loudly instead and returns false; the
 * site's 1-hour backstop then refreshes the cache anyway.
 */
export async function clearSiteCache(reason: string): Promise<boolean> {
  const site = process.env.SITE_URL?.replace(/\/$/, '');
  const secret = process.env.REVALIDATE_SECRET;
  if (!site || !secret) {
    console.warn(
      `⚠ site cache NOT cleared (${reason}): SITE_URL and REVALIDATE_SECRET must both be set. ` +
        'The site will pick up the new data within 1 hour instead of right away.'
    );
    return false;
  }

  try {
    const res = await fetch(`${site}/api/revalidate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`✗ site cache clear failed (${reason}): ${site} answered ${res.status}`);
      return false;
    }
    console.log(`✓ site cache cleared (${reason}) on ${site}`);
    return true;
  } catch (e) {
    console.error(`✗ site cache clear failed (${reason}): ${String(e).split('\n')[0]}`);
    return false;
  }
}
