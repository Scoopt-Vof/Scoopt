// ============================================================================
//  CHECKOUT + ORDER HISTORY  (frontend, browser-persisted)
// ----------------------------------------------------------------------------
//  Scoopt has no way to receive a real confirmation back from a retailer's
//  checkout — eBay's checkout runs on eBay's own domain, with no webhook or
//  API this site can call, exactly like the auto-fill limitation noted in
//  lib/delivery.ts. What we CAN do is notice the shopper going to a retailer
//  and then coming back to this tab, and ask them directly whether they
//  finished. "Ask, don't assume" is the whole design here:
//
//    1. startCheckout() runs when the shopper clicks "Proceed to checkout at
//       <store>": it opens each item's affiliate link and remembers what was
//       sent, as a single "pending" checkout attempt.
//    2. CheckoutReturnWatcher (rendered site-wide, in layout.tsx) listens for
//       the tab regaining focus. If a pending attempt exists and enough time
//       has passed for a real visit to the retailer (not an accidental click
//       or a one-second alt-tab), it shows a "Did you complete your order?"
//       prompt — wherever in the site the shopper happens to land.
//    3. confirmOrder() / dismissPending() record the answer: "yes" removes
//       those items from the basket and files an order in local order
//       history; "no" just clears the pending flag and leaves the basket
//       exactly as it was.
//
//  Everything here is self-reported and local to this browser — there is no
//  real order, payment, or retailer confirmation behind any of it, and nothing
//  is sent anywhere. If a formal retailer integration ever exists (an
//  affiliate-network postback, or Scoopt's own checkout), this module is the
//  seam to replace: same shopper-facing shape, a real signal underneath.
// ============================================================================

import { removeFromBasket } from "@/lib/basket";

export interface PendingCheckout {
  id: string;
  store: string;            // retailer slug (the key)
  storeName?: string;       // retailer display name for the shopper-facing prompt
  productIds: string[];
  productNames: string[];
  total: number;
  startedAt: string; // ISO
}

export interface Order {
  id: string;
  store: string;            // retailer slug (the key)
  storeName?: string;       // retailer display name shown in order history
  productIds: string[];
  productNames: string[];
  total: number;
  completedAt: string; // ISO
}

const PENDING_KEY = "scoopt.checkout.pending.v1";
const ORDERS_KEY = "scoopt.orders.v1";
const MAX_ORDERS = 30;

// How long a shopper needs to have been away before their return counts as a
// real trip to the retailer, not a stray click or an instant alt-tab back.
const MIN_AWAY_MS = 4000;

function readPending(): PendingCheckout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingCheckout) : null;
  } catch {
    return null;
  }
}

function writePending(p: PendingCheckout | null): void {
  if (typeof window === "undefined") return;
  try {
    if (p) window.localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage blocked/full — best effort */
  }
}

export function getPendingCheckout(): PendingCheckout | null {
  return readPending();
}

/** True once enough time has passed that a tab-focus event plausibly means
 *  "back from the retailer", not just an instant re-click. */
export function pendingIsRecognisable(p: PendingCheckout): boolean {
  return Date.now() - new Date(p.startedAt).getTime() >= MIN_AWAY_MS;
}

/** Call when the shopper clicks "Proceed to checkout at <store>". Opens every
 *  line's affiliate link in its own tab — each offer is its own product page
 *  on the retailer's site, there is no shared "add all to cart" link a
 *  comparison site can call — and remembers the attempt so a later return can
 *  be recognised. */
export function startCheckout(
  store: string,
  lines: { productId: string; productName: string; price: number; url: string }[],
  storeName?: string
): void {
  if (typeof window === "undefined" || lines.length === 0) return;
  lines.forEach((l) => window.open(l.url, "_blank", "noopener,noreferrer"));
  writePending({
    id: `co_${Date.now()}`,
    store,
    storeName: storeName ?? store,
    productIds: lines.map((l) => l.productId),
    productNames: lines.map((l) => l.productName),
    total: round(lines.reduce((s, l) => s + l.price, 0)),
    startedAt: new Date().toISOString(),
  });
}

/** Shopper confirmed "yes, I completed it": file the order, remove those
 *  items from the basket, clear the pending flag. */
export function confirmOrder(p: PendingCheckout): Order {
  const order: Order = {
    id: p.id,
    store: p.store,
    storeName: p.storeName ?? p.store,
    productIds: p.productIds,
    productNames: p.productNames,
    total: p.total,
    completedAt: new Date().toISOString(),
  };
  writeOrders([order, ...readOrders()].slice(0, MAX_ORDERS));
  p.productIds.forEach(removeFromBasket);
  writePending(null);
  return order;
}

/** Shopper said "no" (or dismissed the prompt): as far as we know nothing was
 *  bought — clear the pending flag and leave the basket untouched. */
export function dismissPending(): void {
  writePending(null);
}

export function readOrders(): Order[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDERS_KEY);
    return raw ? (JSON.parse(raw) as Order[]) : [];
  } catch {
    return [];
  }
}

function writeOrders(orders: Order[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  } catch {
    /* storage blocked/full — best effort */
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
