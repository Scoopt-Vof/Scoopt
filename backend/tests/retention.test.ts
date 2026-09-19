import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../src/lib/db';
import { ingest } from '../src/ingest/run';
import { runRetention, maybeRunRetention } from '../src/jobs/retention';
import { getPriceHistory } from '../src/api/contract-queries';
import { TestCatalogueSource } from './helpers/test-source';

/**
 * db/017 + src/jobs/retention.ts: no price history for sources that may not
 * keep it (eBay), 90 days of classification audit, and the append-only rule
 * still holding for everything else.
 */

class NoHistoryShop extends TestCatalogueSource {
  readonly keepsPriceHistory = false;
}
const historyShop = () => new TestCatalogueSource('keepshop', 'KeepShop', 'https://keepshop.invalid', 1);
const noHistoryShop = () => new NoHistoryShop('nohistshop', 'NoHistShop', 'https://nohistshop.invalid', 0.9);

let productId: number;
let noHistId: number;

beforeAll(async () => {
  await sql`truncate price_observation, product_classification, offer, match_review_queue, ingest_run, product, retailer, job_state restart identity cascade`;
  await ingest(historyShop());
  await ingest(noHistoryShop());
  await sql`update product set status = 'published' where status = 'draft'`;
  [{ id: productId }] = await sql<{ id: number }[]>`select id from product order by id limit 1`;
  [{ id: noHistId }] = await sql<{ id: number }[]>`select id from retailer where slug = 'nohistshop'`;
}, 30_000);

afterAll(async () => { await sql.end(); });

describe('sources without price history (eBay)', () => {
  it('get an offer but no history rows', async () => {
    const [{ c: offers }] = await sql<{ c: string }[]>`select count(*) as c from offer where retailer_id = ${noHistId}`;
    const [{ c: rows }] = await sql<{ c: string }[]>`select count(*) as c from price_observation where retailer_id = ${noHistId}`;
    expect(Number(offers)).toBeGreaterThan(0);
    expect(Number(rows)).toBe(0);
  });

  it('are ignored by the price-history API even if old rows exist', async () => {
    // A row from before the change: cheaper than anything the history shop has.
    await sql`insert into price_observation (product_id, retailer_id, price_cents, shipping_cents, currency, in_stock, observed_at)
              values (${productId}, ${noHistId}, 60, 0, 'EUR', true, now() - interval '5 days')`;
    const h = await getPriceHistory(String(productId));
    expect(h!.points.every((p) => p.store !== 'nohistshop')).toBe(true);
  });

  it('have old rows deleted by retention', async () => {
    const r = await runRetention();
    expect(r.priceRowsDeleted).toBe(1);
    const [{ c }] = await sql<{ c: string }[]>`select count(*) as c from price_observation where retailer_id = ${noHistId}`;
    expect(Number(c)).toBe(0);
    // Sources that keep history are untouched.
    const [{ c: kept }] = await sql<{ c: string }[]>`select count(*) as c from price_observation`;
    expect(Number(kept)).toBeGreaterThan(0);
  });
});

describe('classification audit retention', () => {
  it('drops rows older than 90 days except the newest per product', async () => {
    const ins = (days: number) => sql`
      insert into product_classification (product_id, stage, confidence, created_at)
      values (${productId}, 'rule', 0.9, now() - make_interval(days => ${days}::int))`;
    const other = (await sql<{ id: number }[]>`select id from product where id <> ${productId} order by id limit 1`)[0].id;
    await ins(200); await ins(120); await ins(10);          // product A: 2 old + 1 recent
    await sql`insert into product_classification (product_id, stage, confidence, created_at)
              values (${other}, 'rule', 0.9, now() - interval '300 days')`;   // product B: only an old row

    const r = await runRetention();
    expect(r.auditRowsDeleted).toBe(2);
    const [{ c: a }] = await sql<{ c: string }[]>`select count(*) as c from product_classification where product_id = ${productId}`;
    const [{ c: b }] = await sql<{ c: string }[]>`select count(*) as c from product_classification where product_id = ${other}`;
    expect(Number(a)).toBe(1);
    expect(Number(b)).toBe(1);
  });
});

describe('append-only still holds outside retention', () => {
  it('refuses UPDATE and plain DELETE', async () => {
    await expect(sql`update price_observation set price_cents = 1 where id = (select min(id) from price_observation)`)
      .rejects.toThrow(/append-only/);
    await expect(sql`delete from price_observation where id = (select min(id) from price_observation)`)
      .rejects.toThrow(/append-only/);
    await expect(sql`delete from product_classification where id = (select min(id) from product_classification)`)
      .rejects.toThrow(/append-only/);
  });

  it('refuses UPDATE even inside a retention transaction', async () => {
    await expect(sql.begin(async (tx) => {
      await tx`set local scoopt.retention = 'on'`;
      await tx`update price_observation set price_cents = 1 where id = (select min(id) from price_observation)`;
    })).rejects.toThrow(/append-only/);
  });
});

describe('daily scheduling from the hourly ingest', () => {
  it('runs once, then not again within the day', async () => {
    await sql`delete from job_state where job = 'retention'`;
    expect(await maybeRunRetention()).toBeNull();
    const [row] = await sql<{ last_success_at: Date | null }[]>`select last_success_at from job_state where job = 'retention'`;
    expect(row.last_success_at).not.toBeNull();
    await maybeRunRetention();
    const [again] = await sql<{ last_success_at: Date | null }[]>`select last_success_at from job_state where job = 'retention'`;
    expect(again.last_success_at!.getTime()).toBe(row.last_success_at!.getTime());
  });
});
