# For Larry: front-end session handoff (2026-09-14)

Josh (with Claude) actioned the **front-end** findings from the code evaluation, then a second round of front-end fixes from walking the live site. All front-end changes are in `frontend/` only. Two small **backend** edits were also made on your behalf (flagged clearly below, both additive, both build clean) — review them before your next session rather than assuming they're done.

This note has three parts: **Part 1** is the original evaluation-findings batch. **Part 2** is the batch from Josh's live-site walkthrough, plus the backend work. **Part 3** is a checkout flow added on top of Part 2's item 6 (delivery details).

---

# Part 1 — Code-evaluation findings batch

## 1. One shared-contract change (needs your half)

I edited `frontend/contract/types.ts` additively: added an optional field to `PriceHistory`:

```ts
observedDays?: number; // distinct days of price history observed
```

- Why: the "cheapest it's been in 30 days" signal was showing after a single day of data. The front end now hides it until 14+ distinct days exist, using `observedDays` when present and falling back to counting distinct days in `points` until you send it.
- **Action for you:** mirror the same field into the backend copy `backend/src/contract/frontend-types.ts` (the two are meant to stay identical), and return `observedDays` from `GET /api/price-history/:id`. Ideally also fix the price basis (A4): `points` exclude shipping while `currentMin` includes it, so the signal is not fully trustworthy until those match.

This is the only contract change from this part. Josh cleared editing the contract; flag anything you disagree with.

## 2. One behavioural change to agree (the API seam)

The front end no longer uses `NEXT_PUBLIC_API_BASE`. New rule (this was F2/A7):

- Browser always calls the relative `/api/...` proxy (same origin as scoopt.nl).
- Server renders call `BACKEND_URL` directly.

Consequences for your half:
- Browser traffic is now same-origin to `scoopt.nl/api`, and Vercel forwards it to Railway **server-to-server**. So the backend no longer needs permissive browser CORS for the normal read path. It does need to accept server-to-server calls from Vercel (it already will). The CORS-on-error findings (B5) matter less now, since the browser no longer talks to Railway directly.
- Vercel is set: `BACKEND_URL = https://scoopt-production.up.railway.app` (Production and Preview) on the `scoopt01` project. The old `NEXT_PUBLIC_API_BASE` vars are still there and can be deleted once the new deploy is confirmed.

## 3. Endpoints the front end now calls (so nothing surprises you)

- `GET /api/categories/:path/products` is now used by the subcategory intake form and the profile page (they used to pull the whole catalogue via empty search). Profile "recently viewed" calls `GET /api/product/:id` once per id (up to 6). A batch endpoint (G12, `GET /api/products?ids=`) would turn that into one call.
- The basket now filters out-of-stock offers **client-side** (A3). Cleaner if `/basket/plan` excludes or flags them like `/basket/compare` does.

## 4. Back-end items the front end is now ready for

- **G6 product attributes** (budget tier, quality, release year, level). When these exist, flip `SHOW_MATCH_PERCENT` to `true` in `frontend/lib/profile.ts` and the match % comes back. It is hidden today because every product scored ~50%.
- **A6 `storeName`** on `Offer` (currently the slug `ebay-nl` is shown as-is).
- **A1 / G7 shipping** as a separate field on `Offer`, plus real delivery rules (B9). Today shipping is folded into `Offer.price` and delivery is always "free", so the smart-split verdict will double-count shipping once real fees land. Front end is ready for a shipping field.
- **A2 / B11 one public product id** returned by every endpoint (category grid uses numeric id, product/search use the slug; same product from two places splits the basket).
- **A4 / G11 price-history basis** + `observedDays` (see item 1).
- **G3 account deletion / export**: sign-out now clears local data (and, since Part 2, actually ends the Supabase session — see below), but there is still no Supabase delete policy or delete/export endpoint. The privacy and sign-in copy was softened so it no longer over-promises.

## 5. Still business/legal (shared, not code)

- Privacy page placeholders: `[DATE]`, `[KVK NUMBER]`, `[REGISTERED ADDRESS]`, `[CONTACT EMAIL]` (need the KvK details).
- Affiliate programmes / real retailer feeds (G4, G5, B7), backend hosting + scheduler (B2, G14) remain open.
- **Site language: decided.** Josh confirmed the site stays in **English** — this is settled, not open anymore.

The full per-finding front-end detail is in `Claude outputs/Scoopt-Frontend-Fixes-2026-09-14.md`.

---

# Part 2 — Live-site walkthrough batch (new)

Josh walked the live site and raised six items (see `Claude outputs/Scoopt-Frontend-Action-List-v2.md` for the original analysis). All six are now implemented. Summary of what actually shipped, and what still needs you.

## 6. Home page refresh — done, front-end only

`frontend/app/page.tsx` and `globals.css` rewritten:
- Added inline SVG icons (category icons + a tool icon per "tools we're building" card) so the page reads as illustrated rather than plain text, with no external image assets to manage.
- The four "tools we're building" tiles are restyled as flat, tinted info panels (`tint-blue/green/orange/purple` — solid background colour, no border, no shadow, no hover-lift) so they read as information, not buttons.
- Hero and section copy rewritten shorter and warmer (new H1: "Know what to buy. Then buy it for less.").
- **Language confirmed English** — no action needed from you here, but worth knowing since it touches copy you may also write (privacy page, etc.) — keep that in English too for consistency.

## 7. Signed-in shoppers skip the questionnaire — done, front-end only

`frontend/components/SubcategoryIntake.tsx` rewritten as a `loading → form → results` state machine. If the shopper is signed in and already has saved answers for that subcategory, it skips straight to results. Two new actions sit above the results: **"Edit preferences"** (re-opens the form against the saved profile) and **"Shopping for someone else?"** (opens the same form but builds a temporary profile scoped to just that visit — never calls `saveProfile()`, never touches their real profile). `PersonalisedGrid` gained an optional `profileOverride` prop to rank against that temporary profile instead of the saved one.
- No backend or contract involvement.

## 8. Product page: write-up + specs table — done, **includes a backend change**

`frontend/app/product/[id]/page.tsx` rewritten to a two-column layout: image on the left, on the right the name, a friendly fit blurb, the new `description` write-up (see below), the existing "why it fits you" reasons, a new specs table (`frontend/components/ProductSpecs.tsx`, renders `Product.specs` with an Icecat attribution line, hidden entirely if there are no specs), then add-to-basket. Prices/price-history sit full-width below.

**Backend change made on your behalf**, since this needed a field the contract didn't have:
- Added `description?: string;` to `Product` in **both** `frontend/contract/types.ts` and `backend/src/contract/frontend-types.ts` (kept in sync, as agreed).
- Wired it through `backend/src/api/contract-queries.ts`: added `description` to `ProductRow`, to the `PRODUCT_COLS` select (`p.description`), and to `toProduct()` (`description: r.description ?? undefined`). This is a single shared helper, so `getProduct`, `searchProducts`, the category-products query, and the personalise-related query all pick it up automatically — no per-endpoint changes needed.
- I did **not** touch `backend/db/001_schema.sql` or `backend/src/ingest/enrich-icecat.ts` — the `description` column already existed on the `product` table and `enrich-icecat.ts` already wrote Icecat's long description into it; it just wasn't exposed over the API or contract. This was purely "expose what's already there."
- **Please review this edit before your next backend session** — it's a small, additive, mechanical change, but it's your file.

## 9. Sign-out now actually signs out — done, front-end only

`frontend/app/profile/page.tsx`: the sign-out button handler now `await`s `signOut()` (which clears the Supabase session and every `scoopt.*` localStorage key) before navigating home, instead of navigating first and leaving the async clear to fail silently. Real bug, small fix, no backend involvement.

## 10. Editable profile tiles (What you value / Life context) — done, front-end only

New `frontend/components/ProfilePersonalise.tsx`, dropped into the profile page in place of the old static display-only tiles. Each of "What you value" (multi-select chips) and "Life context" (household, home, **who I shop for**, pets) now has an inline "Change" editor that saves back into the local profile. "Who I shop for" is the field that powers the "buy something for my son" scenario Josts described — it's stored now; nothing yet *reads* it to bias suggestions automatically (today the per-visit override in item 7 covers "shopping for someone else" manually). Wiring "who I shop for" into automatic personalisation is a natural next front-end step, no backend needed, just flagging it as not done yet.

## 11. Delivery details storage — done (Josh chose "build it now"), front-end only, personal data

New `frontend/lib/delivery.ts`: a `DeliveryDetails` type (name, address lines, postcode, city, country, phone) stored under its own localStorage key `scoopt.delivery.v1`, separate from the anonymous preference profile, only shown/editable when signed in (via `ProfilePersonalise`, when `signedIn` is true). The code has an explicit comment that this is groundwork only: **it does not, and cannot, auto-fill a third-party retailer's checkout** (eBay's checkout runs on eBay's own domain — no front end can pre-fill another company's form across origins for security reasons). This is purely storing the details for a possible future Scoopt-owned checkout or for affiliate hand-off, nothing more. No backend involvement yet — there's no endpoint to send this anywhere; it just lives in the browser today.
- Worth a business conversation before building further: real "push order, pre-filled" would need a formal API/affiliate integration per retailer (ties into G4, the eBay Partner Network item already on your list), not a front-end trick.

## 12. Icecat descriptions were coming back in Dutch — code fixed, **you have two follow-up steps**

Josh noticed the new product write-up (item 8) was showing Dutch text on the live site. Root cause and fix, in `backend/src/sources/icecat.ts`:

```ts
// Icecat's live API treats the language code as upper-case (EN, NL, ...);
// a lower-case value can silently fall back to the account's default
// language, which is why descriptions were coming back in Dutch.
const ICECAT_LANG = (process.env.ICECAT_LANG ?? 'en').toUpperCase();
```
(previously the request hard-coded `lang=en` lower-case in the URL; now it uses `ICECAT_LANG`, normalised to upper-case, with an `ICECAT_LANG` env var if you ever want to override per market).

**This fixes future lookups only.** Three things for your next session:

1. **Re-run the enrichment job**: `npm run enrich:icecat` against the live DB, so already-stored Dutch descriptions get refreshed in English. I can't run this myself — no backend shell in this session, and it needs your Icecat tokens plus live DB access.
2. **Check the MyIcecat dashboard's default content language.** If the account-level default is set to Dutch, some responses may still lean Dutch regardless of the `lang` parameter — worth a quick look at MyIcecat → account settings while you're in there.
3. **Know the ceiling**: on the free Open Icecat tier, some products may only have Dutch content available at all, whatever language is requested — that's a data-coverage limit, not a bug. If a handful of products stay Dutch after the re-run and a dashboard check, that's likely why.

---

# Part 3 — Checkout flow (new) — front-end only, no backend or contract change

Josh's last ask this session: a checkout page after the basket, that "recognises" the shopper coming back from a retailer's checkout. Same underlying reality as Part 2 item 6: eBay's (or any retailer's) checkout runs on their own domain, so there is no webhook, redirect-back, or API that hands Scoopt a real "order complete" signal. So this is built as **self-reported recognition**: notice the shopper leaving, notice them coming back, ask them directly. Josh confirmed this approach explicitly before I built it.

## 13. New `/checkout` page

`frontend/app/checkout/page.tsx`: reuses the exact same `planBasket()` result the basket page already computes, and groups the recommended plan's lines by store. For each store it shows the items, the store subtotal, and a **"Proceed to checkout at `<store>`"** button. It also shows a read-only summary of the shopper's saved delivery details (Part 2 item 11) with a link back to `/profile` to edit them, and a plain note that each store will still ask for the address itself. The basket page (`frontend/app/basket/page.tsx`) now has a "Proceed to checkout →" button leading here.

## 14. `startCheckout()` — leaving for the retailer

New `frontend/lib/checkout.ts`. Clicking "Proceed to checkout at `<store>`" opens each item's existing affiliate `Offer.url` in its own new tab (there is no "add all to one cart" link a comparison site can call — each offer is its own product page on the retailer), and writes a small "pending checkout" record to `localStorage` (`scoopt.checkout.pending.v1`: store, item ids/names, total, a timestamp). No network call, no contract change — this only reads offer data the basket page already has.

## 15. `CheckoutReturnWatcher` — recognising the return

New `frontend/components/CheckoutReturnWatcher.tsx`, mounted once, site-wide, in `frontend/app/layout.tsx`. It listens for the browser tab regaining focus/visibility. If a pending checkout exists and at least ~4 seconds have passed since it started (so an instant re-click doesn't falsely trigger it), it shows a modal: **"Did you complete your order at `<store>`?"** — with the caveat sentence spelled out to the shopper that Scoopt can't actually see what happened on the retailer's site.
- **Yes** → files an order (`scoopt.orders.v1`, capped at 30) and removes those items from the basket.
- **No / not yet** → clears the pending flag, basket is left exactly as it was.

This fires wherever the shopper lands after tabbing back, not just on `/checkout`, since they may return to a different tab/page.

## 16. Order history on the profile page

`frontend/app/profile/page.tsx` gained a "Recent orders" section (only shown once at least one order exists) listing store, items, total and a relative time, sourced from `readOrders()` in the new `lib/checkout.ts`. It's labelled plainly as self-reported, for the same reason as above.

## What this is and isn't

- It's a real, working "did you check out?" loop that a shopper can use today, and it correctly clears items out of the basket once they say yes.
- It is **not** or does not: submit an order anywhere, pass the delivery details to the retailer, receive any confirmation from the retailer, or persist orders anywhere but that one browser's `localStorage` (an order made on one device won't show up on another, and — like the rest of `scoopt.*` — it's wiped on sign-out, same as the basket and delivery details today).
- **No backend or contract involvement at all.** If you later want real order confirmation (via an affiliate network's postback, or Scoopt's own checkout), this module (`lib/checkout.ts`) is the seam to swap out — the shopper-facing shape stays the same, only what backs "confirmed" changes.

---

## Quick checklist for your next session

- [ ] Review the `description` field wiring in `contract-queries.ts` / `frontend-types.ts` (item 8).
- [ ] Review the `ICECAT_LANG` fix in `icecat.ts` (item 12).
- [ ] Run `npm run enrich:icecat` to refresh already-stored Dutch descriptions.
- [ ] Check MyIcecat's default content-language setting.
- [ ] Mirror `observedDays` into your contract copy and return it from `GET /api/price-history/:id` (Part 1, item 1) — still outstanding.
- [ ] KvK details for the privacy page placeholders, whenever convenient.
- [ ] Nothing needed for Part 3 (checkout) — flagging it so it's not a surprise when you next pull `main`.

Everything in Part 2 and Part 3 is front-end only (aside from the two flagged backend edits in item 8 and item 12) and needs nothing else from you to work.
