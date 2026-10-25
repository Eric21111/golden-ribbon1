/**
 * Stock Used Per Order — data helpers for the Create/Edit Product wizards.
 *
 * The stock items are REAL products (their ids are what gets saved in product_stock_uses). The wizard keeps each
 * variant's list in local state and sends it with the product; see stockUseMapping.ts.
 *
 * Drink Choice (below) also uses real products and is saved with the product; see drinkChoiceMapping.ts.
 */

export type RecipeUnit = { singular: string; plural: string };

export type InventoryItemOption = {
  id: string;
  name: string;
  unit: RecipeUnit;
  /** Short note shown in the picker, e.g. what one unit means. */
  hint?: string;
  /** Sell in POS is off, or the product was saved as an inventory supply. */
  stockOnly?: boolean;
  /** Saved category is Drinks. Meal choices must not offer meals or supplies. */
  isDrink?: boolean;
};

/** One inventory item used by a variant, and how many whole stock units each order uses. */
export type RecipeLine = { itemId: string; quantity: number };

export const MAX_RECIPE_QUANTITY = 99;

/** Inventory is tracked in pieces. Egg is the one exception: it is counted in half-egg units. */
const PCS: RecipeUnit = { singular: 'pc', plural: 'pcs' };
const HALF_EGG: RecipeUnit = { singular: 'half-egg unit', plural: 'half-egg units' };

/** A real product offered as a stock item. */
export type IngredientProduct = {
  id: string;
  name: string;
  sellInPos?: boolean;
  category?: 'meals' | 'snacks' | 'drinks' | 'extras' | 'supplies' | null;
};

/** Products carry no unit of their own; by convention Egg stock is kept in half-egg units. */
export function isEggProduct(name: string): boolean {
  return /^eggs?$/i.test(name.trim());
}

export function unitForIngredient(name: string): RecipeUnit {
  return isEggProduct(name) ? HALF_EGG : PCS;
}

/** Real products as stock items, A to Z, optionally leaving out one product (the one being edited). */
export function ingredientOptionsFromProducts(
  products: IngredientProduct[],
  excludeProductId?: string | null,
): InventoryItemOption[] {
  return products
    .filter((product) => product.id !== excludeProductId)
    .map((product) => {
      const hint = [isEggProduct(product.name) ? '½ egg' : null, product.sellInPos === false ? 'Stock only' : null]
        .filter((part) => part != null)
        .join(' · ');
      return {
        id: product.id,
        name: product.name,
        unit: unitForIngredient(product.name),
        ...(hint ? { hint } : {}),
        stockOnly: product.sellInPos === false || product.category === 'supplies',
        isDrink: product.category === 'drinks',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Drinks are kept apart from the fixed ingredients above: a meal does not always use the same drink, the cashier
 * picks one at checkout and it comes out of that drink's own stock. A variant lists which drinks are eligible; they
 * are real products (ids), chosen with the same picker.
 */
export type DrinkChoice = { enabled: boolean; drinkIds: string[] };

export const NO_DRINK_CHOICE: DrinkChoice = { enabled: false, drinkIds: [] };

/** e.g. "Coke, Royal". Empty unless the variant includes a drink and has eligible drinks selected. */
export function summarizeDrinkChoice(choice: DrinkChoice, drinks: InventoryItemOption[]): string {
  if (!choice.enabled) return '';
  return choice.drinkIds
    .map((id) => drinks.find((drink) => drink.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .join(', ');
}

/**
 * Special option for the product currently being created or edited. It has no id yet while creating, so
 * recipe lines refer to it by this constant and show the live product name beside it. It is saved as "self".
 */
export const THIS_PRODUCT_ID = 'this-product';

/** Every known item: "This Product" first, then the real products. Used to resolve recipe lines. */
export function getInventoryOptions(productName: string, ingredients: InventoryItemOption[]): InventoryItemOption[] {
  const name = productName.trim();
  return [
    { id: THIS_PRODUCT_ID, name: 'This Product', unit: PCS, hint: name || 'Name not entered yet' },
    ...ingredients,
  ];
}

/**
 * Items offered in the picker. A product with the same name as the current product is left out so the current
 * product only appears once, as "This Product". Lines already added still resolve through getInventoryOptions,
 * so renaming the product never makes an existing line disappear.
 */
export function getPickerOptions(productName: string, ingredients: InventoryItemOption[]): InventoryItemOption[] {
  const name = productName.trim().toLowerCase();
  return getInventoryOptions(productName, ingredients).filter(
    (item) => item.id === THIS_PRODUCT_ID || !name || item.name.toLowerCase() !== name,
  );
}

export function findInventoryItem(
  itemId: string,
  productName: string,
  ingredients: InventoryItemOption[],
): InventoryItemOption | undefined {
  return getInventoryOptions(productName, ingredients).find((item) => item.id === itemId);
}

/** Case-insensitive match on the item name or its hint. An empty query matches everything. */
export type PickerListFilter = 'supplies' | 'all' | 'drinks';

/**
 * Stock pickers default to inventory supplies and keep those first when All is selected.
 * The drink picker lists saved drinks only.
 */
export function filterPickerItems(items: InventoryItemOption[], filter: PickerListFilter): InventoryItemOption[] {
  const byName = (a: InventoryItemOption, b: InventoryItemOption) => a.name.localeCompare(b.name);
  const self = items.filter((item) => item.id === THIS_PRODUCT_ID);
  const rest = items.filter((item) => item.id !== THIS_PRODUCT_ID);
  if (filter === 'drinks') return rest.filter((item) => item.isDrink).sort(byName);
  const supplies = rest.filter((item) => item.stockOnly).sort(byName);
  if (filter === 'supplies') return [...self, ...supplies];
  const others = rest.filter((item) => !item.stockOnly).sort(byName);
  return [...self, ...supplies, ...others];
}

export function matchesInventorySearch(item: InventoryItemOption, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return item.name.toLowerCase().includes(term) || (item.hint?.toLowerCase().includes(term) ?? false);
}

export function unitLabel(unit: RecipeUnit, quantity: number): string {
  return quantity === 1 ? unit.singular : unit.plural;
}

/**
 * Short extras line for the pricing step, e.g. "+ Rice, Egg". The main product is left out (every variant has
 * it) and quantities only show when above 1. Empty when there is nothing extra.
 */
export function summarizeExtras(lines: RecipeLine[], productName: string, ingredients: InventoryItemOption[]): string {
  const parts = lines
    .filter((line) => line.itemId !== THIS_PRODUCT_ID)
    .map((line) => {
      const item = findInventoryItem(line.itemId, productName, ingredients);
      if (!item) return null;
      return line.quantity > 1 ? `${item.name} ×${line.quantity}` : item.name;
    })
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? `+ ${parts.join(', ')}` : '';
}

const QUICK_ADD_LIMIT = 4;

/**
 * Ingredients already used elsewhere in this product (other options or the product-level list), most used first,
 * so the same item can be added to another option with one tap. "This Product" is not an ingredient here.
 */
export function suggestedIngredientIds(recipes: Record<string, RecipeLine[]>): string[] {
  const counts = new Map<string, number>();
  for (const lines of Object.values(recipes)) {
    for (const line of lines) {
      if (line.itemId === THIS_PRODUCT_ID) continue;
      counts.set(line.itemId, (counts.get(line.itemId) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([itemId]) => itemId);
}

/** One-tap chips: suggested ingredients not yet in this list. */
export function getQuickAddItems(
  lines: RecipeLine[],
  productName: string,
  ingredients: InventoryItemOption[],
  suggestedIds: string[],
): InventoryItemOption[] {
  const options = getPickerOptions(productName, ingredients);
  return suggestedIds
    .map((id) => options.find((item) => item.id === id))
    .filter((item): item is InventoryItemOption => item !== undefined && item.id !== THIS_PRODUCT_ID)
    .filter((item) => !lines.some((line) => line.itemId === item.id))
    .slice(0, QUICK_ADD_LIMIT);
}
