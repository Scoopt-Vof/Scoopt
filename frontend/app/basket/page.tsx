"use client";
// The Smart Basket — Scoopt's revolutionary basket.
// Shows the honest answer to "what's the genuinely cheapest way to buy all of
// this?": best single store vs an optimal multi-store split, delivery included,
// with a plain-language verdict on which actually wins.

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBasket, removeFromBasket, clearBasket, subscribe } from "@/lib/basket";
import { fetchBasketPlanData, type BasketPlanData } from "@/lib/api";
import { planBasket } from "@/lib/smartBasket";
import type { SmartBasketResult, BasketPlan } from "@/contract/types";
import { formatEuro } from "@/lib/format";

const eur = formatEuro;

export default function BasketPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [result, setResult] = useState<SmartBasketResult | null>(null);
  const [planData, setPlanData] = useState<BasketPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // keep in sync with the basket store
  useEffect(() => {
    setIds(getBasket());
    return subscribe(setIds);
  }, []);

  // recompute the plan whenever the basket changes
  useEffect(() => {
    if (ids.length === 0) { setResult(null); setPlanData(null); setLoading(false); setFailed(false); return; }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetchBasketPlanData(ids)
      .then((data) => {
        if (cancelled) return;
        setPlanData(data);
        setResult(planBasket(data.items, data.deliveryRules));
        setLoading(false);
      })
      .catch(() => {
        // Backend down or unreachable: stop the spinner and show a retry rather
        // than leaving "Working out the cheapest way..." on screen forever.
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ids]);

  if (ids.length === 0) {
    return (
      <div className="quiz-card" style={{ textAlign: "center" }}>
        <h1>Your basket is empty</h1>
        <p className="quiz-sub">
          Add products and Scoopt works out the genuinely cheapest way to buy them
          all — even if that means splitting across stores.
        </p>
        <Link href="/category/sport" className="btn-cta" style={{ display: "inline-block", marginTop: 12 }}>
          Browse products →
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="crumb"><Link href="/">Home</Link> › <b>Basket</b></div>
      <h1 className="page-title">Your smart basket</h1>
      <p className="page-blurb">
        The cheapest way to buy everything — delivery included, honestly compared.
      </p>

      {loading && <p className="note">Working out the cheapest way to buy this…</p>}

      {failed && (
        <div className="empty-state">
          <p className="page-blurb" style={{ marginBottom: 8 }}>
            We couldn&apos;t work out your basket just now.
          </p>
          <p className="note">This is usually temporary. Please try again in a moment.</p>
          <button
            className="btn-cta"
            style={{ marginTop: 14 }}
            onClick={() => setIds((prev) => [...prev])}
          >
            Try again
          </button>
        </div>
      )}

      {result && (
        <>
          {/* The verdict banner */}
          <div className={`verdict ${result.recommended === "smart-split" ? "split" : "single"}`}>
            <div className="verdict-icon">
              {result.recommended === "smart-split" ? "⚡" : "✓"}
            </div>
            <div>
              <div className="verdict-head">
                {result.recommended === "smart-split"
                  ? `Split across ${result.smartSplit?.stores.length} stores and save ${eur(result.savingVsSingle)}`
                  : result.recommended === "single-store"
                  ? `Buy everything at ${result.bestSingleStore?.stores[0]}`
                  : "Some items aren't available yet"}
              </div>
              <p className="verdict-note">{result.honestNote}</p>
            </div>
          </div>

          {/* Side-by-side plans */}
          <div className="plans">
            {result.bestSingleStore && (
              <PlanCard
                plan={result.bestSingleStore}
                title="Everything at one store"
                winner={result.recommended === "single-store"}
              />
            )}
            {result.smartSplit && result.smartSplit.stores.length > 1 && (
              <PlanCard
                plan={result.smartSplit}
                title="Smart split across stores"
                winner={result.recommended === "smart-split"}
              />
            )}
          </div>

          {result.recommended !== "none" && (
            <div style={{ marginTop: 20 }}>
              <Link href="/checkout" className="btn-cta">
                Proceed to checkout →
              </Link>
            </div>
          )}

          {/* Basket line items with remove — driven by the basket ids, NOT by the
              plan, so EVERY item can be removed: including one with no offers,
              one that is only available out of stock, and one the backend no
              longer returns (unpublished/deleted) which would otherwise linger
              in the basket with no way to take it out except "Clear basket". */}
          <h2 className="section-h" style={{ marginTop: 30 }}>Items ({ids.length})</h2>
          <div className="basket-lines">
            {ids.map((id) => {
              const item = planData?.items.find((i) => i.productId === id);
              const line = result.smartSplit?.lines.find((l) => l.productId === id);
              const name = item?.productName ?? "This item";
              const knownToBackend = Boolean(item);
              return (
                <div className="basket-line" key={id}>
                  {knownToBackend ? (
                    <Link href={`/product/${id}`} className="bl-name">{name}</Link>
                  ) : (
                    <span className="bl-name">{name}</span>
                  )}
                  {line ? (
                    <>
                      <span className="bl-store">cheapest at {line.store}</span>
                      <span className="bl-price">{eur(line.price)}</span>
                    </>
                  ) : (
                    <span className="bl-store bl-unavailable">
                      {!knownToBackend
                        ? "No longer available"
                        : (item && item.offers.length > 0)
                        ? "Out of stock right now"
                        : "No offers yet"}
                    </span>
                  )}
                  <button
                    className="bl-remove"
                    onClick={() => removeFromBasket(id)}
                    aria-label={`Remove ${name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <button className="btn-ghost" style={{ marginTop: 20 }} onClick={() => clearBasket()}>
            Clear basket
          </button>
        </>
      )}
    </>
  );
}

function PlanCard({ plan, title, winner }: { plan: BasketPlan; title: string; winner: boolean }) {
  return (
    <div className={`plan-card ${winner ? "winner" : ""}`}>
      <div className="plan-top">
        <span className="plan-title">{title}</span>
        {winner && <span className="plan-badge">Recommended</span>}
      </div>
      <div className="plan-total">{eur(plan.grandTotal)}</div>
      <div className="plan-breakdown">
        <span>Items {eur(plan.itemsTotal)}</span>
        <span>Delivery {plan.deliveryTotal === 0 ? "free" : eur(plan.deliveryTotal)}</span>
      </div>
      <div className="plan-stores">
        {plan.stores.map((s) => <span key={s} className="plan-store">{s}</span>)}
      </div>
    </div>
  );
}
