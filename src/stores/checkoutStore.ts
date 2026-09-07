import { create } from 'zustand';
import { getCheckoutFailure } from '@/lib/errors';
import { confirmSale, type Sale, type SaleRequest } from '@/services/saleService';
interface CheckoutState {
  pending: boolean; request: SaleRequest | null; sale: Sale | null; error: string;
  submit: (request: SaleRequest) => Promise<void>; reset: () => void;
}
export const useCheckoutStore = create<CheckoutState>((set, get) => ({
  pending: false, request: null, sale: null, error: '',
  submit: async (request) => {
    if (get().pending || get().sale) return;
    const attempt = get().request ?? request;
    set({ pending: true, request: attempt, error: '' });
    try { const sale = await confirmSale(attempt); set({ sale, pending: false }); }
    catch (error) {
      const failure = getCheckoutFailure(error);
      set({
        pending: false,
        error: failure.message,
        request: failure.preserveRequest ? attempt : null,
      });
    }
  },
  reset: () => { if (!get().pending) set({ request: null, sale: null, error: '' }); },
}));
