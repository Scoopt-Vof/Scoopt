import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from '../src/lib/db';
import { ingest } from '../src/ingest/run';
import { TestCatalogueSource } from './helpers/test-source';
import {
  productHandler, searchHandler, priceHistoryHandler, trackHandler,
  basketPlanHandler, basketCompareHandler,
} from '../src/api/contract-handlers';
import { categoryProductsHandler } from '../src/api/catalog-handlers';
import { getDeliveryRules, personalise } from '../src/api/contract-queries';
import { HttpError } from '../src/api/respond';
import { ProductWithOffersSchema, ProductSchema, PriceHistorySchema } from '../src/contract/schemas';

/**
 * Integration tests for the endpoints the website actually calls
 * (src/api/contract-handlers.ts). They call the handlers directly as
 * `Request → Response` functions — no browser, no running server, no front end.
 *
 * Requires TEST_DATABASE_URL pointing at a database you don't mind truncating
 * (see tests/setup.ts).
 */

let anyProductId: string;

const post = (path: string, body: unknown) =>
  new Request(`http://x${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeAll(async () => {
  await sql`truncate price_observation, offer, match_review_queue, ingest_run, product, retailer restart identity cascade`;
  const summary = await ingest(new TestCatalogueSource());
  expect(summary.offersUpserted).toBeGreaterThan(0);

  // Products enter as 'draft' and are promoted by the classifier's publish
  // gate. These tests exercise the PRICE path with no classifier, so publish
  // them explicitly. Classification has its own suite in categorisation.test.ts.
  await sql`update product set status = 'published' where status = 'draft'`;

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

  it('hides offers that have not been seen recently', async () => {
    await sql`update offer set last_seen_at = now() - interval '30 days' where product_id = ${anyProductId}`;
    try {
      const body = await (await productHandler(new Request('http://x/'), anyProductId)).json();
      expect(body.offers).toEqual([]);
    } finally {
      await sql`update offer set last_seen_at = now() where product_id = ${anyProductId}`;
    }
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

  it('matches every word in any order', async () => {
    const body = await (await searchHandler(new Request('http://x/api/search?q=hardloopschoen%20testmerk'))).json();
    expect(body.length).toBeGreaterThan(0);
  });

  it('treats % and _ as literal characters, not wildcards', async () => {
    const body = await (await searchHandler(new Request('http://x/api/search?q=%25'))).json();
    expect(body).toEqual([]);
  });

  it('lists the catalogue for an empty query, paged', async () => {
    const body = await (await searchHandler(new Request('http://x/api/search?limit=2'))).json();
    expect(body).toHaveLength(2);
    const next = await (await searchHandler(new Request('http://x/api/search?limit=2&offset=2'))).json();
    expect(next[0].id).not.toBe(body[0].id);
  });

  it('rejects a non-numeric limit with a 400 instead of a database error', async () => {
    await expect(searchHandler(new Request('http://x/api/search?limit=abc')))
      .rejects.toMatchObject({ status: 400 } satisfies Partial<HttpError>);
  });

  it('returns an empty array, not an error, for no matches', async () => {
    const res = await searchHandler(new Request('http://x/api/search?q=zzzznotathing'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('uses the same public id as the product endpoint', async () => {
    const [hit] = await (await searchHandler(new Request('http://x/api/search?q=Testmerk'))).json();
    const product = await (await productHandler(new Request('http://x/'), hit.id)).json();
    expect(product.product.id).toBe(hit.id);
  });
});

describe('GET /api/categories/:path/products', () => {
  it('rejects a non-numeric limit with a 400', async () => {
    await expect(categoryProductsHandler(new Request('http://x/api/categories/sport/products?limit=abc'), 'sport'))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('GET /api/price-history/:id', () => {
  it('is contract-valid after repeated ingests', async () => {
    await ingest(new TestCatalogueSource());
    await ingest(new TestCatalogueSource());

    const res = await priceHistoryHandler(new Request('http://x/'), anyProductId);
    expect(res.status).toBe(200);
    const parsed = PriceHistorySchema.safeParse(await res.json());
    if (!parsed.success) console.error(parsed.error.format());
    expect(parsed.success).toBe(true);
  });

  it('compares history and current price on the same delivered basis', async () => {
    const [o] = await sql<{ price_cents: number; shipping_cents: number }[]>`
      select price_cents, shipping_cents from offer where product_id = ${anyProductId} limit 1`;
    const body = await (await priceHistoryHandler(new Request('http://x/'), anyProductId)).json();
    const delivered = (o.price_cents + o.shipping_cents) / 100;
    expect(body.currentMin).toBe(delivered);
    expect(body.points.at(-1).price).toBe(delivered);
  });
});

describe('POST /api/basket/*', () => {
  it('plan only offers items that are in stock', async () => {
    await sql`update offer set in_stock = false where product_id = ${anyProductId}`;
    try {
      const body = await (await basketPlanHandler(post('/api/basket/plan', { items: [anyProductId] }))).json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].offers).toEqual([]);
    } finally {
      await sql`update offer set in_stock = true where product_id = ${anyProductId}`;
    }
  });

  it('rejects oversized baskets', async () => {
    const items = Array.from({ length: 51 }, (_, i) => String(i + 1));
    await expect(basketCompareHandler(post('/api/basket/compare', { items })))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rejects a body that is not JSON', async () => {
    await expect(basketPlanHandler(post('/api/basket/plan', 'not json')))
      .rejects.toMatchObject({ status: 400 });
  });

  it('sends no free-delivery threshold when a retailer has none', async () => {
    const rules = await getDeliveryRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toHaveProperty('freeAbove');
  });
});

describe('POST /api/personalise', () => {
  it('gives the same English fallback reason as the front-end engine', async () => {
    const [p] = await personalise([anyProductId], {
      categories: [], budget: {}, priority: 'price', detail: {},
    });
    expect(p.reasons).toEqual(['Chosen for price']);
  });
});

describe('POST /api/track', () => {
  it('accepts and drops', async () => {
    const res = await trackHandler(post('/api/track', { type: 'view_product', productId: anyProductId, at: new Date().toISOString() }));
    expect(await res.json()).toEqual({ ok: true });
  });

  it('400s on a non-JSON body', async () => {
    const res = await trackHandler(post('/api/track', 'not json'));
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

  it('records shipping and currency on each observation', async () => {
    const rows = await sql<{ c: string }[]>`
      select count(*) as c from price_observation
       where ingest_run_id = (select max(id) from ingest_run)
         and (shipping_cents is null or currency is null)`;
    expect(Number(rows[0].c)).toBe(0);
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

  it('sends junk EANs to the review queue once, not once per run', async () => {
    const junkPath = join(tmpdir(), 'scoopt-junk-fixture.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(junkPath, JSON.stringify({ products: [{
      retailerSku: 'JUNK-1', ean: 'N/A', brand: 'Testmerk', title: 'Broken row',
      category: 'sport', priceCents: 1999, inStock: true,
      productUrl: 'https://retailer.invalid/p/x',
    }] }));
    const junk = () => new TestCatalogueSource('testshop', 'TestShop', 'https://testshop.invalid', 1, junkPath);

    const before = await sql<any[]>`select count(*) as c from match_review_queue`;
    await ingest(junk());
    await ingest(junk());
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
