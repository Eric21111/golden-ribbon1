import { stockUnit, type StockUnitCode } from '@/lib/stockUnits';
/**
 * Stock Used Per Order — data helpers for the Create/Edit Product wizards.
 *
 * The stock items are REAL products (their ids are what gets saved in product_stock_uses). The wizard keeps each
 * variant's list in local state and sends it with the product; see stockUseMapping.ts.
 *
 * Drink Choice (below) also uses real products and is saved with the product; see drinkChoiceMapping.ts.
 */

export type RecipeUnit = { singular: string; plural: string };
const PCS: RecipeUnit = { singular: 'pc', plural: 'pcs' };

export type InventoryItemOption = {
  id: string;
  name: string;
  unit: RecipeUnit;
  /** Short note shown in the picker, e.g. what one unit means. */
  hint?: string;
  /** Show in Cashier POS is off, or the product was saved as an inventory supply. */
  stockOnly?: boolean;
  /** Saved category is Drinks. Meal choices must not offer meals or supplies. */
  isDrink?: boolean;
  /** The product is disabled (Enable Product off). A disabled drink is not offered with a meal and is refused at the register. */
  inactive?: boolean;
  /** Saved product category, for the category icon. Absent for "This Product" and for products with none saved. */
  category?: 'meals' | 'snacks' | 'drinks' | 'extras' | 'supplies' | null;
};

/** One inventory item used by a variant, and how many whole stock units each order uses. */
export type RecipeLine = { itemId: string; quantity: number };

export const MAX_RECIPE_QUANTITY = 99;

/** A real product offered as a stock item. */
export type IngredientProduct = {
  stockUnitCode?: StockUnitCode | null;
  id: string;
  name: string;
  sellInPos?: boolean;
  /** False when Enable Product is off. Absent is treated as enabled. */
  isActive?: boolean;
  category?: 'meals' | 'snacks' | 'drinks' | 'extras' | 'supplies' | null;
};

/** Real products as stock items, A to Z, optionally leaving out one product (the one being edited). */
export function ingredientOptionsFromProducts(
  products: IngredientProduct[],
  excludeProductId?: string | null,
): InventoryItemOption[] {
  return products
    .filter((product) => product.id !== excludeProductId)
    .map((product) => {
      const hint = [stockUnit(product.stockUnitCode)?.hint ?? null, product.sellInPos === false ? 'Stock only' : null, product.isActive === false ? 'Disabled' : null]
        .filter((part) => part != null)
        .join(' · ');
      return {
        id: product.id,
        name: product.name,
        unit: stockUnit(product.stockUnitCode) ?? { singular: 'stock unit (legacy)', plural: 'stock units (legacy)' },
        ...(hint ? { hint } : {}),
        stockOnly: product.sellInPos === false || product.category === 'supplies',
        isDrink: product.category === 'drinks',
        ...(product.isActive === false ? { inactive: true } : {}),
        category: product.category ?? null,
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
    .map((id) => drinks.find((drink) => drink.id === id))
    .filter((drink): drink is InventoryItemOption => drink !== undefined)
    .map((drink) => (drink.inactive ? `${drink.name} (disabled)` : drink.name))
    .join(', ');
}

/**
 * One short phrase for the collapsed option card: "Drink: Coke", "Drink: 3 options", "Drink: 2 options (1 disabled)". Only
 * ENABLED drinks are offered with a meal, so they are what is counted; disabled ones are called out, and a choice whose
 * drinks are all disabled says so. Empty when the option includes no drink or none are selected.
 */
export function summarizeDrinkLine(choice: DrinkChoice, drinks: InventoryItemOption[]): string {
  if (!choice.enabled) return '';
  const chosen = choice.drinkIds
    .map((id) => drinks.find((drink) => drink.id === id))
    .filter((drink): drink is InventoryItemOption => drink !== undefined);
  if (chosen.length === 0) return '';
  const offered = chosen.filter((drink) => !drink.inactive);
  const disabled = chosen.length - offered.length;
  if (offered.length === 0) return 'Drink: all disabled';
  const head = offered.length === 1 ? `Drink: ${offered[0]!.name}` : `Drink: ${offered.length} options`;
  return disabled > 0 ? `${head} (${disabled} disabled)` : head;
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

// ---- Stock Deduction mode (Extras & Sides)

/**
 * How a stock list reads. The database resolves what one order deducts like this: a saved list for the option, else the
 * product-level list, else the product itself x1. So:
 *   own   no list, or exactly "This Product" x1: the product's own stock, deducted once.
 *   other any other list: ONLY the listed items are deducted. The product's own stock is not touched unless
 *         "This Product" is in the list.
 */
export type StockMode = 'own' | 'other';

/** "This Product" x1, the list that means "use this product's own stock". */
export const OWN_STOCK_LINES: RecipeLine[] = [{ itemId: THIS_PRODUCT_ID, quantity: 1 }];

export function stockModeOf(lines: RecipeLine[]): StockMode {
  if (lines.length === 0) return 'own';
  return lines.length === 1 && lines[0]!.itemId === THIS_PRODUCT_ID && lines[0]!.quantity === 1 ? 'own' : 'other';
}

/**
 * The list one sold option really uses (the database resolves it the same way): the option's own list, else the
 * product-level list saved for the whole product, else nothing, which means the product itself x1. A product-level
 * list can stay saved while options exist (it is only editable in the wizard when there are none), so an option
 * without a list of its own inherits it. Own lists REPLACE it, they are never merged. [] = the product itself x1.
 */
export function effectiveLines(optionLines: RecipeLine[], productLines: RecipeLine[]): RecipeLine[] {
  if (optionLines.length > 0) return optionLines;
  return stockModeOf(productLines) === 'own' ? [] : productLines;
}

/** Whether the list also deducts the product's own stock (alongside other items). */
export function includesOwnStock(lines: RecipeLine[]): boolean {
  return lines.some((line) => line.itemId === THIS_PRODUCT_ID);
}

/**
 * What one order deducts, e.g. "Rice ×1, Egg ×1". An empty list reads as the product itself x1, because that is what
 * the database does with no list. Items that are no longer known are left out.
 */
export function summarizeDeduction(lines: RecipeLine[], productName: string, ingredients: InventoryItemOption[]): string {
  const effective = lines.length === 0 ? OWN_STOCK_LINES : lines;
  return effective
    .map((line) => {
      const item = findInventoryItem(line.itemId, productName, ingredients);
      if (!item) return null;
      const name = item.id === THIS_PRODUCT_ID ? productName.trim() || 'This product' : item.name;
      return `${name} ×${line.quantity}`;
    })
    .filter((part): part is string => part !== null)
    .join(', ');
}

/**
 * What one order of an option deducts, as short sentences for the preview. Stock items first (the effective list, see
 * effectiveLines), then the drink. A drink is one more ingredient of the sale line, 1 per meal ordered, but WHICH drink
 * is only known at checkout, so it is described as a choice and never as a specific deduction. Only present when the
 * option includes a drink; an option without one deducts no drink.
 */
export function describeOrderDeduction(options: {
  lines: RecipeLine[];
  inheritedLines?: RecipeLine[];
  productName: string;
  ingredients: InventoryItemOption[];
  /** The option's drink choice, or null/absent when the category or option has none. */
  drink?: DrinkChoice | null;
  drinks?: InventoryItemOption[];
}): string[] {
  const { lines, inheritedLines = [], productName, ingredients, drink, drinks = ingredients } = options;
  const items = summarizeDeduction(effectiveLines(lines, inheritedLines), productName, ingredients);
  const sentences = items ? [`Each order uses ${items}.`] : [];
  if (drink?.enabled) {
    const chosen = drink.drinkIds
      .map((id) => drinks.find((item) => item.id === id))
      .filter((item): item is InventoryItemOption => item !== undefined);
    const offered = chosen.filter((item) => !item.inactive).map((item) => item.name);
    const disabled = chosen.filter((item) => item.inactive).map((item) => item.name);
    if (chosen.length === 0) {
      sentences.push('Plus 1 drink, but none is selected yet. Add at least one drink above.');
    } else if (offered.length === 0) {
      // the database offers only enabled drinks, and an option whose drinks are all disabled cannot be sold
      sentences.push(`Plus 1 drink, but every selected drink is disabled, so this option can't be sold until one is enabled.`);
    } else {
      sentences.push(`Plus 1 drink, chosen at checkout: ${offered.join(', ')}.`);
      if (disabled.length > 0) sentences.push(`Not offered (disabled): ${disabled.join(', ')}.`);
    }
  }
  return sentences;
}

/**
 * One short line for what an option deducts, for the option card and the pricing step. `lines` must already be the
 * effective list (see effectiveLines). A list with "This Product" x1 reads as "+ Rice, Egg" (the product itself is
 * implied, as for meals). Anything else is spelled out in full ("Uses Rice ×1"), because then the product's own stock
 * is either not used (Extra Rice) or used in another quantity, and "+ Rice" would say the opposite.
 */
export function summarizeVariantStock(lines: RecipeLine[], productName: string, ingredients: InventoryItemOption[]): string {
  if (lines.length === 0) return '';
  const own = lines.find((line) => line.itemId === THIS_PRODUCT_ID);
  if (own && own.quantity === 1) return summarizeExtras(lines, productName, ingredients);
  const full = summarizeDeduction(lines, productName, ingredients);
  return full ? `Uses ${full}` : '';
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
