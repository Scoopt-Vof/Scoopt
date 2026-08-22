// POST /api/track  ->  { ok: true }   (body: TrackEvent)
//
// The SERVER side of observed behaviour. Today the frontend stores events in the
// browser (lib/track.ts). This route exists so Larry can flip one line in
// lib/track.ts to POST here instead, and persist events per-account in the DB.
//
// TODO(Larry): validate the event, attach the signed-in user id, and INSERT a
// row into an `events` table. Return { ok: true } on success. Keep it fast and
// fire-and-forget from the client's point of view.
import { NextResponse } from "next/server";
import type { TrackEvent } from "@/contract/types";

export async function POST(req: Request) {
  const event = (await req.json()) as TrackEvent;
  if (!event?.type || !event?.productId) {
    return NextResponse.json({ error: "Body must be a TrackEvent" }, { status: 400 });
  }
  // Fake backend: accept and drop. Real backend persists per-account.
  return NextResponse.json({ ok: true });
}
