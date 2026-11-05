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
 * update_complete_product writes every branch it is SENT: it upserts the branch row and each option row and sets them ON
 * (`is_active = true`) on conflict. It never touches a branch that is not sent. So:
 *   - a branch whose prices the user did not change is simply not sent, which leaves its row, prices and any option that was
 *     switched off there exactly as they are;
 *   - a branch that IS sent comes back fully on, so whatever was switched off there is switched off again afterwards through the
 *     existing configure_branch_products / configure_branch_product_variants functions (see KeepOff).
 * Pure and free of React so it can be unit-tested directly. It does not talk to the backend.
 */

/** What to switch back OFF at one branch after the product was saved. Prices are the ones just saved. */
export type KeepOff = {
  branchId: string;
  /** The branch had the whole product switched off. */
  productOff: boolean;
  /** The price the product row was just saved with (the first option's price for a product with options). */
  productPrice: string;
  /** Options that were off at this branch, under their CURRENT names, with the price just saved. */
  offOptions: Array<{ name: string; price: string }>;
};

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
  product: Map<string, { price: number; on: boolean }>;
  options: Map<string, Map<string, { price: number; active: boolean }>>;
  originalName: Map<string, string>;
};

function indexSource(input: Pick<BranchSaveInput, 'sourceVariants' | 'sourceBranchPrices' | 'sourceBranchVariantPrices'>): SourceState {
  const product = new Map(
    input.sourceBranchPrices.map((row) => [row.branch_id, { price: Number(row.selling_price), on: row.is_active !== false }]),
  );
  const options = new Map<string, Map<string, { price: number; active: boolean }>>();
  for (const row of input.sourceBranchVariantPrices) {
    const byName = options.get(row.branch_id) ?? new Map();
    byName.set(row.name, { price: Number(row.selling_price), active: row.is_active !== false });
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
 * Splits the submitted prices into the branches that must be sent and what to keep switched off afterwards.
 * A branch is left out when it already carries the product with exactly these prices. Anything new (a branch that did not
 * carry it, a new option, a changed price) is sent.
 */
export function planBranchSave(input: BranchSaveInput): { send: BranchPricingDraft[]; keepOff: KeepOff[] } {
  const source = indexSource(input);
  const send: BranchPricingDraft[] = [];
  const keepOff: KeepOff[] = [];

  for (const draft of input.pricing) {
    const product = source.product.get(draft.branchId);
    let unchanged: boolean;
    if (draft.variants === undefined) {
      unchanged = product !== undefined && Number(draft.selling_price) === product.price;
    } else {
      // The option rows themselves say whether the branch already carries every option at exactly these prices.
      unchanged = draft.variants.every((entry) => {
          const name = savedName(source, input.variants, entry.name);
          const row = name === null ? undefined : source.options.get(draft.branchId)?.get(name);
        return row !== undefined && row.price === Number(entry.selling_price);
      });
    }
    if (unchanged) continue;
    send.push(draft);

    const productOff = product !== undefined && !product.on;
    const offOptions: KeepOff['offOptions'] = [];
    for (const entry of draft.variants ?? []) {
      const name = savedName(source, input.variants, entry.name);
      const row = name === null ? undefined : source.options.get(draft.branchId)?.get(name);
      if (row && !row.active) offOptions.push({ name: entry.name, price: entry.selling_price });
    }
    if (productOff || offOptions.length > 0) {
      keepOff.push({
        branchId: draft.branchId,
        productOff,
        productPrice: draft.selling_price ?? draft.variants?.[0]?.selling_price ?? '0.00',
        offOptions,
      });
    }
  }
  return { send, keepOff };
}

/** Plain sentences for Step 3: what is switched off at which branch (and stays off when the product is saved). */
export function keptOffNotes(
  branches: Array<{ id: string; name: string }>,
  input: Pick<BranchSaveInput, 'variants' | 'sourceVariants' | 'sourceBranchPrices' | 'sourceBranchVariantPrices'>,
): string[] {
  const source = indexSource(input);
  const notes: string[] = [];
  for (const branch of branches) {
    const product = source.product.get(branch.id);
    if (product && !product.on) {
      notes.push(`The product is switched off at ${branch.name}.`);
      continue;
    }
    const off = input.variants
      .map((variant) => {
        if (variant.id === null) return null;
        const name = source.originalName.get(variant.id);
        const row = name === undefined ? undefined : source.options.get(branch.id)?.get(name);
        return row && !row.active ? variant.name.trim() || name : null;
      })
      .filter((name): name is string => Boolean(name));
    if (off.length > 0) notes.push(`${off.join(', ')} ${off.length === 1 ? 'is' : 'are'} switched off at ${branch.name}.`);
  }
  return notes;
}

/** Names of the selling branches that do not carry the product yet ("Same for All" would add it to them). */
export function branchesToAdd(
  branches: Array<{ id: string; name: string }>,
  input: Pick<BranchSaveInput, 'sourceBranchPrices' | 'sourceBranchVariantPrices'>,
): string[] {
  const carried = new Set([...input.sourceBranchPrices.map((row) => row.branch_id), ...input.sourceBranchVariantPrices.map((row) => row.branch_id)]);
  return branches.filter((branch) => !carried.has(branch.id)).map((branch) => branch.name);
}
