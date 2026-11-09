import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';
import { parseAlertMessage } from '@/lib/alertMessage';
import { useAlertStore, type AlertTone } from '@/stores/alertStore';

// One round icon at the top says what kind of dialog this is at a glance.
const TONES: Record<AlertTone, { icon: IoniconsIconName; background: string; color: string }> = {
  warning: { icon: 'alert', background: '#FEF3C7', color: '#B45309' },
  danger: { icon: 'alert', background: '#FEE2E2', color: '#B91C1C' },
  info: { icon: 'information', background: '#DCE8FC', color: managerColors.royalBlue },
  success: { icon: 'checkmark', background: '#DCFCE7', color: '#15803D' },
};

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

  const tone = request ? TONES[request.tone] : TONES.info;
  const blocks = request ? parseAlertMessage(request.message) : [];
  // a list reads best left-aligned; a sentence or two reads best centred under the icon
  const hasBullets = blocks.some((block) => block.type === 'bullet');

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
            <View style={[styles.badge, { backgroundColor: tone.background }]}>
              <Ionicons name={tone.icon} size={26} color={tone.color} />
            </View>
            <Text style={styles.title}>{request.title}</Text>
            {blocks.length > 0 ? (
              <View style={styles.message}>
                {blocks.map((block, index) =>
                  block.type === 'bullet' ? (
                    <View key={index} style={styles.bulletRow}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={[styles.messageText, styles.bulletText]}>{block.text}</Text>
                    </View>
                  ) : (
                    <Text key={index} style={[styles.messageText, !hasBullets && styles.messageCentered]}>
                      {block.text}
                    </Text>
                  ),
                )}
              </View>
            ) : null}
            {request.kind === 'confirm' ? (
              <View style={styles.buttonRow}>
                <View style={styles.buttonHalf}>
                  <ManagerActionButton label={request.cancelLabel} variant="secondary" onPress={dismiss} />
                </View>
                <View style={styles.buttonHalf}>
                  <ManagerActionButton
                    label={request.confirmLabel}
                    variant={request.tone === 'danger' ? 'destructive' : 'primary'}
                    onPress={handleConfirm}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.buttonRow}>
                <View style={styles.buttonHalf}>
                  <ManagerActionButton label="OK" onPress={dismiss} />
                </View>
              </View>
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
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    gap: 12,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  badge: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  message: { alignSelf: 'stretch', gap: 8 },
  messageText: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  messageCentered: { textAlign: 'center' },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bullet: { color: managerColors.subtext, fontSize: 14, lineHeight: 20 },
  bulletText: { flex: 1 },
  buttonRow: { alignSelf: 'stretch', flexDirection: 'row', gap: 10, marginTop: 6 },
  buttonHalf: { flex: 1 },
});
