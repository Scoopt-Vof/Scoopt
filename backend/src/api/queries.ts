import { sql } from '../lib/db';
import type { Product, ProductWithOffers, PriceHistory, Offer } from '../contract/types';

/**
 * All database access lives here. The route handlers do HTTP; these do SQL.
 * Hand-written SQL, no ORM — per the 6 Aug decision.
 */

interface OfferRow {
  slug: string; name: string; price_cents: number; shipping_cents: number;
  in_stock: boolean; product_url: string; last_seen_at: Date;
}

function toOffer(r: OfferRow): Offer {
  return {
    retailer: { slug: r.slug, name: r.name },
    priceCents: r.price_cents,
    shippingCents: r.shipping_cents,
    totalCents: r.price_cents + r.shipping_cents,
    inStock: r.in_stock,
    url: r.product_url,
    lastSeenAt: r.last_seen_at.toISOString(),
  };
}

export async function getProduct(id: string): Promise<ProductWithOffers | null> {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) return null;

  const [p] = await sql<any[]>`
    select id, ean, brand, title, category, image_url, description
      from product
     where id = ${productId} and status = 'published'
  `;
  if (!p) return null;

  // ORDER BY total, not price: a €30 item with €4 shipping loses to a €32 item
  // with free shipping, and the user cares about what leaves their bank account.
  const offerRows = await sql<OfferRow[]>`
    select r.slug, r.name, o.price_cents, o.shipping_cents,
           o.in_stock, o.product_url, o.last_seen_at
      from offer o
      join retailer r on r.id = o.retailer_id
     -- Totals add raw cents with no conversion, so a non-euro offer would be
     -- ranked against euro ones as if the numbers matched. Ingest refuses them;
     -- this keeps any row stored before that check out of the comparison.
     where o.product_id = ${productId} and r.is_active and o.currency = 'EUR'
     order by (o.price_cents + o.shipping_cents) asc, r.slug asc
  `;

  const offers = offerRows.map(toOffer);

  return {
    id: String(p.id),
    ean: p.ean,
    brand: p.brand,
    title: p.title,
    category: p.category,
    imageUrl: p.image_url,
    description: p.description,
    fromCents: offers.length ? offers[0].totalCents : null,
    offers,
  };
}

export async function searchProducts(q: string, limit = 24): Promise<Product[]> {
  const term = q.trim();
  if (term.length < 2) return [];

  // The retailer join must sit INSIDE the left join, not beside it — a plain
  // `join retailer` after a `left join offer` silently turns the outer join
  // back into an inner one, hiding every product whose only retailer is
  // inactive. Harmless with one retailer, wrong the moment there are several.
  const rows = await sql<any[]>`
    select p.id, p.ean, p.brand, p.title, p.category, p.image_url,
           min(o.price_cents + o.shipping_cents) as from_cents,
           count(distinct o.retailer_id) as retailer_count
      from product p
      left join (
             offer o join retailer r on r.id = o.retailer_id and r.is_active
           ) on o.product_id = p.id and o.currency = 'EUR'
     where p.status = 'published'
       and (p.title ilike ${'%' + term + '%'} or p.brand ilike ${'%' + term + '%'})
     group by p.id
     order by similarity(p.title, ${term}) desc, from_cents asc nulls last
     limit ${limit}
  `;

  return rows.map((p) => ({
    id: String(p.id),
    ean: p.ean,
    brand: p.brand,
    title: p.title,
    category: p.category,
    imageUrl: p.image_url,
    fromCents: p.from_cents === null ? null : Number(p.from_cents),
  }));
}

export async function getPriceHistory(id: string, days = 30): Promise<PriceHistory | null> {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) return null;

  const [exists] = await sql<any[]>`
    select 1 from product where id = ${productId} and status = 'published'
  `;
  if (!exists) return null;

  // One point per day = the cheapest observation that day, across all retailers.
  const rows = await sql<{ day: Date; price_cents: number }[]>`
    select date_trunc('day', observed_at)::date as day,
           min(price_cents)::int as price_cents
      from price_observation
     where product_id = ${productId}
       and observed_at >= now() - ${days + ' days'}::interval
     group by 1
     order by 1 asc
  `;

  const points = rows.map((r) => ({
    date: r.day.toISOString().slice(0, 10),
    priceCents: r.price_cents,
  }));

  const [current] = await sql<{ current_min: number | null }[]>`
    select min(price_cents + shipping_cents)::int as current_min
      from offer where product_id = ${productId} and currency = 'EUR'
  `;

  const observed = points.map((p) => p.priceCents);
  const currentMin = current?.current_min ?? (observed.length ? observed[observed.length - 1] : 0);

  // INVARIANT min30 <= currentMin <= max30. The current offer total includes
  // shipping while observations do not, so fold currentMin into the range
  // rather than letting the invariant break on a shipping-only difference.
  const pool = observed.length ? [...observed, currentMin] : [currentMin];

  return {
    productId: String(productId),
    points,
    min30: Math.min(...pool),
    max30: Math.max(...pool),
    currentMin,
  };
}
