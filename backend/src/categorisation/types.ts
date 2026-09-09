/**
 * The classifier's vocabulary.
 *
 * ProductInput is deliberately narrow, and that narrowness is the point: if a
 * field is not on this type, no stage can see it. That is how the promise that
 * only permitted sources produce data on the site stays mechanical rather than
 * aspirational — you can read this one type and know exactly what a
 * classification decision was allowed to be based on.
 */

/** One source's own category key for a product, as that source expresses it. */
export interface SourceCategorySignal {
  /** Matches source.source_key — 'icecat' or 'ebay' today. */
  sourceKey: string;
  /** The source's own id or breadcrumb, as text. */
  externalKey: string;
  label?: string | null;
}

export interface ProductInput {
  productId: string;
  title: string;
  brand?: string | null;
  description?: string | null;
  /** Every source category key this product carries, most specific first. */
  sourceCategories?: SourceCategorySignal[];
  specs?: Record<string, string>;
  /** eBay item condition, e.g. 'New', 'Refurbished'. */
  condition?: string | null;
  gtin?: string | null;
}

export type ClassificationStage = 'source' | 'rule' | 'llm' | 'manual' | 'inherited';

/**
 * How the sources related to one another.
 *   single   — only one source had a mapped opinion
 *   agree    — they landed on the same node
 *   refine   — one is an ancestor of the other; take the deeper, no review
 *   conflict — different branches; a human should look
 */
export type Agreement = 'single' | 'agree' | 'refine' | 'conflict';

/** Why a product ended up in the review queue. */
export type ReviewReason =
  | 'unmapped_key'
  | 'source_conflict'
  | 'low_confidence'
  | 'no_rule';

export interface TagAssignment {
  slug: string;
  confidence: number;
  stage: ClassificationStage;
}

export interface ClassificationResult {
  productId: string;
  /** Null when no stage could place the product. */
  categoryId: number | null;
  categoryPath: string | null;
  /** Every ancestor of the primary, nearest first. Written as relation='ancestor'. */
  ancestorIds: number[];
  tags: TagAssignment[];
  stage: ClassificationStage;
  confidence: number;
  agreement: Agreement | null;
  needsReview: boolean;
  reason: ReviewReason | null;
  /** Skip re-work when nothing about the product changed. */
  inputHash: string;
  /** The whole decision, for explaining a wrong answer rather than guessing. */
  detail: Record<string, unknown>;
}

export interface ClassifierOptions {
  /** Below this, the product stays draft and goes to the review queue. */
  publishFloor?: number;
  /** Stage 3. Off by default and deliberately so — see stage-llm.ts. */
  enableLlm?: boolean;
  /** Max model calls per run when stage 3 is enabled. */
  llmBudget?: number;
  classifierVersion?: string;
}

export const DEFAULTS = {
  publishFloor: 0.75,
  /** Two independent sources agreeing is the strongest signal we get. */
  agreementBonus: 0.05,
  /** A rule may refine a shallower source match only if it is this sure. */
  ruleRefineFloor: 0.8,
  maxConfidence: 0.99,
  classifierVersion: 'v1',
} as const;
