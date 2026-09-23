import { create } from 'zustand';
import { applyLiveCartPrices, cartTotalCents, toCents } from '@/lib/money';
import { useCheckoutStore } from './checkoutStore';

import type { CartItem, InventoryItem, PosVariant } from '@/types/models';

type CartProduct = Pick<InventoryItem, 'quantity_on_hand'> & { product: InventoryItem['product'] };

interface CartState {
  shiftId: string | null;
  items: CartItem[];
  beginShift: (shiftId: string) => void;
  /** Stock is shared across a product's variant lines: quantity_on_hand caps their combined total. */
  addProduct: (item: CartProduct, variant?: PosVariant | null) => void;
  decreaseProduct: (productId: string, variantId?: string | null) => void;
  setProductQuantity: (item: CartProduct, quantity: number, variant?: PosVariant | null) => void;
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
  beginShift: (shiftId) => set((state) => state.shiftId === shiftId ? state : { shiftId, items: [] }),
  addProduct: ({ product, quantity_on_hand }, variant = null) => set((state) => {
    if (useCheckoutStore.getState().request) return state;
    const variantId = variant?.id ?? null;
    const totalForProduct = state.items
      .filter((item) => item.product_id === product.id)
      .reduce((sum, item) => sum + item.quantity, 0);
    if (totalForProduct + 1 > quantity_on_hand) return state;
    const existing = state.items.find(
      (item) => item.product_id === product.id && item.variant_id === variantId,
    );
    const nextQuantity = (existing?.quantity ?? 0) + 1;
    const unitPrice = variant ? variant.selling_price : product.selling_price;
    const nextItem: CartItem = {
      product_id: product.id,
      variant_id: variantId,
      product_name: product.name,
      variant_name: variant?.name ?? null,
      sku: product.sku,
      quantity: nextQuantity,
      unit_price: unitPrice,
      subtotal: nextQuantity * toCents(unitPrice) / 100,
    };
    return {
      ...state,
      items: existing
        ? state.items.map((item) => (item.product_id === product.id && item.variant_id === variantId ? nextItem : item))
        : [...state.items, nextItem],
    };
  }),
  decreaseProduct: (productId, variantId = null) => set((state) => {
    if (useCheckoutStore.getState().request) return state;
    const existing = state.items.find(
      (item) => item.product_id === productId && item.variant_id === variantId,
    );
    if (!existing) return state;
    if (existing.quantity === 1) {
      return {
        ...state,
        items: state.items.filter((item) => !(item.product_id === productId && item.variant_id === variantId)),
      };
    }
    const quantity = existing.quantity - 1;
    return {
      ...state,
      items: state.items.map((item) => (item.product_id === productId && item.variant_id === variantId)
        ? { ...item, quantity, subtotal: quantity * toCents(item.unit_price) / 100 }
        : item),
    };
  }),
  setProductQuantity: ({ product, quantity_on_hand }, quantity, variant = null) => set((state) => {
    if (useCheckoutStore.getState().request) return state;
    if (!Number.isFinite(quantity)) return state;
    const variantId = variant?.id ?? null;
    const nextQuantity = Math.max(0, Math.min(Math.floor(quantity), 999999));
    const otherQuantity = state.items
      .filter((item) => item.product_id === product.id && item.variant_id !== variantId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const capped = Math.min(nextQuantity, Math.max(0, quantity_on_hand - otherQuantity));
    const existing = state.items.find(
      (item) => item.product_id === product.id && item.variant_id === variantId,
    );
    if (capped <= 0) {
      return {
        ...state,
        items: state.items.filter((item) => !(item.product_id === product.id && item.variant_id === variantId)),
      };
    }
    const unitPrice = variant ? variant.selling_price : product.selling_price;
    const nextItem: CartItem = {
      product_id: product.id,
      variant_id: variantId,
      product_name: product.name,
      variant_name: variant?.name ?? null,
      sku: product.sku,
      quantity: capped,
      unit_price: unitPrice,
      subtotal: (capped * toCents(unitPrice)) / 100,
    };
    return {
      ...state,
      items: existing
        ? state.items.map((item) => (item.product_id === product.id && item.variant_id === variantId ? nextItem : item))
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
