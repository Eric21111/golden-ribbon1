import { create } from 'zustand';
const MAX_POS_QUANTITY = 999999;
import { applyLiveCartPrices, cartTotalCents, toCents } from '@/lib/money';
import { maxAdditional, maxLineQuantity, type PosStockContext } from '@/features/pos/posAvailability';
import { useCheckoutStore } from './checkoutStore';

import type { CartItem, InventoryItem, PosDrinkOption, PosVariant } from '@/types/models';

/** The drink a cashier picked for a meal option that includes one. */
export type PosDrinkChoice = Pick<PosDrinkOption, 'id' | 'name'>;

const sameLine = (item: CartItem, productId: string, variantId: string | null, drinkId: string | null) =>
  item.product_id === productId && item.variant_id === variantId && (item.drink_product_id ?? null) === drinkId;

type CartProduct = Pick<InventoryItem, 'quantity_on_hand'> & { product: InventoryItem['product'] };

interface CartState {
  shiftId: string | null;
  items: CartItem[];
  /**
   * Shared-ingredient stock for the products on screen (see posAvailability.ts). When set, caps count every cart line
   * together against ingredient stock (Egg, Rice, ...). Without it, or for a product it doesn't know, the cart falls
   * back to the original per-product limit. confirm_sale still re-checks everything.
   */
  stockContext: PosStockContext | null;
  setStockContext: (context: PosStockContext | null) => void;
  beginShift: (shiftId: string) => void;
  /** Stock is shared across a product's variant lines: quantity_on_hand caps their combined total. */
  addProduct: (item: CartProduct, variant?: PosVariant | null, drink?: PosDrinkChoice | null) => void;
  decreaseProduct: (productId: string, variantId?: string | null, drinkId?: string | null) => void;
  setProductQuantity: (
    item: CartProduct,
    quantity: number,
    variant?: PosVariant | null,
    drink?: PosDrinkChoice | null,
  ) => void;
  applyLivePrices: (prices: Record<string, number>) => {
    changed: boolean;
    previousTotalCents: number;
    nextTotalCents: number;
  };
  clearCart: () => void;
}

export const useCartStore = create<CartState>((set, get) => ({
  shiftId: null,
  items: [],
  stockContext: null,
  setStockContext: (context) => set({ stockContext: context }),
  beginShift: (shiftId) => set((state) => state.shiftId === shiftId ? state : { shiftId, items: [] }),
  addProduct: ({ product, quantity_on_hand }, variant = null, drink = null) => set((state) => {
    if (useCheckoutStore.getState().request) return state;
    const variantId = variant?.id ?? null;
    const drinkId = drink?.id ?? null;
    const context = state.stockContext;
    if (context?.product.has(product.id)) {
      if (maxAdditional(context, state.items, product.id, variantId, drinkId) < 1) return state;
    } else {
      const totalForProduct = state.items
        .filter((item) => item.product_id === product.id)
        .reduce((sum, item) => sum + item.quantity, 0);
      if (totalForProduct + 1 > quantity_on_hand) return state;
    }
    const unitPrice = variant ? variant.selling_price : product.selling_price;
    if (unitPrice == null) return state;
    const existing = state.items.find((item) => sameLine(item, product.id, variantId, drinkId));
    const nextQuantity = (existing?.quantity ?? 0) + 1;
    const nextItem: CartItem = {
      product_id: product.id,
      variant_id: variantId,
      product_name: product.name,
      variant_name: variant?.name ?? null,
      sku: product.sku,
      quantity: nextQuantity,
      unit_price: unitPrice,
      subtotal: nextQuantity * toCents(unitPrice) / 100,
      ...(drink ? { drink_product_id: drink.id, drink_name: drink.name } : {}),
    };
    return {
      ...state,
      items: existing
        ? state.items.map((item) => (sameLine(item, product.id, variantId, drinkId) ? nextItem : item))
        : [...state.items, nextItem],
    };
  }),
  decreaseProduct: (productId, variantId = null, drinkId = null) => set((state) => {
    if (useCheckoutStore.getState().request) return state;
    const existing = state.items.find((item) => sameLine(item, productId, variantId, drinkId));
    if (!existing) return state;
    if (existing.quantity === 1) {
      return {
        ...state,
        items: state.items.filter((item) => !sameLine(item, productId, variantId, drinkId)),
      };
    }
    const quantity = existing.quantity - 1;
    return {
      ...state,
      items: state.items.map((item) => (sameLine(item, productId, variantId, drinkId)
        ? { ...item, quantity, subtotal: quantity * toCents(item.unit_price) / 100 }
        : item)),
    };
  }),
  setProductQuantity: ({ product, quantity_on_hand }, quantity, variant = null, drink = null) => set((state) => {
    if (useCheckoutStore.getState().request) return state;
    if (!Number.isFinite(quantity)) return state;
    const variantId = variant?.id ?? null;
    const drinkId = drink?.id ?? null;
    const nextQuantity = Math.max(0, Math.min(Math.floor(quantity), MAX_POS_QUANTITY));
    const otherQuantity = state.items
      .filter((item) => item.product_id === product.id && item.variant_id !== variantId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const context = state.stockContext;
    const capped = context?.product.has(product.id)
      ? Math.min(nextQuantity, maxLineQuantity(context, state.items, product.id, variantId, drinkId))
      : Math.min(nextQuantity, Math.max(0, quantity_on_hand - otherQuantity));
    const existing = state.items.find((item) => sameLine(item, product.id, variantId, drinkId));
    if (capped <= 0) {
      return {
        ...state,
        items: state.items.filter((item) => !sameLine(item, product.id, variantId, drinkId)),
      };
    }
    const unitPrice = variant ? variant.selling_price : product.selling_price;
    if (unitPrice == null) return state;
    const nextItem: CartItem = {
      product_id: product.id,
      variant_id: variantId,
      product_name: product.name,
      variant_name: variant?.name ?? null,
      sku: product.sku,
      quantity: capped,
      unit_price: unitPrice,
      subtotal: (capped * toCents(unitPrice)) / 100,
      ...(drink ? { drink_product_id: drink.id, drink_name: drink.name } : {}),
    };
    return {
      ...state,
      items: existing
        ? state.items.map((item) => (sameLine(item, product.id, variantId, drinkId) ? nextItem : item))
        : [...state.items, nextItem],
    };
  }),
  applyLivePrices: (prices) => {
    const previous = get().items;
    const previousTotalCents = cartTotalCents(previous);
    const { items, changed } = applyLiveCartPrices(previous, prices);
    if (changed) set({ items });
    return { changed, previousTotalCents, nextTotalCents: cartTotalCents(items) };
  },
  clearCart: () => set((state) => ({ ...state, items: [] })),
}));
