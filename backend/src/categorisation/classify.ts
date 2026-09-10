import { createHash } from 'node:crypto';
import type { Sql } from '../lib/db';
import { Taxonomy } from './taxonomy';
import { buildHaystack, runRules, validateRules } from './rules';
import { classifyFromSources } from './stage-source';
import { classifyWithModel, llmEnabled } from './stage-llm';
import {
  DEFAULTS,
  type ClassificationResult,
  type ClassificationStage,
  type ClassifierOptions,
  type ProductInput,
  type ReviewReason,
  type TagAssignment,
} from './types';

/**
 * THE ORCHESTRATOR.
 *
 * Stages run cheapest first and the first to produce an answer wins, with two
 * deliberate exceptions:
 *
 *   1. Tag rules ALWAYS run. Tags are additive, and "noise cancelling" is a
 *      property of the words in the title regardless of who placed the product.
 *
 *   2. A deep rule may refine a shallow source match. If Icecat says
 *      tech/audio-headphones and a rule says a leaf beneath it, the leaf is
 *      the better answer. It may only refine downwards, never sideways.
 *
 * The publish gate at the end is the part that is new relative to how the
 * catalogue behaved before: a product the classifier cannot place stays draft.
 * An unplaceable product should be invisible to shoppers and visible to us,
 * not a live page in a bin category.
 */

export class Classifier {
  constructor(
    private readonly sql: Sql,
    readonly taxonomy: Taxonomy,
    private readonly opts: Required<Pick<ClassifierOptions, 'publishFloor' | 'classifierVersion'>> &
      ClassifierOptions
  ) {}

  private llmCalls = 0;

  async classify(input: ProductInput): Promise<ClassificationResult> {
    const sourceLabels = (input.sourceCategories ?? []).map((s) => s.label);
    const haystack = buildHaystack({
      title: input.title,
      brand: input.brand,
      sourceLabels,
      specs: input.specs,
      condition: input.condition,
    });

    const ruleRun = runRules(haystack);

    let stage: ClassificationStage = 'rule';
    let primaryPath: string | null = null;
    let confidence = 0;
    let agreement: ClassificationResult['agreement'] = null;
    let reason: ReviewReason | null = null;
    let conflicted = false;
    const detail: Record<string, unknown> = {};

    // ---- stage 1 -----------------------------------------------------------
    const sourced = await classifyFromSources(
      this.sql, this.taxonomy, input.sourceCategories ?? [],
      { productId: Number(input.productId) || null }
    );

    if (sourced) {
      const { winner, candidates } = sourced;
      agreement = sourced.agreement;
      stage = 'source';
      primaryPath = winner.categoryPath;
      confidence = agreement === 'agree'
        ? Math.min(DEFAULTS.maxConfidence, winner.confidence + DEFAULTS.agreementBonus)
        : winner.confidence;

      if (agreement === 'refine') {
        // Granularity, not disagreement: take the deeper node, but do not claim
        // more confidence than the source that actually reached that depth.
        const deepest = candidates.reduce((a, b) =>
          b.categoryPath.split('/').length > a.categoryPath.split('/').length ? b : a);
        primaryPath = deepest.categoryPath;
        confidence = Math.min(confidence, deepest.confidence);
      }

      if (agreement === 'conflict') conflicted = true;
      detail.sources = candidates;
    } else if ((input.sourceCategories ?? []).length > 0) {
      reason = 'unmapped_key';
    }

    // ---- stage 2 -----------------------------------------------------------
    if (!primaryPath && ruleRun.best) {
      primaryPath = ruleRun.best.category;
      confidence = ruleRun.best.confidence;
      stage = 'rule';
      reason = null;
    }

    // A deeper rule refines a shallower source match — downwards only.
    if (stage === 'source' && ruleRun.best && primaryPath &&
        ruleRun.best.category.startsWith(primaryPath + '/') &&
        ruleRun.best.confidence >= DEFAULTS.ruleRefineFloor) {
      primaryPath = ruleRun.best.category;
      confidence = Math.min(confidence, ruleRun.best.confidence);
    }

    if (ruleRun.best) {
      detail.rule = {
        id: ruleRun.best.rule.id,
        category: ruleRun.best.category,
        hits: ruleRun.best.hits,
        runnersUp: ruleRun.runnersUp.map((m) => ({ id: m.rule.id, category: m.category })),
      };
    }

    // ---- stage 3 (off by default) -----------------------------------------
    if (!primaryPath && llmEnabled() && this.llmCalls < (this.opts.llmBudget ?? 0)) {
      this.llmCalls++;
      const active = this.taxonomy.activePaths();
      const llm = await classifyWithModel(input, active, this.taxonomy.activeTagSlugs());
      detail.llm = { reasoning: llm.reasoning, confidence: llm.confidence };
      if (llm.categoryPath) {
        primaryPath = llm.categoryPath;
        confidence = llm.confidence;
        stage = 'llm';
        for (const slug of llm.tags) {
          if (!ruleRun.tags.some((t) => t.slug === slug)) {
            ruleRun.tags.push({ slug, confidence: llm.confidence, ruleId: 'llm' });
          }
        }
      }
    }

    if (!primaryPath && !reason) reason = 'no_rule';
    if (conflicted) reason = 'source_conflict';

    const node = primaryPath ? this.taxonomy.byPathOrNull(primaryPath) : null;
    if (primaryPath && !node) {
      // A rule or a map pointed at a path that is not in the tree. Treat it as
      // unplaced rather than guessing — and validateRules() should have caught
      // it at startup, so this is a loud condition, not a quiet one.
      detail.unknownPath = primaryPath;
      primaryPath = null;
    }

    const belowFloor = !node || confidence < this.opts.publishFloor;
    if (node && belowFloor && !reason) reason = 'low_confidence';

    const tags: TagAssignment[] = ruleRun.tags
      .filter((t) => this.taxonomy.tagId(t.slug) !== null)
      .map((t) => ({
        slug: t.slug,
        confidence: t.confidence,
        stage: t.ruleId === 'llm' ? ('llm' as const) : ('rule' as const),
      }));

    return {
      productId: input.productId,
      categoryId: node?.id ?? null,
      categoryPath: node?.path ?? null,
      ancestorIds: node ? this.taxonomy.ancestorsOf(node.path).map((a) => a.id) : [],
      tags,
      stage,
      confidence: node ? Number(confidence.toFixed(3)) : 0,
      agreement,
      needsReview: belowFloor || conflicted,
      reason,
      inputHash: hashInput(input, this.opts.classifierVersion),
      detail,
    };
  }
}

/**
 * An unchanged product is never re-classified. The hash covers everything the
 * classifier is allowed to read, plus the version, so bumping the version
 * invalidates every cached decision in one move.
 */
export function hashInput(input: ProductInput, version: string): string {
  return createHash('sha256')
    .update(JSON.stringify({
      v: version,
      t: input.title,
      b: input.brand ?? null,
      d: (input.description ?? '').slice(0, 500),
      s: (input.sourceCategories ?? []).map((s) => `${s.sourceKey}:${s.externalKey}`).sort(),
      sp: input.specs ?? {},
      c: input.condition ?? null,
    }))
    .digest('hex')
    .slice(0, 32);
}

export async function createClassifier(
  sql: Sql,
  opts: ClassifierOptions = {}
): Promise<Classifier> {
  const taxonomy = await Taxonomy.load(sql);

  // Fail loudly at startup rather than quietly at classification time: a rule
  // pointing at a category that does not exist would fire, win, and then place
  // nothing, which reads exactly like a rule that never matched.
  const problems = validateRules(taxonomy.allPaths());
  if (problems.length > 0) {
    throw new Error(
      `rules.seed.json has ${problems.length} broken rule(s):\n  ` + problems.join('\n  ')
    );
  }

  return new Classifier(sql, taxonomy, {
    publishFloor: opts.publishFloor ?? DEFAULTS.publishFloor,
    classifierVersion: opts.classifierVersion ?? DEFAULTS.classifierVersion,
    enableLlm: opts.enableLlm,
    llmBudget: opts.llmBudget ?? 0,
  });
}
