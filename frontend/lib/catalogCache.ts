// ============================================================================
//  CATALOGUE CACHE — one place that says what is cached and for how long.
// ----------------------------------------------------------------------------
//  "Catalogue" means data that is the same for every visitor: products,
//  categories, offers/prices, price history. It only changes when the ingest
//  job on Railway runs, so every visitor can safely be served the same copy.
//
//  How it stays fresh:
//    1. When the ingest job finishes it calls POST /api/revalidate with the
//       products whose prices changed; those products and the category
//       listings are cleared straight away (a full clear of CATALOG_TAG is
//       used for very large changes). Prices on the site are then never older
//       than the database.
//    2. CATALOG_REVALIDATE is only a backstop: if that call ever fails, a
//       cached copy is still thrown away after this many seconds.
//
//  NEVER use this for anything tied to one person — basket, profile, account,
//  saved items, alerts, personalised results. A cached response is served to
//  EVERY visitor, so caching personal data would show one shopper's data to
//  another. Those calls must stay `cache: "no-store"`.
//
//  Only 200 responses are cached (Next.js skips errors), so a backend hiccup
//  can never be cached and served to everyone.
// ============================================================================

export const CATALOG_TAG = "catalog";

// 1 hour. Prices are refreshed hourly and some shops (bol) require prices to
// match their site "at all times", so a failed clear may never leave a price
// on the site for longer than this. Keep in sync with `export const revalidate` in the catalogue pages
// (app/category/..., app/product/...) — Next.js needs a literal number there.
export const CATALOG_REVALIDATE = 3600;

// Finer tags, so an ingest run that changed a few prices clears only those
// products (plus the category listings, which show every product's lowest
// price) instead of the whole catalogue. See app/api/revalidate/route.ts.
export const LISTING_TAG = "catalog:listing";
export const productTag = (id: string) => `catalog:product:${id}`;

/**
 * Tags for a cached backend path. Everything gets CATALOG_TAG (so a full clear
 * still works); product and price-history reads also get their product's tag;
 * category reads get LISTING_TAG.
 */
export function catalogTagsFor(path: string): string[] {
  const m = path.match(/^\/api\/(?:product|price-history)\/([^/?#]+)/);
  if (m) return [CATALOG_TAG, productTag(decodeURIComponent(m[1]))];
  if (/^\/api\/categor(?:y|ies)\//.test(path)) return [CATALOG_TAG, LISTING_TAG];
  return [CATALOG_TAG];
}

/** fetch() options for a cached catalogue read of `path` (a backend /api path). */
export function catalogFetchInit(path: string): RequestInit {
  return { next: { revalidate: CATALOG_REVALIDATE, tags: catalogTagsFor(path) } };
}
