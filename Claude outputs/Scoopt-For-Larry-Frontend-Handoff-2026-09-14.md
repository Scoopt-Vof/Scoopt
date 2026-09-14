# For Larry: front-end session handoff (2026-09-14)

Josh (with Claude) actioned the **front-end** findings from the code evaluation. All changes are in `frontend/` only. No backend code, migrations, `.env` or database was touched. The work type-checks and builds cleanly. This note is what you need to know and what to carry into the next (back-end) session.

## 1. One shared-contract change (needs your half)

I edited `frontend/contract/types.ts` additively: added an optional field to `PriceHistory`:

```ts
observedDays?: number; // distinct days of price history observed
```

- Why: the "cheapest it's been in 30 days" signal was showing after a single day of data. The front end now hides it until 14+ distinct days exist, using `observedDays` when present and falling back to counting distinct days in `points` until you send it.
- **Action for you:** mirror the same field into the backend copy `backend/src/contract/frontend-types.ts` (the two are meant to stay identical), and return `observedDays` from `GET /api/price-history/:id`. Ideally also fix the price basis (A4): `points` exclude shipping while `currentMin` includes it, so the signal is not fully trustworthy until those match.

This is the only contract change. Josh cleared editing the contract; flag anything you disagree with.

## 2. One behavioural change to agree (the API seam)

The front end no longer uses `NEXT_PUBLIC_API_BASE`. New rule (this was F2/A7):

- Browser always calls the relative `/api/...` proxy (same origin as scoopt.nl).
- Server renders call `BACKEND_URL` directly.

Consequences for your half:
- Browser traffic is now same-origin to `scoopt.nl/api`, and Vercel forwards it to Railway **server-to-server**. So the backend no longer needs permissive browser CORS for the normal read path. It does need to accept server-to-server calls from Vercel (it already will). The CORS-on-error findings (B5) matter less now, since the browser no longer talks to Railway directly.
- Vercel is set: I added `BACKEND_URL = https://scoopt-production.up.railway.app` (Production and Preview) on the `scoopt01` project. The old `NEXT_PUBLIC_API_BASE` vars are still there and can be deleted once the new deploy is confirmed.

## 3. Endpoints the front end now calls (so nothing surprises you)

- `GET /api/categories/:path/products` is now used by the subcategory intake form and the profile page (they used to pull the whole catalogue via empty search). Profile "recently viewed" calls `GET /api/product/:id` once per id (up to 6). A batch endpoint (G12, `GET /api/products?ids=`) would turn that into one call.
- The basket now filters out-of-stock offers **client-side** (A3). Cleaner if `/basket/plan` excludes or flags them like `/basket/compare` does.

## 4. Back-end items the front end is now ready for (your next session)

These are the pieces the front end is built to use the moment your half supplies them:

- **G6 product attributes** (budget tier, quality, release year, level). When these exist, flip `SHOW_MATCH_PERCENT` to `true` in `frontend/lib/profile.ts` and the match % comes back. It is hidden today because every product scored ~50%.
- **A6 `storeName`** on `Offer` (currently the slug `ebay-nl` is shown as-is).
- **A1 / G7 shipping** as a separate field on `Offer`, plus real delivery rules (B9). Today shipping is folded into `Offer.price` and delivery is always "free", so the smart-split verdict will double-count shipping once real fees land. Front end is ready for a shipping field.
- **A2 / B11 one public product id** returned by every endpoint (category grid uses numeric id, product/search use the slug; same product from two places splits the basket).
- **A4 / G11 price-history basis** + `observedDays` (see item 1).
- **G3 account deletion / export**: sign-out now clears local data, but there is no Supabase delete policy or delete/export endpoint. The privacy and sign-in copy was softened so it no longer over-promises.

## 5. Still business/legal (shared, not code)

- Privacy page placeholders: `[DATE]`, `[KVK NUMBER]`, `[REGISTERED ADDRESS]`, `[CONTACT EMAIL]` (need the KvK details).
- Affiliate programmes / real retailer feeds (G4, G5, B7), backend hosting + scheduler (B2, G14), and the site-language decision (English vs Dutch) remain open.

The full per-finding front-end detail is in `Claude outputs/Scoopt-Frontend-Fixes-2026-09-14.md`.
