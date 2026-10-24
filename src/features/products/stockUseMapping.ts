/**
 * Stock Used Per Order: wizard state <-> the p_stock_uses payload of create_complete_product /
 * update_complete_product, and the saved product_stock_uses rows.
 *
 * Kept free of React and path aliases so it can be unit-tested directly. It does not talk to the backend.
 *
 * Payload (sent as the COMPLETE recipe set of the product; see the 20261023110000 migration):
 *   { ingredient_product_id: "<products.id>" | "self", quantity: 1..99,
 *     variant_id?: "<product_variants.id>"   (an option that already exists)
 *     variant_name?: "<name>"                (a new option; resolved after it is created)
 *   }  — neither variant field = the product-level list (a product sold at one price)
 */
import { MAIN_PRODUCT_ITEM_ID, PRODUCT_STOCK_KEY } from './wizardGuards';

export type RecipeLineLike = { itemId: string; quantity: number };

export type StockUsePayload = {
  ingredient_product_id: string;
  quantity: number;
  variant_id?: string;
  variant_name?: string;
};

/** A saved row of product_stock_uses (what the wizard loads when editing). */
export type SavedStockUse = {
  variant_id: string | null;
  ingredient_product_id: string;
  quantity: number;
};

/** An option as the wizard knows it: its draft key, its database id (null while new) and its current name. */
export type WizardVariantRef = { key: string; id: string | null; name: string };

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;

function validLine(line: RecipeLineLike): boolean {
  return Number.isInteger(line.quantity) && line.quantity >= MIN_QUANTITY && line.quantity <= MAX_QUANTITY;
}

/** "This Product" is saved as "self": a new product has no id yet, and "self" always means the product itself. */
function ingredientRef(itemId: string): string {
  return itemId === MAIN_PRODUCT_ITEM_ID ? 'self' : itemId;
}

/** Exactly "This Product" x1: the same as having no recipe. */
export function isDefaultProductLevel(lines: RecipeLineLike[]): boolean {
  return lines.length === 1 && lines[0]!.itemId === MAIN_PRODUCT_ITEM_ID && lines[0]!.quantity === 1;
}

/**
 * Builds the complete payload from the wizard's recipe state. Only options that currently exist in the wizard are
 * included (a removed option's list goes with it). Existing options are referenced by id, so renaming one keeps
 * its list; new options by name.
 */
export function buildStockUsePayload(
  recipes: Record<string, RecipeLineLike[]>,
  variants: WizardVariantRef[],
): StockUsePayload[] {
  const payload: StockUsePayload[] = [];
  const seen = new Set<string>();
  const push = (scope: Pick<StockUsePayload, 'variant_id' | 'variant_name'>, line: RecipeLineLike) => {
    if (!validLine(line)) return;
    const ingredient = ingredientRef(line.itemId);
    const dedupe = `${scope.variant_id ?? scope.variant_name?.toLowerCase() ?? ''}|${ingredient}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    payload.push({ ingredient_product_id: ingredient, quantity: line.quantity, ...scope });
  };

  // The automatic default of a product without variants ("This Product" x1) is exactly what a product with no recipe
  // already does, so it is never saved: picking a category must not write a recipe nobody chose, and an unchanged
  // default is not a change. Any other product-level list is saved as entered.
  const productLevel = recipes[PRODUCT_STOCK_KEY] ?? [];
  if (!isDefaultProductLevel(productLevel)) for (const line of productLevel) push({}, line);
  for (const variant of variants) {
    const scope = variant.id ? { variant_id: variant.id } : { variant_name: variant.name.trim() };
    for (const line of recipes[variant.key] ?? []) push(scope, line);
  }
  return payload;
}

/**
 * Turns saved rows into the wizard's recipe state. Rows of an option that no longer exists in the wizard are left
 * out. The product's own id becomes "This Product". Each list is shown "This Product" first, then A to Z by item
 * name (nameOf), so reopening a product always shows the same order.
 */
export function savedStockUsesToRecipes(
  rows: SavedStockUse[],
  productId: string,
  variants: WizardVariantRef[],
  nameOf: (ingredientProductId: string) => string = (id) => id,
): Record<string, RecipeLineLike[]> {
  const keyByVariantId = new Map(variants.filter((variant) => variant.id).map((variant) => [variant.id as string, variant.key]));
  const recipes: Record<string, RecipeLineLike[]> = {};
  for (const row of rows) {
    const key = row.variant_id === null ? PRODUCT_STOCK_KEY : keyByVariantId.get(row.variant_id);
    if (!key) continue;
    const line = {
      itemId: row.ingredient_product_id === productId ? MAIN_PRODUCT_ITEM_ID : row.ingredient_product_id,
      quantity: Number(row.quantity),
    };
    (recipes[key] ??= []).push(line);
  }
  // "This Product" first in every list, then the rest A to Z (ties by id), whatever order they were saved in
  for (const key of Object.keys(recipes)) {
    const lines = recipes[key]!;
    const others = lines
      .filter((l) => l.itemId !== MAIN_PRODUCT_ITEM_ID)
      .sort((a, b) => nameOf(a.itemId).localeCompare(nameOf(b.itemId)) || a.itemId.localeCompare(b.itemId));
    recipes[key] = [...lines.filter((l) => l.itemId === MAIN_PRODUCT_ITEM_ID), ...others];
  }
  return recipes;
}

/** Order-independent form of a payload, for "did the recipes change?". */
export function canonicalStockUses(payload: StockUsePayload[]): string {
  return JSON.stringify(
    payload
      .map((use) => [use.variant_id ?? (use.variant_name ? `n:${use.variant_name.toLowerCase()}` : ''), use.ingredient_product_id, use.quantity] as const)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

/**
 * What to send as p_stock_uses when saving an EDIT. undefined = leave every saved recipe untouched (nothing about
 * the recipes changed, so an unrelated edit can never rewrite or lose them). Otherwise the complete new set, which
 * replaces the saved one, and an empty array removes them all.
 */
export function stockUsesForSave(baselineCanonical: string, current: StockUsePayload[]): StockUsePayload[] | undefined {
  return canonicalStockUses(current) === baselineCanonical ? undefined : current;
}
