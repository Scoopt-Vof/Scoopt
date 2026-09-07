import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../src/lib/db';
import { ingest } from '../src/ingest/run';
import { TestCatalogueSource } from './helpers/test-source';
import { productHandler, searchHandler, priceHistoryHandler, trackHandler } from '../src/api/handlers';
import { ProductWithOffersSchema, ProductSchema, PriceHistorySchema } from '../src/contract/schemas';

/**
 * Integration tests. These call the route handlers directly as
 * `Request → Response` functions — no browser, no running server, no front end.
 *
 * Requires DATABASE_URL pointing at a database you don't mind truncating.
 */

let anyProductId: string;

beforeAll(async () => {
  await sql`truncate price_observation, offer, match_review_queue, ingest_run, product, retailer restart identity cascade`;
  const summary = await ingest(new TestCatalogueSource());
  expect(summary.offersUpserted).toBeGreaterThan(0);

  const [row] = await sql<{ id: number }[]>`select id from product order by id limit 1`;
  anyProductId = String(row.id);
}, 30_000);

afterAll(async () => { await sql.end(); });

describe('GET /api/product/:id', () => {
  it('returns a contract-valid ProductWithOffers', async () => {
    const res = await productHandler(new Request('http://x/api/product/' + anyProductId), anyProductId);
    expect(res.status).toBe(200);
    const parsed = ProductWithOffersSchema.safeParse(await res.json());
    if (!parsed.success) console.error(parsed.error.format());
    expect(parsed.success).toBe(true);
  });

  it('404s for a product that does not exist', async () => {
    const res = await productHandler(new Request('http://x/api/product/999999'), '999999');
    expect(res.status).toBe(404);
  });

  it('404s rather than 500s on a non-numeric id', async () => {
    const res = await productHandler(new Request('http://x/api/product/abc'), 'abc');
    expect(res.status).toBe(404);
  });

  it('404s on a SQL-injection attempt', async () => {
    const nasty = "1; drop table product;--";
    const res = await productHandler(new Request('http://x/api/product/x'), nasty);
    expect(res.status).toBe(404);
    const [{ count }] = await sql<{ count: string }[]>`select count(*) from product`;
    expect(Number(count)).toBeGreaterThan(0); // table still there
  });
});

describe('GET /api/search', () => {
  it('finds products by brand', async () => {
    const res = await searchHandler(new Request('http://x/api/search?q=Testmerk'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    expect(ProductSchema.array().safeParse(body).success).toBe(true);
  });

  it('400s on a too-short query instead of scanning the table', async () => {
    expect((await searchHandler(new Request('http://x/api/search?q=a'))).status).toBe(400);
    expect((await searchHandler(new Request('http://x/api/search'))).status).toBe(400);
  });

  it('returns an empty array, not an error, for no matches', async () => {
    const res = await searchHandler(new Request('http://x/api/search?q=zzzznotathing'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe('GET /api/price-history/:id', () => {
  it('satisfies min30 <= currentMin <= max30 after repeated ingests', async () => {
    await ingest(new TestCatalogueSource());
    await ingest(new TestCatalogueSource());

    const res = await priceHistoryHandler(new Request('http://x/'), anyProductId);
    expect(res.status).toBe(200);
    const parsed = PriceHistorySchema.safeParse(await res.json());
    if (!parsed.success) console.error(parsed.error.format());
    expect(parsed.success).toBe(true);
  });
});

describe('POST /api/track', () => {
  it('accepts and drops', async () => {
    const res = await trackHandler(new Request('http://x/api/track', {
      method: 'POST', body: JSON.stringify({ event: 'view', productId: anyProductId }),
    }));
    expect(await res.json()).toEqual({ ok: true });
  });

  it('400s on a non-JSON body', async () => {
    const res = await trackHandler(new Request('http://x/api/track', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });
});

describe('ingestion behaviour', () => {
  it('is idempotent — re-running does not duplicate offers', async () => {
    const [before] = await sql<{ c: string }[]>`select count(*) as c from offer`;
    await ingest(new TestCatalogueSource());
    const [after] = await sql<{ c: string }[]>`select count(*) as c from offer`;
    expect(after.c).toBe(before.c);
  });

  it('appends a price observation on every run, even when the price is unchanged', async () => {
    const [before] = await sql<{ c: string }[]>`select count(*) as c from price_observation`;
    await ingest(new TestCatalogueSource());
    const [after] = await sql<{ c: string }[]>`select count(*) as c from price_observation`;
    expect(Number(after.c)).toBeGreaterThan(Number(before.c));
  });

  it('refuses to let price history be rewritten', async () => {
    await expect(
      sql`update price_observation set price_cents = 1 where id = (select min(id) from price_observation)`
    ).rejects.toThrow(/append-only/);
  });

  it('archives the raw payload before parsing', async () => {
    const [run] = await sql<any[]>`select raw_archive_path, status from ingest_run order by id desc limit 1`;
    expect(run.status).toBe('ok');
    expect(run.raw_archive_path).toBeTruthy();
  });

  it('sends junk EANs to the review queue instead of matching them', async () => {
    const junkPath = '/tmp/scoopt-junk-fixture.json';
    const { writeFile } = await import('node:fs/promises');
    await writeFile(junkPath, JSON.stringify({ products: [{
      retailerSku: 'JUNK-1', ean: 'N/A', brand: 'Testmerk', title: 'Broken row',
      category: 'hardlopen', priceCents: 1999, inStock: true,
      productUrl: 'https://retailer.invalid/p/x',
    }] }));

    const before = await sql<any[]>`select count(*) as c from match_review_queue`;
    await ingest(new TestCatalogueSource('testshop', 'TestShop', 'https://testshop.invalid', 1, junkPath));
    const after = await sql<any[]>`select count(*) as c from match_review_queue`;
    expect(Number(after[0].c)).toBe(Number(before[0].c) + 1);

    const [queued] = await sql<any[]>`select reason from match_review_queue order by id desc limit 1`;
    expect(queued.reason).toBe('ean_invalid');
  });
});

describe('data-quality checks (the ones that catch a quietly wrong price)', () => {
  it('has no published product with zero offers', async () => {
    const rows = await sql<any[]>`
      select p.id from product p
      left join offer o on o.product_id = p.id
      where p.status = 'published' and o.id is null`;
    expect(rows).toEqual([]);
  });

  it('has no price outside €0.50–€50,000', async () => {
    const rows = await sql<any[]>`
      select id, price_cents from offer where price_cents < 50 or price_cents > 5000000`;
    expect(rows).toEqual([]);
  });

  it('has no duplicate EAN', async () => {
    const rows = await sql<any[]>`
      select ean from product where ean is not null group by ean having count(*) > 1`;
    expect(rows).toEqual([]);
  });

  it('has no unexplained price jump over 60%', async () => {
    const rows = await sql<any[]>`
      with seq as (
        select product_id, price_cents,
               lag(price_cents) over (partition by product_id order by observed_at) as prev
          from price_observation)
      select * from seq
       where prev is not null
         and abs(price_cents - prev)::numeric / prev > 0.60`;
    expect(rows).toEqual([]);
  });
});
