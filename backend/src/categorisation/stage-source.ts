import type { Sql } from '../lib/db';
import type { Agreement, SourceCategorySignal } from './types';
import type { Taxonomy } from './taxonomy';

/**
 * STAGE 1 — source category maps.
 *
 * The cheapest, most reliable and most scalable stage, and the reason the
 * whole design works: we map a source's TAXONOMY once — a couple of hundred
 * keys — rather than classifying its products one at a time forever.
 *
 * Reading a source's category key out of its payload is the only
 * source-specific code in the system, and it is a handful of lines each.
 * Everything after extraction is shared.
 */

/**
 * Icecat JSON: data.GeneralInfo.Category.CategoryID, plus VirtualCategory ids.
 * Virtual categories are more specific than the main one, so they go first and
 * the resolver takes the first one that maps.
 */
export function extractIcecatCategory(icecatJson: unknown): SourceCategorySignal[] {
  const root = (icecatJson ?? {}) as Record<string, any>;
  const gi = root?.data?.GeneralInfo ?? root?.GeneralInfo ?? {};
  const out: SourceCategorySignal[] = [];

  if (Array.isArray(gi?.VirtualCategory)) {
    for (const v of gi.VirtualCategory) {
      const id = Number(v?.VirtualCategoryID);
      if (Number.isFinite(id)) {
        out.push({ sourceKey: 'icecat', externalKey: String(id), label: v?.Value ?? null });
      }
    }
  }

  const cat = gi?.Category ?? {};
  const id = Number(cat?.CategoryID);
  if (Number.isFinite(id)) {
    const label = typeof cat?.Name === 'string' ? cat.Name : (cat?.Name?.Value ?? null);
    out.push({ sourceKey: 'icecat', externalKey: String(id), label });
  }
  return out;
}

/**
 * eBay Browse item: categoryId, with categoryPath as the human label.
 *
 * This is the change that matters most while eBay is the only feed. Its
 * category id is the only structured category signal on the products Icecat
 * does not know — exactly where the keyword rules are weakest — and the
 * getItem call that returns it was already being paid for.
 */
export function extractEbayCategory(item: Record<string, any> | null | undefined): SourceCategorySignal[] {
  if (!item) return [];
  const id = item?.categoryId ?? item?.categories?.[0]?.categoryId;
  if (id == null || String(id).trim() === '') return [];
  return [{ sourceKey: 'ebay', externalKey: String(id), label: item?.categoryPath ?? null }];
}

export interface SourceCandidate {
  sourceKey: string;
  externalKey: string;
  matchedKey: string;
  hops: number;
  categoryId: number;
  categoryPath: string;
  confidence: number;
  rank: number;
}

export interface SourceStageResult {
  winner: SourceCandidate;
  candidates: SourceCandidate[];
  agreement: Agreement;
}

/**
 * single   — only one source had a mapped opinion
 * agree    — they landed on the same node; the strongest signal we get
 * refine   — one is an ancestor of the other. Granularity, not disagreement:
 *            take the deeper one and do not bother a human
 * conflict — genuinely different branches; worth a human look
 */
function describeAgreement(ranked: SourceCandidate[]): Agreement {
  if (ranked.length < 2) return 'single';
  const [a, b] = ranked as [SourceCandidate, SourceCandidate];
  if (a.categoryPath === b.categoryPath) return 'agree';
  if (a.categoryPath.startsWith(b.categoryPath + '/') ||
      b.categoryPath.startsWith(a.categoryPath + '/')) return 'refine';
  return 'conflict';
}

/**
 * Resolve every signal, drop the ones nothing maps (recording them as work to
 * do), and rank what is left by the precedence table.
 */
export async function classifyFromSources(
  sql: Sql,
  taxonomy: Taxonomy,
  signals: SourceCategorySignal[],
  opts: { productId?: number | null; noteUnmapped?: boolean } = {}
): Promise<SourceStageResult | null> {
  if (signals.length === 0) return null;

  const candidates: SourceCandidate[] = [];
  const seen = new Set<string>();

  for (const sig of signals) {
    const key = `${sig.sourceKey}:${sig.externalKey}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const [row] = await sql<{
      category_id: string; matched_key: string; hops: number; confidence: string;
    }[]>`select * from resolve_source_category(${sig.sourceKey}, ${sig.externalKey})`;

    if (!row) {
      // Not dropped — recorded. The queue is the work list, ordered by how
      // many products each unmapped key is blocking.
      if (opts.noteUnmapped !== false) {
        await sql`select note_unmapped_source_category(
          ${sig.sourceKey}, ${sig.externalKey}, ${sig.label ?? null}, ${opts.productId ?? null})`;
      }
      continue;
    }

    const node = taxonomy.byIdOrNull(Number(row.category_id));
    if (!node) continue;

    const [rank] = await sql<{ source_rank: number }[]>`
      select source_rank(${node.path}, ${sig.sourceKey}) as source_rank`;

    candidates.push({
      sourceKey: sig.sourceKey,
      externalKey: sig.externalKey,
      matchedKey: row.matched_key,
      hops: row.hops,
      categoryId: node.id,
      categoryPath: node.path,
      confidence: Number(row.confidence),
      rank: rank?.source_rank ?? 99,
    });
  }

  if (candidates.length === 0) return null;

  // Best source first; on a tie, the one that needed fewer hops up its own
  // tree, then the more confident one.
  candidates.sort((a, b) => a.rank - b.rank || a.hops - b.hops || b.confidence - a.confidence);

  return {
    winner: candidates[0]!,
    candidates,
    agreement: describeAgreement(candidates),
  };
}
