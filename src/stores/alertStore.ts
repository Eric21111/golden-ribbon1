import { create } from 'zustand';

/** What the dialog's icon says: warning (be careful), danger (can't be undone / went wrong), info, success. */
export type AlertTone = 'warning' | 'danger' | 'info' | 'success';

type ConfirmRequest = {
  kind: 'confirm';
  tone: AlertTone;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
};

type NoticeRequest = {
  kind: 'notice';
  tone: AlertTone;
  title: string;
  message: string;
};

type AlertRequest = ConfirmRequest | NoticeRequest;

interface AlertStoreState {
  request: AlertRequest | null;
  show: (request: AlertRequest) => void;
  dismiss: () => void;
}

/** Backs the app-wide confirm/alert dialog (see GlobalAlertModal + confirmAction.ts) — replaces
 * window.confirm/window.alert (ugly on web) and Alert.alert (inconsistent look vs. the rest of
 * the app on native) with one styled modal on every platform. */
export const useAlertStore = create<AlertStoreState>((set) => ({
  request: null,
  show: (request) => set({ request }),
  dismiss: () => set({ request: null }),
}));
