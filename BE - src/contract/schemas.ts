import { z } from 'zod';

/**
 * Zod mirrors of contract/types.ts.
 *
 * TypeScript checks shape at compile time; these check shape AND the prose
 * invariants at run time, against real data coming out of a real database.
 * The invariants are the interesting part — a response can be perfectly
 * well-typed and still be wrong (offers in the wrong order, a €0 price,
 * a "lowest in 30 days" badge that isn't true).
 */

const cents = z.number().int().positive().max(5_000_000);

export const RetailerSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
});

export const OfferSchema = z.object({
  retailer: RetailerSchema,
  priceCents: cents,
  shippingCents: z.number().int().min(0),
  totalCents: cents,
  inStock: z.boolean(),
  url: z.string().url(),
  lastSeenAt: z.string().datetime(),
}).refine((o) => o.totalCents === o.priceCents + o.shippingCents, {
  message: 'totalCents must equal priceCents + shippingCents',
});

export const ProductSchema = z.object({
  id: z.string().min(1),
  ean: z.string().regex(/^[0-9]{13}$/).nullable(),
  brand: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  imageUrl: z.string().url().nullable(),
  fromCents: cents.nullable(),
});

export const ProductWithOffersSchema = ProductSchema.extend({
  description: z.string().nullable(),
  offers: z.array(OfferSchema),
})
  .refine(
    (p) => p.offers.every((o, i) => i === 0 || o.totalCents >= p.offers[i - 1].totalCents),
    { message: 'INVARIANT: offers must be sorted cheapest-first by totalCents' }
  )
  .refine(
    (p) => p.offers.length === 0
      ? p.fromCents === null
      : p.fromCents === p.offers[0].totalCents,
    { message: 'INVARIANT: fromCents must equal the cheapest offer total' }
  );

export const PriceHistorySchema = z.object({
  productId: z.string().min(1),
  points: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    priceCents: cents,
  })),
  min30: cents,
  max30: cents,
  currentMin: cents,
})
  .refine((h) => h.min30 <= h.currentMin && h.currentMin <= h.max30, {
    message: 'INVARIANT: min30 <= currentMin <= max30',
  })
  .refine(
    (h) => h.points.every((p, i) => i === 0 || p.date >= h.points[i - 1].date),
    { message: 'INVARIANT: price history points must be chronological' }
  );
