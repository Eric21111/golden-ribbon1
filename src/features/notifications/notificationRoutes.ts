import type { UserRole } from '@/types/models';

export type NotificationKind = 'transfer_pending' | 'return_submitted';

export type UnreadNotificationCounts = Record<NotificationKind, number>;

export const EMPTY_UNREAD_COUNTS: UnreadNotificationCounts = { transfer_pending: 0, return_submitted: 0 };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tab badge text: hidden at 0, capped at "9+". */
export function formatBadgeCount(count: number | null | undefined): string | null {
  if (!count || !Number.isFinite(count) || count <= 0) return null;
  return count > 9 ? '9+' : String(Math.floor(count));
}

export function normalizeUnreadCounts(value: unknown): UnreadNotificationCounts {
  const source = (value ?? {}) as Partial<Record<NotificationKind, unknown>>;
  const read = (key: NotificationKind) => {
    const n = Number(source[key]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  return { transfer_pending: read('transfer_pending'), return_submitted: read('return_submitted') };
}

/**
 * Screen to open for a tapped push. The route is derived from the kind and entity, never taken from the
 * payload, and only for the signed-in recipient in the role the notification targets.
 */
export function routeForNotification(
  data: unknown,
  viewer: { userId: string | null | undefined; role: UserRole | null | undefined },
): string | null {
  if (!data || typeof data !== 'object' || !viewer.userId) return null;
  const { kind, entity_id: entityId, recipient_id: recipientId } = data as Record<string, unknown>;
  if (recipientId !== viewer.userId) return null;
  if (typeof entityId !== 'string' || !UUID_PATTERN.test(entityId)) return null;
  if (kind === 'transfer_pending' && viewer.role === 'cashier') return '/cashier/incoming';
  if (kind === 'return_submitted' && viewer.role === 'manager') return `/manager/returns/${entityId}`;
  return null;
}
