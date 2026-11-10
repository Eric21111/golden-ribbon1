import { Platform } from 'react-native';

import {
  getExpoPushToken,
  getPushPermission,
  getRegisteredToken,
  isPushSupported,
  rememberRegisteredToken,
} from '@/features/notifications/pushNotifications';
import { registerPushDevice, unregisterPushDevice } from '@/services/notificationService';

/** Registers this install for the signed-in user. Never prompts; returns false without permission. */
export async function registerThisDeviceForPush(): Promise<boolean> {
  if (!isPushSupported) return false;
  const permission = await getPushPermission();
  if (permission.status !== 'granted') return false;
  const token = await getExpoPushToken();
  await registerPushDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
  rememberRegisteredToken(token);
  return true;
}

/** Best-effort sign-out cleanup; bounded so a slow network never blocks logging out. */
export async function unregisterThisDeviceForPush(timeoutMs = 4_000): Promise<void> {
  const token = getRegisteredToken();
  if (!token) return;
  rememberRegisteredToken(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    unregisterPushDevice(token).catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
}
