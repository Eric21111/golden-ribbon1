import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '@/features/auth/AuthProvider';
import { EMPTY_UNREAD_COUNTS, type NotificationKind } from '@/features/notifications/notificationRoutes';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getUnreadNotificationCounts, markNotificationsRead } from '@/services/notificationService';

/** Signed-in user that can receive notifications (active cashier or manager), else null. */
export function useNotificationRecipientId(): string | null {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  if (!userId || !isSupabaseConfigured || !profile || profile.id !== userId || !profile.is_active) return null;
  return profile.role === 'cashier' || profile.role === 'manager' ? userId : null;
}

export function useUnreadNotificationCounts() {
  const userId = useNotificationRecipientId();
  const query = useQuery({
    queryKey: queryKeys.unreadNotificationCounts(userId ?? ''),
    queryFn: getUnreadNotificationCounts,
    enabled: Boolean(userId),
    staleTime: 5_000,
    // Realtime invalidates immediately; polling covers dropped sockets.
    refetchInterval: 30_000,
  });
  return userId ? (query.data ?? EMPTY_UNREAD_COUNTS) : EMPTY_UNREAD_COUNTS;
}

/**
 * Marks notifications read once the related screen has shown its data. `reviewedAt` changes on each successful
 * load, so items that arrive while the screen is open are cleared too. Never changes transfer/return status.
 */
export function useMarkNotificationsReviewed(kind: NotificationKind, entityId: string | null, reviewedAt: number) {
  const userId = useNotificationRecipientId();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId || !reviewedAt) return;
    void markNotificationsRead(kind, entityId)
      .then((count) => {
        if (count > 0) void queryClient.invalidateQueries({ queryKey: queryKeys.unreadNotificationCounts(userId) });
      })
      .catch(() => {
        // Badge stays until the next successful review; never blocks the screen.
      });
  }, [entityId, kind, queryClient, reviewedAt, userId]);
}
