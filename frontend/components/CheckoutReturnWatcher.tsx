"use client";
// Site-wide, renders nothing most of the time. Watches for the shopper
// returning to this tab after a checkout attempt (lib/checkout.ts) and asks
// them directly whether they finished — there's no real signal back from a
// retailer's own checkout, so this is the honest substitute. Mounted once in
// app/layout.tsx so it catches the return no matter which page they land on.

import { useEffect, useState } from "react";
import {
  getPendingCheckout,
  pendingIsRecognisable,
  confirmOrder,
  dismissPending,
  type PendingCheckout,
} from "@/lib/checkout";

export default function CheckoutReturnWatcher() {
  const [prompt, setPrompt] = useState<PendingCheckout | null>(null);
  const [confirmedStore, setConfirmedStore] = useState<string | null>(null);

  useEffect(() => {
    function checkReturn() {
      if (document.visibilityState !== "visible") return;
      const pending = getPendingCheckout();
      if (pending && pendingIsRecognisable(pending)) setPrompt(pending);
    }
    document.addEventListener("visibilitychange", checkReturn);
    window.addEventListener("focus", checkReturn);
    checkReturn(); // covers the case this component mounts after the return already happened
    return () => {
      document.removeEventListener("visibilitychange", checkReturn);
      window.removeEventListener("focus", checkReturn);
    };
  }, []);

  if (confirmedStore) {
    return (
      <div className="checkout-return-toast">
        <span>
          Marked as ordered from {confirmedStore} — cleared those items from your basket.
        </span>
        <button className="checkout-toast-close" onClick={() => setConfirmedStore(null)} aria-label="Dismiss">
          ×
        </button>
      </div>
    );
  }

  if (!prompt) return null;

  const itemLabel =
    prompt.productNames.length === 1 ? prompt.productNames[0] : `${prompt.productNames.length} items`;

  return (
    <div className="checkout-return-overlay" role="dialog" aria-modal="true" aria-label="Confirm your order">
      <div className="checkout-return-card">
        <h3>Welcome back</h3>
        <p>
          Did you complete your order at <b>{prompt.store}</b> for {itemLabel}?
        </p>
        <p className="note" style={{ margin: "6px 0 16px" }}>
          We can&apos;t see what happens on {prompt.store}&apos;s own checkout, so we&apos;re just asking.
        </p>
        <div className="checkout-return-actions">
          <button
            className="btn-cta"
            onClick={() => {
              confirmOrder(prompt);
              setPrompt(null);
              setConfirmedStore(prompt.store);
            }}
          >
            Yes, I ordered it
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              dismissPending();
              setPrompt(null);
            }}
          >
            No / not yet
          </button>
        </div>
      </div>
    </div>
  );
}
