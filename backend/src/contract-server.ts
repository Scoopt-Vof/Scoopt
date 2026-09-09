import { createServer } from 'node:http';
import {
  productHandler, searchHandler, categoryHandler, basketCompareHandler,
  basketPlanHandler, priceHistoryHandler, trackHandler, personaliseHandler,
  corsPreflight,
} from './api/contract-handlers';
import {
  categoriesTreeHandler, categoryNodeHandler, categoryProductsHandler,
  categoryFacetsHandler, tagsHandler, productTaxonomyHandler,
} from './api/catalog-handlers';
import { sql } from './lib/db';

/**
 * THE REAL BACK END, speaking Josh's contract.
 *
 * All eight endpoints, served from Postgres, at the exact paths the front end
 * already calls. Point Josh's lib/api.ts `base` at http://localhost:3002 and
 * the site runs on the database instead of the TypeScript file — with no other
 * change on his side. That swap is the entire trial run.
 *
 *   npm run serve         → http://localhost:3002
 */
const PORT = Number(process.env.CONTRACT_PORT ?? 3002);

// Order matters: the catalogue routes are listed FIRST because
// /api/categories/... would otherwise be swallowed by nothing — but
// /api/product/:id/taxonomy would be swallowed by /api/product/(.+).
//
// The new /api/categories/* routes are additive and sit alongside the original
// /api/category/:cat, which is unchanged. Josh's frontend keeps working on the
// old one until it chooses to move.
const routes: Array<[RegExp, string, (req: Request, m: string) => Promise<Response>]> = [
  [/^\/api\/product\/(.+)\/taxonomy$/,   'GET', (r, m) => productTaxonomyHandler(r, decodeURIComponent(m))],
  [/^\/api\/categories\/(.+)\/products$/, 'GET', (r, m) => categoryProductsHandler(r, decodePath(m))],
  [/^\/api\/categories\/(.+)\/facets$/,   'GET', (r, m) => categoryFacetsHandler(r, decodePath(m))],
  [/^\/api\/categories\/(.+)$/,            'GET', (r, m) => categoryNodeHandler(r, decodePath(m))],
  [/^\/api\/product\/(.+)$/,        'GET',  (r, m) => productHandler(r, decodeURIComponent(m))],
  [/^\/api\/category\/(.+)$/,       'GET',  (r, m) => categoryHandler(r, decodeURIComponent(m))],
  [/^\/api\/price-history\/(.+)$/,  'GET',  (r, m) => priceHistoryHandler(r, decodeURIComponent(m))],
];

/**
 * A category path contains slashes ('tech/audio-headphones'), so it may arrive
 * either as real path segments or percent-encoded. Decode each segment on its
 * own so both spellings resolve to the same node.
 */
const decodePath = (raw: string): string =>
  raw.split('/').map((seg) => decodeURIComponent(seg)).join('/');

async function route(req: Request, url: URL): Promise<Response> {
  if (req.method === 'OPTIONS') return corsPreflight();
  const p = url.pathname;

  for (const [re, method, fn] of routes) {
    const m = p.match(re);
    if (m && req.method === method) return fn(req, m[1]);
  }

  if (p === '/api/categories' && req.method === 'GET') return categoriesTreeHandler();
  if (p === '/api/tags' && req.method === 'GET') return tagsHandler();
  if (p === '/api/search' && req.method === 'GET') return searchHandler(req);
  if (p === '/api/basket/compare' && req.method === 'POST') return basketCompareHandler(req);
  if (p === '/api/basket/plan' && req.method === 'POST') return basketPlanHandler(req);
  if (p === '/api/track' && req.method === 'POST') return trackHandler(req);
  if (p === '/api/personalise' && req.method === 'POST') return personaliseHandler(req);

  if (p === '/health') {
    const [r] = await sql<{ products: string; offers: string; retailers: string }[]>`
      select (select count(*) from product where status='published') as products,
             (select count(*) from offer) as offers,
             (select count(*) from retailer where is_active) as retailers`;
    const [cmp] = await sql<{ c: string }[]>`
      select count(*) as c from (
        select product_id from offer group by product_id having count(distinct retailer_id) > 1
      ) t`;
    const [cls] = await sql<{ draft: string; classified: string; open_reviews: string }[]>`
      select (select count(*) from product where status='draft') as draft,
             (select count(*) from product_category where relation='primary') as classified,
             (select count(*) from match_review_queue
               where kind='category' and resolved=false) as open_reviews`;
    return new Response(
      JSON.stringify({ ok: true, ...r, comparableProducts: cmp.c, ...cls }),
      { headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404, headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// ADMIN ROUTES ARE DELIBERATELY NOT MOUNTED.
// ---------------------------------------------------------------------------
// src/api/catalog-handlers.ts exports reviewQueueHandler and
// setProductCategoryHandler, and they work — but this server has no
// authentication of any kind, and one of them WRITES. Mounting them here would
// put "change any product's category" on the open internet.
//
// They are ready for whoever adds auth: mount them behind it, e.g.
//   if (p === '/api/admin/review-queue' && requireAdmin(req)) return reviewQueueHandler(req);
// Until then the review queue is read with the SQL in section 7 of the brief.
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
    response = await route(new Request(url, { method: req.method, headers: req.headers as any, body }), url);
  } catch (err) {
    console.error(err);
    response = new Response(JSON.stringify({ error: 'internal error' }), { status: 500 });
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(await response.text());
}).listen(PORT, () => {
  console.log(`\n  Scoopt back end (contract shapes, from Postgres)`);
  console.log(`  http://localhost:${PORT}  —  try /health\n`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { await sql.end(); process.exit(0); });
}
