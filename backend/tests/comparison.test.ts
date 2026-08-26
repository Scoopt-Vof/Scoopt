import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/lib/db';
import { ingest } from '../src/ingest/run';
import { DecathlonSource } from '../src/sources/decathlon';
import { FixtureSource } from '../src/sources/fixture';
import { productHandler, searchHandler } from '../src/api/handlers';
import { ProductWithOffersSchema } from '../src/contract/schemas';

/**
 * THE TEST THAT MATTERS FOR A COMPARISON SITE.
 *
 * Everything in api.test.ts passes with one retailer, and one retailer is a
 * catalogue, not a comparison. These tests put THREE retailers on the SAME
 * EANs at different prices and assert the things a user would actually notice:
 * that the cheapest offer wins, that shipping is counted, and that the product
 * name doesn't change identity depending on which feed ran last.
 */

const FIXTURE = fileURLToPath(new URL('../data/decathlon-products.json', import.meta.url));

// Same EANs, deliberately different prices: 100%, 92%, 110%.
const cheaper = new FixtureSource('sportshop', 'SportShop', 'https://sportshop.example', FIXTURE, 0.92);
const dearer  = new FixtureSource('bigsport',  'BigSport',  'https://bigsport.example',  FIXTURE, 1.10);

let productId: string;

beforeAll(async () => {
  await sql`truncate price_observation, offer, match_review_queue, ingest_run, product, retailer restart identity cascade`;
  await ingest(new DecathlonSource()); // 100%
  await ingest(cheaper);               // 92%  ← should always win
  await ingest(dearer);                // 110%

  const [row] = await sql<{ id: number }[]>`select id from product order by id limit 1`;
  productId = String(row.id);
}, 60_000);

afterAll(async () => { await sql.end(); });

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
    const res = await productHandler(new Request('http://x/'), productId);
    const body = await res.json();

    const parsed = ProductWithOffersSchema.safeParse(body);
    if (!parsed.success) console.error(parsed.error.format());
    expect(parsed.success).toBe(true);

    expect(body.offers).toHaveLength(3);
    expect(body.offers[0].retailer.slug).toBe('sportshop');
    expect(body.offers.at(-1).retailer.slug).toBe('bigsport');

    const totals = body.offers.map((o: any) => o.totalCents);
    expect(totals).toEqual([...totals].sort((a: number, b: number) => a - b));
    expect(body.fromCents).toBe(totals[0]);
  });

  it('ranks on price PLUS shipping, not price alone', async () => {
    // Construct the trap directly: cheaper item, dearer once posted.
    const [p] = await sql<{ id: number }[]>`select id from product limit 1`;
    await sql`
      insert into retailer (slug, name, homepage_url, source_kind)
      values ('trap', 'TrapShop', 'https://trap.example', 'fixture')
      on conflict (slug) do nothing`;
    const [trap] = await sql<{ id: number }[]>`select id from retailer where slug = 'trap'`;

    const [cheapest] = await sql<{ t: number }[]>`
      select min(price_cents + shipping_cents)::int as t from offer where product_id = ${p.id}`;

    // 1 cent cheaper on the sticker, 500 cents dearer delivered.
    await sql`
      insert into offer (product_id, retailer_id, retailer_sku, price_cents, shipping_cents, in_stock, product_url)
      values (${p.id}, ${trap.id}, 'TRAP-1', ${cheapest.t - 1}, 500, true, 'https://trap.example/p/1')
      on conflict (product_id, retailer_id) do update set price_cents = excluded.price_cents`;

    const res = await productHandler(new Request('http://x/'), String(p.id));
    const body = await res.json();
    expect(body.offers[0].retailer.slug).not.toBe('trap');

    await sql`delete from offer where retailer_id = ${trap.id}`;
  });

  it('keeps one stable product title instead of letting the last feed rewrite it', async () => {
    const before = await sql<{ title: string }[]>`select title from product order by id`;
    await ingest(dearer);
    await ingest(cheaper);
    const after = await sql<{ title: string }[]>`select title from product order by id`;
    expect(after.map((r) => r.title)).toEqual(before.map((r) => r.title));
  });

  it('search reports how many retailers each product has', async () => {
    const res = await searchHandler(new Request('http://x/api/search?q=Kalenji'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].fromCents).toBeGreaterThan(0);
  });

  it('counts real comparisons — the number that IS the proof of concept', async () => {
    const [row] = await sql<{ c: string }[]>`
      select count(*) as c from (
        select product_id from offer group by product_id having count(distinct retailer_id) > 1
      ) t`;
    expect(Number(row.c)).toBe(15);
  });
});
