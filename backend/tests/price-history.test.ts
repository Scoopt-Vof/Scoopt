import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../src/lib/db';
import { ingest, observationNeeded } from '../src/ingest/run';
import { getPriceHistory } from '../src/api/contract-queries';
import { TestCatalogueSource } from './helpers/test-source';

/**
 * Price history is written on CHANGE (db/015). These tests pin down that
 * nothing is lost: an unchanged price adds no rows but still shows as a flat
 * line, a changed price adds exactly one row per offer, and a gap (the offer
 * vanished and came back) is never drawn as a flat line.
 */

const shop = (factor = 1) => new TestCatalogueSource('historyshop', 'HistoryShop', 'https://historyshop.invalid', factor);
let productId: number;
let retailerId: number;

beforeAll(async () => {
  await sql`truncate price_observation, offer, match_review_queue, ingest_run, product, retailer restart identity cascade`;
  await ingest(shop());
  await sql`update product set status = 'published' where status = 'draft'`;
  [{ id: productId }] = await sql<{ id: number }[]>`select id from product order by id limit 1`;
  [{ id: retailerId }] = await sql<{ id: number }[]>`select id from retailer where slug = 'historyshop'`;
}, 30_000);

afterAll(async () => { await sql.end(); });

const rowsFor = async () =>
  (await sql<{ c: string }[]>`select count(*) as c from price_observation where product_id = ${productId}`)[0].c;

describe('observationNeeded()', () => {
  const prev = { price_cents: 1000, shipping_cents: 0, currency: 'EUR', in_stock: true, last_seen_at: new Date('2026-09-19T10:00:00Z') };
  const at = new Date('2026-09-19T11:00:00Z');
  it('writes the first observation of an offer', () => {
    expect(observationNeeded(undefined, 1000, 0, 'EUR', true, at)).toBe(true);
  });
  it('skips when nothing changed', () => {
    expect(observationNeeded(prev, 1000, 0, 'EUR', true, at)).toBe(false);
  });
  it('writes on a price, shipping, stock or currency change', () => {
    expect(observationNeeded(prev, 999, 0, 'EUR', true, at)).toBe(true);
    expect(observationNeeded(prev, 1000, 100, 'EUR', true, at)).toBe(true);
    expect(observationNeeded(prev, 1000, 0, 'EUR', false, at)).toBe(true);
    expect(observationNeeded(prev, 1000, 0, 'USD', true, at)).toBe(true);
  });
  it('writes after a gap longer than PRICE_GAP_HOURS, even if unchanged', () => {
    expect(observationNeeded(prev, 1000, 0, 'EUR', true, new Date('2026-09-21T10:00:00Z'))).toBe(true);
  });
});

describe('ingest writes history on change', () => {
  it('adds no rows when the price is unchanged', async () => {
    const before = await rowsFor();
    await ingest(shop());
    expect(await rowsFor()).toBe(before);
  });

  it('adds exactly one row per offer when the price changes, recording where the old period ended', async () => {
    const before = Number(await rowsFor());
    const [{ last_seen_at }] = await sql<{ last_seen_at: Date }[]>`
      select last_seen_at from offer where product_id = ${productId} and retailer_id = ${retailerId}`;
    await ingest(shop(0.9));
    expect(Number(await rowsFor())).toBe(before + 1);
    const [latest] = await sql<{ prev_seen_at: Date | null }[]>`
      select prev_seen_at from price_observation where product_id = ${productId}
       order by observed_at desc, id desc limit 1`;
    expect(latest.prev_seen_at?.getTime()).toBe(last_seen_at.getTime());
  });
});

describe('getPriceHistory() over periods', () => {
  it('draws one point per day across an unchanged period', async () => {
    // Rewrite this product's history as a single row 10 days ago, confirmed
    // until now. (The trigger forbids UPDATE/DELETE on price history, so the
    // test builds it from scratch in a fresh offer instead.)
    await sql`truncate price_observation`;
    await sql`insert into price_observation (product_id, retailer_id, price_cents, shipping_cents, currency, in_stock, observed_at)
              values (${productId}, ${retailerId}, 5000, 0, 'EUR', true, now() - interval '10 days')`;
    await sql`update offer set price_cents = 5000, shipping_cents = 0, last_seen_at = now()
               where product_id = ${productId} and retailer_id = ${retailerId}`;
    const h = await getPriceHistory(String(productId));
    expect(h!.points.length).toBeGreaterThanOrEqual(10);
    expect(h!.points.length).toBeLessThanOrEqual(11);
    expect(new Set(h!.points.map((p) => p.price))).toEqual(new Set([50]));
  });

  it('does not draw a gap as a flat line', async () => {
    // Seen 20→18 days ago at €50, then gone, back 3 days ago at the same price.
    await sql`truncate price_observation`;
    await sql`insert into price_observation (product_id, retailer_id, price_cents, shipping_cents, currency, in_stock, observed_at)
              values (${productId}, ${retailerId}, 5000, 0, 'EUR', true, now() - interval '20 days')`;
    await sql`insert into price_observation (product_id, retailer_id, price_cents, shipping_cents, currency, in_stock, observed_at, prev_seen_at)
              values (${productId}, ${retailerId}, 5000, 0, 'EUR', true, now() - interval '3 days', now() - interval '18 days')`;
    const h = await getPriceHistory(String(productId));
    const days = h!.points.map((p) => p.at.slice(0, 10));
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    expect(days).not.toContain(tenDaysAgo);
    expect(h!.points.length).toBeGreaterThanOrEqual(5);   // 20..18 days ago + 3 days ago..today
    expect(h!.points.length).toBeLessThanOrEqual(8);
  });
});

describe('classification audit on re-ingest', () => {
  it('writes no new audit rows when a product is re-ingested unchanged', async () => {
    const { createClassifier } = await import('../src/categorisation/index');
    const classifier = await createClassifier(sql);
    await ingest(shop(), { classifier });
    const [{ c: before }] = await sql<{ c: string }[]>`select count(*) as c from product_classification`;
    const s = await ingest(shop(), { classifier });
    const [{ c: after }] = await sql<{ c: string }[]>`select count(*) as c from product_classification`;
    expect(after).toBe(before);
    expect(s.classificationsUnchanged).toBe(s.offersUpserted);
  });
});
