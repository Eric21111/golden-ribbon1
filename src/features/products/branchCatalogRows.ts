import { formatMoney } from '@/lib/format';
import type { BranchProduct, BranchProductVariant, Product } from '@/types/models';

/**
 * Branch Catalogs: one row per product LISTED at a branch. "Listed" means the branch has a catalog row for the product
 * (branch_products) and it is switched on. That is all the list asks. It does not mean the product is on the cashier menu: the
 * POS also needs the product enabled and shown in the POS (see inPos below). And being on the menu is not a promise that it can
 * be sold: the POS lists items with no stock too (as "Out of stock"), and a meal can run short of a recipe ingredient.
 *
 * Kept free of React and path aliases beyond format so it can be unit-tested directly.
 */

export type CatalogOption = { name: string; price: number; active: boolean };

export type CatalogBadge = {
  key: 'disabled' | 'stock_only' | 'options_off' | 'no_options';
  label: string;
  tone: 'neutral' | 'warning';
};

export type CatalogRow = {
  product: Product;
  entry: BranchProduct;
  /** The branch's options for this product (branch_product_variants), A to Z. Empty for a product sold at one price. */
  options: CatalogOption[];
  /** Price text for the card: "₱20.00", or "₱70–₱85" when the options are priced differently. */
  priceText: string;
  /** The lowest price shown, for sorting. A product with no active option sorts last. */
  lowPrice: number;
  /**
   * The product has configured options but none is active at this branch (all off, or none set up here). The database then keeps
   * it off the cashier menu and refuses checkout; it never falls back to the stored base price.
   */
  noActiveOption: boolean;
  /** Options that are switched on at this branch. */
  activeOptionCount: number;
  badges: CatalogBadge[];
  /**
   * Whether the cashier POS lists it on its menu at this branch: the product is enabled, shown in POS, and (when it has
   * configured options) has at least one active option here. (The POS also needs the branch row on and the branch active, which a
   * listed row already satisfies.) This is menu visibility only. Stock and recipe ingredients are NOT part of it: this screen
   * cannot read another branch's stock, and the POS lists items with no stock too.
   */
  inPos: boolean;
};

const NO_PRICE_SORTS_LAST = 1e12;
const peso = (value: number) => formatMoney(value);
/** "₱70–₱85" for whole pesos, "₱70.50–₱85.00" otherwise. Equal prices collapse to one. */
export function formatPriceRange(low: number, high: number): string {
  if (low === high) return peso(low);
  const whole = Number.isInteger(low) && Number.isInteger(high);
  const short = (value: number) => (whole ? peso(value).replace(/\.00$/, '') : peso(value));
  return `${short(low)}–${short(high)}`;
}

/**
 * `productIdsWithOptions` is every product that has configured options (any master option, from product_variants). A product is
 * also treated as having options when the branch has option rows for it. Without the list, a product whose branch has NO option
 * rows cannot be told from a single-price product, so pass it whenever it is available.
 */
export function buildCatalogRows(
  products: Product[],
  entries: BranchProduct[],
  branchVariants: BranchProductVariant[],
  productIdsWithOptions: Iterable<string> = [],
): CatalogRow[] {
  const withOptions = new Set(productIdsWithOptions);
  const entryByProduct = new Map(entries.map((entry) => [entry.product_id, entry]));
  const optionsByProduct = new Map<string, CatalogOption[]>();
  for (const variant of branchVariants) {
    const list = optionsByProduct.get(variant.product_id) ?? [];
    list.push({ name: variant.name, price: Number(variant.selling_price), active: variant.is_active });
    optionsByProduct.set(variant.product_id, list);
  }

  const rows: CatalogRow[] = [];
  for (const product of products) {
    const entry = entryByProduct.get(product.id);
    // The visibility rule, unchanged: a row for this branch that is switched on. Nothing else decides it.
    if (!entry?.is_active) continue;

    const options = (optionsByProduct.get(product.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const active = options.filter((option) => option.active);
    const noActiveOption = (withOptions.has(product.id) || options.length > 0) && active.length === 0;
    const prices = active.length > 0 ? active.map((option) => option.price) : [Number(entry.selling_price)];
    const low = Math.min(...prices);
    const high = Math.max(...prices);

    const badges: CatalogBadge[] = [];
    if (!product.is_active) badges.push({ key: 'disabled', label: 'Disabled', tone: 'neutral' });
    if (product.sell_in_pos === false) badges.push({ key: 'stock_only', label: 'Stock only', tone: 'neutral' });
    const off = options.length - active.length;
    if (options.length > 0 && off > 0) {
      badges.push({
        key: 'options_off',
        label: active.length === 0 ? 'All options off' : `${off} ${off === 1 ? 'option' : 'options'} off`,
        tone: 'warning',
      });
    } else if (noActiveOption) {
      badges.push({ key: 'no_options', label: 'No options here', tone: 'warning' });
    }

    rows.push({
      product,
      entry,
      options,
      // never the stored base price for a product that cannot be sold at this branch without an option
      priceText: noActiveOption ? 'No active option' : formatPriceRange(low, high),
      lowPrice: noActiveOption ? NO_PRICE_SORTS_LAST : low,
      noActiveOption,
      activeOptionCount: active.length,
      badges,
      inPos: product.is_active && product.sell_in_pos !== false && !noActiveOption,
    });
  }
  return rows;
}

/** "6 products listed at SM1" or "6 products listed at SM1 · 2 not in POS". */
export function catalogSummary(rows: CatalogRow[], branchName: string): string {
  const notInPos = rows.filter((row) => !row.inPos).length;
  const base = `${rows.length} ${rows.length === 1 ? 'product' : 'products'} listed at ${branchName}`;
  return notInPos > 0 ? `${base} · ${notInPos} not in POS` : base;
}

/** Plain sentences for the detail sheet: whether the cashier POS lists it at the branch, and what that does not promise. */
export function posLines(row: CatalogRow, branchName: string): string[] {
  const lines: string[] = [];
  if (!row.product.is_active) lines.push('The product is disabled, so it is not in the cashier POS.');
  if (row.product.sell_in_pos === false) lines.push('It is stock only, so it is not in the cashier POS.');
  if (row.noActiveOption) {
    lines.push(
      row.options.length > 0
        ? `Every option is off at ${branchName}, so it is not in the cashier POS and cannot be sold until one is turned on.`
        : `It has options, but none are set up at ${branchName}, so it is not in the cashier POS and cannot be sold until one is.`,
    );
  }
  if (row.inPos) {
    lines.push(
      `In the cashier POS at ${branchName}. That does not guarantee enough stock or recipe ingredients: the POS shows "Out of stock" when it runs short.`,
    );
  }
  return lines;
}

/** Empty-state copy. A listing is a branch row, not availability, so the words say what is actually missing. */
export function catalogEmptyState(branchName: string, hasSearch: boolean): { title: string; message: string } {
  if (hasSearch) return { title: 'No matches', message: 'Try another name or SKU.' };
  return {
    title: `Nothing listed at ${branchName}`,
    message:
      'A product is listed here once it has a price at this branch, or once stock of a priced product that is sold in POS is sent to it. Set a branch price in Products, or send stock from Inventory.',
  };
}
