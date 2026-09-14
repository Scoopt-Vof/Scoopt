# Scoopt front-end fixes — 2026-09-14 (Josh's section)

Worked from Larry's handoff brief and the code evaluation. Scope this session was the **front end** (Josh's half). Every change below was made in the `frontend/` tree, type-checked (`tsc --noEmit`, clean) and built (`next build`, all 18 routes, no errors) before being written back to the repo. Nothing was committed or pushed: that is yours to do in GitHub Desktop.

Repo was at commit `e276bd6`, a few pulls past the `55d0232` the evaluation reviewed. The front-end findings still applied (the category page had already been moved onto the paged endpoint, so F4 was only half done).

## Before you push — two manual steps

1. **Your local `frontend/.env.local`.** Remote tools are not allowed to write `.env.local`, so I could not update it. Change it from:
   `NEXT_PUBLIC_API_BASE=http://localhost:3002`
   to:
   `BACKEND_URL=http://localhost:3002`
   (Or just copy the new `frontend/.env.example` to `.env.local`.) Without `BACKEND_URL` set, local dev will show empty pages, because the browser now always goes through the `/api` proxy and the proxy reads `BACKEND_URL`. Optionally add your Supabase keys there to enable sign-in locally.

2. **Vercel environment variables (production).** Set these in the Vercel project so the deployed site works:
   - `BACKEND_URL` = your backend host (the Railway URL)
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` = from the Supabase dashboard (Project Settings, API)
   The site no longer crashes if the Supabase keys are missing, but sign-in stays disabled until they are set.

## What was fixed (front-end only)

- **F1 (Critical) — missing Supabase keys no longer take the whole site down.** `lib/supabaseClient.ts` falls back to a harmless stand-in when the keys are absent instead of throwing on import. The account screen shows a clear "accounts temporarily unavailable" message; every other page works as a guest. Added `frontend/.env.example` and un-ignored it in `.gitignore`.
- **F2 / A7 (Critical) — one backend address for dev and prod.** `lib/api.ts`: the browser always calls the relative `/api/...` proxy; server renders call `BACKEND_URL` directly. Removed the `NEXT_PUBLIC_API_BASE` fallback that made production try to reach `localhost` and shipped the backend address to the browser.
- **F3 (High) — pages no longer hang or go blank on a failed request.** Added `app/error.tsx` and `app/loading.tsx`; the basket page now shows a retry instead of "Working out the cheapest way..." forever; the profile page always finishes loading; the search box no longer leaves an unhandled promise rejection.
- **F14 (Medium) — bad request bodies return 400, not 500.** `api/basket/compare`, `basket/plan`, `personalise`, `track` now parse JSON safely.
- **F6 (High) — every basket item can be removed.** The basket list is drawn from the basket ids, so items with no offers, out-of-stock items, and items the backend no longer returns all show a status and a remove button (previously they could only be cleared en masse).
- **F7 (High) — the smart basket ignores out-of-stock offers.** `lib/smartBasket.ts` filters `inStock` before planning, so a "cheapest" pick is always actually buyable.
- **F8 (High) — honest price signal.** "Cheapest it's been in 30 days" only shows once there are 14+ distinct days of history. Added an optional `observedDays` field to the contract; falls back to counting days in the points until the backend sends it.
- **F13 (Medium) — the meaningless "match %" is hidden** (single flag `SHOW_MATCH_PERCENT` in `lib/profile.ts`). The "why it fits" reasons and the ranking order still show. Flip the flag back on once the backend supplies real product attributes (G6).
- **F5 (High) — the running questionnaire answers now reach the ranking engine.** Sign-up writes `detail["running"]` with the same field ids and values the subcategory intake form uses. Added a one-time migration for profiles saved under the old `hardlopen` key (and the old `advanced` value).
- **F4 (High) / F11 (Medium) — no more full-catalogue loads.** The subcategory intake form and the profile page use the paged category endpoint (and per-id lookups) instead of `searchProducts("")`. Subcategory pages now render the questionnaire even when the backend has no products in that subcategory yet, so "Set up Bedroom" no longer 404s. Shared category/subcategory lists live in `lib/categories.ts` and `lib/subcategories.ts`.
- **F10 (Medium) — the fake Google/Apple sign-in is gone.** `signInWithProvider` (which invented a `shopper@gmail.com` account in localStorage) was removed. "Signed in" now always reflects a real Supabase session.
- **F9 (High) — sign-out clears local data.** All `scoopt.*` keys are cleared on sign-out, so a shared computer no longer leaks the previous user's profile, basket and history. (Deleting the server-side profile row is a backend job, G3.)
- **F12 (Medium) — "sample data" wording removed; stock and freshness shown.** The product and not-found pages no longer say "sample data". `PriceLane` now shows stock status and a "checked X ago" note, and only flags the cheapest **in-stock** offer as cheapest.
- **F16 (Low) — one money format, one category list.** New `lib/format.ts` (`formatEuro`) replaces the mixed `nl-NL`/`en-IE` formatters; category names are no longer hardcoded in four places.
- **F18 (Low) — dead code removed** (`wouldSave` calc and its helper in `smartBasket.ts`).
- **F15 (partial) — Terms link added to the footer**, and the account page no longer promises "view or delete any time" (which the backend cannot do yet). The rest of F15 is business/product (below).

## Needs Larry / a contract change (flagged, not changed)

I edited the shared contract only additively (`observedDays`). These need Larry's half or a joint decision:

- **A6 / G7 — store display name.** `Offer.store` is the slug (`ebay-nl`), shown as-is. Add `storeName` to the contract and `PriceLane` will show a real name.
- **A1 / B9 / G7 — shipping.** Shipping is folded into `Offer.price` with no separate field, and delivery is always "free" (`free_above_cents` defaults to 0). Once real delivery fees exist, the smart-split verdict will double-count shipping. Needs a shipping field and agreement on where delivery is applied. Front end is ready to use it.
- **A2 / B11 — one public product id.** The category grid uses the numeric id; product/search use the slug. Same product from two places splits the basket and view history. Backend should return one id everywhere.
- **A3 — stock in the basket endpoints.** `/basket/plan` returns out-of-stock offers; I filter them client-side for now. Cleaner if the backend excludes or flags them.
- **A4 / G11 — price-history basis.** Points exclude shipping, `currentMin` includes it, so the 30-day signal is not fully trustworthy yet. Backend should use one price basis and return `observedDays`.
- **F13 / G6 — product attributes** (budget tier, quality, release year, level). Until these exist, the match % stays hidden.
- **F9 / G3 — account deletion / export.** Needs a Supabase delete policy and a delete/export endpoint.

## Business / product decisions (not code)

- **F15 legal placeholders** on the privacy page: `[DATE]`, `[KVK NUMBER]`, `[REGISTERED ADDRESS]`, `[CONTACT EMAIL]` — need the KvK details before launch.
- **F15 route names** (`/signup` is really the questionnaire, `/account` is sign-in) and offering account creation at the end of the questionnaire — a UX decision; left as-is to avoid breaking links.
- **F16 — site language** (English vs Dutch). Content is English today and `lang="en"` matches it. If you want Dutch, that is a content pass, not a one-line change.
- **F17 — tests, ESLint, Next.js upgrade** (15.1.0 -> latest 15.x for the security fixes) — worth doing, not started this session.
