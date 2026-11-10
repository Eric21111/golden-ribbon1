import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export type PushPermission = { status: PushPermissionStatus; canAskAgain: boolean };

export const isPushSupported = Platform.OS === 'ios' || Platform.OS === 'android';

const CHANNEL_ID = 'default';
let presentationConfigured = false;
let registeredToken: string | null = null;

/** Foreground pushes show the system banner only; the app adds no second alert. */
export function configurePushPresentation() {
  if (presentationConfigured || !isPushSupported) return;
  presentationConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Android 13+ only shows the permission prompt once a channel exists.
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Stock transfers and returns',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
}

function toPermission(response: Notifications.NotificationPermissionsStatus): PushPermission {
  const granted =
    response.granted ||
    response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    response.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;
  return {
    status: granted ? 'granted' : response.status === 'denied' ? 'denied' : 'undetermined',
    canAskAgain: response.canAskAgain,
  };
}

export async function getPushPermission(): Promise<PushPermission> {
  if (!isPushSupported) return { status: 'unsupported', canAskAgain: false };
  return toPermission(await Notifications.getPermissionsAsync());
}

/** Shows the OS prompt. Call only from an explicit user action. */
export async function requestPushPermission(): Promise<PushPermission> {
  if (!isPushSupported) return { status: 'unsupported', canAskAgain: false };
  await ensureChannel();
  return toPermission(await Notifications.requestPermissionsAsync());
}

export async function getExpoPushToken(): Promise<string> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('EAS project ID is not configured.');
  await ensureChannel();
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

export function rememberRegisteredToken(token: string | null) {
  registeredToken = token;
}

export function getRegisteredToken() {
  return registeredToken;
}

export function addNotificationTapListener(onTap: (data: unknown) => void) {
  if (!isPushSupported) return () => {};
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    onTap(response.notification.request.content.data);
  });
  return () => subscription.remove();
}

export function addForegroundNotificationListener(onReceive: () => void) {
  if (!isPushSupported) return () => {};
  const subscription = Notifications.addNotificationReceivedListener(() => onReceive());
  return () => subscription.remove();
}

/** Data of the push that cold-started the app, if any. */
export function getLaunchNotificationData(): unknown {
  if (!isPushSupported) return null;
  const response = Notifications.getLastNotificationResponse();
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  return response.notification.request.content.data;
}

export function clearLaunchNotification() {
  if (isPushSupported) Notifications.clearLastNotificationResponse();
}

/** Removes the previous account's notifications from the tray on sign-out. */
export async function clearDeliveredNotifications() {
  if (!isPushSupported) return;
  await Promise.allSettled([Notifications.dismissAllNotificationsAsync(), Notifications.setBadgeCountAsync(0)]);
}
