import { create } from 'zustand';
import { toCents } from '@/lib/money';
import { useCheckoutStore } from './checkoutStore';

import type { CartItem, InventoryItem } from '@/types/models';

type CartProduct = Pick<InventoryItem, 'quantity_on_hand'> & { product: InventoryItem['product'] };

interface CartState {
  shiftId: string | null;
  items: CartItem[];
  beginShift: (shiftId: string) => void;
  addProduct: (item: CartProduct) => void;
  decreaseProduct: (productId: string) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  shiftId: null,
  items: [],
  beginShift: (shiftId) => set((state) => state.shiftId === shiftId ? state : { shiftId, items: [] }),
  addProduct: ({ product, quantity_on_hand }) => set((state) => {
    if (useCheckoutStore.getState().request) return state;
    const existing = state.items.find((item) => item.product_id === product.id);
    const nextQuantity = (existing?.quantity ?? 0) + 1;
    if (nextQuantity > quantity_on_hand) return state;
    const nextItem: CartItem = {
      product_id: product.id,
      product_name: product.name,
      sku: product.sku,
      quantity: nextQuantity,
      unit_price: product.selling_price,
      subtotal: nextQuantity * toCents(product.selling_price) / 100,
    };
    return {
      ...state,
      items: existing
        ? state.items.map((item) => item.product_id === product.id ? nextItem : item)
        : [...state.items, nextItem],
    };
  }),
  decreaseProduct: (productId) => set((state) => {
    if (useCheckoutStore.getState().request) return state;
    const existing = state.items.find((item) => item.product_id === productId);
    if (!existing) return state;
    if (existing.quantity === 1) {
      return { ...state, items: state.items.filter((item) => item.product_id !== productId) };
    }
    const quantity = existing.quantity - 1;
    return {
      ...state,
      items: state.items.map((item) => item.product_id === productId
        ? { ...item, quantity, subtotal: quantity * toCents(item.unit_price) / 100 }
        : item),
    };
  }),
  clearCart: () => set({ shiftId: null, items: [] }),
}));
