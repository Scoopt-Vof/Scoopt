// ============================================================================
//  OBSERVED BEHAVIOUR — the tracking seam  (FRONTEND side)
// ----------------------------------------------------------------------------
//  This is the clean line between your half and Larry's:
//
//    FRONTEND (you):  detect behaviour and call track(...).   ← this file
//    BACKEND (Larry): persist the events per-account, later.  ← behind the seam
//
//  Today track() stores events in the browser so the stated-plus-observed loop
//  works end to end with no backend. When Larry is ready, the ONLY thing that
//  changes is the marked block inside track(): instead of writing to
//  localStorage it POSTs to /api/track. Nothing else in the frontend moves,
//  because everything else depends on the SHAPES in the contract, not on where
//  the data is stored.
// ============================================================================

import type {
  TrackEvent, TrackEventType, ObservedSignals, Category,
} from "@/contract/types";

const KEY = "scoopt.events.v1";
const MAX_EVENTS = 200; // keep the local log small; backend has no such limit

// ---- read the raw event log (browser only) ---------------------------------
function readEvents(): TrackEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TrackEvent[]) : [];
  } catch {
    return [];
  }
}

// ---- the ONE function the app calls to record behaviour --------------------
export function track(
  type: TrackEventType,
  productId: string,
  extra?: { category?: Category; store?: string }
): void {
  if (typeof window === "undefined") return; // never track during server render

  const event: TrackEvent = {
    type,
    productId,
    at: new Date().toISOString(),
    ...extra,
  };

  // ===== SWAP POINT — Larry replaces the inside of this block later ==========
  // Today: append to a capped list in the browser.
  // Later: await fetch("/api/track", { method: "POST", body: JSON.stringify(event) })
  const events = readEvents();
  events.push(event);
  const trimmed = events.slice(-MAX_EVENTS);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* storage full or blocked — fine to drop, tracking is best-effort */
  }
  // ===========================================================================
}

// ---- derive the rolled-up signals the personalisation engine consumes ------
// Frontend computes this from the local log today; Larry can compute a richer
// version server-side later. Either way it returns the same ObservedSignals.
export function getObservedSignals(): ObservedSignals {
  const events = readEvents();

  const uniqueRecent = (type: TrackEventType): string[] => {
    const ids = events
      .filter((e) => e.type === type)
      .sort((a, b) => b.at.localeCompare(a.at)) // most recent first
      .map((e) => e.productId);
    return Array.from(new Set(ids)); // de-dupe, keep first (most recent) occurrence
  };

  const categoryAffinity: Partial<Record<Category, number>> = {};
  for (const e of events) {
    if (e.category) {
      categoryAffinity[e.category] = (categoryAffinity[e.category] ?? 0) + 1;
    }
  }

  return {
    viewedProductIds: uniqueRecent("view_product"),
    clickedOutProductIds: uniqueRecent("click_out"),
    purchasedProductIds: uniqueRecent("purchase"),
    categoryAffinity,
  };
}

// Convenience for a "recently viewed" strip, etc.
export function recentlyViewed(limit = 6): string[] {
  return getObservedSignals().viewedProductIds.slice(0, limit);
}

export function clearEvents(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
