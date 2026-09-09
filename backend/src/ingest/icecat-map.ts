import { sql } from '../lib/db';
import {
  CATEGORIES,
  SUBCATEGORIES,
  deleteMapping,
  parseMappingArg,
  setMapping,
} from './source-category-map';

/**
 * ICECAT CATEGORY MAP — CLI over the source_category_map table.
 * -----------------------------------------------------------------------------
 * The map used to be a const inside discover-icecat.ts. It now lives in the
 * database, keyed by source, because the classifier, the enrichment pass and
 * the discovery script all need the same one, and because Awin and Bol will
 * each want their own rows in the same table without anyone editing TypeScript.
 *
 * Build the map from what the data actually contains, not from guessed terms:
 *
 *   npm run discover:icecat                     # which ids occur, by volume
 *   npm run icecat:map -- --unmapped            # which ids our own rows carry
 *   npm run icecat:map -- --set 4=tech/smartphones --set 118=tech/laptops-computers
 *   npm run icecat:map -- --list
 *   npm run icecat:map -- --unset 4
 *   npm run icecat:map -- --targets             # valid category/subcategory ids
 *
 * --set validates the target against the real subcategory ids the front end
 * renders, so a typo fails here rather than silently writing rows the browse
 * page can never show.
 */

const SOURCE = 'icecat';

function collectFlagValues(args: string[], flag: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === flag && args[i + 1]) out.push(args[i + 1]!);
  });
  return out;
}

async function list() {
  const rows = await sql<
    { source_category_id: string; source_category_name: string | null; category: string; subcategory: string }[]
  >`
    select source_category_id, source_category_name, category, subcategory
      from source_category_map
     where source = ${SOURCE}
     order by category, subcategory, source_category_id
  `;

  if (rows.length === 0) {
    console.log(
      `\nNo Icecat mappings stored yet.\n\n` +
      `Start with a report of which category ids actually occur:\n` +
      `  npm run discover:icecat\n` +
      `then store the ones worth mapping:\n` +
      `  npm run icecat:map -- --set <id>=<category>/<subcategory>\n`
    );
    return;
  }

  console.log(`\n${rows.length} Icecat mapping(s):\n`);
  console.log(`  ${'icecat id'.padEnd(12)}${'scoopt target'.padEnd(30)}Icecat's name`);
  console.log(`  ${'-'.repeat(74)}`);
  for (const r of rows) {
    console.log(
      `  ${r.source_category_id.padEnd(12)}` +
      `${`${r.category}/${r.subcategory}`.padEnd(30)}` +
      `${r.source_category_name ?? ''}`
    );
  }
  console.log('');
}

/** Which Icecat category ids our OWN products already carry but we haven't
 *  mapped — the highest-value mapping work, ranked by how many products it
 *  would classify. This is the query that tells you what to map next. */
async function unmapped() {
  const rows = await sql<
    { icecat_category_id: string; icecat_category_name: string | null; n: string }[]
  >`
    select p.icecat_category_id, max(p.icecat_category_name) as icecat_category_name, count(*) as n
      from product p
      left join source_category_map m
        on m.source = ${SOURCE} and m.source_category_id = p.icecat_category_id
     where p.icecat_category_id is not null and m.source_category_id is null
     group by p.icecat_category_id
     order by count(*) desc
  `;

  if (rows.length === 0) {
    console.log(
      `\nNothing unmapped: every Icecat category id currently on a product row has a\n` +
      `mapping. (If that seems too easy, run npm run enrich:icecat first — the ids\n` +
      `only appear on rows Icecat has actually been asked about.)\n`
    );
    return;
  }

  console.log(`\nIcecat category ids on our products with no mapping, most products first:\n`);
  console.log(`  ${'icecat id'.padEnd(12)}${'products'.padEnd(10)}Icecat's name`);
  console.log(`  ${'-'.repeat(60)}`);
  for (const r of rows) {
    console.log(`  ${r.icecat_category_id.padEnd(12)}${String(r.n).padEnd(10)}${r.icecat_category_name ?? ''}`);
  }
  console.log(`\nMap the top ones:\n  npm run icecat:map -- --set <id>=<category>/<subcategory>\n`);
}

function printTargets() {
  console.log(`\nValid targets (category/subcategory), from SUBCATEGORY_META:\n`);
  for (const category of CATEGORIES) {
    console.log(`  ${category}`);
    for (const sub of SUBCATEGORIES[category]) console.log(`    ${category}/${sub}`);
  }
  console.log('');
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');

  if (args.includes('--targets')) { printTargets(); return; }
  if (args.includes('--unmapped')) { await unmapped(); return; }

  const sets = collectFlagValues(args, '--set');
  const unsets = collectFlagValues(args, '--unset');

  for (const spec of sets) {
    const { sourceCategoryId, category, subcategory } = parseMappingArg(spec);
    // Icecat's own label for the id, if any product already carries it — saves
    // retyping it and keeps the stored name honest (theirs, not ours).
    const [known] = await sql<{ icecat_category_name: string | null }[]>`
      select icecat_category_name from product
       where icecat_category_id = ${sourceCategoryId} and icecat_category_name is not null
       limit 1
    `;
    await setMapping({
      source: SOURCE,
      sourceCategoryId,
      sourceCategoryName: known?.icecat_category_name ?? null,
      category,
      subcategory,
    });
    console.log(`  mapped icecat ${sourceCategoryId} -> ${category}/${subcategory}`);
  }

  for (const id of unsets) {
    const n = await deleteMapping(SOURCE, id);
    console.log(n ? `  removed mapping for icecat ${id}` : `  no mapping stored for icecat ${id}`);
  }

  if (sets.length === 0 && unsets.length === 0) {
    await list();
    console.log(
      `Commands:\n` +
      `  --list                              show stored mappings (default)\n` +
      `  --unmapped                          ids on our products with no mapping yet\n` +
      `  --set <id>=<category>/<subcategory> store a mapping (repeatable)\n` +
      `  --unset <id>                        remove a mapping (repeatable)\n` +
      `  --targets                           list valid category/subcategory ids\n`
    );
    return;
  }

  await list();
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('\nfailed:', String(err).split('\n')[0]);
    await sql.end();
    process.exit(1);
  });
