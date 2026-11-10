import Ionicons from '@react-native-vector-icons/ionicons';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
import { getPushPermission, isPushSupported, requestPushPermission, type PushPermission } from '@/features/notifications/pushNotifications';
import { registerThisDeviceForPush } from '@/features/notifications/pushRegistration';
import { pushPermissionExplanation, pushSettingState } from '@/features/notifications/pushSettings';
import { alertNotice, confirmAction } from '@/lib/confirmAction';
import type { UserRole } from '@/types/models';

/** "Enable Notifications" section for the cashier and Main Branch Manager account screens (native only). */
export function PushNotificationsCard({ role }: { role: UserRole }) {
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getPushPermission();
      setPermission(next);
      if (next.status === 'granted') await registerThisDeviceForPush();
    } catch {
      // Keep the last known state; badges do not depend on push.
    }
  }, []);

  useEffect(() => {
    if (!isPushSupported) return;
    void refresh();
    // Re-check after the user returns from the phone's settings.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  if (!isPushSupported) return null;

  const state = pushSettingState(permission);

  const enable = () => {
    confirmAction(
      'Enable notifications?',
      pushPermissionExplanation(role),
      () => {
        setBusy(true);
        void (async () => {
          try {
            const result = await requestPushPermission();
            setPermission(result);
            if (result.status === 'granted') {
              await registerThisDeviceForPush();
              alertNotice('Notifications on', 'This device will receive alerts.', 'success');
            } else {
              alertNotice('Notifications off', 'You can still see new items from the badges in the app.', 'info');
            }
          } catch {
            alertNotice('Could not enable notifications', 'Please try again later. Badges in the app still update.', 'warning');
          } finally {
            setBusy(false);
          }
        })();
      },
      { confirm: 'Continue', cancel: 'Not now', tone: 'info' },
    );
  };

  const onPress = state.action === 'enable' ? enable : state.action === 'settings' ? () => void Linking.openSettings() : undefined;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>NOTIFICATIONS</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !onPress || busy }}
        disabled={!onPress || busy}
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <View style={styles.iconChip}>
          <Ionicons
            name={permission?.status === 'granted' ? 'notifications' : 'notifications-outline'}
            size={18}
            color={managerColors.royalBlue}
          />
        </View>
        <View style={styles.copy}>
          <Text style={styles.label}>{state.label}</Text>
          <Text style={styles.detail}>{state.detail}</Text>
        </View>
        {onPress ? <Ionicons name="chevron-forward" size={18} color={managerColors.subtext} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    borderRadius: 16,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  pressed: { backgroundColor: managerColors.cardSurface },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EAF0FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  detail: { color: managerColors.subtext, fontFamily: 'Inter_500Medium', fontSize: 12 },
});
