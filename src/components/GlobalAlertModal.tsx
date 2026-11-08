import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { useAlertStore } from '@/stores/alertStore';

/** Mounted once at the app root — renders whatever confirm/alert request is currently queued
 * in useAlertStore. See src/lib/confirmAction.ts for the imperative API that pushes into it. */
export function GlobalAlertModal() {
  const request = useAlertStore((state) => state.request);
  const dismiss = useAlertStore((state) => state.dismiss);

  const handleConfirm = () => {
    const current = request;
    dismiss();
    if (current?.kind === 'confirm') current.onConfirm();
  };

  // react-native-web adds a Modal's DOM node when the Modal MOUNTS (not when it becomes visible) and every modal shares
  // the same z-index, so DOM order decides what is on top. This modal mounts at app start, so a sheet opened later
  // would sit above it and hide every confirm/alert raised from inside that sheet (e.g. "Discard changes?" when Close
  // is pressed), which made Close look dead. On web, mount it only while a request is showing so it is always the
  // newest modal. Native keeps the always-mounted Modal (unmounting a visible native Modal can leave a touch blocker).
  if (Platform.OS === 'web' && request == null) return null;

  return (
    <Modal transparent animationType="fade" visible={request != null} onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
        />
        {request ? (
        <View style={styles.card}>
          <Text style={styles.title}>{request.title}</Text>
          <Text style={styles.message}>{request.message}</Text>
          {request.kind === 'confirm' ? (
            <View style={styles.buttonRow}>
              <View style={styles.buttonHalf}>
                <ManagerActionButton label={request.cancelLabel} variant="secondary" onPress={dismiss} />
              </View>
              <View style={styles.buttonHalf}>
                <ManagerActionButton label={request.confirmLabel} onPress={handleConfirm} />
              </View>
            </View>
          ) : (
            <ManagerActionButton label="OK" onPress={dismiss} />
          )}
        </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 18, 36, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    gap: 14,
    width: '100%',
    maxWidth: 400,
  },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 18 },
  message: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  buttonHalf: { flex: 1 },
});
