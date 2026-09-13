import { sql } from './db';

/**
 * What counts as a LIVE offer — the one definition every read path uses.
 *
 * Before this, each query applied its own subset of these rules (one filtered
 * currency, another active retailers, none checked freshness), so the price on
 * a category card, the product page and the price history could all disagree.
 *
 *   * EUR only — totals add raw cents with no currency conversion anywhere.
 *   * active retailer only.
 *   * seen recently — an offer row is refreshed on every ingest run but was
 *     never expired, so an ended eBay listing kept showing as "cheapest"
 *     forever. OFFER_MAX_AGE_HOURS (default 48) is the window.
 *
 * Stock is deliberately NOT part of this filter: out-of-stock offers are still
 * worth showing, but always ranked below in-stock ones (see LIVE_OFFER_ORDER).
 * The basket comparison excludes them explicitly.
 *
 * Expects the offer aliased `o` and its retailer joined as `r`.
 */
export const OFFER_MAX_AGE_HOURS = (() => {
  const n = Number(process.env.OFFER_MAX_AGE_HOURS ?? 48);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 48;
})();

export const LIVE_OFFER = sql`
  o.currency = 'EUR'
  and r.is_active
  and o.last_seen_at >= now() - make_interval(hours => ${OFFER_MAX_AGE_HOURS}::int)
`;

/** In stock first, then cheapest delivered total, then a stable tiebreak. */
export const LIVE_OFFER_ORDER = sql`
  o.in_stock desc, (o.price_cents + o.shipping_cents) asc, r.slug asc
`;
