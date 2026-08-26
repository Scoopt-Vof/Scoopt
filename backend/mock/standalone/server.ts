import { createServer } from 'node:http';
import {
  PRODUCTS, DELIVERY_RULES, getProduct, searchProducts, getCategory,
  basketItemsWithOffers, getPriceHistory, compareBasket,
} from './fakeData';
import type {
  Product, PersonalisedProduct, ShopperProfile, ObservedSignals, Category,
} from './types';

/**
 * THE MOCK API — all eight contract endpoints, served over HTTP, from the
 * same data as lib/fakeData.ts.
 *
 * You do not need this to see the site work. Dropping fakeData.ts into Josh's
 * repo is enough, because his app/api/* routes already read from it.
 *
 * This exists for the other direction: it proves the eight endpoints can be
 * served by something that is NOT a Next.js route reading a TypeScript file —
 * which is exactly what the real Postgres backend will be. Point Josh's
 * lib/api.ts at http://localhost:4000 and the front end cannot tell the
 * difference. That is the seam working.
 *
 *   npm run mock          → http://localhost:4000
 *   curl localhost:4000/api/product/run-pegasus41
 */

const PORT = Number(process.env.MOCK_PORT ?? 4000);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // So Josh can run the front end on :3000 against this on :4000.
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'cache-control': 'no-store',
    },
  });

/**
 * Mirrors lib/profile.ts personalise() so the server-side route behaves like
 * the client engine. Same contract shape either way — that is the point of
 * PersonaliseRequest existing at all.
 */
function personalise(
  products: Product[],
  profile: ShopperProfile | null,
  observed?: ObservedSignals | null
): PersonalisedProduct[] {
  if (!profile) return products.map((product) => ({ product, matchScore: 50, reasons: [] }));

  const BANDS = ['value', 'mid', 'premium'];
  return products
    .map((product) => {
      let score = 50;
      const reasons: string[] = [];
      const s = product.specs ?? {};

      const want = profile.budget?.[product.category as Category];
      if (want && s.tier) {
        const d = Math.abs(BANDS.indexOf(want) - BANDS.indexOf(s.tier));
        if (d === 0) { score += 20; reasons.push(`Past bij je budget (${want})`); }
        else if (d >= 2) score -= 15;
      }

      if (profile.priority === 'quality' && Number(s.quality) >= 4) {
        score += 18; reasons.push('Hoog beoordeeld op kwaliteit');
      } else if (profile.priority === 'newest' && Number(s.released) >= 2026) {
        score += 18; reasons.push('Nieuwste model');
      } else if (profile.priority === 'price' && s.tier === 'value') {
        score += 18; reasons.push('Scherp geprijsd');
      }

      const detail = profile.detail?.[product.subcategory];
      if (detail?.niveau && s.level && detail.niveau === s.level) {
        score += 12; reasons.push(`Voor ${s.level} sporters`);
      }
      if (profile.categories?.includes(product.category as Category)) score += 5;

      if (observed) {
        if (observed.purchasedProductIds?.includes(product.id)) score -= 40;
        if (observed.viewedProductIds?.includes(product.id)) score += 4;
        if (observed.clickedOutProductIds?.includes(product.id)) score += 8;
        if ((observed.categoryAffinity?.[product.category as Category] ?? 0) >= 3) score += 6;
      }

      return {
        product,
        matchScore: Math.max(0, Math.min(100, Math.round(score))),
        reasons: reasons.slice(0, 2),
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

async function handle(req: Request, url: URL): Promise<Response> {
  const p = url.pathname;

  if (req.method === 'OPTIONS') return json({}, 204);

  // GET /api/product/:id
  const product = p.match(/^\/api\/product\/(.+)$/);
  if (product && req.method === 'GET') {
    const r = getProduct(decodeURIComponent(product[1]));
    return r ? json(r) : json({ error: 'Product not found' }, 404);
  }

  // GET /api/search?q=
  if (p === '/api/search' && req.method === 'GET') {
    return json(searchProducts(url.searchParams.get('q') ?? ''));
  }

  // GET /api/category/:cat
  const category = p.match(/^\/api\/category\/(.+)$/);
  if (category && req.method === 'GET') {
    const r = getCategory(decodeURIComponent(category[1]));
    return r ? json(r) : json({ error: 'Category not found' }, 404);
  }

  // POST /api/basket/compare
  if (p === '/api/basket/compare' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.items)) {
      return json({ error: 'Body must be { items: string[] }' }, 400);
    }
    return json(compareBasket({ items: body.items }));
  }

  // POST /api/basket/plan
  if (p === '/api/basket/plan' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.items)) {
      return json({ error: 'Body must be { items: string[] }' }, 400);
    }
    return json({ items: basketItemsWithOffers(body.items), deliveryRules: DELIVERY_RULES });
  }

  // GET /api/price-history/:id
  const history = p.match(/^\/api\/price-history\/(.+)$/);
  if (history && req.method === 'GET') {
    const r = getPriceHistory(decodeURIComponent(history[1]));
    return r ? json(r) : json({ error: 'Product not found' }, 404);
  }

  // POST /api/track
  if (p === '/api/track' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.type !== 'string' || typeof body.productId !== 'string') {
      return json({ error: 'Body must be a TrackEvent' }, 400);
    }
    // Accepts and drops, exactly like the contract says. Real storage lands
    // with auth, because an event is only worth keeping once it has an account.
    console.log(`  track: ${body.type} ${body.productId}${body.store ? ` @${body.store}` : ''}`);
    return json({ ok: true });
  }

  // POST /api/personalise
  if (p === '/api/personalise' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.productIds)) {
      return json({ error: 'Body must be a PersonaliseRequest' }, 400);
    }
    const chosen = body.productIds
      .map((id: string) => PRODUCTS.find((x) => x.id === id))
      .filter(Boolean) as Product[];
    return json(personalise(chosen, body.profile ?? null, body.observed ?? null));
  }

  if (p === '/health') return json({ ok: true, products: PRODUCTS.length });

  if (p === '/') {
    return new Response(INDEX, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  return json({ error: 'Not found' }, 404);
}

const INDEX = `<!doctype html><meta charset="utf-8"><title>Scoopt mock API</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1.5rem;color:#1a1a1a}
code{background:#f2f2f4;padding:.15em .4em;border-radius:4px}a{color:#0b5}h1{font-size:1.4rem}
li{margin:.35rem 0}.warn{background:#fff6e5;border-left:3px solid #e5a300;padding:.8rem 1rem;border-radius:4px}</style>
<h1>Scoopt mock API</h1>
<p class="warn"><strong>Fake prices.</strong> Real Dutch sports products, invented prices and barcodes.
Local development only — never point a public site at this.</p>
<p>All eight contract endpoints, served from the same data as <code>lib/fakeData.ts</code>.</p>
<ul>
<li><a href="/api/search?q=">GET /api/search?q=</a> — all ${'${PRODUCTS.length}'} products</li>
<li><a href="/api/search?q=nike">GET /api/search?q=nike</a></li>
<li><a href="/api/product/run-pegasus41">GET /api/product/run-pegasus41</a> — 3 competing offers</li>
<li><a href="/api/product/run-kiprunks500">GET /api/product/run-kiprunks500</a> — Decathlon own-brand, 1 offer</li>
<li><a href="/api/category/sport">GET /api/category/sport</a></li>
<li><a href="/api/price-history/run-pegasus41">GET /api/price-history/run-pegasus41</a></li>
<li>POST /api/basket/compare — <code>{"items":["run-pegasus41","run-fr265"]}</code></li>
<li>POST /api/basket/plan — same body</li>
<li>POST /api/track — <code>{"type":"view_product","productId":"run-pegasus41"}</code></li>
<li>POST /api/personalise — <code>{"productIds":[...],"profile":null}</code></li>
</ul>`.replace('${PRODUCTS.length}', String(PRODUCTS.length));

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  let body: string | undefined;
  if (req.method === 'POST') {
    body = await new Promise<string>((resolve) => {
      let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d));
    });
  }

  let response: Response;
  try {
    response = await handle(new Request(url, {
      method: req.method, headers: req.headers as any, body,
    }), url);
  } catch (err) {
    console.error(err);
    response = json({ error: 'internal error' }, 500);
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(await response.text());
}).listen(PORT, () => {
  console.log(`\n  Scoopt mock API — ${PRODUCTS.length} products, fake prices`);
  console.log(`  http://localhost:${PORT}\n`);
});
