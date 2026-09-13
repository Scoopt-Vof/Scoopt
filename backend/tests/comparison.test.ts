import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from '../src/lib/db';
import { ingest } from '../src/ingest/run';
import { TestCatalogueSource } from './helpers/test-source';
import { productHandler, basketCompareHandler } from '../src/api/contract-handlers';
import { ProductWithOffersSchema } from '../src/contract/schemas';

/**
 * THE TEST THAT MATTERS FOR A COMPARISON SITE.
 *
 * Everything in api.test.ts passes with one retailer, and one retailer is a
 * catalogue, not a comparison. These tests put THREE retailers on the SAME
 * EANs at different prices and assert the things a user would actually notice:
 * that the cheapest offer wins, that shipping is counted, that an out-of-stock
 * offer never outranks one you can buy, and that the product name doesn't
 * change identity depending on which feed ran last.
 *
 * They exercise src/api/contract-handlers.ts — the API the website calls.
 */

// Same EANs, deliberately different prices: 100%, 92%, 110%.
const baseline = new TestCatalogueSource();
const cheaper  = new TestCatalogueSource('sportshop', 'SportShop', 'https://sportshop.invalid', 0.92);
const dearer   = new TestCatalogueSource('bigsport',  'BigSport',  'https://bigsport.invalid',  1.10);

let productId: string;

beforeAll(async () => {
  await sql`truncate price_observation, offer, match_review_queue, ingest_run, product, retailer restart identity cascade`;
  await ingest(baseline);              // 100%
  await ingest(cheaper);               // 92%  ← should always win
  await ingest(dearer);                // 110%

  // Products enter as 'draft' and are promoted by the classifier's publish
  // gate. These tests exercise the PRICE path with no classifier, so publish
  // them explicitly. Classification has its own suite in categorisation.test.ts.
  await sql`update product set status = 'published' where status = 'draft'`;

  const [row] = await sql<{ id: number }[]>`select id from product order by id limit 1`;
  productId = String(row.id);
}, 60_000);

afterAll(async () => { await sql.end(); });

const getProduct = async (id: string) => (await productHandler(new Request('http://x/'), id)).json();

describe('multi-retailer comparison', () => {
  it('attaches three retailers to one product via EAN alone', async () => {
    const [row] = await sql<{ c: string }[]>`
      select count(distinct retailer_id) as c from offer where product_id = ${productId}`;
    expect(Number(row.c)).toBe(3);
  });

  it('creates zero duplicate products — EAN matching actually merged them', async () => {
    const [products] = await sql<{ c: string }[]>`select count(*) as c from product`;
    const [offers] = await sql<{ c: string }[]>`select count(*) as c from offer`;
    // 15 products, 45 offers. If matching were broken we would see 45 products.
    expect(Number(products.c)).toBe(15);
    expect(Number(offers.c)).toBe(45);
  });

  it('returns offers cheapest-first, and the 92% retailer is top', async () => {
    const body = await getProduct(productId);

    const parsed = ProductWithOffersSchema.safeParse(body);
    if (!parsed.success) console.error(parsed.error.format());
    expect(parsed.success).toBe(true);

    expect(body.offers).toHaveLength(3);
    expect(body.offers[0].store).toBe('sportshop');
    expect(body.offers.at(-1).store).toBe('bigsport');

    const prices = body.offers.map((o: any) => o.price);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
  });

  it('ranks on price PLUS shipping, not price alone', async () => {
    // Construct the trap directly: cheaper item, dearer once posted.
    await sql`
      insert into retailer (slug, name, homepage_url, source_kind)
      values ('trap', 'TrapShop', 'https://trap.invalid', 'fixture')
      on conflict (slug) do nothing`;
    const [trap] = await sql<{ id: number }[]>`select id from retailer where slug = 'trap'`;

    const [cheapest] = await sql<{ t: number }[]>`
      select min(price_cents + shipping_cents)::int as t from offer where product_id = ${productId}`;

    // 1 cent cheaper on the sticker, 500 cents dearer delivered.
    await sql`
      insert into offer (product_id, retailer_id, retailer_sku, price_cents, shipping_cents, in_stock, product_url)
      values (${productId}, ${trap.id}, 'TRAP-1', ${cheapest.t - 1}, 500, true, 'https://trap.invalid/p/1')
      on conflict (product_id, retailer_id) do update set price_cents = excluded.price_cents`;

    try {
      const body = await getProduct(productId);
      expect(body.offers[0].store).not.toBe('trap');
    } finally {
      await sql`delete from offer where retailer_id = ${trap.id}`;
    }
  });

  it('never ranks an out-of-stock offer above one you can buy', async () => {
    const [shop] = await sql<{ id: number }[]>`select id from retailer where slug = 'sportshop'`;
    await sql`update offer set in_stock = false where product_id = ${productId} and retailer_id = ${shop.id}`;
    try {
      const body = await getProduct(productId);
      expect(body.offers[0].store).not.toBe('sportshop');
      expect(body.offers.at(-1)).toMatchObject({ store: 'sportshop', inStock: false });
      expect(ProductWithOffersSchema.safeParse(body).success).toBe(true);
    } finally {
      await sql`update offer set in_stock = true where product_id = ${productId} and retailer_id = ${shop.id}`;
    }
  });

  it('keeps one stable product title instead of letting the last feed rewrite it', async () => {
    const before = await sql<{ title: string }[]>`select title from product order by id`;
    await ingest(dearer);
    await ingest(cheaper);
    const after = await sql<{ title: string }[]>`select title from product order by id`;
    expect(after.map((r) => r.title)).toEqual(before.map((r) => r.title));
  });

  it('basket compare ranks the cheapest complete store first', async () => {
    const res = await basketCompareHandler(new Request('http://x/api/basket/compare', {
      method: 'POST', body: JSON.stringify({ items: [productId] }),
    }));
    const body = await res.json();
    expect(body.cheapestComplete.store).toBe('sportshop');
  });

  it('counts real comparisons — the number that IS the proof of concept', async () => {
    const [row] = await sql<{ c: string }[]>`
      select count(*) as c from (
        select product_id from offer group by product_id having count(distinct retailer_id) > 1
      ) t`;
    expect(Number(row.c)).toBe(15);
  });
});
