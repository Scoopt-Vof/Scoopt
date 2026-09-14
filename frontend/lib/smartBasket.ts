// ============================================================================
//  SMART MULTI-STORE SPLIT  —  Scoopt's revolutionary basket
// ----------------------------------------------------------------------------
//  Given a basket, this answers the question no normal comparison site does:
//  "What is the genuinely cheapest way to buy ALL of this — even if that means
//   buying from more than one store — once delivery costs are counted?"
//
//  It computes two honest plans and recommends whichever actually wins:
//    1. bestSingleStore — cheapest way to buy everything at ONE shop.
//    2. smartSplit       — buy each item wherever it's cheapest, then add up
//                          the delivery for every distinct store used.
//
//  The honesty is the point: sometimes splitting saves real money, and
//  sometimes the extra delivery fees make one store the smarter buy. Scoopt
//  says which — including "just buy it all at X, splitting isn't worth it."
//
//  Pure functions, no I/O — easy for Larry to move server-side unchanged.
// ============================================================================

import type {
  Offer, DeliveryRule, PlanLine, BasketPlan, SmartBasketResult,
} from "@/contract/types";

const eur = (n: number) => `€${n.toFixed(2)}`;

// Delivery for a store given how much is being spent there.
function deliveryFor(store: string, subtotal: number, rules: DeliveryRule[]): number {
  const rule = rules.find((r) => r.store === store);
  if (!rule) return 0;
  if (rule.freeAbove !== undefined && subtotal >= rule.freeAbove) return 0;
  return rule.fee;
}

// Sum delivery across a set of stores, each with its own subtotal.
function totalDelivery(
  storeSubtotals: Record<string, number>,
  rules: DeliveryRule[]
): number {
  return Object.entries(storeSubtotals).reduce(
    (sum, [store, subtotal]) => sum + deliveryFor(store, subtotal, rules),
    0
  );
}

// ---- Plan A: everything at a single store --------------------------------
function bestSingleStore(
  items: { productId: string; productName: string; offers: Offer[] }[],
  rules: DeliveryRule[]
): BasketPlan | undefined {
  // Which stores can supply EVERY item?
  const storesPerItem = items.map((it) => new Set(it.offers.map((o) => o.store)));
  const commonStores = [...(storesPerItem[0] ?? new Set<string>())].filter((store) =>
    storesPerItem.every((s) => s.has(store))
  );
  if (commonStores.length === 0) return undefined; // no single store has it all

  let best: BasketPlan | undefined;
  for (const store of commonStores) {
    const lines: PlanLine[] = items.map((it) => {
      const offer = it.offers.find((o) => o.store === store)!;
      return { productId: it.productId, productName: it.productName, store, price: offer.price };
    });
    const itemsTotal = lines.reduce((s, l) => s + l.price, 0);
    const deliveryTotal = deliveryFor(store, itemsTotal, rules);
    const grandTotal = round(itemsTotal + deliveryTotal);
    if (!best || grandTotal < best.grandTotal) {
      best = {
        kind: "single-store", lines, stores: [store],
        itemsTotal: round(itemsTotal), deliveryTotal: round(deliveryTotal),
        grandTotal, complete: true, missing: [],
      };
    }
  }
  return best;
}

// ---- Plan B: cheapest per item, then count delivery per store used -------
function smartSplit(
  items: { productId: string; productName: string; offers: Offer[] }[],
  rules: DeliveryRule[]
): BasketPlan {
  const lines: PlanLine[] = [];
  const missing: string[] = [];
  const storeSubtotals: Record<string, number> = {};

  for (const it of items) {
    if (it.offers.length === 0) { missing.push(it.productName); continue; }
    const cheapest = it.offers.reduce((a, b) => (a.price <= b.price ? a : b));
    lines.push({
      productId: it.productId, productName: it.productName,
      store: cheapest.store, price: cheapest.price,
    });
    storeSubtotals[cheapest.store] = (storeSubtotals[cheapest.store] ?? 0) + cheapest.price;
  }

  const itemsTotal = lines.reduce((s, l) => s + l.price, 0);
  const deliveryTotal = totalDelivery(storeSubtotals, rules);
  return {
    kind: "smart-split", lines,
    stores: Object.keys(storeSubtotals),
    itemsTotal: round(itemsTotal), deliveryTotal: round(deliveryTotal),
    grandTotal: round(itemsTotal + deliveryTotal),
    complete: missing.length === 0, missing,
  };
}

// ---- The public entry point ----------------------------------------------
export function planBasket(
  items: { productId: string; productName: string; offers: Offer[] }[],
  rules: DeliveryRule[]
): SmartBasketResult {
  // Only ever plan around offers a shopper can actually buy right now. The
  // /basket/plan endpoint returns out-of-stock offers too (unlike /basket/compare),
  // so if we don't filter here the "cheapest" pick could be something nobody can
  // add to a cart. An item left with no in-stock offer becomes "missing", which
  // is the honest outcome.
  const inStockItems = items.map((it) => ({
    ...it,
    offers: it.offers.filter((o) => o.inStock),
  }));

  const single = bestSingleStore(inStockItems, rules);
  const split = smartSplit(inStockItems, rules);

  // Decide the honest recommendation.
  let recommended: SmartBasketResult["recommended"] = "none";
  let saving = 0;
  let note = "";

  if (single && split.complete) {
    // A split only "counts" as different if it actually uses >1 store.
    const splitUsesMultiple = split.stores.length > 1;
    if (splitUsesMultiple && split.grandTotal < single.grandTotal - 0.001) {
      recommended = "smart-split";
      saving = round(single.grandTotal - split.grandTotal);
      note =
        `Splitting across ${split.stores.length} stores saves ${eur(saving)} versus ` +
        `buying everything at ${single.stores[0]} — even after delivery.`;
    } else {
      recommended = "single-store";
      note =
        `Buy everything at ${single.stores[0]}. Splitting would scatter the order ` +
        `across more stores and the extra delivery wipes out the item savings.`;
    }
  } else if (split.complete) {
    // No single store carries everything — the split is the only complete way.
    recommended = "smart-split";
    saving = 0;
    note =
      `No single store carries your whole basket, so the cheapest complete option ` +
      `is a split across ${split.stores.length} stores.`;
  } else if (single) {
    recommended = "single-store";
    note = `Buy everything at ${single.stores[0]}.`;
  } else {
    note = `Some items aren't available at the stores we cover yet.`;
  }

  return {
    bestSingleStore: single,
    smartSplit: split,
    recommended,
    savingVsSingle: saving,
    honestNote: note,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
