// ============================================================================
//  BASKET STORE  (frontend, browser-persisted)
// ----------------------------------------------------------------------------
//  Holds the shopper's basket (a list of product ids) in the browser, and emits
//  an "add_to_basket" event through the tracking seam so the basket also feeds
//  the profile. Small pub/sub so multiple components stay in sync without a
//  heavy state library.
//
//  Later, a signed-in user's basket can live on Larry's backend — this module's
//  functions stay the same signatures, only their innards change.
// ============================================================================

import { track } from "@/lib/track";
import type { Category } from "@/contract/types";

const KEY = "scoopt.basket.v1";
type Listener = (ids: string[]) => void;
const listeners = new Set<Listener>();

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(ids));
  listeners.forEach((fn) => fn(ids));
}

export function getBasket(): string[] {
  return read();
}

export function inBasket(productId: string): boolean {
  return read().includes(productId);
}

export function addToBasket(
  productId: string,
  extra?: { category?: Category }
): void {
  const ids = read();
  if (ids.includes(productId)) return;
  write([...ids, productId]);
  track("add_to_basket", productId, extra); // feeds the profile
}

export function removeFromBasket(productId: string): void {
  write(read().filter((id) => id !== productId));
}

export function clearBasket(): void {
  write([]);
}

// Subscribe to basket changes (returns an unsubscribe fn). Used by the header
// count and the basket page so they update instantly on add/remove.
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
