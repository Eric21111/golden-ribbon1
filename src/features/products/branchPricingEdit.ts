import type {
  BranchPricingDraft,
  EditProductSourceBranchPrice,
  EditProductSourceBranchVariantPrice,
  EditProductSourceVariant,
  EditProductVariantValue,
} from './EditProductWizard';

/**
 * Edit Product and branch availability.
 *
 * update_complete_product writes every branch it is SENT and keeps whatever is switched off there (existing rows keep their
 * is_active flag; only a branch or option that is new comes in on). A branch whose prices did not change is not sent at all, so it
 * is not written or locked for nothing.
 * Pure and free of React so it can be unit-tested directly. It does not talk to the backend.
 */

export type BranchSaveInput = {
  /** The branches the wizard would send (all submitted prices, changed or not). */
  pricing: BranchPricingDraft[];
  /** The options being saved, in order (the first is the default option). `id: null` is a new option. */
  variants: EditProductVariantValue[];
  sourceVariants: EditProductSourceVariant[];
  sourceBranchPrices: EditProductSourceBranchPrice[];
  sourceBranchVariantPrices: EditProductSourceBranchVariantPrice[];
};

type SourceState = {
  product: Map<string, { price: number }>;
  options: Map<string, Map<string, { price: number }>>;
  originalName: Map<string, string>;
};

function indexSource(input: Pick<BranchSaveInput, 'sourceVariants' | 'sourceBranchPrices' | 'sourceBranchVariantPrices'>): SourceState {
  const product = new Map(
    input.sourceBranchPrices.map((row) => [row.branch_id, { price: Number(row.selling_price) }]),
  );
  const options = new Map<string, Map<string, { price: number }>>();
  for (const row of input.sourceBranchVariantPrices) {
    const byName = options.get(row.branch_id) ?? new Map();
    byName.set(row.name, { price: Number(row.selling_price) });
    options.set(row.branch_id, byName);
  }
  const originalName = new Map(input.sourceVariants.map((variant) => [variant.id, variant.name]));
  return { product, options, originalName };
}

/** The option's name as it is saved in the branch rows today (a renamed option still has its old name there until the save). */
function savedName(source: SourceState, variants: EditProductVariantValue[], currentName: string): string | null {
  const variant = variants.find((entry) => entry.name.trim() === currentName);
  if (!variant || variant.id === null) return null;
  return source.originalName.get(variant.id) ?? null;
}

/**
 * The submitted prices that need writing. A branch is left out when it already carries the product with exactly these prices.
 * Anything new (a branch that did not carry it, a new option, a changed price) is sent.
 */
export function branchesToSend(input: BranchSaveInput): BranchPricingDraft[] {
  const source = indexSource(input);
  return input.pricing.filter((draft) => {
    if (draft.variants === undefined) {
      const product = source.product.get(draft.branchId);
      return !(product !== undefined && Number(draft.selling_price) === product.price);
    }
    // The option rows themselves say whether the branch already carries every option at exactly these prices.
    const unchanged = draft.variants.every((entry) => {
      const name = savedName(source, input.variants, entry.name);
      const row = name === null ? undefined : source.options.get(draft.branchId)?.get(name);
      return row !== undefined && row.price === Number(entry.selling_price);
    });
    return !unchanged;
  });
}

/** Names of the selling branches that do not carry the product yet ("Same for All" would add it to them). */
export function branchesToAdd(
  branches: Array<{ id: string; name: string }>,
  input: Pick<BranchSaveInput, 'sourceBranchPrices' | 'sourceBranchVariantPrices'>,
): string[] {
  const carried = new Set([...input.sourceBranchPrices.map((row) => row.branch_id), ...input.sourceBranchVariantPrices.map((row) => row.branch_id)]);
  return branches.filter((branch) => !carried.has(branch.id)).map((branch) => branch.name);
}

/**
 * The branches that already carry the product the way this screen prices it: a product with options is carried where it has
 * option rows, one without options where it has a branch row. (A branch row with no option rows is NOT carried yet: its options
 * still have to be set up there.)
 */
export function branchesCarrying(
  input: Pick<BranchSaveInput, 'sourceVariants' | 'sourceBranchPrices' | 'sourceBranchVariantPrices'>,
): string[] {
  const rows = input.sourceVariants.length > 0 ? input.sourceBranchVariantPrices : input.sourceBranchPrices;
  return [...new Set(rows.map((row) => row.branch_id))];
}

/**
 * What is switched off today at the branches that carry the product, so the pricing cards can say so: the whole product at a
 * branch, and which options (by their key in the wizard) at a branch. Saving never changes either.
 */
export function switchedOffAtBranches(
  input: Pick<BranchSaveInput, 'sourceVariants' | 'sourceBranchPrices' | 'sourceBranchVariantPrices'>,
  variants: Array<{ key: string; id: string | null }>,
): { productOff: string[]; optionsOff: Record<string, string[]> } {
  const productOff = input.sourceBranchPrices.filter((row) => row.is_active === false).map((row) => row.branch_id);
  const optionsOff: Record<string, string[]> = {};
  const originalName = new Map(input.sourceVariants.map((variant) => [variant.id, variant.name]));
  for (const row of input.sourceBranchVariantPrices) {
    if (row.is_active !== false) continue;
    const match = variants.find((variant) => variant.id !== null && originalName.get(variant.id) === row.name);
    if (!match) continue;
    (optionsOff[row.branch_id] ??= []).push(match.key);
  }
  return { productOff, optionsOff };
}
