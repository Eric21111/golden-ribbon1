import { useAlertStore, type AlertTone } from '@/stores/alertStore';

export function confirmAction(
  title: string,
  message: string,
  action: () => void,
  // tone: 'danger' for something that cannot be undone (the confirm button turns red), 'warning' (default) for a careful step
  labels: { cancel?: string; confirm?: string; tone?: AlertTone } = {},
) {
  useAlertStore.getState().show({
    kind: 'confirm',
    tone: labels.tone ?? 'warning',
    title,
    message,
    cancelLabel: labels.cancel ?? 'Cancel',
    confirmLabel: labels.confirm ?? 'Confirm',
    onConfirm: action,
  });
}

/** Single-button informational alert. */
export function alertNotice(title: string, message: string, tone: AlertTone = 'info') {
  useAlertStore.getState().show({ kind: 'notice', tone, title, message });
}
