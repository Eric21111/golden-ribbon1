import { buildUseRows } from './stockDetails';

/**
 * Which products have no stock of their own to count: a product whose every sale takes only from OTHER products (Extra Rice takes
 * Rice x1). Worked out from the real deduction rules (an option's own list, else the product-level list, else the product itself
 * x1), never from the category, so a standalone product, a product that mixes its own stock with others, and an option with no
 * list of its own all still count their own stock.
 *
 * A product is also never "shared" when something else needs its own stock: another product lists it as an ingredient, or it is
 * offered as a drink choice. Free of React so it can be unit-tested.
 */
export type StockSetup = {
  /** Products whose own stock is not used by any sale (and not needed by another product). */
  shared: Set<string>;
  /** For those, the products their sales take from. */
  sources: Map<string, Array<{ id: string; name: string }>>;
};

type ProductLike = { id: string; name: string; sell_in_pos?: boolean | null };
type VariantLike = { id: string; product_id: string; name: string; sort_order: number };
type UseLike = { product_id: string; variant_id: string | null; ingredient_product_id: string; quantity: number | string };
type DrinkLike = { product_id: string; variant_id: string; drink_product_id: string };

export function buildStockSetup(input: {
  products: ProductLike[];
  variants: VariantLike[];
  stockUses: UseLike[];
  drinkChoices: DrinkLike[];
}): StockSetup {
  const names = new Map(input.products.map((product) => [product.id, product.name]));
  const nameOf = (id: string) => names.get(id) ?? 'Unknown item';
  const variantsOf = new Map<string, VariantLike[]>();
  for (const variant of input.variants) variantsOf.set(variant.product_id, [...(variantsOf.get(variant.product_id) ?? []), variant]);
  const usesOf = new Map<string, UseLike[]>();
  for (const use of input.stockUses) usesOf.set(use.product_id, [...(usesOf.get(use.product_id) ?? []), use]);

  // products another product takes pieces from, or offers as a drink: their own stock is real stock
  const neededByOthers = new Set<string>();
  for (const use of input.stockUses) if (use.ingredient_product_id !== use.product_id) neededByOthers.add(use.ingredient_product_id);
  for (const choice of input.drinkChoices) if (choice.drink_product_id !== choice.product_id) neededByOthers.add(choice.drink_product_id);

  const shared = new Set<string>();
  const sources = new Map<string, Array<{ id: string; name: string }>>();
  for (const product of input.products) {
    if (product.sell_in_pos === false || neededByOthers.has(product.id)) continue;
    const result = buildUseRows({
      product: { id: product.id, name: product.name },
      variants: variantsOf.get(product.id) ?? [],
      stockUses: usesOf.get(product.id) ?? [],
      drinkChoices: [],
      nameOf,
    });
    if (!result.ownStockUsed && result.sources.length > 0) {
      shared.add(product.id);
      sources.set(product.id, result.sources);
    }
  }
  return { shared, sources };
}

/**
 * Re-checking before a save: the entered quantities that now belong to products with no stock of their own (a recipe was changed
 * while the form was open). They are held back from the save, never silently dropped from the form, and the user is told.
 */
export function newlySharedEntries<T extends { product_id: string; quantity: string }>(entries: T[], shared: Set<string>): T[] {
  return entries.filter((entry) => Number(entry.quantity) > 0 && shared.has(entry.product_id));
}

/** The sentence shown when entries were held back by a re-check. */
export function staleEntriesNotice(names: string[]): string {
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return names.length === 1
    ? `${list} now takes its stock from other items, so its quantity was left out. Review the list and try again.`
    : `${list} now take their stock from other items, so their quantities were left out. Review the list and try again.`;
}
