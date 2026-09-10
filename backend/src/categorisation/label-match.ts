import { normalise, runRules } from './rules';
import type { Taxonomy } from './taxonomy';

/**
 * MATCHING A SOURCE'S CATEGORY NAME TO ONE OF OURS.
 *
 * This is what turns "map two hundred categories by hand" into "review a list
 * someone else drafted". eBay calls a node "Headphones"; we have a node called
 * "Audio & Headphones" at tech/audio-headphones. A human would match those in
 * a second, and so can we — the hard part is doing it without inventing
 * matches that are merely plausible.
 *
 * Three signals, strongest first:
 *
 *   1. The source's full breadcrumb run through our own RULE ENGINE. This is
 *      the strongest because the rules already encode a lot of vocabulary, in
 *      two languages, with accessory guards. "Consumer Electronics > Portable
 *      Audio & Headphones > Headphones" fires the headphones rule.
 *   2. Exact name match against one of our node names or slugs.
 *   3. Token overlap between their leaf name and our node name, which catches
 *      "Laptops & Netbooks" -> "Laptops & Computers".
 *
 * Anything that clears the floor is PROPOSED, never silently accepted: the
 * proposal is written with a lower confidence and reviewed_by = 'auto', so a
 * person can see exactly which mappings nobody has checked.
 */

export interface LabelMatch {
  categoryPath: string;
  confidence: number;
  how: 'rule' | 'exact-name' | 'token-overlap';
  evidence: string;
}

/** Words that carry no signal about which shelf something belongs on. */
const STOP = new Set([
  'and', 'other', 'others', 'accessories', 'accessory', 'parts', 'supplies',
  'items', 'products', 'general', 'misc', 'miscellaneous', 'more', 'all',
  'en', 'overig', 'overige', 'onderdelen', 'de', 'het', 'van', 'voor',
]);

const tokens = (s: string): string[] =>
  normalise(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t));

export function matchLabelToCategory(
  taxonomy: Taxonomy,
  leafLabel: string,
  breadcrumb?: string | null
): LabelMatch | null {
  const leaf = (leafLabel ?? '').trim();
  if (!leaf) return null;

  // ---- 1. our own rule engine, over their breadcrumb -----------------------
  // The breadcrumb carries more context than the leaf alone, and the rules
  // already know two languages' worth of vocabulary.
  const haystack = normalise(`${breadcrumb ?? ''} ${leaf}`);
  const run = runRules(haystack);
  if (run.best && taxonomy.byPathOrNull(run.best.category)) {
    return {
      categoryPath: run.best.category,
      // Below a human-reviewed mapping (0.900) on purpose.
      confidence: Math.min(0.85, run.best.confidence),
      how: 'rule',
      evidence: `rule "${run.best.rule.id}" matched ${run.best.hits.join(', ')}`,
    };
  }

  // ---- 2. exact name or slug -----------------------------------------------
  const leafNorm = normalise(leaf);
  for (const path of taxonomy.allPaths()) {
    const node = taxonomy.byPathOrNull(path)!;
    if (normalise(node.name) === leafNorm || normalise(node.slug) === leafNorm) {
      return {
        categoryPath: node.path,
        confidence: 0.85,
        how: 'exact-name',
        evidence: `their "${leaf}" == our "${node.name}"`,
      };
    }
  }

  // ---- 3. token overlap ----------------------------------------------------
  // "Laptops & Netbooks" vs "Laptops & Computers": one shared meaningful word
  // out of two is a reasonable proposal, not a certainty.
  const theirs = new Set(tokens(leaf));
  if (theirs.size === 0) return null;

  let best: { path: string; score: number; shared: string[] } | null = null;
  for (const path of taxonomy.allPaths()) {
    const node = taxonomy.byPathOrNull(path)!;
    // Only ever propose a LEAF of ours; a root like "tech" would match half
    // of everything and teach the system nothing.
    if (node.depth === 0) continue;

    const ours = new Set([...tokens(node.name), ...tokens(node.slug)]);
    const shared = [...theirs].filter((t) => ours.has(t));
    if (shared.length === 0) continue;

    // Proportion of THEIR words we account for, so a one-word category name
    // matching one word scores higher than one word out of five.
    const score = shared.length / theirs.size;
    if (!best || score > best.score) best = { path: node.path, score, shared };
  }

  if (!best || best.score < 0.5) return null;

  return {
    categoryPath: best.path,
    // 0.62–0.75: usable, but visibly weaker than a rule match, and well below
    // anything a person has confirmed.
    confidence: Math.min(0.75, 0.6 + best.score * 0.15),
    how: 'token-overlap',
    evidence: `shared: ${best.shared.join(', ')}`,
  };
}
