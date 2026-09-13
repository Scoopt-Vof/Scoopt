import { createServer, type IncomingMessage } from 'node:http';
import {
  productHandler, searchHandler, categoryHandler, basketCompareHandler,
  basketPlanHandler, priceHistoryHandler, trackHandler, personaliseHandler,
} from './api/contract-handlers';
import {
  categoriesTreeHandler, categoryNodeHandler, categoryProductsHandler,
  categoryFacetsHandler, tagsHandler, productTaxonomyHandler,
} from './api/catalog-handlers';
import { corsHeaders, corsPreflight } from './api/cors';
import { fail, HttpError, json } from './api/respond';
import { sql } from './lib/db';

/**
 * THE BACK END, speaking Josh's contract.
 *
 * Every endpoint the front end calls, served from Postgres. This is the only
 * API server — the earlier trial server (src/server.ts and its handlers) has
 * been removed.
 *
 *   npm run serve   → http://localhost:3002   (reads .env)
 *   npm start       → same server, env vars from the host (for deployment)
 *
 * Environment:
 *   CONTRACT_PORT            listen port (default 3002)
 *   PORT                     used only by `npm start` (--use-host-port), because
 *                            hosts such as Railway inject it. Local .env files
 *                            still carry PORT=3001 from the removed trial
 *                            server, and `npm run serve` must stay on 3002.
 *   CORS_ORIGINS             see src/api/cors.ts
 *   RATE_LIMIT_PER_MINUTE    per client IP, default 600; 0 disables
 *   TRUST_PROXY=1            take the client IP from X-Forwarded-For
 *   HEALTH_TOKEN             enables GET /health/details with header x-health-token
 */
const PORT = Number(
  process.env.CONTRACT_PORT ??
  (process.argv.includes('--use-host-port') ? process.env.PORT : undefined) ??
  3002
);
const MAX_BODY_BYTES = 100_000;

// Order matters: /api/product/:id/taxonomy would otherwise be swallowed by
// /api/product/(.+), and the /api/categories suffix routes by the bare one.
const routes: Array<[RegExp, string, (req: Request, m: string) => Promise<Response>]> = [
  [/^\/api\/product\/(.+)\/taxonomy$/,   'GET', (r, m) => productTaxonomyHandler(r, decodeSegment(m))],
  [/^\/api\/categories\/(.+)\/products$/, 'GET', (r, m) => categoryProductsHandler(r, decodePath(m))],
  [/^\/api\/categories\/(.+)\/facets$/,   'GET', (r, m) => categoryFacetsHandler(r, decodePath(m))],
  [/^\/api\/categories\/(.+)$/,            'GET', (r, m) => categoryNodeHandler(r, decodePath(m))],
  [/^\/api\/product\/(.+)$/,        'GET',  (r, m) => productHandler(r, decodeSegment(m))],
  [/^\/api\/category\/(.+)$/,       'GET',  (r, m) => categoryHandler(r, decodeSegment(m))],
  [/^\/api\/price-history\/(.+)$/,  'GET',  (r, m) => priceHistoryHandler(r, decodeSegment(m))],
];

/** decodeURIComponent throws URIError on malformed input ("%E0%A4%A"); that is a 400, not a 500. */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'Malformed URL encoding');
  }
}

/**
 * A category path contains slashes ('tech/audio-headphones'), so it may arrive
 * either as real path segments or percent-encoded. Decode each segment on its
 * own so both spellings resolve to the same node.
 */
const decodePath = (raw: string): string => raw.split('/').map(decodeSegment).join('/');

async function route(req: Request, url: URL): Promise<Response> {
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

  // Public health check: cheap, and reveals nothing but "the database answers".
  if (p === '/health') {
    await sql`select 1`;
    return json({ ok: true });
  }
  if (p === '/health/details') return healthDetails(req);

  return fail(404, 'Not found');
}

/**
 * Catalogue stats (product, draft and review counts). Several count queries,
 * so it is not public: it only exists when HEALTH_TOKEN is set, and only
 * answers requests carrying that token.
 */
async function healthDetails(req: Request): Promise<Response> {
  const token = process.env.HEALTH_TOKEN;
  if (!token || req.headers.get('x-health-token') !== token) return fail(404, 'Not found');

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
  return json({ ok: true, ...r, comparableProducts: cmp.c, ...cls });
}

// ---------------------------------------------------------------------------
// Rate limiting — a fixed one-minute window per client IP, in memory.
// ---------------------------------------------------------------------------
// Deliberately simple: one process, no dependency. It stops a single script
// from hammering the database; it is not a substitute for a CDN/WAF limit.
//
// NOTE: in production the front end's Next.js server calls this back end on
// behalf of every shopper, so all of that traffic shares ONE IP here. The
// default is set high for that reason. Forward the shopper's IP in
// X-Forwarded-For from the proxy and set TRUST_PROXY=1 to limit per shopper.
const RATE_LIMIT = (() => {
  const n = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600);
  return Number.isFinite(n) && n >= 0 ? n : 600;
})();
const hits = new Map<string, { windowStart: number; count: number }>();

function clientIp(req: IncomingMessage): string {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function rateLimited(ip: string): boolean {
  if (RATE_LIMIT === 0) return false;
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart >= 60_000) {
    hits.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Forget idle clients so the map cannot grow without bound.
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, e] of hits) if (e.windowStart < cutoff) hits.delete(ip);
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Request body — read with a size cap.
// ---------------------------------------------------------------------------
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Stop buffering but keep draining, so the 413 can still be written
      // back on the same connection (destroying the request kills the socket).
      if (size > MAX_BODY_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(c);
    });
    req.on('end', () => tooLarge
      ? reject(new HttpError(413, `Request body larger than ${MAX_BODY_BYTES} bytes`))
      : resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;

  let response: Response;
  try {
    if (req.method === 'OPTIONS') {
      response = corsPreflight(origin);
    } else if (rateLimited(clientIp(req))) {
      response = json({ error: 'Too many requests' }, 429, { 'retry-after': '60' });
    } else {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > MAX_BODY_BYTES) throw new HttpError(413, `Request body larger than ${MAX_BODY_BYTES} bytes`);
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      response = await route(
        new Request(url, { method: req.method, headers: req.headers as HeadersInit, body }),
        url
      );
    }
  } catch (err) {
    if (err instanceof HttpError) {
      response = fail(err.status, err.message);
    } else {
      console.error(err);
      response = fail(500, 'internal error');
    }
  }

  // CORS on EVERY response, errors included, so a browser sees the real status.
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  Object.assign(headers, corsHeaders(origin));

  if (res.headersSent || res.destroyed) return;
  res.writeHead(response.status, headers);
  res.end(response.body ? await response.text() : undefined);
});

// Stop a slow client from holding a connection open indefinitely.
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

server.listen(PORT, () => {
  console.log(`\n  Scoopt back end (contract shapes, from Postgres)`);
  console.log(`  http://localhost:${PORT}  —  try /health\n`);
});

// ---------------------------------------------------------------------------
// ADMIN ROUTES ARE DELIBERATELY NOT MOUNTED.
// ---------------------------------------------------------------------------
// src/api/catalog-handlers.ts exports reviewQueueHandler and
// setProductCategoryHandler, and they work — but this server has no user
// authentication, and one of them WRITES. Mount them only behind real auth.

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    server.close();
    await sql.end();
    process.exit(0);
  });
}
