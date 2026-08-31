import * as q from './contract-queries';

/**
 * The eight contract endpoints, database-backed, returning Josh's exact shapes.
 *
 * Same `Request → Response` design as the other handlers, so each becomes a
 * two-line Next.js route:
 *
 *   // app/api/product/[id]/route.ts
 *   import { productHandler } from '@/src/api/contract-handlers';
 *   export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
 *     productHandler(req, (await ctx.params).id);
 *
 * The error bodies and status codes match Josh's existing routes exactly —
 * `{ error: "Product not found" }` and so on — because the front end already
 * treats a 404 as "return null" and anything else as a thrown error.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'cache-control': 'no-store',
    },
  });

export async function productHandler(_req: Request, id: string): Promise<Response> {
  const r = await q.getProduct(id);
  return r ? json(r) : json({ error: 'Product not found' }, 404);
}

export async function searchHandler(req: Request): Promise<Response> {
  // The contract says an empty q returns everything — do not "helpfully" 400.
  return json(await q.searchProducts(new URL(req.url).searchParams.get('q') ?? ''));
}

export async function categoryHandler(_req: Request, cat: string): Promise<Response> {
  const r = await q.getCategory(cat);
  return r ? json(r) : json({ error: 'Category not found' }, 404);
}

export async function basketCompareHandler(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) {
    return json({ error: 'Body must be { items: string[] }' }, 400);
  }
  return json(await q.compareBasket({ items: body.items }));
}

export async function basketPlanHandler(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) {
    return json({ error: 'Body must be { items: string[] }' }, 400);
  }
  const [items, deliveryRules] = await Promise.all([
    q.basketItemsWithOffers(body.items),
    q.getDeliveryRules(),
  ]);
  return json({ items, deliveryRules });
}

export async function priceHistoryHandler(_req: Request, id: string): Promise<Response> {
  const r = await q.getPriceHistory(id);
  return r ? json(r) : json({ error: 'Product not found' }, 404);
}

export async function trackHandler(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.type !== 'string' || typeof body.productId !== 'string') {
    return json({ error: 'Body must be a TrackEvent' }, 400);
  }
  // Accepts and drops, per the contract. Persisting events is only worth doing
  // once there is an account to attach them to, which lands with auth.
  return json({ ok: true });
}

export async function personaliseHandler(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.productIds)) {
    return json({ error: 'Body must be a PersonaliseRequest' }, 400);
  }
  return json(await q.personalise(body.productIds, body.profile ?? null, body.observed ?? null));
}

export function corsPreflight(): Response {
  // 204 is a null-body status: passing a body here throws a TypeError,
  // which contract-server.ts turns into a 500, so every preflight fails.
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-max-age': '86400',
    },
  });
}
