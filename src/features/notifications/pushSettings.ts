import type { UserRole } from '@/types/models';

import type { PushPermission } from './pushNotifications';

export type PushSettingAction = 'enable' | 'settings' | null;

export function pushPermissionExplanation(role: UserRole): string {
  return role === 'cashier'
    ? 'Get an alert on this device when the Main Branch sends stocks to your branch, even when the app is closed. You can turn this off anytime in your phone settings.'
    : 'Get an alert on this device when a branch submits leftover stocks for return, even when the app is closed. You can turn this off anytime in your phone settings.';
}

/** What the Notifications row shows. Never re-prompts after the OS stops allowing it. */
export function pushSettingState(permission: PushPermission | null): {
  label: string;
  detail: string;
  action: PushSettingAction;
} {
  if (!permission) return { label: 'Notifications', detail: 'Checking…', action: null };
  switch (permission.status) {
    case 'granted':
      return { label: 'Notifications on', detail: 'This device receives alerts.', action: null };
    case 'undetermined':
      return { label: 'Enable Notifications', detail: 'Get alerts on this device.', action: 'enable' };
    case 'denied':
      return permission.canAskAgain
        ? { label: 'Enable Notifications', detail: 'Notifications are off for this device.', action: 'enable' }
        : {
            label: 'Notifications off',
            detail: 'Turn them on in your phone settings. Badges in the app still update.',
            action: 'settings',
          };
    default:
      return { label: 'Notifications', detail: 'Not available on this device.', action: null };
  }
}
