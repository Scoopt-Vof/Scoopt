# Awin product feeds — GSM Net (and the next affiliate retailers)

GSM Net is Scoopt's first affiliate-network retailer. Unlike eBay (a live API),
Awin gives you a **product feed**: a file you generate once in the Awin UI and
then poll at a URL. That single file carries both halves of what Scoopt needs —
the product data to display, and the tracked `aw_deep_link` that earns
commission on every click-out.

The code side is already done: `src/sources/gsmnet.ts` (the adapter) and the
`gsm-net` entry in `src/sources/registry.ts`. What is left is generating the
feed and pointing an env var at it.

## 1. Generate the feed in Awin

1. Awin dashboard → **Toolbox → Create-a-Feed**.
2. **Advertiser / Programme:** GSM Net (only shows once your application is
   approved, which it now is).
3. **Format:** CSV. **Compression:** gzip. **Delimiter:** comma (the adapter
   auto-detects, but comma is the tested default).
4. **Columns:** include at least these (canonical Awin column names — keep the
   names as Awin gives them so the adapter maps them automatically):

   | Column            | Why Scoopt needs it                                  |
   |-------------------|------------------------------------------------------|
   | `aw_product_id`   | stable per-product id, used to re-match on each run  |
   | `product_name`    | the title shown, and what the classifier reads       |
   | `brand_name`      | brand shown + a classification signal                |
   | `ean`             | **the matching key** — without it a row goes to review|
   | `search_price`    | the selling price (integer cents after parsing)      |
   | `currency`        | must be EUR (ingest refuses anything else)           |
   | `in_stock`        | drives the stock badge and basket eligibility        |
   | `aw_deep_link`    | **the tracked, commission-bearing click-out link**   |
   | `aw_image_url`    | product image                                        |
   | `merchant_category`| GSM Net's own category, a signal for placement       |
   | `description`     | optional, shown on the product page when present     |

5. Save, then copy the generated **feed URL**.

## 2. Point Scoopt at it

Local (`.env`):

```
GSMNET_FEED_URL=https://productdata.awin.com/datafeed/download/apikey/.../language/nl/fid/.../format/csv/compression/gzip/
```

Production: set the same `GSMNET_FEED_URL` in Railway (the ingest host), the
same place `EBAY_CLIENT_ID` etc. live.

The feed URL contains your Awin API key, so treat it like a secret: it belongs
in `.env` / Railway variables, never committed.

## 3. Run it

```
npm run ingest -- gsm-net           # GSM Net only
npm run ingest -- ebay-nl gsm-net   # eBay + GSM Net; real comparison rows appear
npm run ingest -- --list            # confirm gsm-net shows [ready]
```

Each run downloads the feed, archives it under `raw/gsm-net/`, matches every row
to a canonical product by EAN, upserts one offer per product with the
`aw_deep_link` as its click-out URL, and appends a price observation. Products
the classifier can place (most phones/wearables/audio, by title) go live;
the rest stay `draft` and show up in the run's "map these next" and review-queue
output.

## 4. Confirm it earns

Open a GSM Net offer on the site, click through to GSM Net, and check the click
appears in Awin reporting within a few minutes. If it does, tracking works and a
completed purchase becomes a pending commission. If it does not, the deep-link
column was not `aw_deep_link` (a plain merchant URL is not tracked).

## Notes / still to do (not code)

- **Store name.** Offers currently show the retailer *slug* (`gsm-net`), same as
  eBay shows `ebay-nl`. Showing "GSM Net" needs the `storeName` field added to
  the shared contract `Offer` (flagged A6/G7) — a joint change with Larry, since
  the slug is also the join key for basket comparison and price history.
- **Affiliate disclosure.** Awin's terms and Dutch ACM rules require a visible
  disclosure that Scoopt earns commission on click-outs. Add it to the footer /
  product page before driving traffic.
- **Refresh cadence.** Prices and stock move. Schedule the ingest at least daily
  so the site never shows a stale GSM Net price.
- **Adding the next Awin retailer.** Copy `gsmnet.ts`, change the slug/name/
  homepage and the feed-URL env var, add a `registry.ts` entry. The column
  mapping is shared, so most Awin feeds need no new parsing.
