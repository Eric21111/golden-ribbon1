import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ReturnRequest } from '@/types/returns';

// Keep an unresolved request across navigation/reloads so retries reuse its key.
type PendingReturn = { request: ReturnRequest; id?: string };
export const useReturnStore = create(persist<{
  byUser: Record<string, PendingReturn>;
  save: (user: string, value: PendingReturn) => void;
  clear: (user: string) => void;
}>((set) => ({
  byUser: {},
  save: (user, value) => set(state => ({ byUser: { ...state.byUser, [user]: value } })),
  clear: user => set(state => { const byUser = { ...state.byUser }; delete byUser[user]; return { byUser }; }),
}), { name: 'golden-ribbon-pending-returns', storage: createJSONStorage(() => globalThis.localStorage) }));
