// ============================================================================
// PROFILE STORE + PERSONALISATION ENGINE (Scoopt's USP, frontend version)
// ----------------------------------------------------------------------------
// Today the profile lives in the browser (localStorage) and the ranking is
// computed here on the client. This makes the USP fully clickable with no
// backend. Later, Larry moves `personalise()` server-side and feeds it
// OBSERVED behaviour too — the PersonalisedProduct shape stays identical, so
// the UI doesn't change.
//
// Keep this logic readable, not clever: the "why it fits" reasons are a core
// part of the product, so the rules that produce them must be explainable.
// ============================================================================

import type {
  ShopperProfile, Product, PersonalisedProduct, Priority, BudgetBand, ObservedSignals,
} from "@/contract/types";
import { supabase } from "@/lib/supabaseClient";

const KEY = "scoopt.profile.v1";
const TABLE = "shopper_profile";

// ---- storage (browser only, same-device fast path) --------------------------
export function loadProfile(): ShopperProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ShopperProfile) : null;
  } catch {
    return null;
  }
}

// Writes the local copy immediately — every existing call site stays
// synchronous, nothing about them needs to change — and, if the shopper is
// signed in, mirrors the profile to Supabase in the background so it follows
// them to a new device. A guest (no session yet) just gets the local write,
// same as before.
export function saveProfile(p: ShopperProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(p));
  void syncProfileToSupabase(p);
}

async function syncProfileToSupabase(p: ShopperProfile): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return; // guest — nothing to sync yet, localStorage is enough

  await supabase.from(TABLE).upsert({
    user_id: user.id,
    profile: p,
    updated_at: new Date().toISOString(),
  });
  } catch {
    // Best-effort: the local copy is still correct for this device even if
    // the network write fails (offline, RLS misconfigured, etc).
  }
}

export function clearProfile(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function hasProfile(): boolean {
  return loadProfile() !== null;
}

// ---- the ranking engine -----------------------------------------------------
// Returns products scored 0..100 for THIS shopper, best first, each with short
// human reasons. Pure function: same inputs → same output, easy to test.
//
// `observed` is optional: pass the signals from lib/track.ts to blend STATED
// (questionnaire) with OBSERVED (behaviour). When Larry's backend produces
// richer signals, they arrive in the same ObservedSignals shape, so this
// function doesn't change.
export function personalise(
  products: Product[],
  profile: ShopperProfile | null,
  observed?: ObservedSignals | null
  ): PersonalisedProduct[] {
  // No profile yet → neutral order, no reasons. (The app still works logged-out.)
if (!profile) {
  return products.map((product) => ({ product, matchScore: 50, reasons: [] }));
}

// Fold observed behaviour into the profile's observed fields, so scoreProduct
// can use them without needing to know where they came from.
const merged: ShopperProfile = observed
  ? {
    ...profile,
    viewedProductIds: observed.viewedProductIds,
    purchasedProductIds: observed.purchasedProductIds,
  }
  : profile;

const ranked = products.map((product) => scoreProduct(product, merged, observed ?? null));
  return ranked.sort((a, b) => b.matchScore - a.matchScore);
}

const BUDGET_LABEL: Record<BudgetBand, string> = {
  value: "value", mid: "mid", premium: "premium",
};
const PRIORITY_LABEL: Record<Priority, string> = {
  price: "price", quality: "quality", newest: "newest",
};

function scoreProduct(
  product: Product,
  profile: ShopperProfile,
  observed: ObservedSignals | null
  ): PersonalisedProduct {
  let score = 50;
  const reasons: string[] = [];
  const specs = product.specs ?? {};

// 1) Budget fit — does the product's tier match what they said they spend?
const wantBudget = profile.budget[product.category];
  const tier = specs.tier as BudgetBand | undefined;
  if (wantBudget && tier) {
    if (tier === wantBudget) {
      score += 20;
      reasons.push(`Fits your budget (${BUDGET_LABEL[wantBudget]})`);
    } else if (
      (wantBudget === "value" && tier === "premium") ||
      (wantBudget === "premium" && tier === "value")
      ) {
      score -= 15; // two bands away — poor fit
    }
  }

// 2) Priority — reward the thing they said matters most.
if (profile.priority === "quality" && specs.quality) {
  const q = Number(specs.quality);
  if (q >= 4) { score += 18; reasons.push("Highly rated for quality"); }
}
  if (profile.priority === "newest" && specs.released) {
    if (Number(specs.released) >= 2026) { score += 18; reasons.push("Newest model"); }
  }
  if (profile.priority === "price" && tier === "value") {
    score += 18; reasons.push("Sharply priced");
  }

// 3) Per-category detail — e.g. running experience level.
const detail = profile.detail[product.subcategory];
  if (detail?.niveau && specs.level) {
    if (detail.niveau === specs.level) {
      score += 12;
      reasons.push(`For ${detail.niveau} level`);
    }
  }

// 4) Category interest — small nudge for a category they actually shop.
if (profile.categories.includes(product.category)) score += 5;

// 5) Observed behaviour — what they DO, not just what they said.
if (profile.purchasedProductIds?.includes(product.id)) score -= 40; // already owns it
if (profile.viewedProductIds?.includes(product.id)) score += 4;
  if (observed) {
    // clicked through to a retailer for this product = strong intent
  if (observed.clickedOutProductIds.includes(product.id)) {
    score += 8;
    reasons.push("You showed interest in this");
  }
    // affinity: they browse this category a lot
  const affinity = observed.categoryAffinity[product.category] ?? 0;
    if (affinity >= 3 && profile.categories.includes(product.category)) {
      score += 6;
    }
  }

// If nothing specific matched, still give an honest generic reason.
if (reasons.length === 0) {
  reasons.push(`Chosen for ${PRIORITY_LABEL[profile.priority]}`);
}

return {
  product,
  matchScore: Math.max(0, Math.min(100, score)),
  reasons: reasons.slice(0, 2), // keep the "for you" line short
};
}

// ---- async loader used by app/account/page.tsx ----
// Same-device fast path first (no network round trip). If THIS device has
// never seen a profile for this shopper, fall back to the copy Supabase holds
// for their account — that's what lets a returning shopper on a NEW device
// skip the questionnaire instead of being sent through it again. Call sites
// do not change.
export async function loadProfileAsync(): Promise<ShopperProfile | null> {
  const local = loadProfile();
  if (local) return local;

try {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null; // guest, or not signed in yet — nothing to pull

  const { data: row, error } = await supabase
  .from(TABLE)
  .select("profile")
  .eq("user_id", user.id)
  .maybeSingle();
  if (error || !row) return null;

  const profile = row.profile as ShopperProfile;
  saveProfile(profile); // warm the local cache so this device is fast next time
  return profile;
} catch {
  return null;
}
}
