# Caching & refresh — how scoopt.nl stays fast *and* current

**Status:** branch `feat/cache-refresh-after-ingest` (PR 1 of the site-speed plan).
Nothing here is live until the branch is merged into `main` **and** the setup in section 4 is done.

---

## 1. The idea in one paragraph

Everything that is the same for every visitor — products, categories, prices, price history — is
**cached** by Vercel, so a click is answered in milliseconds instead of waiting on Vercel → Railway →
Supabase. Prices only change when the **ingest job** runs, so the ingest job **clears that cache the
moment it finishes** and the site is never older than the database. A **1-hour limit** is kept as a
backstop in case a clear ever fails (bol requires prices to match its site "at all times", so a stale
price may never sit on the site longer than one refresh cycle).

Anything tied to one person (basket, profile, account, saved items, alerts, personalised picks) is
**never cached** — a cached response is served to *everyone*, so caching personal data would show one
shopper's data to another.

There is **no nightly redeploy**. With hourly ingests (see the site-speed plan) it would add nothing,
cost a build every night, and deploy whatever is on `main` unattended.

## 2. How the pieces fit together

```
                           every visitor
                                │
                                ▼
┌──────────────────────── Vercel (scoopt.nl) ─────────────────────────┐
│  Catalogue pages + /api catalogue routes                            │
│     cached (tag "catalog", max 1 h)  ──miss──►  Railway backend ──► Supabase
│                                                                      │
│  POST /api/revalidate  (needs REVALIDATE_SECRET)                     │
│     → throws away everything tagged "catalog" + all rendered pages   │
└──────────────────────────────▲───────────────────────────────────────┘
                               │ "prices changed, clear your cache"
                  Railway: scoopt-ingest-cron
                  loads prices → clears cache
```

## 3. What each part does

### Website (frontend — Vercel)

| File | What it does |
|---|---|
| `frontend/lib/catalogCache.ts` **(new)** | The single place that defines caching: the tag `catalog` and the 1-hour backstop (`CATALOG_REVALIDATE = 3600`). Contains the written rule that personal data must never use it. |
| `frontend/lib/api.ts` | Server-side fetches for product, category, category products and price history use the catalogue cache. Search, basket and personalise stay uncached. |
| `frontend/lib/backend.ts` | The proxy that `/api/*` routes use gets an opt-in `{ catalog: true }` switch. Without it nothing is cached — a new route is uncached unless someone deliberately marks it as catalogue data. |
| `frontend/app/api/categories/[...path]/route.ts`, `…/category/[cat]`, `…/product/[id]`, `…/price-history/[id]` | Opted in (shared catalogue data). |
| `frontend/app/category/[cat]/page.tsx`, `…/[cat]/[sub]/page.tsx`, `frontend/app/product/[id]/page.tsx` | Rendered pages cached up to 1 h, cleared together with the data. |
| `frontend/app/api/revalidate/route.ts` **(new)** | The "clear the cache" URL. Only answers `POST` with `Authorization: Bearer <REVALIDATE_SECRET>`; anything else gets 401, and without a configured secret it refuses everything (503). Uses `revalidateTag(CATALOG_TAG, { expire: 0 })` — **not** `"max"`, which would show old prices to the first visitor after an ingest. |

Errors are never cached: Next.js only stores `200 OK` responses.

### Backend (Railway)

| File | What it does |
|---|---|
| `backend/src/lib/site-cache.ts` **(new)** | `clearSiteCache()` — calls `POST {SITE_URL}/api/revalidate` with the secret. Never throws; logs loudly if it fails. |
| `backend/src/ingest/run.ts` | After a successful ingest, calls `clearSiteCache('ingest finished')`. |

## 4. Setup (after merge)

Secrets are passwords — paste them yourself; never commit them.

1. Create a long random string, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. **Vercel → scoopt01 → Settings → Environment Variables:** `REVALIDATE_SECRET` = that string (Production and Preview). Redeploy once.
3. **Railway → scoopt-ingest-cron → Variables:** `SITE_URL` = `https://scoopt.nl`, `REVALIDATE_SECRET` = the same string.

## 5. How to check it works

- The ingest log ends with `✓ site cache cleared (ingest finished)`. `⚠ site cache NOT cleared` means a variable is missing.
- Open a page twice: the second load shows `x-vercel-cache: HIT` and returns well under 200 ms.

## 6. Rules for the future (Lorenzo & Josh)

- **Never** use `{ catalog: true }` or `catalogFetchInit` for anything tied to one person.
- Every process that writes prices must end with `clearSiteCache()`. Sources loaded through the ingest job get this for free.

## 7. How to undo it

Revert the merge commit on `main`, or in Vercel → Deployments promote the previous deployment.
