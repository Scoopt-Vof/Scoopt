// POST /api/revalidate  ->  clears cached catalogue data straight away:
//   the products whose prices changed (body { products: [...] }), or everything.
//
// Called by the backend's ingest job (backend/src/lib/site-cache.ts) when it has
// finished loading new prices. After this call
// every product, category and price on the site is re-fetched from the
// backend on its next visit, so the site is never older than the database.
//
// Protected by a shared secret: the caller must send
//   Authorization: Bearer <REVALIDATE_SECRET>
// with the same REVALIDATE_SECRET that is set in Vercel. Without the secret
// anyone could clear the cache over and over and push every visit back onto
// the slow path.
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { CATALOG_TAG, LISTING_TAG, productTag } from "@/lib/catalogCache";

export const dynamic = "force-dynamic";

function authorised(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    // Loud, not silent: a missing secret means nothing can clear the cache.
    console.error("REVALIDATE_SECRET is not set — cache clearing is disabled.");
    return NextResponse.json({ error: "Revalidation not configured" }, { status: 503 });
  }
  if (!authorised(req, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Body (optional JSON): { products: ["123", "sku-abc", ...] } clears just
  // those products + the category listings; { scope: "all" } or no body
  // clears the whole catalogue.
  let products: string[] | null = null;
  try {
    const body = (await req.json()) as { products?: unknown };
    if (Array.isArray(body?.products)) {
      products = body.products
        .filter((p): p is string => typeof p === "string" && /^[\w.-]{1,80}$/.test(p))
        .slice(0, 2000);
    }
  } catch {
    // no or invalid body -> full clear
  }

  // { expire: 0 } = drop the old data immediately (Next.js 16). Do NOT use
  // "max": that would serve the old prices to the first visitor after an ingest.
  if (products && products.length > 0) {
    for (const id of products) {
      revalidateTag(productTag(id), { expire: 0 });
      revalidatePath(`/product/${id}`);
    }
    // Category listings show each product's lowest price and offer count, so
    // any product change can move them. There are only a few dozen.
    revalidateTag(LISTING_TAG, { expire: 0 });
    revalidatePath("/category/[cat]", "page");
    revalidatePath("/category/[cat]/[sub]", "page");
  } else {
    // 1. Every cached backend response tagged "catalog" (lib/catalogCache.ts).
    revalidateTag(CATALOG_TAG, { expire: 0 });
    // 2. Every cached rendered page, so pages rebuild with the fresh data.
    revalidatePath("/", "layout");
  }

  const at = new Date().toISOString();
  const scope = products && products.length > 0 ? `${products.length} products + listings` : "all";
  console.log(`catalogue cache cleared (${scope}) at ${at}`);
  return NextResponse.json({ revalidated: true, scope, at });
}
