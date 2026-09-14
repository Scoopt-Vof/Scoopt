import { sql } from '../lib/db';
import { LIVE_OFFER, LIVE_OFFER_ORDER } from '../lib/offers';
import type {
  Product, Offer, ProductWithOffers, CategoryPage, Category,
  BasketRequest, BasketResult, StoreBasketTotal, PriceHistory, PricePoint,
  DeliveryRule, PersonalisedProduct, ShopperProfile, ObservedSignals,
  BudgetBand, Priority,
} from '../contract/frontend-types';

/**
 * THE BRIDGE — Postgres rows → Josh's contract shapes.
 *
 * This is the file that makes the database usable by the front end, and it
 * exists because the two halves genuinely disagree about representation:
 *
 *   database                     contract
 *   ─────────────────────────────────────────────────────
 *   price_cents: 13999           price: 139.99
 *   title                        name
 *   image_url                    image
 *   retailer {slug,name}         store: "bol.com"
 *   flat product + offers[]      { product, offers }
 *   id: 42 (bigserial)           id: "run-pegasus41"
 *
 * Neither side is wrong. Integer cents is correct for storage — floats corrupt
 * money, and the whole product is judged on whether the numbers are right.
 * Euro floats are correct for a JSON API a browser consumes. The conversion has
 * to happen exactly once, in one place, and this is that place.
 *
 * Conversion happens ONLY on the way out. Nothing upstream of here ever sees a
 * float, so a rounding error cannot get into the database.
 */

/** The single conversion point. Integer cents in, euros out, correctly rounded. */
export const toEuros = (cents: number): number => Math.round(cents) / 100;

/**
 * The ONE public product id rule, used by every endpoint (this file and
 * catalog-queries.ts): the contract slug when a product has one, otherwise the
 * numeric id. Endpoints that disagreed on this made the same product appear
 * twice in a basket.
 */
export const publicProductId = (contractId: string | null, id: string | number): string =>
  contractId ?? String(id);

const CATEGORIES: readonly Category[] = ['home', 'sport', 'tech'];

interface ProductRow {
  id: string; contract_id: string | null; ean: string; brand: string;
  title: string; unit: string | null; category: string; subcategory: string | null;
  image_url: string | null; specs: Record<string, string> | null;
  description: string | null;
}

function toProduct(r: ProductRow): Product {
  return {
    id: publicProductId(r.contract_id, r.id),
    ean: r.ean,
    brand: r.brand,
    name: r.title,
    unit: r.unit ?? '',
    // VISIBLE_PRODUCT below already excludes any category outside the
    // contract's home | sport | tech, so this cast is safe. It used to rewrite
    // unknown values to 'sport', which quietly filled Sport with junk.
    category: r.category as Category,
    subcategory: r.subcategory ?? r.category,
    image: r.image_url ?? '',
    specs: r.specs ?? {},
    // Icecat's product description, stored on product.description. Omitted when
    // absent (the contract field is optional), so it never sends an empty string.
    description: r.description ?? undefined,
  };
}

const PRODUCT_COLS = sql`
  p.id, p.contract_id, p.ean, p.brand, p.title, p.unit,
  p.category, p.subcategory, p.image_url, p.specs, p.description
`;

/** Published, and in a category the contract can represent. */
const VISIBLE_PRODUCT = sql`p.status = 'published' and p.category in ('home', 'sport', 'tech')`;

/** Accepts either the contract slug or the numeric id. */
const byId = (id: string) =>
  sql`(p.contract_id = ${id} or p.id::text = ${id})`;

interface OfferRow {
  contract_id: string | null; product_id: string; slug: string;
  price_cents: number; shipping_cents: number; in_stock: boolean;
  product_url: string; last_seen_at: Date;
}

function toOffer(r: OfferRow): Offer {
  return {
    productId: publicProductId(r.contract_id, r.product_id),
    store: r.slug,
    // Shipping is folded into the price here because the contract's Offer has
    // no shipping field. The database keeps them separate — which is the right
    // call, and the reason the DB ranks on price+shipping while the contract
    // can only rank on one number.
    //
    // CONTRACT NOTE: because shipping is already inside `price`, the basket
    // planner must not add a per-offer shipping cost again. Delivery rules
    // (getDeliveryRules) are the retailer's order-level fee, a separate thing.
    price: toEuros(r.price_cents + r.shipping_cents),
    // Safe because ingest rejects non-euro offers and LIVE_OFFER filters them
    // out: the contract's Offer.currency is the literal "EUR".
    currency: 'EUR',
    inStock: r.in_stock,
    url: r.product_url,
    lastChecked: r.last_seen_at.toISOString(),
  };
}

/**
 * Live offers per product, in stock first and cheapest first within that, so
 * offers[0] is always the best offer a shopper can actually buy.
 */
async function offersFor(productDbIds: string[]): Promise<Map<string, Offer[]>> {
  if (productDbIds.length === 0) return new Map();
  const rows = await sql<OfferRow[]>`
    select p.contract_id, o.product_id, r.slug, o.price_cents, o.shipping_cents,
           o.in_stock, o.product_url, o.last_seen_at
      from offer o
      join retailer r on r.id = o.retailer_id
      join product  p on p.id = o.product_id
     where o.product_id = any(${productDbIds}::bigint[])
       and ${LIVE_OFFER}
     order by ${LIVE_OFFER_ORDER}
  `;
  const map = new Map<string, Offer[]>();
  for (const row of rows) {
    const key = String(row.product_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(toOffer(row));
  }
  return map;
}

// ---------------------------------------------------------------------------
// GET /api/product/:id
// ---------------------------------------------------------------------------
export async function getProduct(id: string): Promise<ProductWithOffers | null> {
  const [row] = await sql<ProductRow[]>`
    select ${PRODUCT_COLS} from product p
     where ${byId(id)} and ${VISIBLE_PRODUCT} limit 1`;
  if (!row) return null;
  const offers = (await offersFor([row.id])).get(String(row.id)) ?? [];
  return { product: toProduct(row), offers };
}

// ---------------------------------------------------------------------------
// GET /api/search?q=&limit=&offset=
// ---------------------------------------------------------------------------
export const SEARCH_DEFAULT_LIMIT = 100;
export const SEARCH_EMPTY_DEFAULT_LIMIT = 200;
export const SEARCH_MAX_LIMIT = 200;
const SEARCH_MAX_WORDS = 8;

/** ILIKE treats % and _ as wildcards; a shopper typing them means the literal. */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => '\\' + c);

export async function searchProducts(
  q: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<Product[]> {
  const term = q.trim();
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));

  // The contract's behaviour: an empty query lists the catalogue. It is paged
  // (limit/offset), not unbounded — callers that want "everything" must page.
  if (!term) {
    const limit = clampLimit(opts.limit, SEARCH_EMPTY_DEFAULT_LIMIT);
    const rows = await sql<ProductRow[]>`
      select ${PRODUCT_COLS} from product p
       where ${VISIBLE_PRODUCT}
       order by p.id asc limit ${limit} offset ${offset}`;
    return rows.map(toProduct);
  }

  // Every word must match somewhere (title, brand, subcategory or unit), in
  // any order — so "nike shoe" finds "Nike Pegasus running shoe", which a
  // single substring match never did.
  const words = term.split(/\s+/).filter(Boolean).slice(0, SEARCH_MAX_WORDS);
  const wordMatches = words.map((w) => {
    const pattern = '%' + escapeLike(w) + '%';
    return sql`(p.title ilike ${pattern} or p.brand ilike ${pattern}
             or p.subcategory ilike ${pattern} or p.unit ilike ${pattern})`;
  });
  const allWords = wordMatches.reduce((acc, m) => sql`${acc} and ${m}`);

  const limit = clampLimit(opts.limit, SEARCH_DEFAULT_LIMIT);
  const rows = await sql<ProductRow[]>`
    select ${PRODUCT_COLS} from product p
     where ${VISIBLE_PRODUCT} and ${allWords}
     order by similarity(p.title, ${term}) desc, p.title asc, p.id asc
     limit ${limit} offset ${offset}`;
  return rows.map(toProduct);
}

function clampLimit(requested: number | undefined, fallback: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.min(Math.max(Math.floor(requested), 1), SEARCH_MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// GET /api/category/:cat
// ---------------------------------------------------------------------------
// Read from the category TREE (007_category_tree.sql, metadata from 014), the
// same source /api/categories/.../products uses. It used to read the legacy
// product.subcategory text column plus a hardcoded name/icon table here, so
// the subcategory tiles and the product grid on one page could disagree.
//
// A subcategory is listed only when it has at least one published product in
// it or below it, so the browse page never advertises an empty shelf.
export async function getCategory(cat: string): Promise<CategoryPage | null> {
  if (!CATEGORIES.includes(cat as Category)) return null;
  const category = cat as Category;

  const [root] = await sql<{ name: string; blurb: string | null }[]>`
    select name, blurb from category
     where path = ${category} and parent_id is null and is_active limit 1`;
  if (!root) return null;

  const rows = await sql<{ slug: string; name: string; icon: string | null; essentials: string[] }[]>`
    select c.slug, c.name, c.icon, c.essentials
      from category c
      join category parent on parent.id = c.parent_id and parent.path = ${category}
     where c.is_active
       and exists (
         select 1 from products_in_category(c.path) pic
           join product p on p.id = pic.product_id and p.status = 'published')
     order by c.position, c.name`;

  return {
    category,
    name: root.name,
    blurb: root.blurb ?? '',
    subcategories: rows.map((r) => ({
      id: r.slug,
      name: r.name,
      icon: r.icon ?? 'tag',
      essentials: r.essentials ?? [],
    })),
  };
}

// ---------------------------------------------------------------------------
// POST /api/basket/plan  and  POST /api/basket/compare
// ---------------------------------------------------------------------------
export async function basketItemsWithOffers(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await sql<ProductRow[]>`
    select ${PRODUCT_COLS} from product p
     where (p.contract_id = any(${ids}) or p.id::text = any(${ids}))
       and ${VISIBLE_PRODUCT}`;
  const offers = await offersFor(rows.map((r) => r.id));

  // Preserve the caller's order — the basket page lists items as the user added
  // them, and returning them in database order would silently reshuffle it.
  // Index by BOTH ids, so a basket holding either spelling still resolves.
  const byKey = new Map<string, ProductRow>();
  for (const r of rows) {
    byKey.set(String(r.id), r);
    if (r.contract_id) byKey.set(r.contract_id, r);
  }
  const seen = new Set<string>();
  return ids
    .map((id) => byKey.get(id))
    .filter((r): r is ProductRow => {
      if (!r || seen.has(String(r.id))) return false;
      seen.add(String(r.id));
      return true;
    })
    .map((r) => ({
      productId: publicProductId(r.contract_id, r.id),
      productName: r.title,
      // The planner picks the cheapest offer per item, so only offers a
      // shopper can actually buy are candidates. /basket/compare applies the
      // same rule, so the two endpoints now agree.
      offers: (offers.get(String(r.id)) ?? []).filter((o) => o.inStock),
    }));
}

export async function getDeliveryRules(): Promise<DeliveryRule[]> {
  const rows = await sql<{ slug: string; delivery_fee_cents: number; free_above_cents: number | null }[]>`
    select slug, delivery_fee_cents, free_above_cents from retailer where is_active order by slug`;
  return rows.map((r) => ({
    store: r.slug,
    fee: toEuros(r.delivery_fee_cents),
    // NULL = no free-delivery threshold (012). Omitting the key is how the
    // contract says that; sending 0 meant "free above €0", i.e. always free.
    ...(r.free_above_cents == null ? {} : { freeAbove: toEuros(r.free_above_cents) }),
  }));
}

export async function compareBasket(req: BasketRequest): Promise<BasketResult> {
  const items = await basketItemsWithOffers(req.items);
  const stores = (await sql<{ slug: string }[]>`
    select slug from retailer where is_active order by slug`).map((r) => r.slug);

  const totals: StoreBasketTotal[] = stores
    .map((store) => {
      let totalCents = 0;
      const missing: string[] = [];
      for (const item of items) {
        const offer = item.offers.find((o) => o.store === store && o.inStock);
        if (offer) totalCents += Math.round(offer.price * 100);
        else missing.push(item.productName);
      }
      return {
        store,
        total: totalCents / 100,
        complete: items.length > 0 && missing.length === 0,
        missing,
      };
    })
    .sort((a, b) => Number(b.complete) - Number(a.complete) || a.total - b.total);

  return { totals, cheapestComplete: totals.find((t) => t.complete) };
}

// ---------------------------------------------------------------------------
// GET /api/price-history/:id
// ---------------------------------------------------------------------------
export async function getPriceHistory(id: string): Promise<PriceHistory | null> {
  const [row] = await sql<{ id: string; contract_id: string | null }[]>`
    select p.id, p.contract_id from product p
     where ${byId(id)} and ${VISIBLE_PRODUCT} limit 1`;
  if (!row) return null;

  const publicId = publicProductId(row.contract_id, row.id);

  // One point per day: the cheapest IN-STOCK delivered price that day, and the
  // retailer it came from. Delivered = price + shipping, the same basis as the
  // current minimum below and as Offer.price, so "lowest in 30 days" compares
  // like with like. Observations from before 013 have no shipping recorded
  // (NULL, read as 0) and no currency (NULL, read as EUR — ingest refused
  // everything else long before that migration).
  const rows = await sql<{ day: Date; total_cents: number; slug: string }[]>`
    select distinct on (day)
           date_trunc('day', po.observed_at)::date as day,
           (po.price_cents + coalesce(po.shipping_cents, 0))::int as total_cents,
           r.slug
      from price_observation po
      join retailer r on r.id = po.retailer_id and r.is_active
     where po.product_id = ${row.id}
       and po.observed_at >= now() - interval '30 days'
       and po.in_stock
       and coalesce(po.currency, 'EUR') = 'EUR'
     order by day asc, total_cents asc`;

  const points: PricePoint[] = rows.map((r) => ({
    at: r.day.toISOString(),
    store: r.slug,
    price: toEuros(r.total_cents),
  }));

  // The same live, in-stock offers the product page ranks first.
  const [cur] = await sql<{ m: number | null }[]>`
    select min(o.price_cents + o.shipping_cents)::int as m
      from offer o
      join retailer r on r.id = o.retailer_id
     where o.product_id = ${row.id} and ${LIVE_OFFER} and o.in_stock`;

  if (points.length === 0 && cur?.m == null) {
    return { productId: publicId, points: [], currentMin: 0, min30: 0, max30: 0, isLowest30: false };
  }

  const currentMin = cur?.m != null ? toEuros(cur.m) : points[points.length - 1].price;
  const pool = points.length ? [...points.map((p) => p.price), currentMin] : [currentMin];

  return {
    productId: publicId,
    points,
    currentMin,
    min30: Math.min(...pool),
    max30: Math.max(...pool),
    isLowest30: currentMin <= Math.min(...pool) + 0.001,
  };
}

// ---------------------------------------------------------------------------
// POST /api/personalise — mirrors frontend lib/profile.ts so client and server agree.
// ---------------------------------------------------------------------------
// Kept rule-for-rule and reason-for-reason identical to scoreProduct() in the
// front end (English reasons, the same penalties, the same affinity rule). If
// you change one, change the other — or retire one of them.
const BUDGET_LABEL: Record<BudgetBand, string> = { value: 'value', mid: 'mid', premium: 'premium' };
const PRIORITY_LABEL: Record<Priority, string> = { price: 'price', quality: 'quality', newest: 'newest' };

export async function personalise(
  productIds: string[],
  profile: ShopperProfile | null,
  observed?: ObservedSignals | null
): Promise<PersonalisedProduct[]> {
  if (productIds.length === 0) return [];
  const rows = await sql<ProductRow[]>`
    select ${PRODUCT_COLS} from product p
     where (p.contract_id = any(${productIds}) or p.id::text = any(${productIds}))
       and ${VISIBLE_PRODUCT}`;
  const products = rows.map(toProduct);

  if (!profile) return products.map((product) => ({ product, matchScore: 50, reasons: [] }));

  const merged: ShopperProfile = observed
    ? { ...profile, viewedProductIds: observed.viewedProductIds, purchasedProductIds: observed.purchasedProductIds }
    : profile;

  return products
    .map((product) => scoreProduct(product, merged, observed ?? null))
    .sort((a, b) => b.matchScore - a.matchScore);
}

function scoreProduct(
  product: Product, profile: ShopperProfile, observed: ObservedSignals | null
): PersonalisedProduct {
  let score = 50;
  const reasons: string[] = [];
  const specs = product.specs ?? {};

  const wantBudget = profile.budget?.[product.category];
  const tier = specs.tier as BudgetBand | undefined;
  if (wantBudget && tier) {
    if (tier === wantBudget) {
      score += 20;
      reasons.push(`Fits your budget (${BUDGET_LABEL[wantBudget]})`);
    } else if (
      (wantBudget === 'value' && tier === 'premium') ||
      (wantBudget === 'premium' && tier === 'value')
    ) {
      score -= 15;
    }
  }

  if (profile.priority === 'quality' && specs.quality) {
    if (Number(specs.quality) >= 4) { score += 18; reasons.push('Highly rated for quality'); }
  }
  if (profile.priority === 'newest' && specs.released) {
    if (Number(specs.released) >= 2026) { score += 18; reasons.push('Newest model'); }
  }
  if (profile.priority === 'price' && tier === 'value') {
    score += 18; reasons.push('Sharply priced');
  }

  const detail = profile.detail?.[product.subcategory];
  if (detail?.niveau && specs.level && detail.niveau === specs.level) {
    score += 12;
    reasons.push(`For ${detail.niveau} level`);
  }

  if (profile.categories?.includes(product.category)) score += 5;

  if (profile.purchasedProductIds?.includes(product.id)) score -= 40;
  if (profile.viewedProductIds?.includes(product.id)) score += 4;
  if (observed) {
    if (observed.clickedOutProductIds?.includes(product.id)) {
      score += 8;
      reasons.push('You showed interest in this');
    }
    const affinity = observed.categoryAffinity?.[product.category] ?? 0;
    if (affinity >= 3 && profile.categories?.includes(product.category)) score += 6;
  }

  if (reasons.length === 0) reasons.push(`Chosen for ${PRIORITY_LABEL[profile.priority]}`);

  return {
    product,
    matchScore: Math.max(0, Math.min(100, Math.round(score))),
    reasons: reasons.slice(0, 2),
  };
}
