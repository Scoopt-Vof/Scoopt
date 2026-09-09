# Icecat: product images, specs and the manufacturer category

Icecat (icecat.biz) is a product-content syndicator: manufacturer images,
descriptions, specs and category, looked up by GTIN/EAN. It is not a retailer,
carries no price or stock, and never produces an offer.

**What Icecat is for on scoopt.** Products come from retailer feeds — eBay now,
Awin and Bol next. Icecat sits on top of those products and supplies:

1. **The image.** The main reason it's here. Feed images are seller photos:
   inconsistent framing, watermarks, occasionally a photo of a used item. One
   manufacturer image source makes the product grid coherent.
2. **Description and specs.**
3. **The manufacturer's own category** — stage 1 of categorisation. It comes
   from the data sheet rather than a seller's dropdown choice, which is exactly
   why eBay's category ids were rejected as a mapping source and this one
   wasn't.

Prices only ever come from a retailer feed. Nothing here invents one.

## The two passes

| Command | Job | Writes new products? |
| --- | --- | --- |
| `npm run enrich:icecat` | The day-to-day pass. Walks **our** products, looks each up by the EAN we already hold, fills in image/description/specs and the raw Icecat category. | No |
| `npm run discover:icecat` | Parked. Walks **Icecat's** catalogue index and can create product rows nothing offers yet. Report-only unless you pass `--yes-create-products`. | Only with the flag, and as `draft` |

Supporting commands:

| Command | Job |
| --- | --- |
| `npm run icecat:map` | Read and edit the source → scoopt category map (stored in the database, not in code) |
| `npm run icecat:verify` | The checks that say whether any of this is working |
| `npm run icecat:categories` | Look up an Icecat category id by name (reference lookup, not the way to build the map) |

Windows: if PowerShell's execution policy blocks `npm`, use `npm.cmd`.

## Setup, ~10 minutes

1. Log in at <https://icecat.biz/en/myIcecat> with the Scoopt account
   (username `Scoopt`, the free "Open Icecat Data" tier).
2. **My profile → Access details → Manage Access Tokens**.
3. **Add API Access Token** and **Add Content Access Token** — Icecat's
   recommended header-based auth, used in preference to the legacy `app_key`.
4. Put these in `backend/.env` (see `.env.example`). Share them through a
   password manager, not chat:

```
ICECAT_USERNAME=Scoopt
ICECAT_API_TOKEN=<token>
ICECAT_CONTENT_TOKEN=<token>
```

5. `npm run db:migrate` — `db/007_source_category_map.sql` adds the mapping
   table and the provenance columns everything below depends on.

## The category map lives in the database

`source_category_map`, keyed by `(source, source_category_id)`. It used to be a
`const` inside `discover-icecat.ts`; it moved because the enrichment pass, the
discovery script and the classifier all need the same map, and because Awin's
and Bol's taxonomies will slot in as more rows under a different `source`
rather than as another copy in another script. A mapping change is then a row
update, not a code change and a redeploy.

```bash
npm run icecat:map -- --list        # what's mapped
npm run icecat:map -- --unmapped    # Icecat ids our products carry with no mapping, by volume
npm run icecat:map -- --targets     # valid category/subcategory ids
npm run icecat:map -- --set 4=tech/smartphones --set 15=tech/audio-headphones
npm run icecat:map -- --unset 4
```

`--set` validates the target against the real subcategory ids the front end
renders, so a typo fails at the command line instead of writing rows the browse
page can never show.

**Build the map from real data, not from guessed search terms.** Run
`enrich:icecat` (or `discover:icecat`'s report), then `--unmapped`: it lists the
Icecat category ids our own products actually carry, ranked by how many products
each would classify, with Icecat's own label beside it. Map the top of that list
and stop when the tail stops mattering.

**The raw id is stored on the product** (`product.icecat_category_id`), and the
map is applied *from* it. That is what makes refining a mapping a re-run over
our own database instead of a re-fetch of the whole catalogue from Icecat.

## What `enrich:icecat` does

```bash
npm run enrich:icecat
npm run enrich:icecat -- --limit 50
```

For each product with an EAN, oldest-checked first (and no-image products
first), it looks the EAN up and — only when Icecat has data — sets `image_url`
and `description`, merges `specs`, and stores `icecat_category_id` /
`icecat_category_name`.

Image priority is a deliberate exception to `run.ts`'s "first writer wins" rule
between retailers: a manufacturer data sheet beats an incidental listing photo,
so Icecat may replace the image. The feed's image is never discarded — it stays
whenever Icecat has none, so a page always has something to show.

Category priority is conservative: Icecat sets `category`/`subcategory` only
where the product has none yet, records `category_source = 'source-map'` when it
does, and never overwrites a category a human set (`category_source = 'manual'`).

## What `discover:icecat` does, and why it's parked

```bash
npm run discover:icecat                                     # report only
npm run discover:icecat -- --from-file raw/icecat-index/1234567890.xml
npm run discover:icecat -- --limit 20 --category 4 --yes-create-products
```

It downloads Icecat's product index, archives it under `raw/icecat-index/`
before parsing, and reports which Icecat category ids occur and in what volume.
That report is the map-building step.

With `--yes-create-products` it creates a product row per matching GTIN. Those
rows are deliberately:

- **`status = 'draft'`** — the API serves only `published`, so a product with no
  price never reaches the site. `run.ts` promotes a draft to `published` the
  moment a real retailer offer attaches to the same EAN. `suppressed` is a human
  decision and is never touched.
- **`created_by_source = 'icecat'`** — so a run can be undone in one statement.

It is kept, rather than deleted, because it buys three things later: a canonical
product spine keyed by EAN, so eBay, Awin and Bol offers for the same television
land on one row instead of three fuzzy-matched duplicates; a catalogue to show
affiliate networks when applying; and watchlist / price-alert candidates. None of
those are needed today, which is why it does nothing unless asked twice.

### Undoing a discovery run

```sql
-- what would go
select count(*) from product
 where created_by_source = 'icecat'
   and not exists (select 1 from offer o where o.product_id = product.id);

-- remove it (only rows no retailer ever offered)
delete from product
 where created_by_source = 'icecat'
   and not exists (select 1 from offer o where o.product_id = product.id);
```

## Verifying — `npm run icecat:verify`

Row counts per subcategory only prove a script ran. This prints the numbers that
say whether the premises hold:

1. **EAN coverage on products that have offers.** Everything Icecat does depends
   on matching by EAN, and eBay listings frequently carry no GTIN. If this is
   low, Icecat can't reach most of the catalogue and discovery rows would never
   acquire a price — the fix is brand+MPN matching (tier 2 in `run.ts`), before
   volume makes it painful. **Check this before mapping a dozen categories.**
2. **Icecat coverage by category** — how many lookups actually returned a data
   sheet.
3. **Products with no offer**, by status and creator, so you can see whether the
   backlog drains. It flags loudly if a *published* product has no offer.
4. **Who created and classified what** — how much of the catalogue is genuinely
   manufacturer-classified versus taken from whatever a feed claimed.
5. **Unmapped Icecat category ids**, by volume.

## Coverage — set expectations first

Open Icecat only carries content for brands that sponsor it: overwhelmingly
electronics, computing and home-appliance manufacturers. Expect it to run deep
in **Technology** and parts of **Home** (kitchen appliances, lighting), and thin
to empty in **Sport** — running shoes and sportswear brands are generally not
Open Icecat sponsors. So Sport will keep showing eBay seller photos and will
fall through to the later keyword/model classification stages. That is the shape
of the free tier, not a bug. Upgrading to Full Icecat (paid) is the lever if
Sport coverage ever justifies it.

## Fair use and licensing

- The free tier requires visible **"Specs Icecat"** attribution and an AS-IS
  disclaimer wherever this content appears. Add both to the product page
  **before** this goes live for real users — retrofitting attribution is worse
  than adding it now.
- Icecat's terms are written around parties that **list and offer** the
  products. Linking a shopper to a live offer sits comfortably inside that;
  publishing catalogue pages for products nobody offers is further from it, which
  is one more reason discovery rows stay `draft`. Read the Open Icecat terms once
  before changing that.
- Icecat notes image links can be IP-restricted for hotlinking at volume. This
  integration links to Icecat's URLs for now. Re-hosting images in Supabase
  Storage and serving them from our own domain is the obvious next step: it
  removes the hotlinking question, survives a URL changing, and takes the page
  load off their CDN.
- Matching on EAN alone can occasionally attach a manufacturer image for a
  variant the seller isn't selling. A cheap sanity check comparing Icecat's
  brand/model string against the feed title — flagging rather than silently
  overwriting — is worth adding before this runs at volume.

## Not yet verified

Written from Icecat's published manuals, not live responses. Before relying on
it:

- Confirm the `FeaturesGroups` and `GeneralInfo.Category` shapes in
  `src/sources/icecat.ts` against a real product; adjust the field paths if the
  manuals were imprecise.
- Confirm header-token auth works as documented; the legacy `app_key` param is
  the fallback.
- Confirm Open Icecat actually covers the brands scoopt needs.
- `discover-icecat.ts` and `list-icecat-categories.ts` fetch the index and
  category reference files, both documented but unconfirmed. `discover:icecat`
  with no flags is the cheap test: it writes nothing, and if it reports "0 rows
  parsed" the archived file it names shows the real attribute names to fix in
  `parseIndexRows()`. `tests/icecat-index.test.ts` pins both shapes the parser
  currently handles, so fixing one can't silently break the other.
