# The trial run — start here

Four stages, each proving something different, each independently useful. Stage 1
takes fifteen minutes and needs nothing installed. Stop after any stage; they
build on each other but each one stands alone.

**What the whole thing proves:** the same 49 products reach the front end two
ways — from a TypeScript file and from a real Postgres database — and the site
cannot tell which. That equivalence is the seam working, and it's the thing
that means swapping in a real retailer feed later is a one-file change rather
than a rewrite.

> ⚠️ Every price in here is invented. Local development only. Never point a
> public site at any of it.

---

## Stage 1 — See the site work (15 min, nothing to install)

Josh's eight API routes all read from `lib/fakeData.ts`, and nothing else in the
app touches it. So this is a one-file swap.

```bash
# in Josh's repo
cp fakeData.ts lib/fakeData.ts
npm install
npm run dev                      # → http://localhost:3000
```

Click these five, in this order — they're chosen to show you the whole product:

| URL | What you're looking at |
|---|---|
| `/category/sport` | Hardlopen / Fietsen / Fitness |
| `/product/run-fr265` | **Four** retailers competing on one barcode |
| `/product/run-kiprunks500` | **One** offer — Decathlon own-brand, no comparison exists |
| `/basket` | Add both, watch the smart split beat the best single store |
| `/search?q=nike` | 7 results |

**If stage 1 works, you have a demonstrable product.** Everything below is about
proving the machine behind it is real.

---

## Stage 2 — Prove the backend machine works (30 min)

You need a database. Supabase free tier, region **Frankfurt**.

```bash
# in scoopt-backend/
cp .env.example .env             # paste your Supabase connection string
npm install
npm run db:migrate               # creates the tables
npm test                         # 36 tests, all should pass
```

`npm test` is the real check here. It runs the ingestion pipeline, the EAN
matcher, the API handlers and the data-quality rules against a live Postgres,
including the unhappy paths — junk barcodes going to the review queue, a
SQL-injection attempt, and a proof that price history physically cannot be
rewritten.

---

## Stage 3 — Put the Dutch sports retailers into the database (5 min)

```bash
npm run seed
```

Ingests all five Dutch sports retailers from `data/seed/`. You should see:

```
✓ decathlon.nl: 17 seen, 17 offers, 17 observations, 0 queued
✓ jdsports.nl:  20 seen, 20 offers, 20 observations, 0 queued
✓ bever.nl:     12 seen, 12 offers, 12 observations, 0 queued
✓ intersport.nl:33 seen, 33 offers, 33 observations, 0 queued
✓ bol.com:      41 seen, 41 offers, 41 observations, 0 queued
products with 2+ retailer offers (real comparisons): 36
```

**That last number is the one that matters.** 123 offers across 49 products, 36
of which have a genuine comparison. One retailer would give you a catalogue;
five give you a comparison site.

Run `npm run seed` again — offers stay at 123 (ingestion is idempotent) but
observations climb. That's the price history accumulating, and it's the only
asset here that cannot be recreated retrospectively.

---

## Stage 4 — Run the site on the database (10 min)

This is the actual trial run.

```bash
npm run trial:verify
```

Runs both implementations over the same inputs and diffs every result — all 49
product pages with their offers, five searches, the category tree, the basket
totals, the delivery rules. It should end with:

```
✓ EQUIVALENT — the front end cannot tell the file from the database
```

Then serve the database to the front end:

```bash
npm run serve                    # → http://localhost:3002
```

In Josh's repo, `lib/api.ts`, change one line:

```ts
const base = "http://localhost:3002";   // was ""
```

Restart `npm run dev` and browse the site again. Every page is now rendered from
Postgres. Change the line back and it's rendering from the file. **That swap,
with nothing else changing, is the trial run passing.**

Sanity check any time: `curl http://localhost:3002/health`

---

## What this proves, and what it doesn't

**Proved, and verified rather than asserted:** the schema holds real
multi-retailer data; EAN matching merges five retailers' rows into one product
without duplicates; ingestion is idempotent; price history accumulates and is
physically append-only; offers rank cheapest-first including shipping; the
database output is byte-identical to the file output; 36 tests pass; typecheck
is clean against Josh's real contract.

**Not proved:** that any retailer will give you data. That's a commercial
question, and nothing in this repo moves it. What it does mean is that the day
an Odyssey or Awin feed arrives, the work is one file — a parser producing
`RawOffer[]` — and everything downstream already works.

**Not proved either:** the five live API adapters (eBay, Kroger, Best Buy, Open
Prices). They were written but never executed, because the machine they were
built on has no outbound network. `npm run ingest -- openprices-ah` needs no
signup and is the cheapest way to find out.

---

## The two bugs the verification caught

Worth knowing, because neither would have thrown an error — the site would just
have been quietly wrong, which is the failure mode that actually kills a
comparison site.

**Retailer slugs.** The database called it `bol-com`; the contract calls it
`bol.com`. The front end joins delivery rules to offers on that exact string, so
every delivery fee silently resolved to zero and the smart-split planner
confidently recommended the wrong basket. No endpoint errored.

**Category vs subcategory.** The seed files set `category` to `hardlopen`
instead of `sport`, so `/api/category/sport` returned an empty subcategory list
and the entire browse page came back blank — with a 200.

Both were found only because the equivalence check compares the two
implementations field by field. Keep running it.

---

## Command reference

| Command | Does |
|---|---|
| `npm run db:migrate` | Create/update tables. Safe to re-run. |
| `npm run seed` | Ingest the five Dutch sports retailers |
| `npm test` | 36 backend tests |
| `npm run trial:verify` | Diff file-backed vs database-backed output |
| `npm run serve` | Serve contract shapes from Postgres on :3002 |
| `npm run mock` | Serve the same shapes with no database, on :4000 |
| `npm run mock:build` | Regenerate `fakeData.ts` + seed files after editing the catalogue |
| `npm run mock:check` | Verify the generated data against Josh's contract |
| `npm run ingest -- --list` | Show every source and what it needs |
| `npm run trial` | migrate → seed → serve, in one go |
