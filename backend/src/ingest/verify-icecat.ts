import { sql } from '../lib/db';

/**
 * ICECAT VERIFICATION — the checks that tell you whether this is working.
 * -----------------------------------------------------------------------------
 * "Rows per subcategory went up" only proves a script ran. These are the
 * numbers that say whether the premises hold:
 *
 *   1. EAN COVERAGE ON OFFERS. Everything Icecat does depends on matching by
 *      EAN. eBay listings frequently carry no GTIN at all, and if the offers we
 *      already have mostly lack one, then Icecat can never enrich them and
 *      catalogue rows can never acquire a price. That number decides whether
 *      brand+MPN matching is needed before any of this scales.
 *
 *   2. ICECAT COVERAGE, BY CATEGORY. Open Icecat is sponsored by electronics,
 *      computing and appliance brands. Expect deep Technology coverage and
 *      near-zero Sport. Better to see that as a number than to discover it as a
 *      broken-looking grid.
 *
 *   3. ZERO-OFFER PRODUCTS. A product with no offer is a dead end on a site
 *      whose purpose is sending someone to buy. This shows how many exist and
 *      whether the backlog is draining as feeds arrive.
 *
 *   4. WHO CLASSIFIED WHAT. How much of the catalogue is genuinely
 *      manufacturer-classified versus taken from whatever a feed claimed.
 *
 * Read-only: this script writes nothing.
 *
 * Run:  npm run icecat:verify
 */

const pct = (n: number, of: number) => (of === 0 ? '—' : `${Math.round((n / of) * 100)}%`);
const heading = (s: string) => console.log(`\n${s}\n${'-'.repeat(s.length)}`);

async function main() {
  // --- 1. EAN coverage on products that actually have an offer --------------
  heading('1. EAN coverage on products with offers');
  const [ean] = await sql<{ with_offers: string; with_ean: string }[]>`
    select count(*) as with_offers,
           count(*) filter (where p.ean is not null) as with_ean
      from product p
     where exists (select 1 from offer o where o.product_id = p.id)
  `;
  const withOffers = Number(ean?.with_offers ?? 0);
  const withEan = Number(ean?.with_ean ?? 0);
  console.log(`  products with at least one offer : ${withOffers}`);
  console.log(`  ...of which carry an EAN         : ${withEan}  (${pct(withEan, withOffers)})`);
  if (withOffers > 0 && withEan / withOffers < 0.5) {
    console.log(
      `\n  ! Fewer than half of your offered products have an EAN. Icecat can only\n` +
      `    match on EAN, so most of the catalogue is unreachable to it and\n` +
      `    catalogue-first rows would never acquire a price. Brand+MPN matching\n` +
      `    (tier 2 in run.ts) is the fix, before volume makes this painful.`
    );
  }

  const [byRetailer] = await sql<{ retailers: string }[]>`
    select count(distinct retailer_id) as retailers from offer
  `;
  console.log(`  distinct retailers with offers   : ${byRetailer?.retailers ?? 0}`);

  // --- 2. Icecat coverage by category --------------------------------------
  heading('2. Icecat coverage, by category');
  const coverage = await sql<
    { category: string; n: string; checked: string; hit: string; categorised: string }[]
  >`
    select category,
           count(*)                                                    as n,
           count(*) filter (where icecat_checked_at is not null)        as checked,
           count(*) filter (where icecat_category_id is not null)       as hit,
           count(*) filter (where category_source = 'source-map')       as categorised
      from product
     group by category
     order by category
  `;
  console.log(`  ${'category'.padEnd(10)}${'products'.padEnd(10)}${'checked'.padEnd(10)}${'icecat hit'.padEnd(12)}from icecat category`);
  for (const r of coverage) {
    console.log(
      `  ${r.category.padEnd(10)}${String(r.n).padEnd(10)}${String(r.checked).padEnd(10)}` +
      `${`${r.hit} (${pct(Number(r.hit), Number(r.checked))})`.padEnd(12)}${r.categorised}`
    );
  }
  console.log(
    `\n  "icecat hit" = Icecat returned a data sheet. Low numbers in sport are\n` +
    `  expected: Open Icecat's sponsors are electronics and appliance brands.`
  );

  // --- 3. Products with no offer -------------------------------------------
  heading('3. Products with no offer (the backlog that must drain)');
  const orphans = await sql<
    { category: string; subcategory: string | null; status: string; n: string; source: string | null }[]
  >`
    select p.category, p.subcategory, p.status, p.created_by_source as source, count(*) as n
      from product p
     where not exists (select 1 from offer o where o.product_id = p.id)
     group by p.category, p.subcategory, p.status, p.created_by_source
     order by count(*) desc
  `;
  if (orphans.length === 0) {
    console.log('  none — every product has at least one offer.');
  } else {
    console.log(`  ${'category'.padEnd(10)}${'subcategory'.padEnd(22)}${'status'.padEnd(12)}${'created by'.padEnd(12)}count`);
    for (const r of orphans) {
      console.log(
        `  ${r.category.padEnd(10)}${(r.subcategory ?? '—').padEnd(22)}` +
        `${r.status.padEnd(12)}${(r.source ?? '—').padEnd(12)}${r.n}`
      );
    }
    const [published] = await sql<{ n: string }[]>`
      select count(*) as n from product p
       where p.status = 'published'
         and not exists (select 1 from offer o where o.product_id = p.id)
    `;
    if (Number(published?.n ?? 0) > 0) {
      console.log(
        `\n  ! ${published!.n} PUBLISHED product(s) have no offer, so the site is showing\n` +
        `    products nobody can buy. Discovery rows are created as 'draft' for\n` +
        `    exactly this reason; these came from somewhere else, or were promoted\n` +
        `    and then lost their offers.`
      );
    }
  }

  // --- 4. Provenance -------------------------------------------------------
  heading('4. Who created and classified what');
  const prov = await sql<{ created_by_source: string | null; n: string }[]>`
    select created_by_source, count(*) as n from product group by created_by_source order by count(*) desc
  `;
  for (const r of prov) console.log(`  created by ${(r.created_by_source ?? 'feed / unknown').padEnd(20)} ${r.n}`);

  const cls = await sql<{ category_source: string | null; n: string }[]>`
    select category_source, count(*) as n from product group by category_source order by count(*) desc
  `;
  console.log('');
  for (const r of cls) console.log(`  classified by ${(r.category_source ?? 'unrecorded').padEnd(17)} ${r.n}`);

  // --- 5. Unmapped Icecat categories --------------------------------------
  heading('5. Icecat category ids on our products with no mapping');
  const unmapped = await sql<{ icecat_category_id: string; name: string | null; n: string }[]>`
    select p.icecat_category_id, max(p.icecat_category_name) as name, count(*) as n
      from product p
      left join source_category_map m
        on m.source = 'icecat' and m.source_category_id = p.icecat_category_id
     where p.icecat_category_id is not null and m.source_category_id is null
     group by p.icecat_category_id
     order by count(*) desc
     limit 20
  `;
  if (unmapped.length === 0) {
    console.log('  none.');
  } else {
    for (const r of unmapped) {
      console.log(`  ${r.icecat_category_id.padEnd(12)}${String(r.n).padEnd(8)}${r.name ?? ''}`);
    }
    console.log(`\n  Map these with: npm run icecat:map -- --set <id>=<category>/<subcategory>`);
  }

  console.log('');
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('\nfailed:', String(err));
    await sql.end();
    process.exit(1);
  });
