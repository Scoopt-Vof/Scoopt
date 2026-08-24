# The fake API — real Dutch sports products, invented prices

> ⚠️ **The prices and barcodes in here are made up.** Brands, product names and
> RRP ballparks are real so the site looks like the real thing while you build
> it. The numbers are not. **This must never reach a public site** — invented
> prices on a live comparison site are misleading to consumers under the ACM
> Leidraad, and any retailer reviewing your affiliate application will
> spot-check one. Local development and demos only.

**49 products · 3 subcategories · 5 Dutch sports retailers · all 8 endpoints.**

Built against Josh's real `contract/types.ts`, pulled from the front-end zip in
Drive — not against a guess at it.

---

## The fastest way to see the site work

Josh's eight API routes already import from `lib/fakeData.ts`. Nothing else in
the app touches it. So this is a one-file swap:

```bash
# in Josh's repo
cp fakeData.ts lib/fakeData.ts
npm run dev            # → http://localhost:3000
```

That's it. No database, no server, no credentials, no network. Every page —
home, category, search, product, basket, profile — runs on the new data.

Things worth clicking:

| Where | What you should see |
|---|---|
| `/product/run-pegasus41` | Three retailers competing, cheapest first |
| `/product/run-kiprunks500` | **One** offer — Decathlon own-brand, no comparison possible |
| `/product/run-fr265` | Four retailers — the richest comparison in the set |
| `/basket` | Smart split beating the best single store by ~€18 |
| `/category/sport` | Hardlopen / Fietsen / Fitness |
| `/search?q=nike` | Brand search |

## The mock server (optional)

If you want the eight endpoints served over HTTP instead — which is what the
real Postgres backend will eventually be:

```bash
npm run mock           # → http://localhost:4000
```

Open <http://localhost:4000> for a clickable index of every endpoint. Point
Josh's `lib/api.ts` `base` at `http://localhost:4000` and the front end cannot
tell the difference. CORS is open so `:3000` can call `:4000`.

You do not need this to see the site work — it exists to prove the seam holds
when the data comes from somewhere that isn't a TypeScript file.

## Re-verifying after you edit anything

```bash
npm run mock:check
```

Runs the generated data through **Josh's actual `planBasket()` and
`personalise()`** and asserts the contract's prose invariants: offers sorted
cheapest-first, complete baskets ranked before incomplete,
`min30 <= currentMin <= max30`, EAN check digits valid, no product with zero
offers, scores clamped 0–100.

It also typechecks the data file against Josh's real `contract/types.ts`, so if
he changes a shape you find out immediately rather than at merge time.

## Changing the catalogue

Edit `generate-fakedata.mjs` — the `CATALOGUE` table is one line per product —
then:

```bash
npm run mock:build     # regenerates fakeData.ts
npm run mock:check     # re-verifies
```

---

## The one design decision worth understanding

**`STOCKS` — which retailer carries which brand — is modelled honestly, and
that is the most useful thing in this file.**

Decathlon's catalogue is overwhelmingly own-brand: Kiprun, Kalenji, B'Twin,
Van Rysel, Domyos, Corength. Those barcodes exist nowhere else on earth. So
those products get exactly **one** offer and no comparison at all. The
comparison engine only has work to do on the third-party brands several
retailers carry — Nike, adidas, Asics, Garmin, Hoka, On.

The resulting spread across 49 products:

- 13 products with **1** offer (no comparison — mostly Decathlon own-brand)
- 9 with **2**
- 16 with **3**
- 11 with **4**

A mock where everything had five competing offers would flatter the product and
teach you nothing. This one shows you the real dynamic, and the real dynamic is
the reason the retailer set has to be picked for *brand overlap* rather than
just for size. Decathlon alone is a catalogue; Decathlon plus JD Sports plus
Intersport is a comparison site.

## Two things the checks caught, worth knowing

**`isLowest30` was dead.** The original history generator wobbles every past
price around today's price, so some past day is almost always cheaper — meaning
`isLowest30` is false for every product and the "laagste in 30 dagen" badge
never appears. With seven products that's invisible; with 49 it was obvious.
Roughly a quarter of products are now deterministically at their genuine 30-day
low, so the badge fires on 8 of 49. If you change the generator, keep this.

**Personalisation doesn't filter by sport.** Ranking a budget-conscious
*beginner runner* currently returns the B'Twin Riverside 500 — a bicycle — in
third place, because `personalise()` scores on budget tier and priority but
never checks whether the product's subcategory is one the shopper actually does.
That's in Josh's `lib/profile.ts`, not in this data, so I've left it alone. It's
worth him knowing before the "voor jou" line ships.

## What this is not

This does not touch the Postgres backend in the parent folder. That one ingests
real feeds and returns integer cents; this one returns euro floats because
that's what Josh's contract specifies. When the Odyssey and Awin feeds arrive,
the real backend serves these same eight shapes from the database and this
folder gets deleted.
