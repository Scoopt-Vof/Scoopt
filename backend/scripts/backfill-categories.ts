/**
 * BACKFILL — classify products that already exist.
 *
 * The ingest job classifies each product as it arrives, but products ingested
 * BEFORE the categorisation system existed have no place on the tree at all,
 * so they are invisible to every /api/categories endpoint. This is the one-off
 * pass that fixes that, and the pass you re-run after editing rules.seed.json.
 *
 *   npx tsx scripts/backfill-categories.ts --dry-run --limit 20   look first
 *   npx tsx scripts/backfill-categories.ts --limit 200            do it
 *   npx tsx scripts/backfill-categories.ts --force                ignore the hash cache
 *
 * SAFE BY DEFAULT:
 *   * --dry-run writes nothing and prints what would happen.
 *   * Products a human has placed (stage='manual') are never moved.
 *   * A product whose input has not changed since it was last classified is
 *     skipped, so a nightly run over ten thousand products does almost nothing.
 *   * Nothing here calls a model unless CLASSIFIER_LLM=1 is set AND --llm is
 *     passed; stage 3 ships disabled on purpose.
 *
 * WHAT IT DOES NOT DO: it cannot invent a source category signal for a product
 * that was ingested before src/sources/ebay.ts started carrying categoryId.
 * Those rows fall through to the rule engine, which is exactly what stage 2 is
 * for. Re-ingesting is what gives them a stage 1 signal.
 */
import { sql } from '../src/lib/db';
import {
  createClassifier, persistClassification, alreadyClassified, hashInput,
  DEFAULTS,
} from '../src/categorisation/index';

const args = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string) => args.includes(name);
const value = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
};

const dryRun = flag('--dry-run');
const force = flag('--force');
const limit = value('--limit', 500);
const publishFloor = value('--floor', DEFAULTS.publishFloor);

async function main() {
  const classifier = await createClassifier(sql, {
    publishFloor,
    llmBudget: flag('--llm') ? value('--llm-budget', 100) : 0,
  });

  console.log(
    `\nbackfill: ${classifier.taxonomy.size} categories, floor ${publishFloor}` +
    `${dryRun ? ', DRY RUN (nothing will be written)' : ''}\n`
  );

  // Products with no primary category first — they are the ones currently
  // invisible — then the oldest-classified, so an interrupted run still makes
  // forward progress instead of re-doing the same head of the list.
  const products = await sql<{
    id: string; title: string; brand: string; description: string | null;
    specs: Record<string, string> | null;
  }[]>`
    select p.id, p.title, p.brand, p.description, p.specs
      from product p
      left join product_category pc
        on pc.product_id = p.id and pc.relation = 'primary'
     where p.status <> 'suppressed'
     order by (pc.product_id is null) desc, p.updated_at asc
     limit ${limit}`;

  let placed = 0, queued = 0, skipped = 0, manual = 0;

  for (const p of products) {
    const input = {
      productId: String(p.id),
      title: p.title,
      brand: p.brand,
      description: p.description,
      specs: p.specs ?? {},
    };

    if (!force && await alreadyClassified(sql, Number(p.id), hashInput(input, DEFAULTS.classifierVersion))) {
      skipped++;
      continue;
    }

    const [human] = await sql<{ n: string }[]>`
      select count(*) as n from product_category
       where product_id = ${p.id} and stage = 'manual'`;
    if (Number(human?.n ?? 0) > 0) { manual++; continue; }

    const result = await classifier.classify(input);

    if (dryRun) {
      console.log(
        `  ${(result.categoryPath ?? '— unplaced').padEnd(26)} ` +
        `${result.confidence.toFixed(2)} ${result.stage.padEnd(6)} ` +
        `${result.tags.map((t) => t.slug).join(',').padEnd(24)} ${p.title.slice(0, 60)}`
      );
    } else {
      await persistClassification(sql, classifier.taxonomy, result);
    }

    if (result.categoryId && !result.needsReview) placed++; else queued++;
  }

  console.log(
    `\n${placed} placed and publishable, ${queued} queued for review, ` +
    `${skipped} unchanged since last run, ${manual} left alone (human-placed).`
  );

  if (!dryRun) {
    const unmapped = await sql<{ source_key: string; external_key: string; external_label: string | null; hits: number }[]>`
      select source_key, external_key, external_label, hits
        from source_category_unmapped order by hits desc limit 15`;
    if (unmapped.length > 0) {
      console.log(`\nmap these source categories next (biggest win first):`);
      for (const u of unmapped) {
        console.log(`  ${u.source_key.padEnd(8)} ${u.external_key.padEnd(12)} ${String(u.hits).padStart(4)} hits  ${u.external_label ?? ''}`);
      }
    }
    const [draft] = await sql<{ c: string }[]>`
      select count(*) as c from product where status = 'draft'`;
    console.log(`\nproducts still in draft (not visible to shoppers): ${draft!.c}\n`);
  }
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('\nbackfill failed:', String(err));
    await sql.end();
    process.exit(1);
  });
