import * as q from './catalog-queries';
import { json, HttpError, intParam, readJson } from './respond';

/**
 * The catalogue endpoints. Same `Request → Response` shape and the same error
 * bodies as contract-handlers.ts; CORS is applied to every response by
 * contract-server.ts.
 *
 * These are ADDITIVE. Nothing here changes what /api/category/:cat returns.
 */

export async function categoriesTreeHandler(): Promise<Response> {
  return json(await q.getTree());
}

export async function categoryNodeHandler(_req: Request, path: string): Promise<Response> {
  const r = await q.getCategoryByPath(path);
  return r ? json(r) : json({ error: 'Category not found' }, 404);
}

export async function categoryProductsHandler(req: Request, path: string): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const tags = params.get('tags')?.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);
  const r = await q.getCategoryProducts(path, {
    limit: intParam(params, 'limit'),
    offset: intParam(params, 'offset'),
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
  const limit = intParam(new URL(req.url).searchParams, 'limit') ?? 50;
  return json(await q.getReviewQueue(Math.min(Math.max(limit, 1), 200)));
}

export async function setProductCategoryHandler(req: Request, id: string): Promise<Response> {
  const body = await readJson(req).catch(() => {
    throw new HttpError(400, 'Body must be { categoryPath: string, reviewedBy?: string }');
  });
  if (typeof body.categoryPath !== 'string') {
    return json({ error: 'Body must be { categoryPath: string, reviewedBy?: string }' }, 400);
  }
  const reviewedBy = typeof body.reviewedBy === 'string' ? body.reviewedBy : null;
  const r = await q.setProductCategory(id, body.categoryPath, reviewedBy);
  return r.ok ? json(r) : json({ error: r.error }, 400);
}
