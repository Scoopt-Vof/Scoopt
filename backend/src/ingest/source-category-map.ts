import { sql } from '../lib/db';

/**
 * THE SOURCE → SCOOPT CATEGORY MAPPING LAYER.
 * -----------------------------------------------------------------------------
 * Stage 1 of categorisation: a source's own taxonomy, translated into ours.
 * Icecat is the first source through it; Awin merchants and Bol will each get
 * their own rows in the same table under a different `source` value.
 *
 * This deliberately lives in the database (see db/007_source_category_map.sql),
 * not in a const in an ingest script. Two reasons, both learned the hard way:
 * a mapping change should not need a redeploy, and two scripts holding two
 * copies of "the" map is a bug waiting for a quiet evening.
 *
 * The map is applied FROM the raw source category id stored on each product.
 * That ordering matters: change a mapping and the fix is a re-run over our own
 * rows, not a re-fetch of the whole catalogue from the source.
 */

/** The only category values the front-end contract accepts. */
export const CATEGORIES = ['home', 'sport', 'tech'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Every subcategory id the site knows about, copied from SUBCATEGORY_META in
 * ../api/contract-queries.ts. A mapping to a subcategory that isn't here would
 * write a row the browse page can never show, so mappings are validated
 * against this list before they're stored.
 */
export const SUBCATEGORIES: Record<Category, readonly string[]> = {
  sport: [
    'running', 'cycling', 'hiking-outdoor', 'fitness-gym',
    'swimming', 'team-sports', 'racket-sports', 'winter-sports',
  ],
  home: [
    'furniture', 'kitchen-dining', 'bedroom', 'lighting',
    'home-decor', 'storage', 'home-textiles', 'garden-outdoor',
  ],
  tech: [
    'smartphones', 'laptops-computers', 'wearables', 'audio-headphones',
    'tv-video', 'cameras', 'gaming', 'home-appliances',
  ],
};

export interface CategoryMapping {
  category: Category;
  subcategory: string;
  sourceCategoryName: string | null;
}

export type CategoryMap = Map<string, CategoryMapping>;

/** Reads one source's whole map. Small table; one query, cached by the caller. */
export async function loadCategoryMap(source: string): Promise<CategoryMap> {
  const rows = await sql<
    { source_category_id: string; source_category_name: string | null; category: Category; subcategory: string }[]
  >`
    select source_category_id, source_category_name, category, subcategory
      from source_category_map
     where source = ${source}
  `;

  const map: CategoryMap = new Map();
  for (const r of rows) {
    map.set(String(r.source_category_id), {
      category: r.category,
      subcategory: r.subcategory,
      sourceCategoryName: r.source_category_name,
    });
  }
  return map;
}

/** Validates a category/subcategory pair against what the front end can render. */
export function assertValidTarget(category: string, subcategory: string): asserts category is Category {
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    throw new Error(`"${category}" is not a Scoopt category. Use one of: ${CATEGORIES.join(', ')}.`);
  }
  const allowed = SUBCATEGORIES[category as Category];
  if (!allowed.includes(subcategory)) {
    throw new Error(
      `"${subcategory}" is not a subcategory of ${category}.\n` +
      `Valid ${category} subcategories: ${allowed.join(', ')}.`
    );
  }
}

/** Upsert one mapping. Idempotent, so re-running a fill-in script is harmless. */
export async function setMapping(opts: {
  source: string;
  sourceCategoryId: string;
  sourceCategoryName?: string | null;
  category: string;
  subcategory: string;
  notes?: string | null;
}): Promise<void> {
  assertValidTarget(opts.category, opts.subcategory);
  await sql`
    insert into source_category_map
      (source, source_category_id, source_category_name, category, subcategory, notes)
    values
      (${opts.source}, ${String(opts.sourceCategoryId)}, ${opts.sourceCategoryName ?? null},
       ${opts.category}, ${opts.subcategory}, ${opts.notes ?? null})
    on conflict (source, source_category_id) do update
      set source_category_name = coalesce(excluded.source_category_name, source_category_map.source_category_name),
          category    = excluded.category,
          subcategory = excluded.subcategory,
          notes       = coalesce(excluded.notes, source_category_map.notes),
          updated_at  = now()
  `;
}

export async function deleteMapping(source: string, sourceCategoryId: string): Promise<number> {
  const rows = await sql`
    delete from source_category_map
     where source = ${source} and source_category_id = ${String(sourceCategoryId)}
    returning source_category_id
  `;
  return rows.length;
}

/**
 * Parses the "4=tech/smartphones" shorthand the icecat:map CLI takes, so a
 * whole map can be filled in from one command line without editing code.
 */
export function parseMappingArg(arg: string): { sourceCategoryId: string; category: string; subcategory: string } {
  const [id, target] = arg.split('=');
  if (!id || !target) {
    throw new Error(`Expected <sourceCategoryId>=<category>/<subcategory>, got "${arg}".`);
  }
  const [category, subcategory] = target.split('/');
  if (!category || !subcategory) {
    throw new Error(`Expected <category>/<subcategory> after "=", got "${target}".`);
  }
  return { sourceCategoryId: id.trim(), category: category.trim(), subcategory: subcategory.trim() };
}
