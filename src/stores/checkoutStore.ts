import 'expo-sqlite/localStorage/install';
import { create } from 'zustand';
import { getCheckoutFailure } from '@/lib/errors';
import { confirmSale, type Sale, type SaleRequest } from '@/services/saleService';
import type { CartItem } from '@/types/models';
import { isSaleId } from '@/lib/saleErrors';

type SavedCheckout = { request: SaleRequest; sale: Sale | null; items: CartItem[] };
const storageKey = (userId: string) => `golden-ribbon-checkout-v1:${userId}`;

interface CheckoutState {
  userId: string | null;
  pending: boolean;
  request: SaleRequest | null;
  sale: Sale | null;
  items: CartItem[];
  error: string;
  recoveryError: boolean;
  activateUser: (userId: string | null) => void;
  submit: (request: SaleRequest, items?: CartItem[]) => Promise<void>;
  reset: () => boolean;
}

export const useCheckoutStore = create<CheckoutState>((set, get) => ({
  userId: null, pending: false, request: null, sale: null, items: [], error: '', recoveryError: false,
  activateUser: (userId) => {
    if (get().userId === userId && !get().recoveryError) return;
    const empty = { userId, pending: false, request: null, sale: null, items: [], error: '', recoveryError: false };
    if (!userId) { set(empty); return; }
    try {
      const raw = globalThis.localStorage.getItem(storageKey(userId));
      const saved: SavedCheckout | null = raw ? JSON.parse(raw) : null;
      if (raw !== null && (!saved || typeof saved !== 'object')) throw new Error('Invalid saved checkout');
      if (saved && (typeof saved.request?.key !== 'string' || saved.request.key.length < 16
        || !isSaleId(saved.request.shiftId) || !Array.isArray(saved.request.items)
        || !saved.request.items.length || !Array.isArray(saved.items)
        || !saved.request.items.every(item => isSaleId(item.product_id) && Number.isInteger(item.quantity) && item.quantity > 0)
        || (saved.sale && (!isSaleId(saved.sale.id) || saved.sale.shift_id !== saved.request.shiftId)))) {
        throw new Error('Invalid saved checkout');
      }
      set({ ...empty, request: saved?.request ?? null, sale: saved?.sale ?? null, items: saved?.items ?? [], error: saved && !saved.sale
        ? 'A checkout is awaiting confirmation. Retry this saved order to check its result.' : '' });
    } catch {
      // Never discard an unreadable journal: it could belong to a committed sale.
      set({ ...empty, recoveryError: true, error: 'Unable to read the saved checkout. Retry recovery or contact support before making another sale.' });
    }
  },
  submit: async (request, items = []) => {
    const state = get();
    if (state.pending || state.sale || state.recoveryError || !state.userId) return;
    const userId = state.userId;
    const retry = Boolean(state.request);
    const attempt = state.request ?? JSON.parse(JSON.stringify(request)) as SaleRequest;
    const snapshot = state.request ? state.items : items;
    const journal: SavedCheckout = { request: attempt, sale: null, items: snapshot };
    // Persist synchronously BEFORE any network write. If storage fails, no RPC is sent.
    try { globalThis.localStorage.setItem(storageKey(userId), JSON.stringify(journal)); }
    catch {
      set({ error: 'Unable to save checkout recovery on this device. Free device storage and retry. No checkout request was sent.' });
      return;
    }
    set({ pending: true, request: attempt, items: snapshot, error: '' });
    try {
      const sale = await confirmSale(attempt);
      try { globalThis.localStorage.setItem(storageKey(userId), JSON.stringify({ ...journal, sale })); }
      catch { /* The original durable request remains sufficient to recover this committed sale. */ }
      if (get().userId === userId) set({ sale, pending: false });
    } catch (error) {
      const failure = getCheckoutFailure(error);
      // A later refusal cannot disprove an earlier commit whose response was lost.
      let preserve = retry || failure.preserveRequest;
      if (!preserve) {
        try { globalThis.localStorage.removeItem(storageKey(userId)); }
        catch { preserve = true; }
      }
      if (get().userId === userId) set({
        pending: false,
        error: retry ? 'The saved checkout is still unverified. Retry the same order or contact support; do not recreate it.' : failure.message,
        request: preserve ? attempt : null,
      });
    }
  },
  reset: () => {
    const state = get();
    if (state.pending || state.recoveryError || (state.request && !state.sale)) return false;
    try { if (state.userId) globalThis.localStorage.removeItem(storageKey(state.userId)); }
    catch { set({ error: 'Unable to finish checkout recovery. Free device storage and tap Done again.' }); return false; }
    set({ request: null, sale: null, items: [], error: '' });
    return true;
  },
}));
