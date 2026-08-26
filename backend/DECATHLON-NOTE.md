# Why this reads a stand-in catalogue instead of decathlon.nl

Short version: there is no Decathlon API to build against, and their site
explicitly closes the back door. So the pipeline is real and the source is a
stand-in — which is exactly the split that lets everything else be finished.

## The three findings

**1. Decathlon publishes no product or pricing API.**
Their developer portal ([developers.decathlon.com](https://developers.decathlon.com))
is real and well-maintained, but it covers sport activities, sport places,
activity tracking and SSO. There is no catalogue endpoint and no price endpoint.
This matches the finding already recorded in `scoopt/price-data-access-research.md`
on 4 Aug: *"No product/pricing API despite a real dev portal."*

**2. `decathlon.nl/robots.txt` disallows the storefront JSON.**
Second line of the file:

```
User-Agent: *
Disallow: /api/*
```

Those `/api/*` paths are precisely the JSON endpoints their own website calls.
The disallow is the site operator's machine-readable instruction to automated
clients, and it is the first thing anyone looks at in a dispute. (Their robots.txt
also names `ClaudeBot` with a crawl-delay, so they have thought about agents
specifically.)

**3. The governing case law is Dutch and it went against the comparison site.**
*Ryanair v PR Aviation* (CJEU C-30/14): where a database attracts neither
copyright nor the sui generis database right, the Database Directive does not
apply at all — so its lawful-user protections fall away and the site's terms bind
as an ordinary contract. PR Aviation was a Dutch price-comparison site doing
exactly this. It lost.

The practical exposure isn't a fine. It's that scraped data can't be used with an
affiliate link, so it earns nothing, while putting the affiliate relationships
that *do* earn at risk. It costs money rather than making it.

## What we built instead

Everything downstream of the source adapter is production code running against a
real Postgres: schema, ingestion, EAN validation and matching, the review queue,
append-only price history, the API handlers, and the data-quality checks. The
source adapter — one file, `src/sources/decathlon.ts` — reads
`data/decathlon-products.json`, which contains real Decathlon house brands and
product names with **invented prices and EANs**.

## What changes when a real feed arrives

Decathlon's affiliate programme ships a licensed product feed. That is Wave 4 in
your own sequencing — after launch, because a live site with traffic and visible
editorial is a much stronger application than a description of one.

When it lands:

1. Write `src/sources/decathlon-feed.ts` implementing `RetailerSource`
2. Change one line in `src/ingest/run.ts` to construct it instead
3. Set `sourceKind` to `'affiliate_feed'`

Nothing else in this codebase moves. That is the thing the trial run was for.

## If you want live data sooner

**bol.com** is the one that's actually available today: free, self-service to any
approved affiliate, EAN-keyed endpoints that fit the matching strategy exactly,
and your own build order already says *start here*. The work is one more file
implementing the same interface, plus token caching (their tokens live 299
seconds, so caching is a requirement rather than an optimisation).

Say the word and I'll write that adapter — it slots into everything above without
touching a single other file.
