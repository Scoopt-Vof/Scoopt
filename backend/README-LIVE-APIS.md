# Getting real prices in — which APIs, in what order

Five live sources are wired up. All of them implement the same `RetailerSource`
interface, so adding one changes exactly one file and nothing else.

`npm run ingest -- --list` shows what's available and what each needs.

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
— **it is the application**. That reorders everything: build something live and
real-looking first, then apply. Approval then takes ~2 working days (7 by the
terms), and only after that does the API-key button appear in your affiliate
dashboard. There is no bol sandbox, so you cannot touch bol data before this.

Good news buried in the terms: the words *vergelijkingssite* and
*prijsvergelijker* appear nowhere in them. Comparison is not banned. The two
clauses that bite are **2.6(g)** (spider/stock-alert sites — so use APIs and
never crawl bol) and **2.6(i)** (showing products *"zonder enige toegevoegde
waarde"*). bol's own guidance names *"productvergelijkingen"* as legitimate
added value, so use their vocabulary in the application.

### 2. Five retailers with no EAN overlap is not a comparison

This is the trap to design around. Kroger sells US groceries, Best Buy sells US
electronics, Albert Heijn sells Dutch groceries. They share almost no EANs. Wire
up five sources naively and you get five catalogues sitting next to each other
with an empty comparison on every page — which demonstrates the opposite of what
you're trying to show.

**The fix is eBay's marketplace header.** One integration, three sources:
`ebay-nl`, `ebay-de`, `ebay-gb`. Same branded products, three real prices, one
EAN. That produces genuine comparison rows, which is the only thing a reviewer
at bol or Odyssey will actually look at.

The ingest job prints this number at the end of every run:

```
products with 2+ retailer offers (real comparisons): 15
```

**That number is your proof of concept.** If it's zero, you have a catalogue.

---

## The ladder

### Step 1 — today, no signup at all (15 minutes)

```bash
npm run ingest -- openprices-ah openprices-jumbo
```

Open Prices needs no API key, no account, no approval. Crowd-sourced Dutch
supermarket prices attached to Open Food Facts products, so every record already
carries a valid EAN-13. Volume is small — around 285 Dutch price points — but
it proves the whole path against a real third-party API over the real internet.

⚠️ **ODbL licence — decide this before you design the production schema.**
This data is ODbL 1.0. Loading it into Postgres creates a "Derivative Database"
(§4.4b), and publishing a site from it counts as publicly using that derivative
(§4.4c), which triggers share-alike (§4.4a) *and* an obligation to give anyone
who asks a machine-readable copy of the derivative database (§4.6).

The escape hatch is §4.5(a), the Collective Database clause: keep this data
**unmodified in its own tables**, keep your own commercially-collected offers in
**separate tables**, and join only at query time. Then only the Open Prices
tables are ODbL — which they already were, so nothing of yours is infected.
What breaks it is merging Open Prices fields into your canonical `product`
table. For the PoC this is fine; before production, segregate or drop it.
Attribution is required wherever it's displayed.

### Step 2 — instant credentials, ~30 minutes

```bash
npm run ingest -- kroger
```

1. Sign up at <https://developer.kroger.com/create-account/> — free, instant
2. Register an app → Client ID + Client Secret
3. Put `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` in `.env`

The fastest route from zero to a real live price with a real UPC. US groceries,
so useless as a Scoopt retailer — its job is to prove OAuth2 client credentials,
token caching, rate limiting and pagination all work against someone else's
server. Quota 10,000/day. Note prices are per-store, so the adapter resolves a
`locationId` first; without one the API returns products with no prices at all.

Their developer terms are robots-blocked to automated readers, so their stance
on aggregation is **unverified** — read them yourself before going past a
private prototype.

### Step 3 — the one that matters, ~1 day

```bash
npm run ingest -- ebay-nl ebay-de ebay-gb
```

1. Register at <https://developer.ebay.com/signin?tab=register> — account
   approval takes about **1 business day**
2. Create a **Production** keyset → App ID (Client ID) + Cert ID (Secret)
3. **The gate everyone hits:** before your production keyset activates, eBay
   requires you to subscribe to or opt out of marketplace account-deletion
   notifications. Subscribing needs a publicly reachable HTTPS callback URL —
   a free Cloudflare Worker or Vercel function is enough, it does not need to be
   your real product. Opting out is only available if you *don't persist eBay
   data*, which is not true of a price-comparison database, so **don't attest to
   that falsely.** Stand up the endpoint.
4. Put `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` in `.env`

Real live prices, in EUR, from a Dutch marketplace, with GTINs. This is the
backbone.

**Two constraints designed around in the adapter.** `gtin` is not returned by
search — only by `getItem` — so every product costs one search slot plus one
detail call, against a default quota of **5,000 calls/day**. That's why
`EBAY_MAX_ITEMS_PER_QUERY` defaults to 8. And search-by-GTIN is documented as
UPC-only, so you can't reliably go EAN → item; the flow is keyword → item →
EAN. Keep the same `EBAY_QUERIES` across all three marketplaces or you won't get
overlap.

### Step 4 — optional fourth shape

```bash
npm run ingest -- bestbuy
```

Key from <https://developer.bestbuy.com>. Simplest auth of the set — an API key
in the query string.

⚠️ Two problems. Their published policy **rejects free email domains** (Gmail,
Yahoo), so use an address on your own domain. And their terms forbid using the
service *"for the purposes of analyzing, receiving or reviewing information
regarding Best Buy pricing"* on behalf of third parties, and require Best Buy to
sit in the *"first or primary tier"* of any commerce options you show. A neutral
comparison site is against the grain of both. **Prototype only. Never ship it.**

---

## What was ruled out, so you don't re-research it

| Source | Verdict |
|---|---|
| **Etsy** | No GTIN/EAN/UPC field at all. Cannot join an EAN graph. Terms also cap caching at 6 hours, which forbids a price-history store. |
| **Zalando** | Shop API archived Aug 2018. No successor. |
| **OTTO / Kaufland** | Seller-only APIs, need a signed marketplace contract. |
| **Walmart** | No longer issues new API keys; affiliate route is manual review. |
| **Target / Home Depot** | No public API. `developer.homedepot.com` doesn't even resolve. Everything sold as an "API" is a scraper. |
| **Amazon** | PA-API 5.0 retired May 2026; Creators API gated on qualifying affiliate sales. |
| **Rakuten** | Product Search does return JAN + multi-seller spread, but it's Japan-only, and the ToS bar competing services and restrict data storage. |
| **UPCitemdb** | Keyless, but offers are 2014–2022 snapshots and EU products are missing or miscategorised. |
| **Barcode Lookup** | Right data model (`stores[]` with country + currency), but $99/mo minimum. |
| **Lowe's** | `portal.apim.lowes.com` exists and claims self-service; API list renders nothing publicly. Unverified — 10 minutes to check if you're curious. |

---

## Environment variables

```bash
# eBay — developer.ebay.com → Application Keys (Production)
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_QUERIES=Garmin Forerunner 265,Nike Pegasus 41,Adidas Ultraboost 22
EBAY_MAX_ITEMS_PER_QUERY=8

# Kroger — developer.kroger.com
KROGER_CLIENT_ID=
KROGER_CLIENT_SECRET=
KROGER_ZIP=45202

# Best Buy — developer.bestbuy.com (company email domain required)
BESTBUY_API_KEY=

# Sent on every outbound request. Put a real contact address here —
# it is the difference between being rate-limited and being emailed.
HTTP_USER_AGENT=Scoopt/0.1 (price comparison; +https://scoopt.nl; you@scoopt.nl)
```

---

## A note on what is and isn't proven

The pipeline, the schema, the EAN matching, the comparison ordering and the
36 tests were all run end-to-end against a real Postgres and they pass.

The five live adapters were **written but not executed** — the environment they
were built in has no outbound network access, so the first real call to eBay,
Kroger, Best Buy and Open Prices will happen on your machine. Expect small field
surprises on first contact; that's what `raw/` archives are for. The failure
mode to watch for is an adapter returning zero offers rather than throwing,
which usually means a query returned nothing rather than the credentials being
wrong. `npm run ingest -- <source>` prints per-query counts for exactly this.
