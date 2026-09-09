import * as q from './catalog-queries';

/**
 * The catalogue endpoints. Same `Request → Response` shape, same JSON helper,
 * same CORS headers and same error bodies as contract-handlers.ts, so mounting
 * them is three lines in contract-server.ts and the frontend treats a 404 the
 * way it already does.
 *
 * These are ADDITIVE. Every existing route stays exactly as it was; nothing
 * here changes what /api/category/:cat returns, so Josh's frontend keeps
 * working untouched until it chooses to move.
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

export async function categoriesTreeHandler(): Promise<Response> {
  return json(await q.getTree());
}

export async function categoryNodeHandler(_req: Request, path: string): Promise<Response> {
  const r = await q.getCategoryByPath(path);
  return r ? json(r) : json({ error: 'Category not found' }, 404);
}

export async function categoryProductsHandler(req: Request, path: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const tags = params.get('tags')?.split(',').map((t) => t.trim()).filter(Boolean);
  const r = await q.getCategoryProducts(path, {
    limit: params.has('limit') ? Number(params.get('limit')) : undefined,
    offset: params.has('offset') ? Number(params.get('offset')) : undefined,
    tags,
  });
  return r ? json(r) : json({ error: 'Category not found' }, 404);
}

export async function categoryFacetsHandler(_req: Request, path: string): Promise<Response> {
  const r = await q.getCategoryFacets(path);
  return r ? json(r) : json({ error: 'Category not found' }, 404);
}

export async function tagsHandler(): Promise<Response> {
  return json(await q.getFacetTags());
}

export async function productTaxonomyHandler(_req: Request, id: string): Promise<Response> {
  const r = await q.getProductTaxonomy(id);
  return r ? json(r) : json({ error: 'Product not found' }, 404);
}

// ---------------------------------------------------------------------------
// Admin — see the note in contract-server.ts about why these are not mounted.
// ---------------------------------------------------------------------------

export async function reviewQueueHandler(req: Request): Promise<Response> {
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50);
  return json(await q.getReviewQueue(Math.min(Math.max(limit, 1), 200)));
}

export async function setProductCategoryHandler(req: Request, id: string): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.categoryPath !== 'string') {
    return json({ error: 'Body must be { categoryPath: string, reviewedBy?: string }' }, 400);
  }
  const r = await q.setProductCategory(id, body.categoryPath, body.reviewedBy ?? null);
  return r.ok ? json(r) : json({ error: r.error }, 400);
}
