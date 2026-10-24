/**
 * Small, dependency-free helpers for the Create/Edit Product wizards (kept free of React and path aliases so
 * they can be unit-tested directly). Frontend only: nothing here touches saving, services, or the backend.
 */

export type PricingMode = 'same' | 'different';

/**
 * The preview-only settings the wizard keeps in local state. None of them are saved yet. (Stock Used Per Order and
 * Drink Choice are NOT among them any more: both are saved with the product.)
 */
export type PreviewConfigState = {
  category: string;
  /** The category a wizard starts with; choosing it again is not "using" the preview setting. */
  defaultCategory: string;
  /** "Available for sale in POS". Absent / true is the normal state; false is the (preview-only) inventory-only choice. */
  sellable?: boolean;
};

/** Staff-facing names of the preview-only settings the user has actually used. */
export function getUnsavedPreviewItems(state: PreviewConfigState): string[] {
  const items: string[] = [];
  if (state.category !== state.defaultCategory) items.push('Product Category');
  if (state.sellable === false) items.push('POS Availability');
  return items;
}

/** One short sentence for the pricing step, or null when no preview-only setting has been used. */
export function buildPreviewNotice(items: string[]): string | null {
  if (items.length === 0) return null;
  const list =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  return `Not saved yet: ${list}. Everything else is saved.`;
}

/**
 * Prices only count for the pricing mode that is selected. Both modes' inputs are kept in state so switching
 * back restores them, but a hidden mode must never leak into what is submitted.
 */
export function activeUniformBase(mode: PricingMode, uniformBase: string): string {
  return mode === 'same' ? uniformBase : '';
}

export function activeUniformPrice(
  mode: PricingMode,
  uniformPrices: Record<string, string>,
  key: string,
): string | undefined {
  return mode === 'same' ? uniformPrices[key] : undefined;
}

/** Whether the mode that is NOT selected still holds entered prices (to tell the user they're kept). */
export function otherModeHasPrices(
  mode: PricingMode,
  inputs: {
    uniformBase: string;
    uniformPrices: Record<string, string>;
    branchDrafts: Record<string, { base: string; variantPrices: Record<string, string> }>;
  },
): boolean {
  if (mode === 'same') {
    return Object.values(inputs.branchDrafts).some(
      (draft) => draft.base.trim() !== '' || Object.values(draft.variantPrices).some((price) => price.trim() !== ''),
    );
  }
  return (
    inputs.uniformBase.trim() !== '' || Object.values(inputs.uniformPrices).some((price) => price.trim() !== '')
  );
}

// ---- unsaved-changes detection

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => [key, normalize(inner)] as const)
      .filter(([, inner]) => {
        if (inner === '' || inner === false || inner == null) return false;
        if (Array.isArray(inner)) return inner.length > 0;
        if (typeof inner === 'object') return Object.keys(inner as object).length > 0;
        return true;
      })
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * A stable string for "what the user has entered". Empty values are dropped, so typing something and deleting
 * it again (or toggling a preview option on and off) ends up identical to the starting snapshot.
 */
export function buildDraftSnapshot(parts: Record<string, unknown>): string {
  return JSON.stringify(normalize(parts));
}

export type CloseDecision = 'close' | 'confirm';

/** Close straight away unless there are unsaved edits. A save that is in flight is never interrupted. */
export function decideClose(options: { dirty: boolean; submitting: boolean }): CloseDecision {
  return options.dirty && !options.submitting ? 'confirm' : 'close';
}

export const DISCARD_DIALOG = {
  title: 'Discard changes?',
  message: 'You have unsaved changes. If you close now, they will be lost.',
  cancel: 'Continue Editing',
  confirm: 'Discard Changes',
} as const;

// ---- product-level "Stock Used Per Order" (products without variants)

/** Key under which the product-level stock list is kept in the preview recipe state. */
export const PRODUCT_STOCK_KEY = '__product__';

/** Id of the "This Product" stock option (kept in sync with recipePreviewData by a test). */
export const MAIN_PRODUCT_ITEM_ID = 'this-product';

/**
 * Whether to start the product-level list with "This Product ×1". Only a brand-new, never-configured list is
 * seeded: once the key exists (even as an empty list the user cleared on purpose) it is left alone, and
 * products that have variants are never seeded.
 */
export function shouldSeedProductStock(options: {
  variantCount: number;
  autoAdd: boolean;
  current: unknown;
}): boolean {
  return options.variantCount === 0 && options.autoAdd && options.current === undefined;
}

/**
 * The automatic default (exactly "This Product ×1") is not something the user edited, so it is left out of the
 * unsaved-changes snapshot. Any other change (a different quantity, extra items) still counts.
 */
export function withoutDefaultProductStock<T extends Record<string, Array<{ itemId: string; quantity: number }>>>(
  recipes: T,
): Record<string, Array<{ itemId: string; quantity: number }>> {
  const lines = recipes[PRODUCT_STOCK_KEY];
  if (lines && lines.length === 1 && lines[0]!.itemId === MAIN_PRODUCT_ITEM_ID && lines[0]!.quantity === 1) {
    const rest: Record<string, Array<{ itemId: string; quantity: number }>> = { ...recipes };
    delete rest[PRODUCT_STOCK_KEY];
    return rest;
  }
  return recipes;
}

// ---- wizard flow (which steps a product goes through)

/**
 * full: Product Info → category-specific Step 2 → Branch Pricing.
 * simple: Product Info → Branch Pricing. Drinks, Extras & Sides and Inventory Supplies without variants are sold
 *   at one price and have nothing to set up in Step 2.
 * inventory: Product Info only (not sold in POS: no selling variants, no branch prices to configure).
 *
 * POS availability is its own choice: the flow is never inferred from the category, only from that choice.
 */
export type WizardFlow = 'full' | 'simple' | 'inventory';

/** Categories that skip Step 2 while they have no variants. An existing one with variants keeps all three steps. */
const SIMPLE_CATEGORIES: readonly string[] = ['drinks', 'extras', 'supplies'];

export function getWizardFlow(options: { sellable: boolean; category: string; variantCount: number }): WizardFlow {
  if (!options.sellable) return 'inventory';
  if (SIMPLE_CATEGORIES.includes(options.category) && options.variantCount === 0) return 'simple';
  return 'full';
}

/** Internal step ids shown in the indicator for a flow (Step 2 is internal id 2, Branch Pricing is 3). */
export function flowSteps(flow: WizardFlow): Array<1 | 2 | 3> {
  if (flow === 'inventory') return [1];
  if (flow === 'simple') return [1, 3];
  return [1, 2, 3];
}

// ---- inventory-only (preview-only until the backend can store POS availability)

/**
 * TEMPORARILY OFF. While false, the "Sell in POS" switch and the inventory-only one-step flow (with its disabled
 * save) are hidden, and every product goes through its normal category flow and can be saved. The component,
 * the flow rules and the messages below are kept so the feature can be switched back on once the backend can
 * store POS availability: set this to true and nothing else needs to change.
 */
export const POS_AVAILABILITY_ENABLED = false;

/**
 * The value the wizard actually uses for "sellable". While the feature is off this is always true, whatever the
 * stored choice is, so hidden state can never turn a product into an inventory-only one or block saving.
 */
export function resolveSellable(enabled: boolean, chosen: boolean): boolean {
  return enabled ? chosen : true;
}

export const INVENTORY_ONLY_MESSAGE = 'Stock only. Customers can\'t buy this in POS.';

/**
 * POS availability can't be stored yet, so an inventory-only product would just be saved as a normal product
 * (₱0.00 default price, no branch prices) and could still appear in POS. Rather than do that, saving is blocked.
 */
export const INVENTORY_ONLY_UNSUPPORTED_MESSAGE =
  'Stock-only products can\'t be saved yet. This is coming in a later update.';

/** Whether a flow may be saved. Inventory-only is not supported yet, so it never can. */
export function isSaveSupported(flow: WizardFlow): boolean {
  return flow !== 'inventory';
}

// ---- price field feedback (Step 3)

/**
 * Whether one price field should be flagged as "missing". Only once an error is showing, and only when the
 * same list already has some prices entered (a list the user hasn't started yet isn't flagged field by field).
 */
export function isPriceMissing(options: {
  showErrors: boolean;
  prices: Record<string, string>;
  keys: string[];
  key: string;
}): boolean {
  if (!options.showErrors) return false;
  const anyFilled = options.keys.some((key) => (options.prices[key] ?? '').trim() !== '');
  return anyFilled && (options.prices[options.key] ?? '').trim() === '';
}

// ---- first option card (Create, Meals and Snacks)

/**
 * Whether to open Step 2 with one blank option card ready. Only for a brand-new product with no options, and
 * only once per wizard: a product sold at one price removes the card and it is never added back. Edit never
 * calls this, so an existing product's variants are never touched.
 */
export function shouldOfferFirstOption(options: {
  startsWithOption: boolean;
  variantCount: number;
  alreadyOffered: boolean;
}): boolean {
  return options.startsWithOption && options.variantCount === 0 && !options.alreadyOffered;
}

// ---- Edit: pre-filled variant prices

/**
 * Pre-fills a per-variant price map for the Edit wizard. Step 3 reads these prices by each variant's DRAFT KEY
 * (the id the wizard generates for every row, including ones that exist in the database), never by the database
 * id. Keying by the database id leaves every saved price blank. Prices are matched to variants by name, and a
 * variant with no saved price gets '' so nothing is invented.
 */
export function seedVariantPrices(
  variants: ReadonlyArray<{ key: string; name: string }>,
  pricesByName: ReadonlyMap<string, number> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    variants.map((variant) => [variant.key, String(pricesByName?.get(variant.name) ?? '')]),
  );
}
