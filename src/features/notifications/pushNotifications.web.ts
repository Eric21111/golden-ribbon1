// Web build: no native push. In-app badges still work through the unread-count query.
export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export type PushPermission = { status: PushPermissionStatus; canAskAgain: boolean };

export const isPushSupported = false;

export function configurePushPresentation() {}

export async function getPushPermission(): Promise<PushPermission> {
  return { status: 'unsupported', canAskAgain: false };
}

export async function requestPushPermission(): Promise<PushPermission> {
  return { status: 'unsupported', canAskAgain: false };
}

export async function getExpoPushToken(): Promise<string> {
  throw new Error('Push notifications are not supported on web.');
}

export function rememberRegisteredToken(_token: string | null) {}

export function getRegisteredToken(): string | null {
  return null;
}

export function addNotificationTapListener(_onTap: (data: unknown) => void) {
  return () => {};
}

export function addForegroundNotificationListener(_onReceive: () => void) {
  return () => {};
}

export function getLaunchNotificationData(): unknown {
  return null;
}

export function clearLaunchNotification() {}

export async function clearDeliveredNotifications() {}
