import { useAlertStore } from '@/stores/alertStore';

export function confirmAction(
  title: string,
  message: string,
  action: () => void,
  labels: { cancel?: string; confirm?: string } = {},
) {
  useAlertStore.getState().show({
    kind: 'confirm',
    title,
    message,
    cancelLabel: labels.cancel ?? 'Cancel',
    confirmLabel: labels.confirm ?? 'Confirm',
    onConfirm: action,
  });
}

/** Single-button informational alert. */
export function alertNotice(title: string, message: string) {
  useAlertStore.getState().show({ kind: 'notice', title, message });
}
