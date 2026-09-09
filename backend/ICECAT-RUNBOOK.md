# Icecat — what to actually run, in order

Replaces the earlier "instructions for Larry" note. Two things changed since
that note was written: Icecat's job is supplying **images, specs and the
manufacturer category** for products that come from eBay (and later Awin, Bol),
not creating products of its own; and the category map now lives in the database
rather than in a `const` inside a script.

The reference doc is `README-ICECAT.md`. This is just the order of operations.

Windows: if PowerShell's execution policy blocks `npm`, use `npm.cmd` throughout.

---

## 0. Pull, install, migrate

```bash
git pull
cd backend
npm install
npm run db:migrate      # applies db/007_source_category_map.sql
```

`007` adds the `source_category_map` table plus four columns on `product`:
`icecat_category_id`, `icecat_category_name`, `created_by_source`,
`category_source`. Everything below depends on it.

## 1. Tokens into `backend/.env`

One shared Open Icecat account (username `Scoopt`). Ask Josh for the two token
values and send them through a password manager, not chat.

```
ICECAT_USERNAME=Scoopt
ICECAT_API_TOKEN=<from Josh>
ICECAT_CONTENT_TOKEN=<from Josh>
```

## 2. Check the premise before doing any mapping work

```bash
npm run icecat:verify
```

Look at section 1: **how many of the products that already have offers carry an
EAN.** Icecat can only match on EAN. If that number is low, then Icecat cannot
reach most of the catalogue, and no amount of category mapping fixes it — the fix
is brand+MPN matching in `run.ts`. This is a two-minute check that decides
whether the rest of the list is worth doing today.

## 3. Enrich what we already have

```bash
npm run enrich:icecat -- --limit 20      # small first run
npm run icecat:verify                    # did lookups actually hit?
npm run enrich:icecat                    # then the rest
```

This is the pass that matters. It walks our own products, looks each up by EAN,
and fills in the manufacturer image, description, specs, and Icecat's own
category id — no index download, no category filtering.

Expect misses in Sport. Open Icecat's sponsors are electronics, computing and
appliance brands; running shoes and sportswear largely aren't there, so those
products keep their eBay photo and fall through to the later keyword/model
classification stages. That's the free tier's shape, not a bug.

## 4. Map the Icecat categories that actually occur

```bash
npm run icecat:map -- --unmapped
```

That lists the Icecat category ids **our own products carry** with no mapping
yet, most products first, with Icecat's own label beside each one. Map from the
top:

```bash
npm run icecat:map -- --targets                              # valid ids, if unsure
npm run icecat:map -- --set 4=tech/smartphones --set 15=tech/audio-headphones
npm run icecat:map -- --list
```

This replaces searching thirteen guessed terms and hand-editing
`ICECAT_CATEGORY_MAP`. Mappings are validated against the real subcategory ids
the front end renders, and stored in the database — no code change, no redeploy,
and Awin and Bol will add rows to the same table later.

Then re-run enrichment so the new mappings get applied:

```bash
npm run enrich:icecat
npm run icecat:verify        # section 4 shows how much is now manufacturer-classified
```

`npm run icecat:categories -- --search Smartphone` still exists for the reverse
lookup (you have a name, you want the id). It is no longer the starting point.

---

## Optional, and only when there's a reason: catalogue discovery

`discover:icecat` creates product rows from Icecat's own catalogue that no
retailer offers yet. We're keeping it for the canonical-EAN spine, for showing a
real catalogue when applying to affiliate networks, and for watchlist candidates
— but nothing on the site needs it today, so it does nothing unless asked twice.

```bash
npm run discover:icecat        # REPORT ONLY. Writes nothing.
```

That downloads the index, archives it under `raw/icecat-index/`, and prints which
Icecat category ids occur and in what volume. If it says **0 rows parsed**, the
parser doesn't recognise the file: open the archived file it names, look at one
real element, and fix the attribute names in `parseIndexRows()` in
`src/ingest/discover-icecat.ts`. `--from-file <path>` replays an archive so you
can iterate on the parser without re-downloading. `tests/icecat-index.test.ts`
covers both documented shapes — run `npm test` after changing the parser.

Only if you actually want the rows:

```bash
npm run discover:icecat -- --limit 20 --category 4 --yes-create-products
```

Rows are created as `status = 'draft'` (invisible to the site — the API serves
only `published`) and stamped `created_by_source = 'icecat'`. `npm run ingest`
promotes a draft to `published` automatically when a real retailer offer attaches
to the same EAN. To undo a whole run, see the delete statement in
`README-ICECAT.md`.

---

## Before real users see any of this

- Add **"Specs Icecat"** attribution and the AS-IS disclaimer to the product
  page. The free tier requires both; retrofitting it later is worse.
- Read the Open Icecat terms once with re-hosting in mind. Serving images from
  Supabase Storage instead of hotlinking Icecat's CDN is the likely next step.
- Decide what a product page with no offer says. Right now the answer is "it
  isn't published", which is the safe default.
