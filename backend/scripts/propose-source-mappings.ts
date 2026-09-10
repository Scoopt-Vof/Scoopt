/**
 * PROPOSE MAPPINGS FROM A SOURCE'S CATEGORY TREE TO OURS.
 *
 * The point of the whole exercise: you review a drafted list ONCE per source
 * category, instead of adding keywords forever.
 *
 * By default it only proposes for categories that are actually BLOCKING
 * products — the keys sitting in source_category_unmapped — so the first run
 * is a handful of rows that matter rather than nineteen thousand that do not.
 * --all proposes across the source's whole tree.
 *
 *   npx tsx scripts/propose-source-mappings.ts ebay --dry-run
 *   npx tsx scripts/propose-source-mappings.ts ebay
 *   npx tsx scripts/propose-source-mappings.ts ebay --all --min 0.75
 *
 * Proposals are written with reviewed_by = 'auto' and a confidence BELOW the
 * 0.900 a human-checked mapping gets, so they work immediately but you can
 * always see which ones nobody has looked at:
 *
 *   select * from source_category_map where reviewed_by = 'auto';
 *
 * To confirm one, set reviewed_by to your name and confidence to 0.950. To
 * correct one, just update its category_id — every product under it moves on
 * the next classification run, with no re-fetch and no re-ingest.
 */
import { sql, connectionLabel } from '../src/lib/db';
import { Taxonomy } from '../src/categorisation/index';
import { matchLabelToCategory } from '../src/categorisation/label-match';

const args = process.argv.slice(2).filter((a) => a !== '--');
const source = args[0];
const dryRun = args.includes('--dry-run');
const all = args.includes('--all');
const minConfidence = (() => {
  const i = args.indexOf('--min');
  return i === -1 ? 0.6 : Number(args[i + 1]);
})();

/** Their full path, so the rule engine gets the context the leaf name lacks. */
async function breadcrumbFor(sourceKey: string, key: string): Promise<string> {
  const rows = await sql<{ label: string }[]>`
    with recursive up as (
      select external_key, parent_key, label, 0 as hops
        from source_category
       where source_key = ${sourceKey} and external_key = ${key}
      union all
      select p.external_key, p.parent_key, p.label, up.hops + 1
        from source_category p
        join up on up.parent_key = p.external_key
       where p.source_key = ${sourceKey} and up.hops < 12
    )
    select coalesce(label, '') as label from up order by hops desc`;
  return rows.map((r) => r.label).filter(Boolean).join(' > ');
}

async function main() {
  console.log(`\nconnected to ${connectionLabel()}`);
  if (!source) {
    console.error('\nUsage: npx tsx scripts/propose-source-mappings.ts <source> [--all] [--dry-run] [--min 0.6]\n');
    process.exit(1);
  }

  const taxonomy = await Taxonomy.load(sql);

  // Unmapped keys that are actually blocking products, busiest first — this is
  // the work list the ingest prints at the end of every run.
  const candidates = all
    ? await sql<{ external_key: string; label: string | null; hits: number }[]>`
        select sc.external_key, sc.label, 0 as hits
          from source_category sc
          left join source_category_map m
            on m.source_key = sc.source_key and m.external_key = sc.external_key
         where sc.source_key = ${source} and m.external_key is null
         order by sc.external_key`
    : await sql<{ external_key: string; label: string | null; hits: number }[]>`
        select u.external_key,
               coalesce(sc.label, u.external_label) as label,
               u.hits
          from source_category_unmapped u
          left join source_category sc
            on sc.source_key = u.source_key and sc.external_key = u.external_key
          left join source_category_map m
            on m.source_key = u.source_key and m.external_key = u.external_key
         where u.source_key = ${source} and m.external_key is null
         order by u.hits desc`;

  console.log(
    `\nproposing mappings for "${source}": ${candidates.length} unmapped ` +
    `${all ? 'categories' : 'categories that are blocking products'}` +
    `${dryRun ? ' — DRY RUN, nothing will be written' : ''}\n`
  );

  if (candidates.length === 0) {
    console.log(
      all
        ? 'Nothing unmapped. Import the tree first: scripts/import-source-categories.ts\n'
        : 'Nothing is blocked. Run an ingest first, or use --all to propose across the whole tree.\n'
    );
    return;
  }

  let proposed = 0, tooWeak = 0;

  for (const c of candidates) {
    const label = c.label ?? '';
    const crumb = await breadcrumbFor(source, c.external_key);
    const match = matchLabelToCategory(taxonomy, label || c.external_key, crumb);

    if (!match || match.confidence < minConfidence) {
      tooWeak++;
      console.log(
        `  ?  ${c.external_key.padEnd(10)} ${String(c.hits).padStart(4)}  ` +
        `${(label || '(no label)').slice(0, 34).padEnd(36)} -> no confident match`
      );
      continue;
    }

    console.log(
      `  ->  ${c.external_key.padEnd(10)} ${String(c.hits).padStart(4)}  ` +
      `${(label || '(no label)').slice(0, 34).padEnd(36)} -> ${match.categoryPath} ` +
      `(${match.confidence.toFixed(2)}, ${match.how})`
    );

    if (!dryRun) {
      const node = taxonomy.byPathOrNull(match.categoryPath)!;
      await sql`
        insert into source_category_map
          (source_key, external_key, external_label, category_id, confidence, reviewed_by)
        values (${source}, ${c.external_key}, ${label || null}, ${node.id},
                ${match.confidence}, 'auto')
        on conflict (source_key, external_key) do nothing`;
    }
    proposed++;
  }

  console.log(
    `\n${proposed} proposed, ${tooWeak} left for a human.` +
    (dryRun ? ' (dry run — nothing written)' : '')
  );

  if (!dryRun && proposed > 0) {
    console.log(
      `\nReview them:\n` +
      `  select m.external_key, m.external_label, c.path, m.confidence\n` +
      `    from source_category_map m join category c on c.id = m.category_id\n` +
      `   where m.source_key = '${source}' and m.reviewed_by = 'auto'\n` +
      `   order by m.confidence;\n\n` +
      `Then re-classify — no re-fetch needed, the raw signals are stored:\n` +
      `  npx tsx scripts/backfill-categories.ts --force --keep-published\n`
    );
  }
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('\npropose failed:', String(err).split('\n')[0]);
    await sql.end();
    process.exit(1);
  });
