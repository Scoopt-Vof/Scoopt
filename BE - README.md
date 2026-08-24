# Scoopt back end — Decathlon trial run

A complete, working, single-retailer vertical slice: database → ingestion → API →
tests. Everything runs. 29 tests pass. Nothing here is a sketch.

**Read `DECATHLON-NOTE.md` first** — it explains why the source adapter reads a
stand-in catalogue rather than decathlon.nl, and what to change when a licensed
feed arrives.

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

Unzip `scoopt-backend.zip` to wherever you keep code — e.g. `~/code/scoopt-backend`.
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
npm run db:migrate # create the tables in Supabase
npm run ingest     # load the catalogue — should print "15 seen, 15 offers"
npm test           # 29 tests, all should pass
npm run dev        # start the API on http://localhost:3001
```

With the server running, open a **second** terminal and try:

```bash
curl "http://localhost:3001/api/search?q=Kalenji"
curl "http://localhost:3001/api/product/1"
curl "http://localhost:3001/api/price-history/1"
```

Or just open <http://localhost:3001/api/product/1> in your browser.

Run `npm run ingest` a few more times and the price history builds up. Set
`SIMULATE_PRICE_DRIFT=1` in `.env` first if you want the prices to actually move
so the chart has something to show.

### 6. Look at the data

Supabase dashboard → **Table Editor**. You'll see `product`, `offer`,
`price_observation`, `ingest_run`, `match_review_queue` filling up.

---

## What's in here

```
db/001_schema.sql          the database. money as integer cents, price history append-only
src/contract/types.ts      the shapes the API returns  ← replaced by Josh's contract later
src/contract/schemas.ts    Zod mirrors + the invariants written down as code
src/sources/types.ts       the RetailerSource interface  ← THE SWAP POINT
src/sources/decathlon.ts   the Decathlon adapter  ← the one file a real feed replaces
src/ingest/run.ts          acquire → archive → normalise → match → store
src/api/queries.ts         all the SQL
src/api/handlers.ts        Request → Response functions  ← these drop into Next.js as-is
src/server.ts              a tiny dev server so you can curl it without Next.js
tests/                     29 tests: unit, integration, and data-quality
data/                      the stand-in Decathlon catalogue
raw/                       archived payloads, one per ingest run
```

---

## Wiring this into Josh's Next.js app

Nothing needs rewriting. Copy `src/` and `db/` into the repo, delete
`src/server.ts` and `src/contract/types.ts`, point the contract imports at
`contract/types.ts`, and each route file becomes two lines:

```ts
// app/api/product/[id]/route.ts
import { productHandler } from '@/src/api/handlers';

export const GET = (req: Request, ctx: { params: { id: string } }) =>
  productHandler(req, ctx.params.id);
```

```ts
// app/api/search/route.ts
import { searchHandler } from '@/src/api/handlers';
export const GET = searchHandler;
```

The `DATA_SOURCE` flag from the 6 Aug plan sits above this: `lib/data/index.ts`
returns either `lib/fakeData.ts` or these queries. That's how you flip between
fake and real in one second, and how `lib/fakeData.ts` stays useful as a test
oracle instead of being deleted.

---

## What this trial run proves, and what it doesn't

**Proves:** the schema holds real data; ingestion is idempotent; price history
accumulates and cannot be silently rewritten; junk EANs are caught rather than
matched; the API returns contract-valid shapes; the data-quality checks fire.

**Doesn't prove:** that any particular retailer will give you data. That is a
commercial question, not a technical one, and it stays the long pole. Nothing in
this codebase gets you closer to it except that it's ready when approval lands.

**Not built yet** (deliberately out of scope for a single-retailer trial):
`/api/category`, `/api/basket/*`, `/api/personalise`, auth, and matching tiers 2
and 3 — brand+MPN and fuzzy title only start mattering with a second retailer.
