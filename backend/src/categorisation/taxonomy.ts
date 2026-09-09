import type { Sql } from '../lib/db';

/**
 * An in-memory snapshot of the tree and the tag vocabulary.
 *
 * Loaded once per process, not once per product. An ingest run classifying a
 * few hundred products would otherwise issue a few thousand lookups for a
 * table of twenty-seven rows that changes about once a month.
 *
 * Call reload() after a migration or a taxonomy edit inside a long-lived
 * process; the ingest job is short-lived enough that it never needs to.
 */
export interface CategoryNode {
  id: number;
  path: string;
  slug: string;
  name: string;
  depth: number;
  parentId: number | null;
  isActive: boolean;
}

export class Taxonomy {
  private byPath = new Map<string, CategoryNode>();
  private byId = new Map<number, CategoryNode>();
  private tagIdBySlug = new Map<string, number>();

  private constructor(private readonly sql: Sql) {}

  static async load(sql: Sql): Promise<Taxonomy> {
    const t = new Taxonomy(sql);
    await t.reload();
    return t;
  }

  async reload(): Promise<void> {
    const rows = await this.sql<{
      id: string; path: string; slug: string; name: string;
      depth: number; parent_id: string | null; is_active: boolean;
    }[]>`
      select id, path, slug, name, depth, parent_id, is_active
        from category order by path`;

    this.byPath.clear();
    this.byId.clear();
    for (const r of rows) {
      const node: CategoryNode = {
        id: Number(r.id),
        path: r.path,
        slug: r.slug,
        name: r.name,
        depth: r.depth,
        parentId: r.parent_id === null ? null : Number(r.parent_id),
        isActive: r.is_active,
      };
      this.byPath.set(node.path, node);
      this.byId.set(node.id, node);
    }

    const tags = await this.sql<{ id: string; slug: string }[]>`
      select id, slug from tag where is_active`;
    this.tagIdBySlug.clear();
    for (const t of tags) this.tagIdBySlug.set(t.slug, Number(t.id));
  }

  byPathOrNull(path: string): CategoryNode | null {
    return this.byPath.get(path) ?? null;
  }

  byIdOrNull(id: number): CategoryNode | null {
    return this.byId.get(id) ?? null;
  }

  /** Every ancestor of a path, nearest first: 'a/b/c' -> ['a/b', 'a']. */
  ancestorsOf(path: string): CategoryNode[] {
    const parts = path.split('/');
    const out: CategoryNode[] = [];
    for (let i = parts.length - 1; i > 0; i--) {
      const node = this.byPath.get(parts.slice(0, i).join('/'));
      if (node) out.push(node);
    }
    return out;
  }

  /** The closed list a model is allowed to pick from. Active nodes only. */
  activePaths(): string[] {
    return [...this.byPath.values()].filter((n) => n.isActive).map((n) => n.path);
  }

  allPaths(): string[] {
    return [...this.byPath.keys()];
  }

  tagId(slug: string): number | null {
    return this.tagIdBySlug.get(slug) ?? null;
  }

  activeTagSlugs(): string[] {
    return [...this.tagIdBySlug.keys()];
  }

  get size(): number {
    return this.byPath.size;
  }
}
