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

// The server may still hold a registration from an earlier launch even if this launch's registration failed.
async function tokenToUnregister(): Promise<string | null> {
  const remembered = getRegisteredToken();
  if (remembered) return remembered;
  const permission = await getPushPermission();
  return permission.status === 'granted' ? getExpoPushToken() : null;
}

/** Best-effort sign-out cleanup; bounded so a slow network never blocks logging out. */
export async function unregisterThisDeviceForPush(timeoutMs = 4_000): Promise<void> {
  if (!isPushSupported) return;
  const work = tokenToUnregister()
    .then((token) => (token ? unregisterPushDevice(token) : undefined))
    .catch(() => undefined);
  rememberRegisteredToken(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
}
