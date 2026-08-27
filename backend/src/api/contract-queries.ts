import { sql } from '../lib/db';
import type {
  Product, Offer, ProductWithOffers, CategoryPage, Category,
  BasketRequest, BasketResult, StoreBasketTotal, PriceHistory, PricePoint,
  DeliveryRule, PersonalisedProduct, ShopperProfile, ObservedSignals,
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
const toEuros = (cents: number): number => Math.round(cents) / 100;

interface ProductRow {
  id: string; contract_id: string | null; ean: string; brand: string;
  title: string; unit: string | null; category: string; subcategory: string | null;
  image_url: string | null; specs: Record<string, string> | null;
}

function toProduct(r: ProductRow): Product {
  return {
    // Prefer the contract slug; fall back to the numeric id so a product
    // ingested from a real feed before matching is still addressable.
    id: r.contract_id ?? String(r.id),
    ean: r.ean,
    brand: r.brand,
    name: r.title,
    unit: r.unit ?? '',
    // The contract allows exactly home | sport | tech. Anything else in the
    // database is a data error, not a new category — default rather than emit
    // a value the front end's Record<Category, …> lookups cannot handle.
    category: (['home', 'sport', 'tech'].includes(r.category) ? r.category : 'sport') as Category,
    subcategory: r.subcategory ?? r.category,
    image: r.image_url ?? '',
    specs: r.specs ?? {},
  };
}

const PRODUCT_COLS = sql`
  p.id, p.contract_id, p.ean, p.brand, p.title, p.unit,
  p.category, p.subcategory, p.image_url, p.specs
`;

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
    productId: r.contract_id ?? String(r.product_id),
    store: r.slug,
    // Shipping is folded into the price here because the contract's Offer has
    // no shipping field. The database keeps them separate — which is the right
    // call, and the reason the DB ranks on price+shipping while the contract
    // can only rank on one number.
    price: toEuros(r.price_cents + r.shipping_cents),
    // Safe because ingest rejects non-euro offers and offersFor() filters them
    // out: the contract's Offer.currency is the literal "EUR".
    currency: 'EUR',
    inStock: r.in_stock,
    url: r.product_url,
    lastChecked: r.last_seen_at.toISOString(),
  };
}

async function offersFor(productDbIds: string[]): Promise<Map<string, Offer[]>> {
  if (productDbIds.length === 0) return new Map();
  const rows = await sql<OfferRow[]>`
    select p.contract_id, o.product_id, r.slug, o.price_cents, o.shipping_cents,
           o.in_stock, o.product_url, o.last_seen_at
      from offer o
      join retailer r on r.id = o.retailer_id and r.is_active
      join product  p on p.id = o.product_id
     where o.product_id = any(${productDbIds}::bigint[])
      -- The contract's Offer.currency is the literal "EUR", and ranking adds
      -- raw cents with no conversion. Ingest refuses non-euro rows; this is the
      -- second lock, so a row ingested before that check cannot reach the API.
      and o.currency = 'EUR'
     order by (o.price_cents + o.shipping_cents) asc, r.slug asc
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
     where ${byId(id)} and p.status = 'published' limit 1`;
  if (!row) return null;
  const offers = (await offersFor([row.id])).get(String(row.id)) ?? [];
  return { product: toProduct(row), offers };
}

// ---------------------------------------------------------------------------
// GET /api/search?q=
// ---------------------------------------------------------------------------
export async function searchProducts(q: string): Promise<Product[]> {
  const term = q.trim();
  // The contract's behaviour: an empty query returns everything.
  const rows = term
    ? await sql<ProductRow[]>`
        select ${PRODUCT_COLS} from product p
         where p.status = 'published'
           and (p.title ilike ${'%' + term + '%'}
             or p.brand ilike ${'%' + term + '%'}
             or p.subcategory ilike ${'%' + term + '%'}
             or p.unit ilike ${'%' + term + '%'})
         order by similarity(p.title, ${term}) desc, p.title asc
         limit 100`
    : await sql<ProductRow[]>`
        select ${PRODUCT_COLS} from product p
         where p.status = 'published' order by p.id asc limit 200`;
  return rows.map(toProduct);
}

// ---------------------------------------------------------------------------
// GET /api/category/:cat
// ---------------------------------------------------------------------------
const SUBCATEGORY_META: Record<string, { name: string; icon: string; essentials: string[] }> = {
  hardlopen: { name: 'Hardlopen', icon: 'shoe', essentials: ['Hardloopschoenen', 'GPS-horloge', 'Hardloopsokken', 'Hartslagband'] },
  fietsen:   { name: 'Fietsen',   icon: 'bike', essentials: ['Fiets', 'Helm', 'Fietsbroek', 'Verlichting'] },
  fitness:   { name: 'Fitness',   icon: 'dumbbell', essentials: ['Trainingsschoenen', 'Dumbbells', 'Fitnessmat', 'Weerstandsbanden'] },
};

const CATEGORY_META: Record<Category, { name: string; blurb: string }> = {
  sport: { name: 'Sport', blurb: 'Vind de juiste spullen voor de sport die je écht doet — met de prijs van elke winkel naast elkaar.' },
  home:  { name: 'Wonen', blurb: 'Binnenkort — we beginnen met sport en breiden daarna uit.' },
  tech:  { name: 'Techniek', blurb: 'Binnenkort — we beginnen met sport en breiden daarna uit.' },
};

export async function getCategory(cat: string): Promise<CategoryPage | null> {
  if (!['home', 'sport', 'tech'].includes(cat)) return null;
  const category = cat as Category;

  // Subcategories are derived from what is actually in the database, so the
  // browse page can never advertise a subcategory with nothing behind it.
  const rows = await sql<{ subcategory: string }[]>`
    select distinct subcategory from product
     where status = 'published' and category = ${category} and subcategory is not null
     order by subcategory`;

  return {
    category,
    name: CATEGORY_META[category].name,
    blurb: CATEGORY_META[category].blurb,
    subcategories: rows.map((r) => ({
      id: r.subcategory,
      name: SUBCATEGORY_META[r.subcategory]?.name ?? r.subcategory,
      icon: SUBCATEGORY_META[r.subcategory]?.icon ?? 'tag',
      essentials: SUBCATEGORY_META[r.subcategory]?.essentials ?? [],
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
       and p.status = 'published'`;
  const offers = await offersFor(rows.map((r) => r.id));

  // Preserve the caller's order — the basket page lists items as the user added
  // them, and returning them in database order would silently reshuffle it.
  const byKey = new Map(rows.map((r) => [r.contract_id ?? String(r.id), r]));
  return ids
    .map((id) => byKey.get(id))
    .filter((r): r is ProductRow => Boolean(r))
    .map((r) => ({
      productId: r.contract_id ?? String(r.id),
      productName: r.title,
      offers: offers.get(String(r.id)) ?? [],
    }));
}

export async function getDeliveryRules(): Promise<DeliveryRule[]> {
  const rows = await sql<{ slug: string; delivery_fee_cents: number; free_above_cents: number }[]>`
    select slug, delivery_fee_cents, free_above_cents from retailer where is_active order by slug`;
  return rows.map((r) => ({
    store: r.slug,
    fee: toEuros(r.delivery_fee_cents),
    freeAbove: toEuros(r.free_above_cents),
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
     where ${byId(id)} and p.status = 'published' limit 1`;
  if (!row) return null;

  const publicId = row.contract_id ?? String(row.id);

  // One point per day: the cheapest observation that day, and which retailer
  // it came from. The contract's PricePoint carries the store, so a chart can
  // show who was cheapest when — which is the interesting part.
  const rows = await sql<{ day: Date; price_cents: number; slug: string }[]>`
    select distinct on (day)
           date_trunc('day', po.observed_at)::date as day,
           po.price_cents,
           r.slug
      from price_observation po
      join retailer r on r.id = po.retailer_id
     where po.product_id = ${row.id}
       and po.observed_at >= now() - interval '30 days'
     order by day asc, po.price_cents asc`;

  const points: PricePoint[] = rows.map((r) => ({
    at: r.day.toISOString(),
    store: r.slug,
    price: toEuros(r.price_cents),
  }));

  const [cur] = await sql<{ m: number | null }[]>`
    select min(price_cents + shipping_cents)::int as m
      from offer where product_id = ${row.id}`;

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
// POST /api/personalise — mirrors lib/profile.ts so client and server agree.
// ---------------------------------------------------------------------------
export async function personalise(
  productIds: string[],
  profile: ShopperProfile | null,
  observed?: ObservedSignals | null
): Promise<PersonalisedProduct[]> {
  const rows = await sql<ProductRow[]>`
    select ${PRODUCT_COLS} from product p
     where (p.contract_id = any(${productIds}) or p.id::text = any(${productIds}))
       and p.status = 'published'`;
  const products = rows.map(toProduct);

  if (!profile) return products.map((product) => ({ product, matchScore: 50, reasons: [] }));

  const BANDS = ['value', 'mid', 'premium'];
  return products
    .map((product) => {
      let score = 50;
      const reasons: string[] = [];
      const s = product.specs ?? {};

      const want = profile.budget?.[product.category];
      if (want && s.tier) {
        const d = Math.abs(BANDS.indexOf(want) - BANDS.indexOf(s.tier));
        if (d === 0) { score += 20; reasons.push(`Past bij je budget (${want})`); }
        else if (d >= 2) score -= 15;
      }

      if (profile.priority === 'quality' && Number(s.quality) >= 4) {
        score += 18; reasons.push('Hoog beoordeeld op kwaliteit');
      } else if (profile.priority === 'newest' && Number(s.released) >= 2026) {
        score += 18; reasons.push('Nieuwste model');
      } else if (profile.priority === 'price' && s.tier === 'value') {
        score += 18; reasons.push('Scherp geprijsd');
      }

      const detail = profile.detail?.[product.subcategory];
      if (detail?.niveau && s.level && detail.niveau === s.level) {
        score += 12; reasons.push(`Voor ${s.level} sporters`);
      }
      if (profile.categories?.includes(product.category)) score += 5;

      if (observed) {
        if (observed.purchasedProductIds?.includes(product.id)) score -= 40;
        if (observed.viewedProductIds?.includes(product.id)) score += 4;
        if (observed.clickedOutProductIds?.includes(product.id)) score += 8;
        if ((observed.categoryAffinity?.[product.category] ?? 0) >= 3) score += 6;
      }

      return {
        product,
        matchScore: Math.max(0, Math.min(100, Math.round(score))),
        reasons: reasons.slice(0, 2),
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}
