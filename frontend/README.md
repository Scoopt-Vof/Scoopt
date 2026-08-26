# Scoopt — Next.js starter scaffold

This is the real starting point for the Scoopt website, built on the structure
you and Larry agreed. It runs entirely on **fake data** right now, so the whole
frontend works before the real backend exists. That is deliberate — it is how
you two build in parallel without blocking each other.

---

## The USP: the personalised shopping experience

Scoopt's differentiator isn't the price comparison (anyone can copy that) — it's
the **shopper profile** that learns what you want and gives informed buying
advice. This scaffold has the full experience working on the frontend:

- **`/signup`** — a short questionnaire (categories → budget → priority →
  per-category detail like running distance/level). Multi-step to reduce drop-off.
- **`/profile`** — shows what Scoopt learned, plus personalised top picks with a
  match % and *why each fits you*.
- **On every product** — a "Voor jou" panel: a match score and the reasons this
  product suits this shopper (or an invite to make a profile if they haven't).
- **On category pages** — products are **re-ranked** to the shopper, with the
  same "why it fits" reasons.

How it works today: the profile is saved in the browser (`lib/profile.ts`) and
the ranking is computed on the client. The rules are deliberately simple and
explainable — budget fit, stated priority (price / quality / newest), and
per-category detail. **Later, Larry moves `personalise()` to the backend** and
feeds it *observed* behaviour (what they viewed/bought) as well as the stated
questionnaire — the `PersonalisedProduct` shape stays identical, so the UI
doesn't change. The `ShopperProfile` type already has the `viewedProductIds` /
`purchasedProductIds` fields waiting for that.

---

### Observed behaviour (stated + observed)

The profile also learns from what shoppers **do**, not only what they said:

- `components/TrackView.tsx` records a `view_product` event on every product page.
- `components/PriceLane.tsx` records a `click_out` event when they go to a store.
- These feed the ranking: a product they clicked out on gets a small boost (and
  the reason "Je toonde hier interesse in"); something they already bought is
  demoted; a category they browse a lot nudges its products up.
- `/profile` shows an **"Onlangs bekeken"** (recently viewed) strip as proof the
  signal is captured — this even works before they make a profile.

**The seam (keeps the frontend/backend split clean):** all tracking goes through
one function, `track()` in `lib/track.ts`. Today it writes events to the browser.
There's a clearly-marked **SWAP POINT** inside `track()` — when Larry's backend
is ready, only that block changes (localStorage → `POST /api/track`). Nothing
else in the frontend moves, because everything depends on the `TrackEvent` /
`ObservedSignals` shapes in the contract, not on where events are stored. So:
**you build the detection + wiring; Larry builds the persistence; the contract is
the agreed line between you.**

---

## The smart basket (Scoopt's revolutionary basket)

The basket answers a question no mainstream NL comparison site answers well:
**"What is the genuinely cheapest way to buy ALL of this — even if that means
buying from more than one store — once delivery is counted?"**

- `lib/smartBasket.ts` computes two honest plans and recommends the real winner:
  best single store vs a smart split (each item at its cheapest store, every
  store's delivery fee added in).
- Crucially it is **honest**: when splitting would scatter the order and the
  extra delivery wipes out the item savings, it says *"just buy it all at X."*
  That honesty is the brand — it's why the ranking can be trusted.
- `lib/basket.ts` holds the basket (browser-persisted) and emits `add_to_basket`
  events through the tracking seam, so the basket also feeds the profile.
- `app/basket/page.tsx` shows the verdict banner, both plans side by side, and
  the per-item "cheapest at" store.

Delivery rules (a flat fee waived above a threshold) live in `lib/fakeData.ts`
for now — Larry supplies real ones later; the shapes hold.

## Accounts &amp; sign-in

Sign-in / sign-up screens live at `/account`: email + password plus Google/Apple
buttons. New sign-ups flow into the questionnaire. The whole experience works now
on a FAKE signed-in account stored in the browser (`lib/auth.ts`), with clearly
marked SWAP POINTs where Larry wires real auth later.

Important split: the frontend owns the SCREENS and the non-sensitive `Account`
record. Real credential checking, sessions, and Google/Apple OAuth are backend
(Larry's) — passwords are NEVER stored on the frontend, even in the fake version.

The profile page has a "complete your profile" section with four progressive
insight areas (sizing, timing, values, life context). Each explains what Scoopt
can tell the shopper once added — turning profile-building into a value exchange
rather than a long form. Sign-up stays short; these deepen over time.

## What's in here

```
scoopt/
  contract/types.ts     ← THE SEAM. The data shapes both halves agree on.
  lib/
    fakeData.ts          ← temporary stand-in for Larry's backend
    api.ts               ← the ONE place the frontend calls the API
  app/
    layout.tsx           ← header/footer wrapper
    page.tsx             ← home page (hero + 3 category cards)
    globals.css          ← the Scoopt look, carried from the prototype
    category/[cat]/       ← a category page (lists subcategories + products)
    product/[id]/         ← a product page (the price-comparison lane)
    api/                  ← the 4 endpoints from the contract
  components/
    PriceLane.tsx         ← the per-store price bars
```

The golden rule: **the frontend never touches the database.** It only ever
calls the functions in `lib/api.ts`, which hit the `app/api/*` routes, which
today read from `lib/fakeData.ts`. When Larry's backend is ready, only the
*insides* of those API routes change — the shapes in `contract/types.ts` stay
identical, so the frontend keeps working untouched.

---

## Running it for the first time (total beginner)

You need **Node.js** installed. If you don't have it:

1. Go to https://nodejs.org and install the **LTS** version.
2. Check it worked — open a terminal and run:
   ```
   node --version
   ```
   You should see a version number (v20 or higher).

Then, in a terminal, from inside this folder:

```
npm install        # downloads Next.js and React (one-time, takes a minute)
npm run dev        # starts the local site
```

Open **http://localhost:3000** in your browser. You'll see the Scoopt home
page. Click a category → a subcategory's products → a product to see the
price-comparison lane. All of it is running on the fake data.

Press `Ctrl + C` in the terminal to stop it.

---

## How you and Larry split this

- **You (frontend):** everything in `app/` (except `app/api/`), `components/`,
  and `lib/api.ts`. Make the pages look and work well against the fake data.
- **Larry (backend):** `app/api/*` and, later, a real database. His job is to
  make those routes return the same shapes `lib/fakeData.ts` returns now, but
  from real retailer feeds instead.
- **Shared, agreed together:** `contract/types.ts`. Never change a shape here
  without telling the other person — it's the seam that keeps both halves fitting.

---

## Git: how to work in parallel without collisions

```
git checkout main && git pull        # start from the latest shared code
git checkout -b feat/my-piece         # your own branch
#   ... build, then ...
git add . && git commit -m "describe what you did"
git push -u origin feat/my-piece      # publish your branch
#   open a Pull Request on GitHub, the other reviews, then merge
```

Merge **small and often** (every few days). Two branches kept apart for weeks
cause painful conflicts; branches merged every few days barely conflict at all.

---

## What's intentionally NOT here yet (later phases)

- Real prices (Larry's feed ingestion + product matching)
- User accounts, saved baskets, price alerts
- The full editorial / buying-guide layer
- Anything to do with checkout

Keep the catalogue small and the shapes stable, and the rest grows from here.
