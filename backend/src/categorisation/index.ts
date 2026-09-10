/**
 * The categorisation system — one import surface.
 *
 *   import { createClassifier, persistClassification, extractEbayCategory }
 *     from './categorisation/index';
 *
 * Everything else in this folder is an implementation detail. If you find
 * yourself importing a deeper path in application code, that is a sign the
 * surface is missing something.
 */
export { createClassifier, Classifier, hashInput } from './classify';
export { persistClassification, alreadyClassified } from './persist';
export { Taxonomy } from './taxonomy';
export type { CategoryNode } from './taxonomy';
export {
  extractIcecatCategory, extractEbayCategory, classifyFromSources,
} from './stage-source';
export { runRules, buildHaystack, normalise, validateRules, categoryRules, tagRules } from './rules';
export { llmEnabled } from './stage-llm';
export type {
  ProductInput, SourceCategorySignal, ClassificationResult,
  ClassificationStage, Agreement, ReviewReason, ClassifierOptions,
} from './types';
export { DEFAULTS } from './types';
