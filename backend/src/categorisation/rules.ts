import rulesSeed from './rules.seed.json' with { type: 'json' };

/**
 * STAGE 2 — the keyword / regex rule engine.
 *
 * Deterministic, inspectable, and deliberately kept in one JSON file so that
 * two developers new to TypeScript can read and edit the whole vocabulary
 * without touching code.
 *
 * It is explicitly the WEAKER tool for categories, which is why it sits behind
 * the source category maps rather than in front of them. It is the STRONGER
 * tool for lexical tags — "noise cancelling" is a property of the words in the
 * title, not of anyone's taxonomy — so tag rules always run, even when stage 1
 * has already placed the product.
 *
 * The `none` list is the single most valuable field in the format. Without it
 * a phone case is a phone and a TV wall bracket is a TV, because both say the
 * word. Every accessory trap in the test suite is a `none` list working.
 *
 * Dutch terms sit alongside English deliberately: they are INPUTS, matched
 * against Dutch listing titles on the way in. They are never shown to a
 * visitor, so they do not conflict with scoopt.nl reading entirely in English.
 */

export interface CategoryRule {
  id: string;
  /** A category path that must exist in the tree. Validated at load. */
  category: string;
  any: string[];
  all?: string[];
  none?: string[];
  confidence?: number;
  tags?: string[];
  priority?: number;
  enabled?: boolean;
}

export interface TagRule {
  id: string;
  tag: string;
  any: string[];
  all?: string[];
  none?: string[];
  confidence?: number;
  enabled?: boolean;
}

export interface RuleMatch {
  rule: CategoryRule;
  category: string;
  confidence: number;
  hits: string[];
}

export interface RuleRun {
  best: RuleMatch | null;
  runnersUp: RuleMatch[];
  tags: { slug: string; confidence: number; ruleId: string }[];
  haystack: string;
}

const CATEGORY_RULES = (rulesSeed as { categoryRules: CategoryRule[] }).categoryRules;
const TAG_RULES = (rulesSeed as { tagRules: TagRule[] }).tagRules;

export function categoryRules(): CategoryRule[] {
  return CATEGORY_RULES.filter((r) => r.enabled !== false);
}

export function tagRules(): TagRule[] {
  return TAG_RULES.filter((r) => r.enabled !== false);
}

/**
 * Lower-case, strip accents, collapse punctuation to single spaces.
 * Matching then happens on whole words against this one flat string, so
 * "Bluetooth-speaker" and "bluetooth speaker" behave identically.
 */
export function normalise(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Everything a rule is allowed to read, as one normalised string. */
export function buildHaystack(parts: {
  title: string;
  brand?: string | null;
  sourceLabels?: (string | null | undefined)[];
  specs?: Record<string, string>;
  condition?: string | null;
}): string {
  const bits = [
    parts.title,
    parts.brand ?? '',
    ...(parts.sourceLabels ?? []).map((s) => s ?? ''),
    ...Object.values(parts.specs ?? {}),
    parts.condition ?? '',
  ];
  return normalise(bits.join(' '));
}

function termMatches(term: string, haystack: string): boolean {
  if (term.startsWith('re:')) {
    try {
      return new RegExp(term.slice(3), 'i').test(haystack);
    } catch {
      return false; // a broken regex must not take the whole run down
    }
  }
  const t = normalise(term);
  if (!t) return false;
  // Whole-word match. The haystack is already space-normalised, so padding
  // both sides is a correct and much cheaper test than a built regex.
  //
  // Plural-tolerant, because listing titles are written by sellers and are
  // inconsistent about it. "storage box" must match "Storage Boxes", and — far
  // more importantly — the `none` guard "cover" must match "Sofa Covers", or a
  // set of sofa COVERS classifies as a sofa. Real misses from the first
  // production dry run, both directions.
  const padded = ` ${haystack} `;
  return padded.includes(` ${t} `)
      || padded.includes(` ${t}s `)
      || padded.includes(` ${t}es `);
}

function matchedTerms(terms: string[], haystack: string): string[] {
  return terms.filter((t) => termMatches(t, haystack));
}

/**
 * Base confidence, plus a small bonus for each extra matching term and for
 * longer (more specific) terms. Capped below 1 — and below the floor a mapped
 * source category can reach — so a rule can never outrank stage 1.
 */
function score(base: number, hits: string[]): number {
  const extra = Math.min(0.08, (hits.length - 1) * 0.03);
  const longest = Math.max(...hits.map((t) => normalise(t).length), 0);
  const specificity = longest >= 12 ? 0.04 : longest >= 8 ? 0.02 : 0;
  return Math.min(0.94, base + extra + specificity);
}

function passes(
  rule: { any: string[]; all?: string[]; none?: string[] },
  haystack: string
): string[] | null {
  if (rule.none && rule.none.some((t) => termMatches(t, haystack))) return null;
  if (rule.all && !rule.all.every((t) => termMatches(t, haystack))) return null;
  const hits = matchedTerms(rule.any, haystack);
  return hits.length > 0 ? hits : null;
}

/** Run every rule against one product. Category rules compete; tag rules do not. */
export function runRules(haystack: string): RuleRun {
  const matches: RuleMatch[] = [];

  for (const rule of categoryRules()) {
    const hits = passes(rule, haystack);
    if (!hits) continue;
    matches.push({
      rule,
      category: rule.category,
      confidence: score(rule.confidence ?? 0.78, hits),
      hits,
    });
  }

  // priority, then confidence, then depth — a deeper category is a more
  // specific answer and should win a tie against its own ancestor.
  matches.sort((a, b) =>
    (b.rule.priority ?? 0) - (a.rule.priority ?? 0) ||
    b.confidence - a.confidence ||
    b.category.split('/').length - a.category.split('/').length
  );

  const best = matches[0] ?? null;

  const tags: RuleRun['tags'] = [];
  const seen = new Set<string>();
  for (const rule of tagRules()) {
    const hits = passes(rule, haystack);
    if (!hits || seen.has(rule.tag)) continue;
    seen.add(rule.tag);
    tags.push({ slug: rule.tag, confidence: score(rule.confidence ?? 0.8, hits), ruleId: rule.id });
  }
  // Tags declared on the winning category rule are added as well.
  for (const slug of best?.rule.tags ?? []) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    tags.push({ slug, confidence: best!.confidence, ruleId: best!.rule.id });
  }

  return { best, runnersUp: matches.slice(1, 4), tags, haystack };
}

/**
 * Every rule must point at a real category. A typo would otherwise produce a
 * rule that fires, wins, and silently classifies nothing — the worst kind of
 * failure because it looks like the rule simply never matched.
 */
export function validateRules(knownPaths: Iterable<string>): string[] {
  const known = new Set(knownPaths);
  const problems: string[] = [];
  for (const rule of categoryRules()) {
    if (!known.has(rule.category)) {
      problems.push(`rule "${rule.id}" targets unknown category "${rule.category}"`);
    }
  }
  return problems;
}
