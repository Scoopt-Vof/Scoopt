"use client";
// Honest price signal — the "feedback not upsell" feature.
// Reads price history and tells the shopper the TRUTH about timing:
//   • "Cheapest it's been in 30 days" (buy with confidence), or
//   • how far today's price sits below the 30-day high, or
//   • nothing, if there's nothing honest and useful to say.
// It never pushes a purchase — it just gives a true fact that helps decide.
//
// Crucially, it stays SILENT until there is enough history for any claim to be
// honest. With a single observation the current price is trivially the lowest
// ever seen, so showing "cheapest in 30 days" on a day-old product would be a
// false signal — exactly the kind of price claim EU/Dutch consumer rules look
// at closely, and the opposite of the "honest signals" promise on the home page.

import { useEffect, useState } from "react";
import { fetchPriceHistory } from "@/lib/api";
import { formatEuro } from "@/lib/format";
import type { PriceHistory, PricePoint } from "@/contract/types";

// Minimum distinct days of price history before we say anything about "30 days".
const MIN_HISTORY_DAYS = 14;

// Fallback when the backend has not (yet) sent observedDays: count distinct
// calendar days present in the observations.
function distinctObservedDays(points: PricePoint[]): number {
  return new Set(points.map((p) => p.at.slice(0, 10))).size;
}

export default function PriceSignal({ productId }: { productId: string }) {
  const [h, setH] = useState<PriceHistory | null>(null);

  useEffect(() => {
    fetchPriceHistory(productId).then(setH).catch(() => setH(null));
  }, [productId]);

  if (!h || h.points.length === 0) return null;

  // Not enough history to say anything honest about the last 30 days.
  const observedDays = h.observedDays ?? distinctObservedDays(h.points);
  if (observedDays < MIN_HISTORY_DAYS) return null;

  if (h.isLowest30) {
    return (
      <div className="signal good">
        <span className="signal-dot" /> Cheapest it&apos;s been in 30 days — a good time to buy.
      </div>
    );
  }

  const belowHigh = h.max30 - h.currentMin;
  if (belowHigh > 0.5) {
    return (
      <div className="signal">
        <span className="signal-dot" /> {formatEuro(belowHigh)} below its 30-day high
        (low was {formatEuro(h.min30)}).
      </div>
    );
  }

  return (
    <div className="signal warn">
      <span className="signal-dot" /> Near its 30-day high — you might wait for a drop.
    </div>
  );
}
