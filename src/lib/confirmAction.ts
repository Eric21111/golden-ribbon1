import { useAlertStore, type AlertTone } from '@/stores/alertStore';

export function confirmAction(
  title: string,
  message: string,
  action: () => void,
  // tone: 'danger' for something that cannot be undone (the confirm button turns red), 'warning' (default) for a careful step
  labels: {
    cancel?: string;
    confirm?: string;
    tone?: AlertTone;
    // a second choice next to the confirm button, instead of Cancel (e.g. "Replace it" / "Add to it"); closing is then the X or a tap outside
    secondary?: { label: string; onPress: () => void };
    closeButton?: boolean;
  } = {},
) {
  useAlertStore.getState().show({
    kind: 'confirm',
    tone: labels.tone ?? 'warning',
    title,
    message,
    cancelLabel: labels.cancel ?? 'Cancel',
    confirmLabel: labels.confirm ?? 'Confirm',
    onConfirm: action,
    ...(labels.secondary ? { secondary: labels.secondary } : {}),
    ...(labels.closeButton ? { closeButton: true } : {}),
  });
}

/** Single-button informational alert. */
export function alertNotice(title: string, message: string, tone: AlertTone = 'info') {
  useAlertStore.getState().show({ kind: 'notice', tone, title, message });
}
