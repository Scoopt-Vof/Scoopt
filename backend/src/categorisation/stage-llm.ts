import type { ProductInput } from './types';

/**
 * STAGE 3 — the model fallback.
 *
 * SHIPPED DISABLED, and that is a decision rather than an oversight.
 *
 * Stages 1 and 2, with eBay's categoryId mapped, should resolve the great
 * majority of a deliberately narrow catalogue. Stage 3 brings an API key, a
 * per-run budget, a cache, and a new failure mode, for a tail nobody has
 * measured yet. Turn it on when source_category_unmapped and the 'no_rule'
 * review rows prove it is needed — not before.
 *
 * When it IS enabled, three constraints keep it honest:
 *   * it must copy a path from OUR list, character for character, or say
 *     "unknown" — anything else is discarded rather than trusted;
 *   * its confidence is clamped to 0.90, below the floor a mapped source
 *     category reaches, so it can never outrank stage 1;
 *   * it is called from the backfill, never from the ingest path, which must
 *     not block on a network round trip per product.
 *
 * No new dependency: this is the Anthropic Messages API over plain fetch.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.CLASSIFIER_MODEL ?? 'claude-sonnet-4-5';

const SYSTEM_PROMPT = `You classify retail products for scoopt, a Dutch price-comparison site.

You will be given a product and two closed lists: allowed category paths and allowed tag slugs.

Rules:
- Choose exactly ONE category path, copied character-for-character from the allowed list.
- If no path is a good fit, return "unknown" for category. Do not invent a path.
- Choose zero or more tag slugs, copied character-for-character from the list.
- Accessories belong with accessories: a phone case is not a phone, a TV wall bracket is not a TV.
- Judge only from the product data given. Do not guess at brand, price or retailer.
- confidence is your own honest 0-1 estimate that a careful human would agree.

Reply with JSON only, no prose, in this exact shape:
{"category":"<path or unknown>","tags":["slug"],"confidence":0.0,"reasoning":"one short sentence"}`;

export interface LlmResult {
  categoryPath: string | null;
  tags: string[];
  confidence: number;
  reasoning?: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function llmEnabled(): boolean {
  return process.env.CLASSIFIER_LLM === '1' && Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function classifyWithModel(
  input: ProductInput,
  allowedPaths: string[],
  allowedTags: string[]
): Promise<LlmResult> {
  const empty: LlmResult = { categoryPath: null, tags: [], confidence: 0 };
  if (!llmEnabled()) return empty;

  const body = {
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        product: {
          title: input.title,
          brand: input.brand ?? null,
          description: (input.description ?? '').slice(0, 600),
          specs: input.specs ?? {},
          condition: input.condition ?? null,
        },
        allowedCategoryPaths: allowedPaths,
        allowedTagSlugs: allowedTags,
      }),
    }],
  };

  let parsed: Record<string, any>;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as { content?: { text?: string }[] };
    const text = json.content?.[0]?.text ?? '';
    parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    // A model that is down, rate-limited or babbling must not fail the run.
    return empty;
  }

  const path = typeof parsed.category === 'string' ? parsed.category : null;
  const valid = Boolean(path) && path !== 'unknown' && allowedPaths.includes(path!);

  return {
    categoryPath: valid ? path : null,
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: unknown): t is string => typeof t === 'string' && allowedTags.includes(t))
      : [],
    // Never let the model claim more certainty than a mapped source category.
    confidence: valid ? clamp(Number(parsed.confidence) || 0.6, 0, 0.9) : 0,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 200) : undefined,
  };
}
