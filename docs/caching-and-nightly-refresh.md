# Caching & nightly refresh — how scoopt.nl stays fast *and* current

**Status:** prepared on branch `feat/cache-refresh-after-ingest`, not merged, not deployed.
Nothing here is live until the branch is merged into `main` **and** the setup steps in section 4 are done.

---

## 1. The idea in one paragraph

Everything that is the same for every visitor — products, categories, prices, price history — is now
**cached** by Vercel, so a click is answered in milliseconds instead of waiting on Vercel → Railway →
Supabase. Because prices only change when the **ingest job** runs, the ingest job now **clears that cache
the moment it finishes**, so the site is never older than the database. A **6-hour limit** is kept as a
backstop in case a clear ever fails. On top of that, a small **nightly job at 03:00 Amsterdam time**
clears the cache again and **redeploys** the site from `main`.

Anything tied to one person (basket, profile, account, saved items, alerts, personalised picks) is
**never cached** — a cached response is served to *everyone*, so caching personal data would show one
shopper's data to another.

## 2. How the pieces fit together

```
                           every visitor
                                │
                                ▼
┌──────────────────────── Vercel (scoopt.nl) ─────────────────────────┐
│  Catalogue pages + /api catalogue routes                            │
│     cached (tag "catalog", max 6 h)  ──miss──►  Railway backend ──► Supabase
│                                                                      │
│  POST /api/revalidate  (needs REVALIDATE_SECRET)                     │
│     → throws away everything tagged "catalog" + all rendered pages   │
└──────────────────────────────▲───────────────────────────────────────┘
                               │ "prices changed, clear your cache"
          ┌────────────────────┴─────────────────────┐
          │                                          │
 Railway: scoopt-ingest-cron               Railway: nightly-refresh (NEW)
 00:00 UTC daily (existing)                01:00 + 02:00 UTC, acts only when
 loads prices → clears cache               it is 03:00 in Amsterdam:
                                           clears cache → triggers Vercel redeploy
```

## 3. What each part does

### Website (frontend — Vercel)

| File | What it does |
|---|---|
| `frontend/lib/catalogCache.ts` **(new)** | The single place that defines caching: the tag name `catalog` and the 6-hour backstop (`CATALOG_REVALIDATE = 21600`). Contains the written rule that personal data must never use it. |
| `frontend/lib/api.ts` | The server-side fetches for product, category, category products and price history now use the catalogue cache. Search, basket and personalise stay uncached. |
| `frontend/lib/backend.ts` | The proxy that `/api/*` routes use gets an opt-in `{ catalog: true }` switch. Without the switch it still never caches — so any new route is uncached unless someone deliberately marks it as catalogue data. |
| `frontend/app/api/categories/[...path]/route.ts` | Opted in. **This is the subcategory product grid that was taking ~525 ms per visit.** |
| `frontend/app/api/category/[cat]/route.ts`, `…/product/[id]/route.ts`, `…/price-history/[id]/route.ts` | Opted in (shared catalogue data). |
| `frontend/app/category/[cat]/page.tsx`, `…/[cat]/[sub]/page.tsx`, `frontend/app/product/[id]/page.tsx` | Rendered pages are cached up to 6 h (was 10 min). They are cleared together with the data. |
| `frontend/app/api/revalidate/route.ts` **(new)** | The "clear the cache" button, as a URL. Only answers `POST` requests carrying `Authorization: Bearer <REVALIDATE_SECRET>`; anything else gets 401, and if the secret isn't configured it refuses everything (503). Clears the `catalog` data and every rendered page. |
| `frontend/.env.example` | Documents the new `REVALIDATE_SECRET` variable. |

Errors are never cached: Next.js only stores `200 OK` responses, so a backend hiccup can't get stuck
on the site.

### Backend (Railway)

| File | What it does |
|---|---|
| `backend/src/lib/site-cache.ts` **(new)** | `clearSiteCache()` — calls `POST {SITE_URL}/api/revalidate` with the secret. **Never throws**: if the call fails, the ingest run still counts as successful (the data *is* in the database) and the log says so loudly; the 6-hour backstop then refreshes the site anyway. |
| `backend/src/ingest/run.ts` | After a successful ingest, calls `clearSiteCache('ingest finished')`. Skipped when every source failed (nothing changed). |
| `backend/src/jobs/nightly-refresh.ts` **(new)** | The 03:00 job: (1) clears the site cache, (2) calls the Vercel Deploy Hook to start a fresh production deployment of `main`. Exits with an error if either step fails, so Railway shows the run as failed. |
| `backend/package.json` | New script `npm run nightly-refresh`. |
| `backend/tests/nightly-refresh.test.ts` **(new)** | Proves the job runs exactly once a night at 03:00 Amsterdam in summer, winter and on both clock-change nights. |
| `backend/.env.example` | Documents `SITE_URL`, `REVALIDATE_SECRET`, `VERCEL_DEPLOY_HOOK_URL`. |

### Why 03:00 needs two schedule times

Railway cron runs on **UTC** and ignores daylight saving. 03:00 in Amsterdam is **01:00 UTC in summer**
and **02:00 UTC in winter** (clocks go back on 25 Oct 2026). So the job is scheduled for **both**
(`0 1,2 * * *`) and the script checks the Amsterdam clock: on one run it does the work, on the other it
logs "not 03:xx — nothing to do" and exits. No manual change needed when the clocks change.

### Why the ingest job and the nightly job are separate

The existing ingest runs at 00:00 UTC (02:00 Amsterdam in summer, 01:00 in winter) and already clears
the cache itself — that alone keeps prices current. The 03:00 job is a **safety net**: if an ingest
clear ever fails, the site is cleared again within the night, and the redeploy gives a clean start
every day. Worth knowing: the redeploy is not strictly needed for freshness, and each one uses a Vercel
build (~1–2 min). If a nightly build ever fails, Vercel keeps serving the previous version — the site
does not go down.

### Why not a Vercel Cron job

This project uses Vercel's multi-service setup (`services` in `vercel.json`), which is still in beta,
and Vercel's docs don't say whether cron jobs work with it. Railway cron is already proven here
(`scoopt-ingest-cron`), so the nightly job lives there too.

## 4. Setup steps (after the branch is merged)

The secrets below are passwords — paste them yourself; never commit them to the repo.

1. **Create the secret.** Any long random string, e.g. run
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. **Vercel → scoopt01 → Settings → Environment Variables:** add `REVALIDATE_SECRET` = that string
   (Production). Redeploy once so it takes effect.
3. **Vercel → scoopt01 → Settings → Git → Deploy Hooks:** create a hook named `nightly-refresh`
   for branch `main`. Copy the URL (treat it as a password).
4. **Railway → scoopt-ingest-cron → Variables:** add `SITE_URL` = `https://scoopt.nl` and
   `REVALIDATE_SECRET` = the same string.
5. **Railway → + Add → GitHub repo `Scoopt-Vof/Scoopt`**, name it `nightly-refresh`, then in its
   Settings:
   - Root directory: `/backend`
   - Custom start command: `npm run nightly-refresh`
   - Cron schedule: `0 1,2 * * *`
   - Variables: `SITE_URL`, `REVALIDATE_SECRET` (same values as above), `VERCEL_DEPLOY_HOOK_URL`
     (the hook URL from step 3).

## 5. How to check it works

- **Cache clear by hand:** in Railway, run the nightly service once with the extra variable
  `FORCE_REFRESH=1` (then remove it). The log should show `✓ site cache cleared` and
  `✓ redeploy triggered`, and a new deployment appears in Vercel.
- **After an ingest run:** the ingest log ends with `✓ site cache cleared (ingest finished)`.
  A `⚠ site cache NOT cleared` line means a variable is missing on that Railway service.
- **Speed:** open a page twice — the second load should show `x-vercel-cache: HIT` and come back in
  well under 200 ms.

## 6. Rules for the future (for Lorenzo & Josh)

- **Never** pass `{ catalog: true }` or use `catalogFetchInit` for anything tied to one person.
- A new data source (Awin, Bol, …) needs nothing extra *as long as it's loaded through the ingest
  job*. Any other process that writes prices must call `clearSiteCache()` when it finishes.
- "I changed data and the site didn't update" is almost always the cache — run the nightly job with
  `FORCE_REFRESH=1`, or redeploy in Vercel.

## 7. How to undo it

- **Everything:** revert the merge commit on `main`; Vercel redeploys the previous behaviour.
- **Only the nightly job:** delete (or pause) the `nightly-refresh` service in Railway.
- **Emergency:** Vercel → Deployments → pick the previous deployment → *Promote* (one click).

## 8. What was tested

- Frontend build passes (Next.js 15.1); the three catalogue pages are cached pages (ISR), and
  `/api/revalidate` is a dynamic route.
- Local run against a stand-in backend: 4 visits → 1 backend call; wrong or missing secret → 401;
  after a clear → exactly 1 new backend call, then cached again; the backend's `clearSiteCache()`
  successfully cleared the local site; with its variables missing it logs a warning and doesn't fail.
- Backend type-check passes; the 4 timing tests pass (summer, winter, both clock-change nights,
  forced run).
- **Not yet tested:** on Vercel/Railway themselves — that happens on the branch's Vercel preview and
  with the `FORCE_REFRESH=1` run in section 5.
