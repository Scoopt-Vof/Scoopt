import * as q from './contract-queries';
import {
  json, HttpError, intParam, readJson, stringArray,
  MAX_BASKET_ITEMS, MAX_PERSONALISE_IDS,
} from './respond';

/**
 * The eight contract endpoints, database-backed, returning Josh's exact shapes.
 *
 * Same `Request → Response` design throughout, so each becomes a two-line
 * Next.js route if the back end is ever folded into the front end:
 *
 *   // app/api/product/[id]/route.ts
 *   import { productHandler } from '@/src/api/contract-handlers';
 *   export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
 *     productHandler(req, (await ctx.params).id);
 *
 * The error bodies and status codes match Josh's existing routes exactly —
 * `{ error: "Product not found" }` and so on — because the front end already
 * treats a 404 as "return null" and anything else as a thrown error.
 *
 * Client errors are thrown as HttpError and turned into JSON 4xx responses by
 * contract-server.ts, which also applies CORS to every response.
 */

export async function productHandler(_req: Request, id: string): Promise<Response> {
  const r = await q.getProduct(id);
  return r ? json(r) : json({ error: 'Product not found' }, 404);
}

export async function searchHandler(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  // The contract says an empty q lists the catalogue — do not "helpfully" 400.
  // It is paged with limit/offset rather than unbounded.
  return json(await q.searchProducts(params.get('q') ?? '', {
    limit: intParam(params, 'limit'),
    offset: intParam(params, 'offset'),
  }));
}

export async function categoryHandler(_req: Request, cat: string): Promise<Response> {
  const r = await q.getCategory(cat);
  return r ? json(r) : json({ error: 'Category not found' }, 404);
}

async function basketItems(req: Request): Promise<string[]> {
  const body = await readJson(req).catch(() => {
    throw new HttpError(400, 'Body must be { items: string[] }');
  });
  return stringArray(body.items, 'items', MAX_BASKET_ITEMS);
}

export async function basketCompareHandler(req: Request): Promise<Response> {
  const items = await basketItems(req);
  return json(await q.compareBasket({ items }));
}

export async function basketPlanHandler(req: Request): Promise<Response> {
  const items = await basketItems(req);
  const [planItems, deliveryRules] = await Promise.all([
    q.basketItemsWithOffers(items),
    q.getDeliveryRules(),
  ]);
  return json({ items: planItems, deliveryRules });
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
  const body = await readJson(req).catch(() => {
    throw new HttpError(400, 'Body must be a PersonaliseRequest');
  });
  const productIds = stringArray(body.productIds, 'productIds', MAX_PERSONALISE_IDS);
  return json(await q.personalise(
    productIds,
    (body.profile as Parameters<typeof q.personalise>[1]) ?? null,
    (body.observed as Parameters<typeof q.personalise>[2]) ?? null,
  ));
}
