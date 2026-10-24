/**
 * POS availability with shared stock (Egg, Rice, ... and the drink chosen with a meal).
 *
 * list_cashier_pos_inventory returns, per product, the EFFECTIVE recipe of the product and of each of its (branch)
 * variants, the eligible drinks of each option that includes one, plus the branch's stock of every ingredient and
 * drink involved. The server has already applied the same rules as confirm_sale (branch variant -> master variant by
 * name; variant lines -> product lines -> 1 unit of the product itself), so nothing here maps variants or picks a
 * fallback. This module only does the arithmetic that stops a CART from asking for more of an ingredient or a drink
 * than the branch has, counting every line together.
 *
 * It is an advance check for a better cashier experience. confirm_sale re-checks everything and stays the final
 * stock authority.
 */
import type { InventoryItem, PosStockLine, PosStockUses } from '@/types/models';

export type { PosStockLine, PosStockUses };

export type PosStockContext = {
  stock: Map<string, number>;
  names: Map<string, string>;
  product: Map<string, PosStockLine[] | null>;
  variants: Map<string, PosStockLine[] | null>;
  /** Eligible drinks of each (branch) option that includes one: option id -> drink product ids. */
  drinks: Map<string, string[]>;
  /**
   * Options that include a drink but have no usable one (every configured drink is inactive). The server reports them
   * as sellable_quantity 0 and leaves them out of `drinks`, which is NOT the same as an option with no Drink Choice
   * (that one sells without a drink). confirm_sale refuses these, so the POS must not offer them.
   */
  drinkBlocked: Set<string>;
};

export type CartLineLike = {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  /** The drink chosen for this line (an option that includes a drink), if any. */
  drink_product_id?: string | null;
};

const legacyLines = (productId: string): PosStockLine[] => [{ ingredient_product_id: productId, quantity: 1 }];

/** Normalises the JSON the server sent (numbers may arrive as strings). */
export function parseStockUses(raw: unknown): PosStockUses | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const lines = (input: unknown): PosStockLine[] | null => {
    if (!Array.isArray(input)) return null;
    return input.map((line) => ({
      ingredient_product_id: String((line as Record<string, unknown>).ingredient_product_id),
      quantity: Number((line as Record<string, unknown>).quantity),
    }));
  };
  const numbers = (input: unknown): Record<string, number> =>
    Object.fromEntries(Object.entries((input ?? {}) as Record<string, unknown>).map(([key, n]) => [key, Number(n)]));
  const variants: Record<string, PosStockLine[] | null> = {};
  for (const [key, input] of Object.entries((value.variants ?? {}) as Record<string, unknown>)) variants[key] = lines(input);
  const drinks: Record<string, string[]> = {};
  for (const [key, input] of Object.entries((value.drinks ?? {}) as Record<string, unknown>)) {
    if (Array.isArray(input)) drinks[key] = input.map((id) => String(id));
  }
  return {
    product: lines(value.product),
    variants,
    drinks,
    ingredient_stock: numbers(value.ingredient_stock),
    ingredient_names: Object.fromEntries(
      Object.entries((value.ingredient_names ?? {}) as Record<string, unknown>).map(([key, name]) => [key, String(name)]),
    ),
  };
}

/**
 * Builds the lookup from the loaded POS rows. A row without stock_uses (older data, or a caller that never had
 * recipes) is treated as a product without a recipe: one unit of itself, from its own quantity_on_hand, which is
 * exactly the behaviour the POS always had.
 */
export function buildStockContext(items: InventoryItem[]): PosStockContext {
  const ctx: PosStockContext = {
    stock: new Map(),
    names: new Map(),
    product: new Map(),
    variants: new Map(),
    drinks: new Map(),
    drinkBlocked: new Set(),
  };
  for (const item of items) {
    const uses = item.stock_uses;
    if (uses) {
      ctx.product.set(item.product.id, uses.product);
      for (const [variantId, lines] of Object.entries(uses.variants)) ctx.variants.set(variantId, lines);
      for (const [variantId, ids] of Object.entries(uses.drinks ?? {})) ctx.drinks.set(variantId, ids);
      for (const [id, qty] of Object.entries(uses.ingredient_stock)) ctx.stock.set(id, qty);
      for (const [id, name] of Object.entries(uses.ingredient_names)) ctx.names.set(id, name);
    } else {
      ctx.product.set(item.product.id, legacyLines(item.product.id));
      ctx.stock.set(item.product.id, item.quantity_on_hand);
    }
    if (!ctx.names.has(item.product.id)) ctx.names.set(item.product.id, item.product.name);
  }
  // Second pass (needs all stock loaded): the server says "cannot be sold" (0) for an option with no drink to offer,
  // while the meal's own ingredients would allow it. Ingredients out of stock is a different, ordinary case.
  for (const item of items) {
    for (const variant of item.variants ?? []) {
      if (variant.sellable_quantity !== 0 || (ctx.drinks.get(variant.id)?.length ?? 0) > 0) continue;
      const lines = ctx.variants.has(variant.id) ? ctx.variants.get(variant.id) : ctx.product.get(item.product.id);
      if (lines && lines.length > 0 && ingredientRoom(ctx, lines) > 0) ctx.drinkBlocked.add(variant.id);
    }
  }
  return ctx;
}

/** How many units the ingredients alone allow (no cart, no drink). */
function ingredientRoom(ctx: PosStockContext, lines: PosStockLine[]): number {
  let room = Number.POSITIVE_INFINITY;
  for (const use of lines) room = Math.min(room, Math.floor((ctx.stock.get(use.ingredient_product_id) ?? 0) / use.quantity));
  return Number.isFinite(room) ? Math.max(0, room) : 0;
}

/** The recipe one cart line uses, or null when that line cannot be sold. */
export function linesFor(ctx: PosStockContext, productId: string, variantId: string | null): PosStockLine[] | null {
  if (variantId && ctx.variants.has(variantId)) return ctx.variants.get(variantId) ?? null;
  if (ctx.product.has(productId)) return ctx.product.get(productId) ?? null;
  return legacyLines(productId);
}

/** Eligible drink ids of an option (empty when the option does not include a drink). */
export function drinksFor(ctx: PosStockContext, variantId: string | null): string[] {
  return variantId ? ctx.drinks.get(variantId) ?? [] : [];
}

/** Total units of every ingredient and drink the given cart lines will use. */
export function cartUsage(ctx: PosStockContext, cart: CartLineLike[]): Map<string, number> {
  const used = new Map<string, number>();
  const add = (id: string, qty: number) => used.set(id, (used.get(id) ?? 0) + qty);
  for (const line of cart) {
    const lines = linesFor(ctx, line.product_id, line.variant_id);
    if (lines) {
      for (const use of lines) add(use.ingredient_product_id, use.quantity * line.quantity);
    }
    // the chosen drink is one more thing the line uses, 1 per meal ordered (same rule as confirm_sale)
    if (line.drink_product_id) add(line.drink_product_id, line.quantity);
  }
  return used;
}

/**
 * How many MORE units of a line fit, given what the cart already uses. Never negative.
 * For an option that includes a drink, a drink must be given and eligible; a drink is refused for an option that
 * does not include one (confirm_sale refuses both).
 */
export function maxAdditional(
  ctx: PosStockContext,
  cart: CartLineLike[],
  productId: string,
  variantId: string | null,
  drinkId: string | null = null,
): number {
  const lines = linesFor(ctx, productId, variantId);
  if (!lines || lines.length === 0) return 0;
  if (variantId && ctx.drinkBlocked.has(variantId)) return 0;
  const eligible = drinksFor(ctx, variantId);
  if (eligible.length > 0) {
    if (!drinkId || !eligible.includes(drinkId)) return 0;
  } else if (drinkId) {
    return 0;
  }
  const used = cartUsage(ctx, cart);
  let room = Number.POSITIVE_INFINITY;
  for (const use of lines) {
    const free = (ctx.stock.get(use.ingredient_product_id) ?? 0) - (used.get(use.ingredient_product_id) ?? 0);
    room = Math.min(room, Math.floor(free / use.quantity));
  }
  if (drinkId) {
    room = Math.min(room, Math.floor((ctx.stock.get(drinkId) ?? 0) - (used.get(drinkId) ?? 0)));
  }
  return Number.isFinite(room) ? Math.max(0, room) : 0;
}

/**
 * The most a single line's quantity may be, with every OTHER line in the cart staying as it is. Used to cap a
 * typed or stepped quantity, and to show per-line limits. A line is product + option + chosen drink.
 */
export function maxLineQuantity(
  ctx: PosStockContext,
  cart: CartLineLike[],
  productId: string,
  variantId: string | null,
  drinkId: string | null = null,
): number {
  const others = cart.filter(
    (line) =>
      !(line.product_id === productId && line.variant_id === variantId && (line.drink_product_id ?? null) === drinkId),
  );
  return maxAdditional(ctx, others, productId, variantId, drinkId);
}

export type StockShortage = { ingredientId: string; name: string; needed: number; available: number };

/** Ingredients and drinks the cart needs more of than the branch has (for the final live check before payment). */
export function findShortages(ctx: PosStockContext, cart: CartLineLike[]): StockShortage[] {
  const shortages: StockShortage[] = [];
  for (const [ingredientId, needed] of cartUsage(ctx, cart)) {
    const available = ctx.stock.get(ingredientId) ?? 0;
    if (needed > available) {
      shortages.push({ ingredientId, name: ctx.names.get(ingredientId) ?? 'Item', needed, available });
    }
  }
  return shortages;
}

/**
 * Adds the cart-aware limits the POS list and item sheet display: max_quantity on the item (no variants) and on each
 * variant is the most that line may reach in the cart right now. For an option that includes a drink, each eligible
 * drink gets its own limit (drink_options) and the option's max_quantity is the best of them.
 * quantity_on_hand (the server's sellable quantity) is left alone, so what is listed or marked out of stock does not
 * change as the cart fills.
 */
export function withCartLimits(items: InventoryItem[], ctx: PosStockContext, cart: CartLineLike[]): InventoryItem[] {
  return items.map((item) => {
    const variants = item.variants ?? [];
    if (variants.length === 0) {
      return { ...item, max_quantity: maxLineQuantity(ctx, cart, item.product.id, null) };
    }
    const limited = variants.map((variant) => {
      const drinks = drinksFor(ctx, variant.id);
      if (drinks.length === 0) {
        const blocked = ctx.drinkBlocked.has(variant.id);
        return {
          ...variant,
          max_quantity: maxLineQuantity(ctx, cart, item.product.id, variant.id),
          ...(blocked ? { unavailable: true } : {}),
        };
      }
      const drink_options = drinks.map((drinkId) => ({
        id: drinkId,
        name: ctx.names.get(drinkId) ?? 'Drink',
        max_quantity: maxLineQuantity(ctx, cart, item.product.id, variant.id, drinkId),
      }));
      return {
        ...variant,
        drink_options,
        max_quantity: Math.max(0, ...drink_options.map((option) => option.max_quantity)),
      };
    });
    return { ...item, variants: limited, max_quantity: Math.max(0, ...limited.map((variant) => variant.max_quantity ?? 0)) };
  });
}
