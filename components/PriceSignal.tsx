"use client";
// Honest price signal — the "feedback not upsell" feature.
// Reads price history and tells the shopper the TRUTH about timing:
//   • "Cheapest it's been in 30 days" (buy with confidence), or
//   • how far today's price sits below the 30-day high, or
//   • nothing, if there's nothing honest and useful to say.
// It never pushes a purchase — it just gives a true fact that helps decide.

import { useEffect, useState } from "react";
import { fetchPriceHistory } from "@/lib/api";
import type { PriceHistory } from "@/contract/types";

const eur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);

export default function PriceSignal({ productId }: { productId: string }) {
  const [h, setH] = useState<PriceHistory | null>(null);

  useEffect(() => {
    fetchPriceHistory(productId).then(setH).catch(() => setH(null));
  }, [productId]);

  if (!h || h.points.length === 0) return null;

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
        <span className="signal-dot" /> {eur(belowHigh)} below its 30-day high
        (low was {eur(h.min30)}).
      </div>
    );
  }

  return (
    <div className="signal warn">
      <span className="signal-dot" /> Near its 30-day high — you might wait for a drop.
    </div>
  );
}
