# Scoopt back end

A complete, working vertical slice: database → ingestion → API → tests.
Everything runs. Nothing here is a sketch.

Prices come from **eBay** only (see `README-LIVE-APIS.md`); **Icecat** supplies
the catalogue itself — product rows with a real manufacturer image, name and
specs, created straight from Icecat's data with no price attached — and also
enriches products a retailer feed already found (see `README-ICECAT.md`). No
source may invent a price; Icecat carries none at all.

Sources with invented prices are refused on the write path in
`src/ingest/run.ts` unless `ALLOW_SYNTHETIC_SOURCES=1`, which only the test
suite sets. Never set it against the database that serves scoopt.nl.

---

## What you need installed

You already have Node, npm, Git and VS Code, so you need one more thing:

| Thing | Why | Where |
|---|---|---|
| A Postgres database | Everything else needs somewhere to write | [supabase.com](https://supabase.com) — free tier, pick region **Frankfurt (eu-central-1)** |

That's it. No Docker, no Python, no VPS for this trial.

---

## Setup — about ten minutes

### 1. Put the folder somewhere sensible

Clone the repo (or open the clone you already have) and work in `backend/`.
Open that folder in VS Code (**File → Open Folder**).

### 2. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Name it `scoopt`, set a database password (**save it in your password manager now** —
   Supabase shows it once)
3. Region: **Central EU (Frankfurt)**. This matters for GDPR and it matters for latency.
4. Wait ~2 minutes while it provisions.

### 3. Get the connection string

In the Supabase dashboard: **Settings** (gear, bottom left) → **Database** →
**Connection string** → **URI** tab.

Copy the one labelled **Session pooler**, port **5432**. It looks like:

```
postgresql://postgres.abcdefghijklm:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

Replace `[YOUR-PASSWORD]` with the password from step 2.

> Two poolers are offered. **Session (5432)** for the ingestion job, which holds a
> connection. **Transaction (6543)** for the website later, because Vercel functions
> are short-lived and would otherwise exhaust the connection limit. For now, 5432.

### 4. Create your `.env`

In VS Code, duplicate `.env.example` and rename the copy to `.env`. Paste your
connection string into the `DATABASE_URL` line.

`.env` is already in `.gitignore`. **Never commit it.** If it ever lands in a
GitHub repo, rotate the password in Supabase immediately.

### 5. Run it

Open the VS Code terminal (**Terminal → New Terminal**) and run these in order:

```bash
npm install        # install dependencies (~30 seconds)
npm run db:migrate # create/upgrade the tables in Supabase (only new files run)
npm run ingest -- ebay-nl ebay-de   # load real prices (needs eBay keys, see README-LIVE-APIS.md)
npm run serve      # start the API on http://localhost:3002
```

With the server running, open a **second** terminal and try:

```bash
curl "http://localhost:3002/health"
curl "http://localhost:3002/api/search?q=running%20shoes"
curl "http://localhost:3002/api/product/1"
curl "http://localhost:3002/api/price-history/1"
```

Or use `api.http` with the VS Code REST Client extension.

Price history builds up every time `npm run ingest` runs. Offers an ingest run
has not refreshed within `OFFER_MAX_AGE_HOURS` (default 48) are hidden, so run
ingest at least that often.

`npm run db:migrate -- --list` shows which migration files are applied and
which are pending. Applied files are recorded in `schema_migrations`; the first
run against an existing database re-applies every file once (they were all
written to be re-runnable) and records them.

### Running the tests

The suite empties every table before it runs, so it must never point at a
database you care about. It reads `TEST_DATABASE_URL` — not `DATABASE_URL` —
and refuses to start if that is missing, or identical to the real one.

Make a throwaway database (a second free Supabase project called `scoopt-test`
is the quickest route), run the migrations against it, and add it to `.env`:

```
TEST_DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

```bash
npm run test:env         # runs the suite with TEST_DATABASE_URL read from .env
npm run typecheck
npm run contract:check   # the backend's contract copy still matches the front end's
```

---

### 6. Look at the data

Supabase dashboard → **Table Editor**. You'll see `product`, `offer`,
`price_observation`, `ingest_run`, `match_review_queue` filling up.

---

## What's in here

```
db/001–014_*.sql           the database, applied in filename order, each once
  001_schema.sql           money as integer cents, price history append-only
  003_rls.sql, 011_rls_category_tag.sql   row level security: Supabase's public API exposes nothing
  012–014                  delivery thresholds, shipping on history, category display metadata
scripts/migrate.mjs        applies pending migrations and records them in schema_migrations
scripts/contract-check.mjs fails if the backend's contract copy drifts from the front end's
src/contract-server.ts     THE API server (npm run serve / npm start)
src/api/contract-handlers.ts  Request → Response handlers for the contract endpoints
src/api/contract-queries.ts   rows → contract shapes; the one cents → euros conversion
src/api/catalog-*.ts       category tree, paged category products, facets, taxonomy
src/api/cors.ts, respond.ts   CORS policy, JSON/error helpers and input validation
src/lib/offers.ts          the one definition of a live offer (EUR, active retailer, fresh)
src/contract/frontend-types.ts   verbatim copy of frontend/contract/types.ts
src/contract/schemas.ts    Zod mirrors of that contract + the invariants written down as code
src/sources/types.ts       the RetailerSource interface  ← THE SWAP POINT
src/sources/ebay.ts        the eBay adapter (NL and DE marketplaces)
src/ingest/run.ts          acquire → archive → normalise → match → store → classify
src/ingest/discover-icecat.ts       creates NEW products straight from Icecat, no price yet
src/categorisation/        the classifier: source category maps, rules, (disabled) model fallback
tests/                     unit, integration and data-quality tests
tests/setup.ts             refuses to run the suite against your real database
raw/                       archived payloads, one per ingest run (gitignored; RAW_ARCHIVE_DIR overrides)
tests/fixtures/            test-only catalogue: invented brands, never shipped
```

---

## How the front end uses this

The front end's Next.js `/api/*` routes proxy to this server via
`frontend/lib/backend.ts` (`BACKEND_URL`). There is no fake-data fallback: if the
back end is unreachable the routes return 502/503 and the pages render empty —
which is the correct failure mode for a price-comparison site.

Browsers only call this server directly in local development; allow that origin
with `CORS_ORIGINS` (default `http://localhost:3000`).

---

## Deploying (Railway)

The back end runs on Railway, configured in the dashboard (Railway's
config-as-code files cannot be enabled for this project). Both services build
from this repo with **Root Directory** `/backend`, **Railpack** builder, branch
`main` (auto-deploy).

| Service | Start command | Other settings |
|---|---|---|
| API | `npx tsx src/contract-server.ts` (or `npm start`) | Healthcheck Path `/health`; restart On Failure; public domain → port 8080 |
| Ingest (cron) | `npm run ingest:railway` (eBay NL + DE) | Cron Schedule `0 3 * * *`; restart Never |

Environment variables are set per service in Railway (there is no `.env` file on
Railway). See `.env.example` for the full list.

- **API:** `DATABASE_URL`, `CONTRACT_PORT=8080` (matches the domain's target
  port); optionally `HEALTH_TOKEN`, `CORS_ORIGINS`, `OFFER_MAX_AGE_HOURS`
- **Ingest:** `DATABASE_URL`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`,
  `HTTP_USER_AGENT`; optionally `EPN_CAMPAIGN_ID`

Order when a release includes migrations: run `npm run db:migrate` against the
live database first, then merge to `main`. Offers not refreshed within
`OFFER_MAX_AGE_HOURS` (default 48) are hidden, so the ingest cron must keep
running for prices to stay visible.

The front end (Vercel) reaches the API through `BACKEND_URL`, set to the API
service's public Railway URL.

---

## What this proves, and what it doesn't

**Proves:** the schema holds real data; ingestion is idempotent and atomic per
product; price history accumulates and cannot be silently rewritten; junk EANs
are caught rather than matched; the API returns contract-valid shapes; the
data-quality checks fire.

**Doesn't prove:** that any particular retailer will give you data. That is a
commercial question, not a technical one, and it stays the long pole.

**Not built yet:** user authentication on the API (so admin routes stay
unmounted and `/api/track` drops events), matching tiers 2 and 3 (brand+MPN and
fuzzy title), currency conversion, and an ingest scheduler.
