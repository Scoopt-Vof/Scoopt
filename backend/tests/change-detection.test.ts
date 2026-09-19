import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../src/lib/db';
import { ingest, isUnchanged } from '../src/ingest/run';
import { tryStartJob, finishJob } from '../src/lib/job-state';
import { TestCatalogueSource } from './helpers/test-source';

/**
 * Hourly ingest only does work for rows that changed (see run.ts step 3), and
 * only tells the website about the products that changed.
 */

const shop = (factor = 1) => new TestCatalogueSource('changeshop', 'ChangeShop', 'https://changeshop.invalid', factor);

beforeAll(async () => {
  await sql`truncate price_observation, offer, match_review_queue, ingest_run, product, retailer, job_state restart identity cascade`;
  await ingest(shop());
}, 30_000);

afterAll(async () => { await sql.end(); });

describe('unchanged rows', () => {
  it('re-ingesting an identical feed changes nothing but last_seen_at', async () => {
    const [{ t: before }] = await sql<{ t: Date }[]>`select max(last_seen_at) as t from offer`;
    const s = await ingest(shop());
    expect(s.offersUpserted).toBe(0);
    expect(s.observationsWritten).toBe(0);
    expect(s.changedProductIds).toEqual([]);
    expect(s.offersUnchanged).toBeGreaterThan(0);
    const [{ t: after }] = await sql<{ t: Date }[]>`select min(last_seen_at) as t from offer`;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('a price change marks exactly the changed products', async () => {
    const s = await ingest(shop(0.95));
    expect(s.offersUnchanged).toBe(0);
    expect(s.changedProductIds.length).toBeGreaterThan(0);
    const [{ c }] = await sql<{ c: string }[]>`select count(distinct product_id) as c from offer`;
    // internal ids (+ contract ids where the fixture has them)
    expect(s.changedProductIds.length).toBeGreaterThanOrEqual(Number(c));
  });
});

describe('isUnchanged()', () => {
  const k = {
    retailer_sku: 'X', product_url: 'https://s.invalid/p', price_cents: 1000, shipping_cents: 0,
    currency: 'EUR', in_stock: true, last_seen_at: new Date('2026-09-19T10:00:00Z'), ean: '0001000000007',
  };
  const raw = {
    retailerSku: 'X', ean: '0001000000007', brand: 'B', title: 'T', category: 'sport',
    priceCents: 1000, shippingCents: 0, currency: 'EUR', inStock: true, productUrl: 'https://s.invalid/p',
  } as any;
  const at = new Date('2026-09-19T11:00:00Z');
  it('is true for an identical row', () => expect(isUnchanged(k, raw, at)).toBe(true));
  it('is false when the link changed', () => expect(isUnchanged(k, { ...raw, productUrl: 'https://s.invalid/q' }, at)).toBe(false));
  it('is false when the EAN moved', () => expect(isUnchanged(k, { ...raw, ean: '0001000000014' }, at)).toBe(false));
  it('is false for an invalid row (it must reach the review queue)', () => expect(isUnchanged(k, { ...raw, title: '' }, at)).toBe(false));
});

describe('job state', () => {
  it('refuses to start a second run while one is running', async () => {
    expect(await tryStartJob('t')).toBe(true);
    expect(await tryStartJob('t')).toBe(false);
    await finishJob('t', true);
    expect(await tryStartJob('t')).toBe(true);
    await finishJob('t', true);
  });

  it('ignores a stale running mark from a crashed run', async () => {
    await sql`update job_state set running_since = now() - interval '2 hours' where job = 't'`;
    expect(await tryStartJob('t')).toBe(true);
    await finishJob('t', true);
  });

  it('counts consecutive failures and resets on success', async () => {
    await tryStartJob('t');
    expect(await finishJob('t', false, 'x')).toBe(1);
    await tryStartJob('t');
    expect(await finishJob('t', false, 'y')).toBe(2);
    await tryStartJob('t');
    expect(await finishJob('t', true)).toBe(0);
  });
});
