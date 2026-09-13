import { Alert, Platform } from 'react-native';

export function confirmAction(
  title: string,
  message: string,
  action: () => void,
  labels: { cancel?: string; confirm?: string } = {},
) {
  const cancelLabel = labels.cancel ?? 'Cancel';
  const confirmLabel = labels.confirm ?? 'Confirm';
  if (Platform.OS === 'web') {
    if (globalThis.confirm(`${title}\n\n${message}`)) action();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: action },
  ]);
}

/** Single-button informational alert — `Alert.alert` is a no-op on web, so fall back to `window.alert`. */
export function alertNotice(title: string, message: string) {
  if (Platform.OS === 'web') {
    globalThis.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
