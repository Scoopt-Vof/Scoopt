import { getProduct, searchProducts, getPriceHistory } from './queries';

/**
 * Route handlers as plain `(Request) => Promise<Response>` functions.
 *
 * This shape is deliberate and it is the reason the tests need no browser, no
 * running server and no front end. A Next.js App Router route file becomes a
 * two-line re-export:
 *
 *   // app/api/product/[id]/route.ts
 *   import { productHandler } from '@/src/api/handlers';
 *   export const GET = (req: Request, ctx: { params: { id: string } }) =>
 *     productHandler(req, ctx.params.id);
 *
 * and Vitest calls the same function directly with `new Request(...)`.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Prices change hourly at most; let the CDN absorb the traffic.
      'cache-control': status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store',
    },
  });

const fail = (status: number, message: string) => json({ error: message }, status);

export async function productHandler(_req: Request, id: string): Promise<Response> {
  const product = await getProduct(id);
  if (!product) return fail(404, 'product not found');
  return json(product);
}

export async function searchHandler(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  if (q.trim().length < 2) return fail(400, 'q must be at least 2 characters');
  return json(await searchProducts(q));
}

export async function priceHistoryHandler(_req: Request, id: string): Promise<Response> {
  const history = await getPriceHistory(id);
  if (!history) return fail(404, 'product not found');
  return json(history);
}

/** POST /api/track — accepts and drops, per the contract. Real storage lands with auth. */
export async function trackHandler(req: Request): Promise<Response> {
  try {
    await req.json();
  } catch {
    return fail(400, 'body must be JSON');
  }
  return json({ ok: true });
}
