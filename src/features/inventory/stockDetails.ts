import { INVALID_QUANTITY_LABEL, formatDate, formatLiveStock } from '@/lib/format';

import { LOW_STOCK_THRESHOLD } from './inventoryStatus';

/**
 * What the Main Inventory "Stock details" sheet shows, worked out from data the screen already reads. Free of React so it can be
 * unit-tested. Nothing here invents a number: Main holds ONE stock balance per product. Options (variants) have no stock of
 * their own; a sold option takes pieces from the products listed in its recipe.
 */

// ---------------------------------------------------------------- the stock card

export type StockDisplay = {
  /** The big number, or the plain-words state when there is no number. */
  value: string;
  /** A line only when the value alone would mislead (a stored quantity that is not whole pieces); otherwise null. */
  note: string | null;
  tone: 'normal' | 'warning' | 'danger' | 'muted';
  /** The "Last updated" row. */
  updated: string;
};

type StockItem = { updated_at: string | null; quantity_on_hand: number | string };

/**
 * Four different things used to read alike ("Not set", "0 pcs", "Not initialized"):
 *  - not set: no stock row yet, so no opening stock was ever entered (the same "Not set" as the list pill and filter)
 *  - zero: counted, and none is left
 *  - low: counted, a few left
 *  - unavailable: the stored amount is not a whole number of pieces
 */
export function stockDisplay(item: StockItem): StockDisplay {
  if (item.updated_at == null) {
    return { value: 'Not set', note: null, tone: 'muted', updated: 'Never' };
  }
  const updated = formatDate(item.updated_at);
  const shown = formatLiveStock(item.quantity_on_hand);
  if (shown === INVALID_QUANTITY_LABEL) {
    return { value: 'Unavailable', note: 'The stored quantity is not a whole number of pieces.', tone: 'danger', updated };
  }
  const quantity = Number(item.quantity_on_hand);
  if (quantity <= 0) return { value: shown, note: null, tone: 'danger', updated };
  if (quantity <= LOW_STOCK_THRESHOLD) return { value: shown, note: null, tone: 'warning', updated };
  return { value: shown, note: null, tone: 'normal', updated };
}

// ---------------------------------------------------------------- the action

export type SendAction =
  | { kind: 'send'; label: string; hint: null }
  | { kind: 'opening'; label: string; hint: null }
  | { kind: 'blocked'; label: string; hint: string };

/**
 * Whether "Send stock" makes sense for this product. The database refuses a transfer of a disabled product and of more than
 * Main has on hand (a product never counted has nothing on hand), so offering the button there only leads to an error.
 */
export function sendAction(item: StockItem & { product: { is_active: boolean } }): SendAction {
  if (!item.product.is_active) {
    return { kind: 'blocked', label: 'Send stock', hint: "A disabled product can't be sent. Enable it in Products first." };
  }
  if (item.updated_at == null) {
    return { kind: 'opening', label: 'Set opening stock', hint: null };
  }
  if (Number(item.quantity_on_hand) <= 0) {
    return { kind: 'blocked', label: 'Send stock', hint: 'Main has none left to send.' };
  }
  return { kind: 'send', label: 'Send stock', hint: null };
}

// ---------------------------------------------------------------- prices

export type BranchRef = { id: string; name: string };
export type BranchPriceState = { branchId: string; branchName: string; state: 'priced' | 'off' | 'not_added'; price: number | null };
export type OptionPrices = { key: string; name: string; defaultPrice: number; retired: boolean; branches: BranchPriceState[] };
export type PriceSummary = {
  /** Stock only: not sold, so there is no price at all. */
  stockOnly: boolean;
  hasOptions: boolean;
  /** The price a branch gets when it first receives the product (the master price). Not what any branch charges today. */
  productDefault: number | null;
  /** Per selling branch, for a product without options. */
  product: BranchPriceState[];
  options: OptionPrices[];
};

type VariantLike = { id: string; name: string; default_price: number | string; is_active: boolean; sort_order: number };
type BranchProductLike = { branch_id: string; selling_price: number | string; is_active: boolean };
type BranchVariantLike = { branch_id: string; name: string; selling_price: number | string; is_active: boolean };

/**
 * Main does not sell, so there is no "Main price": the prices are the ones each selling branch charges. Per branch a price is
 * "priced" (sold there), "off" (the branch has it but switched off: the whole product, or just that option) or "not added"
 * (the branch has no row for it yet).
 */
export function buildPriceSummary(input: {
  product: { selling_price?: number | string | null; sell_in_pos?: boolean | null };
  variants: VariantLike[];
  branchProducts: BranchProductLike[];
  branchVariants: BranchVariantLike[];
  branches: BranchRef[];
}): PriceSummary {
  const stockOnly = input.product.sell_in_pos === false;
  const productRows = new Map(input.branchProducts.map((row) => [row.branch_id, row]));
  const optionRows = new Map(input.branchVariants.map((row) => [`${row.branch_id}|${row.name}`, row]));
  const productStates = input.branches.map<BranchPriceState>((branch) => {
    const row = productRows.get(branch.id);
    if (!row) return { branchId: branch.id, branchName: branch.name, state: 'not_added', price: null };
    return { branchId: branch.id, branchName: branch.name, state: row.is_active ? 'priced' : 'off', price: Number(row.selling_price) };
  });
  const options = [...input.variants]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map<OptionPrices>((variant) => ({
      key: variant.id,
      name: variant.name,
      defaultPrice: Number(variant.default_price),
      retired: !variant.is_active,
      branches: input.branches.map<BranchPriceState>((branch) => {
        const row = optionRows.get(`${branch.id}|${variant.name}`);
        if (!row) return { branchId: branch.id, branchName: branch.name, state: 'not_added', price: null };
        const wholeProductOff = productRows.get(branch.id)?.is_active === false;
        return { branchId: branch.id, branchName: branch.name, state: row.is_active && !wholeProductOff ? 'priced' : 'off', price: Number(row.selling_price) };
      }),
    }));
  return {
    stockOnly,
    hasOptions: options.length > 0,
    productDefault: input.product.selling_price == null ? null : Number(input.product.selling_price),
    product: productStates,
    options,
  };
}

// ---------------------------------------------------------------- what a sale takes from stock

export type UseRow = {
  key: string;
  /** The option's name, or "Each sale" for a product without options. */
  title: string;
  /** Pieces taken per sale, e.g. "Rice ×1". The product's own stock is named after the product. */
  items: string[];
  /** The drinks a cashier may pick from for this option (it comes out of that drink's own stock). */
  drinks: string[];
  usesOwnStock: boolean;
};

type StockUseLike = { variant_id: string | null; ingredient_product_id: string; quantity: number | string };
type DrinkChoiceLike = { variant_id: string; drink_product_id: string };

/**
 * The same resolution the database uses when a sale is confirmed: an option's own list, else the product-level list, else the
 * product itself x1. Options never get a stock balance; this only says which products a sale takes pieces from.
 */
export function buildUseRows(input: {
  product: { id: string; name: string };
  variants: Array<{ id: string; name: string; sort_order: number }>;
  stockUses: StockUseLike[];
  drinkChoices: DrinkChoiceLike[];
  nameOf: (productId: string) => string;
}): { rows: UseRow[]; ownStockUsed: boolean; sources: Array<{ id: string; name: string }> } {
  const { product, nameOf } = input;
  const label = (use: { ingredient_product_id: string; quantity: number | string }) =>
    `${use.ingredient_product_id === product.id ? product.name : nameOf(use.ingredient_product_id)} ×${Number(use.quantity)}`;
  const productLevel = input.stockUses.filter((use) => use.variant_id === null);
  const resolve = (variantId: string | null): { items: string[]; usesOwnStock: boolean } => {
    const own = variantId === null ? [] : input.stockUses.filter((use) => use.variant_id === variantId);
    const list = own.length > 0 ? own : productLevel;
    if (list.length === 0) return { items: [`${product.name} ×1`], usesOwnStock: true };
    return { items: list.map(label), usesOwnStock: list.some((use) => use.ingredient_product_id === product.id) };
  };
  const rows: UseRow[] = [];
  if (input.variants.length === 0) {
    rows.push({ key: 'product', title: 'Each sale', drinks: [], ...resolve(null) });
  } else {
    for (const variant of [...input.variants].sort((a, b) => a.sort_order - b.sort_order)) {
      const drinks = input.drinkChoices
        .filter((choice) => choice.variant_id === variant.id)
        .map((choice) => nameOf(choice.drink_product_id))
        .sort((a, b) => a.localeCompare(b));
      rows.push({ key: variant.id, title: variant.name, drinks, ...resolve(variant.id) });
    }
  }
  // the OTHER products a sale takes pieces from (Extra Rice -> Rice): where this product's stock really lives
  const sourceIds = new Set<string>();
  for (const row of rows) {
    const variantId = row.key === 'product' ? null : row.key;
    const own = variantId === null ? [] : input.stockUses.filter((use) => use.variant_id === variantId);
    for (const use of own.length > 0 ? own : productLevel) if (use.ingredient_product_id !== product.id) sourceIds.add(use.ingredient_product_id);
  }
  const sources = [...sourceIds].map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name));
  return { rows, ownStockUsed: rows.some((row) => row.usesOwnStock), sources };
}
