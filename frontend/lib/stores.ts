// ============================================================================
//  STORE DISPLAY NAMES
// ----------------------------------------------------------------------------
//  Offer.store is the retailer SLUG ("ebay-nl", "gsm-net") — the stable key the
//  basket comparison, delivery rules and price history all match on. Offer.
//  storeName is the DISPLAY name ("eBay Netherlands", "GSM Net").
//
//  The basket, checkout and smart-split structures carry the slug only (it is
//  their join key). To show a real name there, build a slug -> name lookup from
//  the offers already loaded on the page, then translate at the point of
//  display. Keep the slug as the key everywhere; only the label changes.
// ============================================================================
import type { Offer } from "@/contract/types";

/** Build a slug -> display-name lookup from the offers loaded on a page. */
export function storeNameMap(items: { offers: Offer[] }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const it of items) {
    for (const o of it.offers) {
      if (o.storeName) map[o.store] = o.storeName;
    }
  }
  return map;
}

/** Display name for a store slug, falling back to the slug if it is unknown. */
export function storeLabel(slug: string, names: Record<string, string>): string {
  return names[slug] ?? slug;
}
