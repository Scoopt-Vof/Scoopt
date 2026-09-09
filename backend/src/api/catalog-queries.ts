import { sql } from '../lib/db';

/**
 * THE BROWSE READ MODEL.
 *
 * This replaces the pattern the category page uses today, which is to call
 * /api/search with an empty query and filter the result in JavaScript. That
 * path returns `order by p.id asc limit 200` — the two hundred OLDEST products
 * in the catalogue — so categories start silently emptying as new products are
 * ingested, with no error anywhere. Filtering and paging belong in the
 * database, which is what these queries do.
 *
 * Every function here reads only PUBLISHED products and ACTIVE categories.
 * A product the classifier could not place is draft and does not appear.
 */

export interface CategoryNodeDto {
  path: string;
  slug: string;
  name: string;
  depth: number;
  productCount: number;
  children?: CategoryNodeDto[];
}

/** Products in a node AND everything below it, counted once each. */
const COUNT_FOR_PATH = sql`
  (select count(*) from products_in_category(c.path) pic
     join product p on p.id = pic.product_id and p.status = 'published')`;

export async function getTree(): Promise<CategoryNodeDto[]> {
  const rows = await sql<{
    path: string; slug: string; name: string; depth: number;
    parent_path: string | null; product_count: string;
  }[]>`
    select c.path, c.slug, c.name, c.depth,
           case when c.depth = 0 then null
                else substring(c.path from 1 for length(c.path) - length(c.slug) - 1)
           end as parent_path,
           ${COUNT_FOR_PATH} as product_count
      from category c
     where c.is_active
     order by c.depth, c.position, c.name`;

  const byPath = new Map<string, CategoryNodeDto>();
  const roots: CategoryNodeDto[] = [];

  for (const r of rows) {
    const node: CategoryNodeDto = {
      path: r.path, slug: r.slug, name: r.name, depth: r.depth,
      productCount: Number(r.product_count), children: [],
    };
    byPath.set(r.path, node);
    // Rows are ordered by depth, so a parent is always already in the map.
    const parent = r.parent_path ? byPath.get(r.parent_path) : null;
    if (parent) parent.children!.push(node);
    else if (r.depth === 0) roots.push(node);
  }
  return roots;
}

export interface CategoryDetail {
  path: string;
  slug: string;
  name: string;
  breadcrumb: { path: string; name: string }[];
  children: CategoryNodeDto[];
  productCount: number;
}

export async function getCategoryByPath(path: string): Promise<CategoryDetail | null> {
  const [node] = await sql<{
    path: string; slug: string; name: string; depth: number; product_count: string;
  }[]>`
    select c.path, c.slug, c.name, c.depth, ${COUNT_FOR_PATH} as product_count
      from category c where c.path = ${path} and c.is_active limit 1`;
  if (!node) return null;

  // The breadcrumb is every prefix of the path, which the materialised path
  // makes a plain IN lookup rather than a recursive walk.
  const parts = path.split('/');
  const ancestorPaths = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));

  const crumbs = ancestorPaths.length
    ? await sql<{ path: string; name: string }[]>`
        select path, name from category
         where path = any(${ancestorPaths}) and is_active
         order by depth`
    : [];

  const children = await sql<{
    path: string; slug: string; name: string; depth: number; product_count: string;
  }[]>`
    select c.path, c.slug, c.name, c.depth, ${COUNT_FOR_PATH} as product_count
      from category c
     where c.parent_id = (select id from category where path = ${path})
       and c.is_active
     order by c.position, c.name`;

  return {
    path: node.path,
    slug: node.slug,
    name: node.name,
    breadcrumb: crumbs.map((c) => ({ path: c.path, name: c.name })),
    children: children.map((c) => ({
      path: c.path, slug: c.slug, name: c.name, depth: c.depth,
      productCount: Number(c.product_count),
    })),
    productCount: Number(node.product_count),
  };
}

export interface CategoryProduct {
  id: string;
  ean: string | null;
  brand: string;
  name: string;
  unit: string;
  category: string;
  subcategory: string;
  image: string;
  specs: Record<string, string>;
  tags: string[];
  minPrice: number | null;
  offerCount: number;
}

export interface CategoryProductsPage {
  path: string;
  total: number;
  limit: number;
  offset: number;
  products: CategoryProduct[];
}

/**
 * Products in a category and everything below it. Paged, filterable by tag,
 * and — unlike the read path it replaces — bounded by the CATEGORY rather than
 * by an arbitrary slice of the whole catalogue.
 *
 * Sorted by whether the product actually has an offer first: a product Icecat
 * created but no retailer sells yet is honest to show, but it is not what a
 * shopper came for, so it sorts below the ones with a real price.
 */
export async function getCategoryProducts(
  path: string,
  opts: { limit?: number; offset?: number; tags?: string[] } = {}
): Promise<CategoryProductsPage | null> {
  const [exists] = await sql<{ path: string }[]>`
    select path from category where path = ${path} and is_active limit 1`;
  if (!exists) return null;

  const limit = Math.min(Math.max(opts.limit ?? 48, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const tags = opts.tags?.length ? opts.tags : null;

  const [countRow] = await sql<{ c: string }[]>`
    select count(*) as c
      from products_in_category(${path}) pic
      join product p on p.id = pic.product_id and p.status = 'published'
     where ${tags === null ? sql`true` : sql`
       (select count(distinct t.slug) from product_tag pt
          join tag t on t.id = pt.tag_id
         where pt.product_id = p.id and t.slug = any(${tags})) = ${tags.length}`}`;

  // The ordering is wrapped in an outer select because Postgres will not let
  // an ORDER BY expression reference an output-column alias — only a bare
  // alias. Repeating the min-price subquery in the ORDER BY would work too,
  // and would run it twice.
  const rows = await sql<{
    id: string; ean: string | null; brand: string; title: string; unit: string | null;
    category: string; subcategory: string | null; image_url: string | null;
    specs: Record<string, string> | null; tags: string[] | null;
    min_price_cents: number | null; offer_count: string;
  }[]>`
    select * from (
      select p.id, p.ean, p.brand, p.title, p.unit, p.category, p.subcategory,
             p.image_url, p.specs,
             (select array_agg(t.slug order by t.slug) from product_tag pt
                join tag t on t.id = pt.tag_id and t.is_active
               where pt.product_id = p.id) as tags,
             (select min(o.price_cents + o.shipping_cents)::int from offer o
                join retailer r on r.id = o.retailer_id and r.is_active
               where o.product_id = p.id and o.currency = 'EUR') as min_price_cents,
             (select count(*) from offer o where o.product_id = p.id) as offer_count
        from products_in_category(${path}) pic
        join product p on p.id = pic.product_id and p.status = 'published'
       where ${tags === null ? sql`true` : sql`
         (select count(distinct t.slug) from product_tag pt
            join tag t on t.id = pt.tag_id
           where pt.product_id = p.id and t.slug = any(${tags})) = ${tags.length}`}
    ) x
     order by (x.min_price_cents is null), x.min_price_cents asc, x.title asc
     limit ${limit} offset ${offset}`;

  return {
    path,
    total: Number(countRow?.c ?? 0),
    limit,
    offset,
    products: rows.map((r) => ({
      id: r.id,
      ean: r.ean,
      brand: r.brand,
      name: r.title,
      unit: r.unit ?? '',
      category: r.category,
      subcategory: r.subcategory ?? r.category,
      image: r.image_url ?? '',
      specs: r.specs ?? {},
      tags: r.tags ?? [],
      // Cents in the database, euros on the way out — the same single
      // conversion point discipline as contract-queries.ts.
      minPrice: r.min_price_cents == null ? null : Math.round(r.min_price_cents) / 100,
      offerCount: Number(r.offer_count),
    })),
  };
}

export interface Facet {
  slug: string;
  label: string;
  kind: string;
  count: number;
}

export async function getCategoryFacets(path: string): Promise<Facet[] | null> {
  const [exists] = await sql<{ path: string }[]>`
    select path from category where path = ${path} and is_active limit 1`;
  if (!exists) return null;

  const rows = await sql<{
    tag_slug: string; tag_label: string; tag_kind: string; product_count: string;
  }[]>`select * from category_tag_facets(${path})`;

  return rows.map((r) => ({
    slug: r.tag_slug, label: r.tag_label, kind: r.tag_kind, count: Number(r.product_count),
  }));
}

export async function getFacetTags(): Promise<Facet[]> {
  const rows = await sql<{ slug: string; label: string; kind: string; c: string }[]>`
    select t.slug, t.label, t.kind::text as kind,
           (select count(*) from product_tag pt
              join product p on p.id = pt.product_id and p.status = 'published'
             where pt.tag_id = t.id) as c
      from tag t where t.is_active and t.is_facet
     order by t.kind, t.label`;
  return rows.map((r) => ({
    slug: r.slug, label: r.label, kind: r.kind, count: Number(r.c),
  }));
}

/**
 * One product's place in the taxonomy — the primary path, its ancestors, and
 * its tags. Used by the product page for breadcrumbs.
 */
export async function getProductTaxonomy(productId: string) {
  const [p] = await sql<{ id: string }[]>`
    select id from product
     where (contract_id = ${productId} or id::text = ${productId})
       and status = 'published' limit 1`;
  if (!p) return null;

  const [primary] = await sql<{ path: string; name: string }[]>`
    select c.path, c.name from product_category pc
      join category c on c.id = pc.category_id
     where pc.product_id = ${p.id} and pc.relation = 'primary' limit 1`;

  const tags = await sql<{ slug: string; label: string }[]>`
    select t.slug, t.label from product_tag pt
      join tag t on t.id = pt.tag_id and t.is_active
     where pt.product_id = ${p.id} order by t.label`;

  const breadcrumb = primary
    ? await sql<{ path: string; name: string }[]>`
        select path, name from category
         where ${primary.path} like path || '%' and is_active
         order by depth`
    : [];

  return {
    productId,
    primaryPath: primary?.path ?? null,
    breadcrumb: breadcrumb.map((b) => ({ path: b.path, name: b.name })),
    tags: tags.map((t) => ({ slug: t.slug, label: t.label })),
  };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/**
 * The one review queue: low-confidence placements, source conflicts, and the
 * unmapped keys blocking the most products. Deliberately one call, because the
 * three lists are one job.
 */
export async function getReviewQueue(limit = 50) {
  const open = await sql<{
    id: string; product_id: string | null; title: string | null;
    confidence: number; reason: string; created_at: Date;
  }[]>`
    select q.id, q.product_id, p.title, q.confidence, q.reason, q.created_at
      from match_review_queue q
      left join product p on p.id = q.product_id
     where q.resolved = false and q.kind = 'category'
     order by q.created_at desc limit ${limit}`;

  const unmapped = await sql<{
    source_key: string; external_key: string; external_label: string | null; hits: number;
  }[]>`
    select source_key, external_key, external_label, hits
      from source_category_unmapped order by hits desc limit ${limit}`;

  const coverage = await sql`select * from v_source_mapping_coverage`;

  return { open, unmapped, coverage };
}

/**
 * A human override. Written as stage='manual', which persist.ts treats as
 * untouchable: later classification runs may add tags but will never move a
 * product a person has placed.
 */
export async function setProductCategory(
  productId: string, categoryPath: string, reviewedBy?: string | null
): Promise<{ ok: true; productId: string; path: string } | { ok: false; error: string }> {
  const [p] = await sql<{ id: string }[]>`
    select id from product where contract_id = ${productId} or id::text = ${productId} limit 1`;
  if (!p) return { ok: false, error: 'Product not found' };

  const [c] = await sql<{ id: string; path: string }[]>`
    select id, path from category where path = ${categoryPath} limit 1`;
  if (!c) return { ok: false, error: `Unknown category path "${categoryPath}"` };

  const ancestors = c.path.split('/').slice(0, -1)
    .map((_, i) => c.path.split('/').slice(0, i + 1).join('/'));

  await sql.begin(async (tx) => {
    await tx`delete from product_category where product_id = ${p.id}
              and relation in ('primary', 'ancestor')`;
    await tx`insert into product_category
               (product_id, category_id, relation, confidence, stage)
             values (${p.id}, ${c.id}, 'primary', 1.000, 'manual')`;
    if (ancestors.length > 0) {
      await tx`insert into product_category (product_id, category_id, relation, confidence, stage)
               select ${p.id}, id, 'ancestor', 1.000, 'manual' from category
                where path = any(${ancestors})
               on conflict do nothing`;
    }
    const parts = c.path.split('/');
    await tx`update product
                set category = ${parts[0]}, subcategory = ${parts[1] ?? parts[0]},
                    status = 'published', updated_at = now()
              where id = ${p.id}`;
    await tx`update match_review_queue set resolved = true
              where product_id = ${p.id} and kind = 'category' and resolved = false`;
    await tx`insert into product_classification
               (product_id, category_id, stage, confidence, tags, needs_review, detail)
             values (${p.id}, ${c.id}, 'manual', 1.000, '{}', false,
                     ${tx.json({ reviewedBy: reviewedBy ?? null })})`;
  });

  return { ok: true, productId, path: c.path };
}
