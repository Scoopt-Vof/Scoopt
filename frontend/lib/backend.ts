// ============================================================================
//  BACKEND PROXY  —  the only way these API routes get data.
// ----------------------------------------------------------------------------
//  There is deliberately NO local fallback catalogue. This file replaces
//  lib/fakeData.ts, which invented products, stores, prices and 30-day price
//  histories and served them as though they were real.
//
//  If the backend is not configured or not reachable, these routes return an
//  error and the pages render empty. That is the correct behaviour: an empty
//  page is honest, an invented price attributed to a real shop is not.
//
//  Set BACKEND_URL (server-side, no NEXT_PUBLIC_ prefix — it is never needed in
//  the browser) to the Railway backend, e.g. https://scoopt-backend.up.railway.app
// ============================================================================

import { NextResponse } from "next/server";
import { catalogFetchInit } from "@/lib/catalogCache";

const BACKEND_URL = process.env.BACKEND_URL?.replace(/\/$/, "");

// `catalog: true` is for GET routes that return shared catalogue data
// (products, categories, prices). Those responses are cached and cleared when
// the ingest job finishes — see lib/catalogCache.ts. Leave it off for anything
// personal (basket, personalise, tracking): those must never be cached.
export async function proxy(
  path: string,
  init?: RequestInit,
  opts: { catalog?: boolean } = {}
): Promise<NextResponse> {
  if (!BACKEND_URL) {
    // Loud, not silent. A missing env var must never degrade into fake data.
    console.error("BACKEND_URL is not set — refusing to serve data.");
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(
      `${BACKEND_URL}${path}`,
      opts.catalog ? { ...init, ...catalogFetchInit } : { ...init, cache: "no-store" }
    );
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    console.error(`Backend unreachable for ${path}:`, err);
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}
