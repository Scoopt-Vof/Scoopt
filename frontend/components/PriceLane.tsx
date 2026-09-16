"use client";
import type { Offer } from "@/contract/types";
import { track } from "@/lib/track";
import { formatEuro, timeAgo } from "@/lib/format";

// Renders one horizontal bar per store, cheapest flagged. Each row links out to
// the retailer AND records a "click_out" event (strong buying-intent signal).
//
// Stock and freshness (both already sent on every Offer) are shown: an
// out-of-stock offer is muted, labelled, and is NEVER flagged "cheapest" — only
// the cheapest IN-STOCK offer earns that flag, so the shopper is never sent to a
// "cheapest" price they can't actually buy.
//
// Offer.storeName (A6, now in the contract) is the display name shown here;
// Offer.store stays the slug used as the React key and the click-out tracking
// key. STILL flagged for Larry: item price and shipping are not separated
// (A1/G7) — the backend folds shipping into Offer.price today.
export default function PriceLane({ offers }: { offers: Offer[] }) {
  if (offers.length === 0) return <p className="note">No prices available yet.</p>;

  // Bar scale uses the dearest offer; the "cheapest" flag uses the cheapest
  // offer that is actually in stock.
  const max = offers.reduce((m, o) => Math.max(m, o.price), offers[0].price);
  const inStockPrices = offers.filter((o) => o.inStock).map((o) => o.price);
  const cheapestInStock = inStockPrices.length ? Math.min(...inStockPrices) : null;

  return (
    <div>
      {offers.map((o) => {
        const widthPct = Math.max(12, (o.price / max) * 100);
        const isCheapest = o.inStock && cheapestInStock !== null && o.price === cheapestInStock;
        const checked = timeAgo(o.lastChecked);
        return (
          <a
            className={`lane lane-link${o.inStock ? "" : " lane-oos"}`}
            key={o.store}
            href={o.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={() => track("click_out", o.productId, { store: o.store })}
          >
            <div className="lane-store">
              {o.storeName || o.store}
              {!o.inStock && <span className="lane-oos-tag">out of stock</span>}
              {checked && <span className="lane-checked">checked {checked}</span>}
            </div>
            <div className="lane-track">
              <div
                className={`lane-fill${isCheapest ? " win" : ""}`}
                style={{ width: `${widthPct}%` }}
              />
              <div className="lane-label">
                {formatEuro(o.price)}
                {isCheapest && <span className="win-flag">cheapest</span>}
              </div>
            </div>
          </a>
        );
      })}
      {cheapestInStock !== null && max > cheapestInStock && (
        <div className="savings">
          Save up to {formatEuro(max - cheapestInStock)} by buying at the cheapest in-stock store.
        </div>
      )}
    </div>
  );
}
