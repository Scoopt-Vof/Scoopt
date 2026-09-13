# Getting real prices in — which APIs, in what order

One live price source is wired up today: **eBay**, on the Dutch and German
marketplaces (`ebay-nl`, `ebay-de`). Every source implements the same
`RetailerSource` interface (`src/sources/types.ts`), so adding one changes
exactly one file plus a line in `src/sources/registry.ts`.

`npm run ingest -- --list` shows what's available and what each needs.

> **Removed:** the Kroger, Best Buy and Open Prices adapters, and `ebay-gb`.
> Kroger and Best Buy are US retailers pricing in USD, and eBay UK prices in
> GBP — ingest refuses every non-EUR offer (nothing converts currency), so they
> could never write a row. Open Prices was never registered. The research on
> them is kept at the bottom of this file so nobody re-does it.

---

## Read this first: the two findings that change the plan

### 1. bol.com will not review you without a live site

You wanted a proof of concept to show when applying to affiliate programmes.
That instinct is right, but it's stronger than you think — bol's FAQ says
outright:

> *"Het is wel belangrijk dat je website of applicatie online staat wanneer je
> hem aanmeldt. Wanneer dit niet zo is — of als er geen content op de website
> staat — kunnen wij helaas niet beoordelen of de site binnen de richtlijnen
> van het Affiliate Programma past."*

Their terms define an Affiliate Partnerkanaal as a **"gebruiksklare"** (ready
for use) website or web application. A parked domain doesn't count.

So the proof of concept isn't a nice-to-have you show alongside the application
— **it is the application**. Build something live and real-looking first, then
apply. Approval then takes ~2 working days (7 by the terms), and only after that
does the API-key button appear in your affiliate dashboard. There is no bol
sandbox.

Comparison is not banned: *vergelijkingssite* and *prijsvergelijker* appear
nowhere in the terms. The clauses that bite are **2.6(g)** (spider/stock-alert
sites — use APIs, never crawl bol) and **2.6(i)** (products *"zonder enige
toegevoegde waarde"*). bol's own guidance names *"productvergelijkingen"* as
legitimate added value, so use their vocabulary in the application.

### 2. Retailers with no EAN overlap are not a comparison

Sources that share no EANs give you catalogues side by side with an empty
comparison on every page. **eBay's marketplace header is the workaround:** one
integration, several marketplaces, the same branded products at different prices
against one EAN.

The ingest job prints this number at the end of every run:

```
products with 2+ retailer offers (real comparisons): 15
```

**That number is your proof of concept.** If it's zero, you have a catalogue.

---

## eBay — setup (~1 day, mostly waiting)

```bash
npm run ingest -- ebay-nl ebay-de
```

1. Register at <https://developer.ebay.com/signin?tab=register> — account
   approval takes about **1 business day**
2. Create a **Production** keyset → App ID (Client ID) + Cert ID (Secret)
3. **The gate everyone hits:** before your production keyset activates, eBay
   requires you to subscribe to or opt out of marketplace account-deletion
   notifications. Subscribing needs a publicly reachable HTTPS callback URL —
   a free Cloudflare Worker or Vercel function is enough. Opting out is only
   available if you *don't persist eBay data*, which is not true of a
   price-comparison database, so **don't attest to that falsely.**
4. Put `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` in `.env`
5. Optional but needed to earn anything: join the **eBay Partner Network** and
   put your campaign id in `EPN_CAMPAIGN_ID`. Stored links then become
   affiliate links.

**Constraints designed around in the adapter (`src/sources/ebay.ts`):**

- `gtin` is not returned by search — only by `getItem` — so every product costs
  one search slot plus one detail call, against a default quota of **5,000
  calls/day**. That's why `EBAY_MAX_ITEMS_PER_QUERY` defaults to 8.
- Search-by-GTIN is documented as UPC-only, so the flow is keyword → item → EAN.
- Only **new-condition** listings are fetched, so used items are never compared
  against new ones.
- Several sellers often list the same EAN. The adapter keeps the **cheapest
  delivered** listing per EAN per marketplace (the database holds one offer per
  product per marketplace).
- The search terms come from the built-in, category-tagged `DEFAULT_QUERIES`
  list. **Leave `EBAY_QUERIES` unset**: if set, it replaces that list and tags
  every result as sport/running.

Offers that an ingest run has not refreshed within `OFFER_MAX_AGE_HOURS`
(default 48) are hidden from the API, so ingest needs to run at least that often
for prices to stay visible.

---

## What was ruled out, so you don't re-research it

| Source | Verdict |
|---|---|
| **Kroger** | Real OAuth2 API with UPCs, but US groceries in USD. Removed. Developer terms were robots-blocked; stance on aggregation unverified. |
| **Best Buy** | US electronics in USD. Terms forbid using the service for analysing Best Buy pricing on behalf of third parties and require Best Buy in the first tier of commerce options. Removed. |
| **Open Prices** | Keyless, Dutch supermarket prices with EANs, but tiny volume and **ODbL** share-alike: merging it into `product` would make the derivative database ODbL. Removed. |
| **eBay UK (`ebay-gb`)** | Prices in GBP; refused by ingest without currency conversion. Removed from the registry. |
| **Etsy** | No GTIN/EAN/UPC field at all. Terms also cap caching at 6 hours, which forbids a price-history store. |
| **Zalando** | Shop API archived Aug 2018. No successor. |
| **OTTO / Kaufland** | Seller-only APIs, need a signed marketplace contract. |
| **Walmart** | No longer issues new API keys; affiliate route is manual review. |
| **Target / Home Depot** | No public API. Everything sold as an "API" is a scraper. |
| **Amazon** | PA-API 5.0 retired May 2026; Creators API gated on qualifying affiliate sales. |
| **Rakuten** | Japan-only, and the ToS bar competing services and restrict data storage. |
| **UPCitemdb** | Keyless, but offers are 2014–2022 snapshots and EU products are missing or miscategorised. |
| **Barcode Lookup** | Right data model, but $99/mo minimum. |

---

## Environment variables

See `.env.example` for the full, commented list. The eBay-specific ones:

```bash
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_MAX_ITEMS_PER_QUERY=8
EPN_CAMPAIGN_ID=
HTTP_USER_AGENT=Scoopt/0.1 (price comparison; +https://scoopt.nl; you@scoopt.nl)
```
