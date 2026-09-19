// ============================================================================
//  CATALOGUE CACHE — one place that says what is cached and for how long.
// ----------------------------------------------------------------------------
//  "Catalogue" means data that is the same for every visitor: products,
//  categories, offers/prices, price history. It only changes when the ingest
//  job on Railway runs, so every visitor can safely be served the same copy.
//
//  How it stays fresh:
//    1. When the ingest job finishes it calls POST /api/revalidate, which
//       clears everything tagged CATALOG_TAG straight away (see
//       app/api/revalidate/route.ts). Prices on the site are then never older
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

export const catalogFetchInit: RequestInit = {
  next: { revalidate: CATALOG_REVALIDATE, tags: [CATALOG_TAG] },
};
