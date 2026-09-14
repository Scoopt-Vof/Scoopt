// ============================================================================
//  DELIVERY DETAILS  (frontend, browser-persisted)  — item 6
// ----------------------------------------------------------------------------
//  Stores a shopper's delivery address and contact details so we have them for
//  future checkout / saved-basket features. Kept in its OWN localStorage key,
//  separate from the shopper profile, because this is personal data and should
//  only exist for a signed-in shopper (the profile can be anonymous). signOut()
//  clears every scoopt.* key, so these details are removed on sign-out too.
//
//  IMPORTANT: this does NOT auto-fill a retailer's checkout. eBay's checkout
//  runs on eBay's own domain and a website cannot pre-fill another company's
//  checkout form. When a shopper clicks out, the retailer fills in the address
//  it holds. Storing these here is groundwork for Scoopt's own future checkout
//  and to prefill our own forms — nothing more.
// ============================================================================

export interface DeliveryDetails {
  fullName?: string;
  line1?: string;
  line2?: string;
  postcode?: string;
  city?: string;
  country?: string;
  phone?: string;
}

const KEY = "scoopt.delivery.v1";

export function loadDelivery(): DeliveryDetails | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DeliveryDetails) : null;
  } catch {
    return null;
  }
}

export function saveDelivery(d: DeliveryDetails): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage blocked/full — best effort */
  }
}

export function clearDelivery(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function hasDelivery(d: DeliveryDetails | null): boolean {
  return Boolean(d && (d.fullName || d.line1 || d.postcode || d.city));
}
