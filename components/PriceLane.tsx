"use client";
import type { Offer } from "@/contract/types";
import { track } from "@/lib/track";

const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

// Renders one horizontal bar per store, cheapest flagged. Each row links out to
// the retailer AND records a "click_out" event (strong buying-intent signal).
export default function PriceLane({ offers }: { offers: Offer[] }) {
  if (offers.length === 0) return <p className="note">No prices available yet.</p>;

  const min = offers[0].price;
  const max = offers[offers.length - 1].price;

  return (
    <div>
      {offers.map((o) => {
        const widthPct = Math.max(12, (o.price / max) * 100);
        const isCheapest = o.price === min;
        return (
          <a
            className="lane lane-link"
            key={o.store}
            href={o.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={() => track("click_out", o.productId, { store: o.store })}
          >
            <div className="lane-store">{o.store}</div>
            <div className="lane-track">
              <div
                className={`lane-fill${isCheapest ? " win" : ""}`}
                style={{ width: `${widthPct}%` }}
              />
              <div className="lane-label">
                {eur.format(o.price)}
                {isCheapest && <span className="win-flag">cheapest</span>}
              </div>
            </div>
          </a>
        );
      })}
      {max > min && (
        <div className="savings">
          Save up to {eur.format(max - min)} by buying at the cheapest store.
        </div>
      )}
    </div>
  );
}
