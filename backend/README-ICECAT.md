# Icecat product enrichment + catalogue discovery

Icecat (icecat.biz) is a product-content syndicator: manufacturer images,
descriptions and specs, looked up by GTIN/EAN. It is not a retailer and
carries no price or stock, so it's a separate pass from the live retailer
adapters in README-LIVE-APIS.md.

There are now two Icecat passes, doing two different jobs:

- **`npm run enrich:icecat`** — enriches products that a retailer feed
  already created (matched by EAN). Doesn't add new products.
- **`npm run discover:icecat`** — the other half: CREATES new product rows
  straight from Icecat's own catalogue, filtered to the categories you map,
  with no price attached. This is what fills a subcategory ("Smartphones",
  "Laptops & Computers", ...) even before any retailer has matched a product
  into it. See `src/ingest/discover-icecat.ts` for the full explanation and
  `src/ingest/list-icecat-categories.ts` for finding the category IDs it needs.

Flow this enables: `discover:icecat` populates a subcategory with real
manufacturer catalogue entries (name, image, specs) with no price yet; later,
`npm run ingest -- ebay-nl` (or any future affiliate feed) matches the same
EAN and attaches a real price. A shopper always sees a real manufacturer photo
instead of a placeholder, and the price appears the moment any connected
retailer has that exact product — nothing here ever invents one.

## Account

Scoopt has a free "Open Icecat Data" account (username "Scoopt"). That tier
covers only brands sponsoring Open Icecat, not Icecat's full catalogue — a
miss for a real, well-known GTIN usually means that brand/SKU isn't in the
Open tier, not a broken request. Upgrading to Full Icecat (paid) removes
that ceiling if catalogue coverage turns out to be too thin in practice.

## Setup, ~10 minutes

1. Log in at <https://icecat.biz/en/myIcecat> with the Scoopt account.
2. Go to **My profile -> Access details -> Manage Access Tokens**.
3. **Add API Access Token** and **Add Content Access Token** — Icecat's
   recommended, modern auth method (header-based), used in preference to
   the legacy static `app_key`.
4. Put `ICECAT_USERNAME` (the MyIcecat username), `ICECAT_API_TOKEN` and
   `ICECAT_CONTENT_TOKEN` in `.env` — see `.env.example`.

No callback URL, no approval wait, no company email requirement — the
slowest step is generating the two tokens.

## What `enrich:icecat` does

```bash
npm run enrich:icecat
```

For each product already in the database (matched by EAN), looks it up at
Icecat and — only when Icecat has data for it — overwrites `image_url` and
`description`, and merges into `specs`. This is a deliberate exception to
the "first writer wins" rule the retailer ingest (`run.ts`) uses between
retailers: a manufacturer data sheet is categorically better than an
incidental eBay listing photo, so Icecat is allowed to replace it.

Products are processed oldest-checked-first, with no-image products always
first, so an interrupted run still makes forward progress and a fresh
catalogue converges quickly.

## What `discover:icecat` does

```bash
npm run icecat:categories -- --search Smartphone   # find real category IDs first
npm run discover:icecat -- --limit 100
```

Downloads Icecat's own product index, filters it to the category IDs you've
mapped in `ICECAT_CATEGORY_MAP` (inside `src/ingest/discover-icecat.ts`), and
for every matching GTIN creates a `product` row — brand, title, image,
description, specs — with `status = 'published'` and no offer yet. It never
touches price. `ICECAT_CATEGORY_MAP` ships empty on purpose: run
`icecat:categories` first and paste in real IDs rather than guessing them.

## Coverage — set expectations before running discover:icecat

Open Icecat only carries content for brands that sponsor it, overwhelmingly
electronics, computing and home-appliance manufacturers. It runs deep in
**Technology** and parts of **Home & Furniture** (kitchen appliances,
lighting), and it runs thin to empty in **Sport** — running shoes and
sportswear brands are not typically Open Icecat sponsors. That is not a bug
in this pipeline; it's the actual shape of the free tier. Sport keeps
depending on the generic eBay searches in `src/sources/ebay.ts` for now.
Upgrading to Full Icecat (paid) is the lever if Sport coverage matters enough
to pay for.

## Fair use

The free tier requires visible "Specs Icecat" attribution and an AS-IS
disclaimer wherever this content is shown. Add both to the product page
alongside the image before this goes live for real users. Icecat also
notes their image links can be IP-restricted for hotlinking at volume;
this integration links directly to Icecat's URLs for now, and re-hosting
images (e.g. in Supabase storage) is a reasonable follow-up if that proves
unreliable.

## Not yet verified

This was written from Icecat's published manuals, not a live response —
the account had no data yet at the time. Before relying on it:

- Confirm the `FeaturesGroups` shape in `src/sources/icecat.ts` against a
  real product; adjust the field paths if the manuals were imprecise.
- Confirm Open Icecat actually covers the brands Scoopt needs (Garmin was
  the example that prompted this). If coverage is too thin, that's the
  signal to upgrade to Full Icecat rather than a bug to fix.
- Confirm the header-token auth works as documented; the legacy `app_key`
  param is the fallback if it doesn't.
- `discover-icecat.ts` and `list-icecat-categories.ts` carry the same
  caveat for the index/category reference files — see the header comments
  in each. Run `npm run icecat:categories -- --search <term>` first; a
  working, non-empty result there confirms the reference file path and
  shape before you invest in the bigger catalogue pull.
