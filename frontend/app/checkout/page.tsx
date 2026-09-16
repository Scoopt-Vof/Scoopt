"use client";
// Checkout — the step between the basket and the retailer. Lines up what to
// buy where (reusing the same smart-split plan the basket page shows), sends
// the shopper to each store's own checkout via their affiliate link, and
// recognises them coming back. See lib/checkout.ts for how "recognise"
// actually works: it's a self-reported "did you finish?" prompt, since no
// retailer hands this site a real confirmation.

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBasket, subscribe as subscribeBasket } from "@/lib/basket";
import { fetchBasketPlanData, type BasketPlanData } from "@/lib/api";
import { planBasket } from "@/lib/smartBasket";
import { startCheckout } from "@/lib/checkout";
import { storeNameMap, storeLabel } from "@/lib/stores";
import { loadDelivery, hasDelivery, type DeliveryDetails } from "@/lib/delivery";
import { currentAccount } from "@/lib/auth";
import { formatEuro } from "@/lib/format";
import type { SmartBasketResult, BasketPlan } from "@/contract/types";

const eur = formatEuro;

interface StoreGroup {
  store: string;
  total: number;
  lines: { productId: string; productName: string; price: number; url: string }[];
}

function groupByStore(plan: BasketPlan | undefined, planData: BasketPlanData | null): StoreGroup[] {
  if (!plan || !planData) return [];
  const byStore = new Map<string, StoreGroup["lines"]>();
  for (const line of plan.lines) {
    const item = planData.items.find((i) => i.productId === line.productId);
    const offer = item?.offers.find((o) => o.store === line.store);
    const list = byStore.get(line.store) ?? [];
    list.push({ productId: line.productId, productName: line.productName, price: line.price, url: offer?.url ?? "" });
    byStore.set(line.store, list);
  }
  return [...byStore.entries()].map(([store, lines]) => ({
    store,
    lines,
    total: Math.round(lines.reduce((s, l) => s + l.price, 0) * 100) / 100,
  }));
}

export default function CheckoutPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [result, setResult] = useState<SmartBasketResult | null>(null);
  const [planData, setPlanData] = useState<BasketPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryDetails | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [startedStore, setStartedStore] = useState<string | null>(null);

  useEffect(() => {
    setIds(getBasket());
    setDelivery(loadDelivery());
    setSignedIn(Boolean(currentAccount()));
    return subscribeBasket(setIds);
  }, []);

  useEffect(() => {
    if (ids.length === 0) {
      setResult(null);
      setPlanData(null);
      setLoading(false);
      setFailed(false);
      return;
    }
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
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ids]);

  if (ids.length === 0) {
    return (
      <div className="quiz-card" style={{ textAlign: "center" }}>
        <h1>Your basket is empty</h1>
        <p className="quiz-sub">Add products to your basket before checking out.</p>
        <Link href="/basket" className="btn-cta" style={{ display: "inline-block", marginTop: 12 }}>
          Go to basket →
        </Link>
      </div>
    );
  }

  const plan: BasketPlan | undefined =
    result?.recommended === "smart-split" ? result.smartSplit : result?.bestSingleStore;
  const groups = groupByStore(plan, planData);
  // Slug -> display-name lookup; groups key on the slug, this labels them.
  const storeNames = storeNameMap(planData?.items ?? []);

  return (
    <>
      <div className="crumb">
        <Link href="/">Home</Link> › <Link href="/basket">Basket</Link> › <b>Checkout</b>
      </div>
      <h1 className="page-title">Checkout</h1>
      <p className="page-blurb">
        Scoopt doesn&apos;t run its own checkout yet — you&apos;ll finish paying on each store&apos;s own site.
        This page lines up what to buy where, and keeps track for you.
      </p>

      {loading && <p className="note">Working out where to send you…</p>}
      {failed && (
        <p className="note">We couldn&apos;t work out your basket just now. Try again from your basket.</p>
      )}

      {plan && plan.missing.length > 0 && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          <p className="note">
            {plan.missing.length === 1 ? "One item isn't" : `${plan.missing.length} items aren't`} available right
            now and won&apos;t be included: {plan.missing.join(", ")}.
          </p>
        </div>
      )}

      <div className="checkout-delivery">
        <h2 className="section-h" style={{ marginTop: 0 }}>
          Delivery details
        </h2>
        {signedIn && hasDelivery(delivery) ? (
          <p className="note" style={{ fontSize: 13.5 }}>
            {[delivery!.fullName, delivery!.line1, delivery!.postcode && delivery!.city ? `${delivery!.postcode} ${delivery!.city}` : delivery!.city]
              .filter(Boolean)
              .join(", ")}
            {" — "}
            <Link href="/profile">change</Link>
          </p>
        ) : (
          <p className="note" style={{ fontSize: 13.5 }}>
            {signedIn ? "You haven't saved a delivery address yet. " : "Sign in to save a delivery address for your own reference. "}
            Each store will still ask you for it directly at their own checkout — Scoopt can&apos;t fill that in for
            you.{" "}
            <Link href={signedIn ? "/profile" : "/signup"}>{signedIn ? "Add one" : "Sign in"}</Link>
          </p>
        )}
      </div>

      {groups.map((g) => (
        <div className="checkout-store-group" key={g.store}>
          <div className="checkout-store-head">
            <h2 className="section-h" style={{ margin: 0 }}>
              {storeLabel(g.store, storeNames)}
            </h2>
            <span className="checkout-store-total">{eur(g.total)}</span>
          </div>
          <ul className="checkout-store-lines">
            {g.lines.map((l) => (
              <li key={l.productId}>
                <span>{l.productName}</span>
                <span>{eur(l.price)}</span>
              </li>
            ))}
          </ul>
          <button
            className="btn-cta"
            onClick={() => {
              const openable = g.lines.filter((l) => l.url);
              if (openable.length === 0) return;
              startCheckout(g.store, openable, storeLabel(g.store, storeNames));
              setStartedStore(g.store);
            }}
          >
            Proceed to checkout at {storeLabel(g.store, storeNames)} →
          </button>
          {startedStore === g.store && (
            <p className="note" style={{ marginTop: 8 }}>
              Opened {g.lines.length > 1 ? `${g.lines.length} tabs` : "a new tab"} for {storeLabel(g.store, storeNames)}. Come back to this
              tab when you&apos;re done and we&apos;ll ask whether it went through.
            </p>
          )}
        </div>
      ))}

      {groups.length > 1 && (
        <p className="note" style={{ marginTop: 6 }}>
          These items split across {groups.length} stores because that was the cheapest complete way to buy
          everything — each has its own checkout and its own delivery fee, already accounted for.
        </p>
      )}
    </>
  );
}
