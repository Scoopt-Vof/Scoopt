"use client";
// The Smart Basket — Scoopt's revolutionary basket.
// Shows the honest answer to "what's the genuinely cheapest way to buy all of
// this?": best single store vs an optimal multi-store split, delivery included,
// with a plain-language verdict on which actually wins.

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBasket, removeFromBasket, clearBasket, subscribe } from "@/lib/basket";
import { fetchBasketPlanData } from "@/lib/api";
import { planBasket } from "@/lib/smartBasket";
import type { SmartBasketResult, BasketPlan } from "@/contract/types";

const eur = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);

export default function BasketPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [result, setResult] = useState<SmartBasketResult | null>(null);
  const [loading, setLoading] = useState(true);

  // keep in sync with the basket store
  useEffect(() => {
    setIds(getBasket());
    return subscribe(setIds);
  }, []);

  // recompute the plan whenever the basket changes
  useEffect(() => {
    if (ids.length === 0) { setResult(null); setLoading(false); return; }
    setLoading(true);
    fetchBasketPlanData(ids).then((data) => {
      setResult(planBasket(data.items, data.deliveryRules));
      setLoading(false);
    });
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

          {/* Basket line items with remove */}
          <h2 className="section-h" style={{ marginTop: 30 }}>Items ({ids.length})</h2>
          <div className="basket-lines">
            {(result.smartSplit?.lines ?? []).map((l) => (
              <div className="basket-line" key={l.productId}>
                <Link href={`/product/${l.productId}`} className="bl-name">{l.productName}</Link>
                <span className="bl-store">cheapest at {l.store}</span>
                <span className="bl-price">{eur(l.price)}</span>
                <button className="bl-remove" onClick={() => removeFromBasket(l.productId)} aria-label="Remove">×</button>
              </div>
            ))}
            {result.smartSplit && result.smartSplit.missing.length > 0 && (
              <p className="note">Not available anywhere we cover yet: {result.smartSplit.missing.join(", ")}</p>
            )}
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
