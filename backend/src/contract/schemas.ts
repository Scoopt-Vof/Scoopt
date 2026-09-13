import { z } from 'zod';

/**
 * Zod mirrors of the shapes in contract/frontend-types.ts — the contract the
 * front end actually consumes.
 *
 * TypeScript checks shape at compile time; these check shape AND the prose
 * invariants at run time, against real data coming out of a real database.
 * The invariants are the interesting part — a response can be perfectly
 * well-typed and still be wrong (offers in the wrong order, a €0 price,
 * a "lowest in 30 days" badge that isn't true).
 *
 * (These previously mirrored the legacy trial API's shapes — priceCents,
 * flat products — which the website never read. That API has been removed.)
 */

const euros = z.number().positive().max(50_000);

export const CategorySchema = z.enum(['home', 'sport', 'tech']);

export const OfferSchema = z.object({
  productId: z.string().min(1),
  store: z.string().min(1),
  price: euros,
  currency: z.literal('EUR'),
  inStock: z.boolean(),
  url: z.string().url(),
  lastChecked: z.string().datetime(),
});

export const ProductSchema = z.object({
  id: z.string().min(1),
  ean: z.string().regex(/^[0-9]{13}$/),
  brand: z.string().min(1),
  name: z.string().min(1),
  unit: z.string(),
  category: CategorySchema,
  subcategory: z.string().min(1),
  image: z.string(),
  specs: z.record(z.string()).optional(),
});

export const ProductWithOffersSchema = z.object({
  product: ProductSchema,
  offers: z.array(OfferSchema),
})
  .refine(
    (p) => p.offers.every((o, i) => i === 0 || !o.inStock || p.offers[i - 1].inStock),
    { message: 'INVARIANT: in-stock offers must come before out-of-stock offers' }
  )
  .refine(
    (p) => p.offers.every((o, i) =>
      i === 0 || o.inStock !== p.offers[i - 1].inStock || o.price >= p.offers[i - 1].price),
    { message: 'INVARIANT: offers must be cheapest-first within each stock group' }
  )
  .refine(
    (p) => p.offers.every((o) => o.productId === p.product.id),
    { message: 'INVARIANT: every offer must carry the same public product id as its product' }
  );

export const PriceHistorySchema = z.object({
  productId: z.string().min(1),
  points: z.array(z.object({
    at: z.string().datetime(),
    store: z.string().min(1),
    price: euros,
  })),
  currentMin: z.number().min(0),
  min30: z.number().min(0),
  max30: z.number().min(0),
  isLowest30: z.boolean(),
})
  .refine((h) => h.min30 <= h.currentMin && h.currentMin <= h.max30, {
    message: 'INVARIANT: min30 <= currentMin <= max30',
  })
  .refine(
    (h) => h.points.every((p, i) => i === 0 || p.at >= h.points[i - 1].at),
    { message: 'INVARIANT: price history points must be chronological' }
  )
  .refine(
    (h) => h.points.length === 0 || h.isLowest30 === (h.currentMin <= h.min30 + 0.001),
    { message: 'INVARIANT: isLowest30 must agree with currentMin and min30' }
  );
