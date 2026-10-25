/**
 * PREVIEW ONLY — product category for the Create/Edit wizards.
 * The selected category lives in local wizard state, is never saved or sent to any API, and only changes
 * how Step 2 is laid out (titles, labels, and which preview sections are shown). Switching category never
 * deletes variant names or preview selections; it only hides sections that don't apply.
 *
 * Existing products have no saved category yet, so Edit starts in the "unset" state instead of pretending the
 * product is a Meal.
 */

export type ProductCategory = 'meals' | 'snacks' | 'drinks' | 'extras' | 'supplies';

/** A real category, or "unset" (Edit Product, until the user picks one to preview). */
export type CategoryChoice = ProductCategory | 'unset';

export type SimpleEmptyState = { title: string; body: string; link: string };

type CategoryConfigFields = {
  label: string;
  /** Step 2 heading. */
  step2Title: string;
  /** Short name of Step 2 in the step indicator. */
  stepLabel: string;
  /** What one entry is called: "Variant", "Option", "Size". */
  noun: string;
  nameLabel: string;
  namePlaceholder: string;
  /** Section label above the stock-used list. Empty when it doesn't apply. */
  ingredientsLabel: string;
  showIngredients: boolean;
  /**
   * Whether other inventory items (Rice, Egg, Browse all) can be added to the stock list. When false the list is
   * only the product itself (e.g. 5 pcs of a snack), with no extra-item chips or picker.
   */
  allowOtherStock: boolean;
  showDrinkChoice: boolean;
  /** Show the "Complete / No items yet" badge on variant cards (only where ingredients are expected). */
  showStatus: boolean;
  /**
   * When set, Step 2 starts as a short note with an "add" link instead of the full variant prompt, because
   * these products are normally sold as one item (or not sold directly). Variants stay available.
   */
  simpleEmpty: SimpleEmptyState | null;
  /** Body of the standard "No variants yet" note (used when `simpleEmpty` is null). */
  emptyBody: string;
  /**
   * Show a product-level "stock used" list while there are no variants (a product sold one way, at one price). Meals
   * and Snacks start it with "This Product ×1"; once variants exist each variant has its own list instead.
   */
  productLevelStock: boolean;
  /** New configurations (a new variant, or a product-level list) start with "This Product ×1". */
  autoAddMainProduct: boolean;
  /**
   * A NEW product (Create only) opens Step 2 with one blank option card ready, with This Product ×1 already in
   * it. A product sold at one price just removes the card. It is offered once and never added back.
   */
  startsWithOption: boolean;
};

export type ProductCategoryConfig = CategoryConfigFields & { id: ProductCategory };
export type ResolvedCategoryConfig = CategoryConfigFields & { id: CategoryChoice };

const STANDARD_EMPTY_BODY = 'Skip this step if the product has a single price.';

export const PRODUCT_CATEGORIES: ProductCategoryConfig[] = [
  {
    id: 'meals',
    label: 'Meals & Viands',
    step2Title: 'Meal Options & Stock',
    stepLabel: 'Meal Options',
    noun: 'Variant',
    nameLabel: 'Variant name',
    namePlaceholder: 'e.g. With Rice',
    ingredientsLabel: 'THIS MEAL USES',
    showIngredients: true,
    allowOtherStock: true,
    showDrinkChoice: true,
    showStatus: true,
    simpleEmpty: null,
    emptyBody: STANDARD_EMPTY_BODY,
    productLevelStock: true,
    autoAddMainProduct: true,
    startsWithOption: true,
  },
  {
    id: 'snacks',
    label: 'Snacks & Finger Foods',
    step2Title: 'Selling Options & Stock',
    stepLabel: 'Selling Options',
    noun: 'Option',
    nameLabel: 'Option name',
    namePlaceholder: 'e.g. 3 pcs',
    ingredientsLabel: 'THIS SNACK USES · OPTIONAL',
    showIngredients: true,
    allowOtherStock: false, // a snack is just the snack: no Rice / Egg / Browse all
    showDrinkChoice: false, // snacks have no drink choice
    showStatus: false,
    simpleEmpty: null,
    emptyBody: STANDARD_EMPTY_BODY,
    productLevelStock: true,
    autoAddMainProduct: true,
    startsWithOption: true,
  },
  {
    id: 'drinks',
    label: 'Drinks',
    step2Title: 'Sizes & Packaging',
    stepLabel: 'Sizes & Packaging',
    noun: 'Size',
    nameLabel: 'Size or packaging',
    namePlaceholder: 'e.g. 500 ml bottle',
    ingredientsLabel: '',
    showIngredients: false,
    allowOtherStock: false,
    showDrinkChoice: false,
    showStatus: false,
    simpleEmpty: {
      title: 'Sold as a single drink',
      body: 'Skip this, or add a size. Each packaged drink is its own product.',
      link: 'Add a size or packaging',
    },
    emptyBody: STANDARD_EMPTY_BODY,
    productLevelStock: false,
    autoAddMainProduct: false,
    startsWithOption: false,
  },
  {
    id: 'extras',
    label: 'Extras & Sides',
    step2Title: 'Simple Selling Options',
    stepLabel: 'Selling Options',
    noun: 'Option',
    nameLabel: 'Option name',
    namePlaceholder: 'e.g. Extra rice',
    ingredientsLabel: 'STOCK USED PER ORDER · OPTIONAL',
    showIngredients: true,
    allowOtherStock: true,
    showDrinkChoice: false,
    showStatus: false,
    simpleEmpty: {
      title: 'Sold at one fixed price',
      body: 'Skip this step, or list the stock it uses below.',
      link: 'Add a selling option',
    },
    emptyBody: STANDARD_EMPTY_BODY,
    productLevelStock: true,
    autoAddMainProduct: false,
    startsWithOption: false,
  },
  {
    id: 'supplies',
    label: 'Inventory Supplies',
    step2Title: 'Inventory Details',
    stepLabel: 'Inventory Details',
    noun: 'Option',
    nameLabel: 'Option name',
    namePlaceholder: 'e.g. Per pack',
    ingredientsLabel: '',
    showIngredients: false,
    allowOtherStock: false,
    showDrinkChoice: false,
    showStatus: false,
    simpleEmpty: {
      title: 'Inventory item',
      body: 'Usually not sold on its own. Options are optional.',
      link: 'Add a selling option anyway',
    },
    emptyBody: STANDARD_EMPTY_BODY,
    productLevelStock: false,
    autoAddMainProduct: false,
    startsWithOption: false,
  },
];

/**
 * Neutral layout for "Category not set" (existing products). It assumes nothing about the product: plain
 * variants, no drink-choice section, nothing auto-added. The stock-used lists ARE shown, because an existing
 * product may already have saved ones and the category is not saved, so it could never be inferred. Existing
 * variants and prices are shown and edited exactly as before.
 */
export const UNSET_CATEGORY_CONFIG: ResolvedCategoryConfig = {
  id: 'unset',
  label: 'Category not set',
  step2Title: 'Variants',
  stepLabel: 'Variants',
  noun: 'Variant',
  nameLabel: 'Variant name',
  namePlaceholder: 'Variant name',
  ingredientsLabel: 'STOCK USED PER ORDER · OPTIONAL',
  showIngredients: true,
  allowOtherStock: true,
  showDrinkChoice: false,
  showStatus: false,
  simpleEmpty: null,
  emptyBody: STANDARD_EMPTY_BODY,
  productLevelStock: true,
  autoAddMainProduct: false,
  startsWithOption: false,
};

/**
 * Whether a variant's drink choice section is shown. Meals show it; for "Category not set" (existing products) it is
 * shown only for an option that already includes a drink, because the category is not saved and a saved drink choice
 * must never be invisible. Everywhere else it is hidden (the saved selection is kept).
 */
export function isDrinkChoiceVisible(category: CategoryChoice, drinkEnabled: boolean): boolean {
  return getCategoryConfig(category).showDrinkChoice || (category === 'unset' && drinkEnabled);
}

/** Create starts as Meals & Viands (new products choose a category up front). */
export const DEFAULT_PRODUCT_CATEGORY: ProductCategory = 'meals';

/** Edit starts "not set": existing products have no saved category, so none is presented as confirmed. */
export const INITIAL_EDIT_CATEGORY: CategoryChoice = 'unset';

export function getCategoryConfig(category: CategoryChoice): ResolvedCategoryConfig {
  if (category === 'unset') return UNSET_CATEGORY_CONFIG;
  return PRODUCT_CATEGORIES.find((entry) => entry.id === category) ?? PRODUCT_CATEGORIES[0]!;
}
