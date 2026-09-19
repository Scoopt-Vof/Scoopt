// POST /api/revalidate  ->  clears the cached catalogue straight away.
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
import { CATALOG_TAG } from "@/lib/catalogCache";

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

  // 1. Every cached backend response tagged "catalog" (lib/catalogCache.ts).
  // { expire: 0 } = drop the old data immediately (Next.js 16). Do NOT use "max":
  // that would serve the old prices to the first visitor after an ingest.
  revalidateTag(CATALOG_TAG, { expire: 0 });
  // 2. Every cached rendered page, so pages rebuild with the fresh data.
  revalidatePath("/", "layout");

  const at = new Date().toISOString();
  console.log(`catalogue cache cleared at ${at}`);
  return NextResponse.json({ revalidated: true, at });
}
