import { PRICE_PATTERN } from './productSchema';

/** What is wrong with a typed price, if anything. An empty field is only a problem once a save was tried. */
export function priceProblem(text: string): 'Invalid price' | 'Must be above ₱0' | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!PRICE_PATTERN.test(trimmed)) return 'Invalid price';
  return Number(trimmed) > 0 ? null : 'Must be above ₱0';
}

export type PriceFieldId = { field: string; card?: string };

/**
 * The first price, in the order the step shows them, that stops the save: empty, malformed or ₱0. `card` is the branch card it
 * sits in ("Different per Branch"), so the card (with its branch name) can be brought into view and not just the bare field.
 * A branch that is switched off has no price field and is skipped. Null when every price is fine (then the refusal was
 * something else, e.g. every branch is off).
 */
export function firstPriceToFix(input: {
  mode: 'same' | 'different';
  variants: Array<{ key: string }>;
  uniformBase: string;
  uniformPrices: Record<string, string>;
  branches: Array<{ id: string }>;
  branchOn: Record<string, boolean>;
  drafts: Record<string, { base: string; variantPrices: Record<string, string> }>;
}): PriceFieldId | null {
  const needsFixing = (value: string) => value.trim() === '' || priceProblem(value) !== null;
  const hasVariants = input.variants.length > 0;
  if (input.mode === 'same') {
    if (!hasVariants) return needsFixing(input.uniformBase) ? { field: 'same:base' } : null;
    const bad = input.variants.find((variant) => needsFixing(input.uniformPrices[variant.key] ?? ''));
    return bad ? { field: `same:${bad.key}` } : null;
  }
  for (const branch of input.branches) {
    if (input.branchOn[branch.id] === false) continue;
    const draft = input.drafts[branch.id] ?? { base: '', variantPrices: {} };
    if (!hasVariants) {
      if (needsFixing(draft.base)) return { field: `${branch.id}:base`, card: branch.id };
      continue;
    }
    const bad = input.variants.find((variant) => needsFixing(draft.variantPrices[variant.key] ?? ''));
    if (bad) return { field: `${branch.id}:${bad.key}`, card: branch.id };
  }
  return null;
}
