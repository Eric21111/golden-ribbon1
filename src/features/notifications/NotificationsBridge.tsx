import { useQueryClient } from '@tanstack/react-query';
import { router, usePathname, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/AuthProvider';
import { routeForNotification } from '@/features/notifications/notificationRoutes';
import {
  addForegroundNotificationListener,
  addNotificationTapListener,
  clearLaunchNotification,
  configurePushPresentation,
  getLaunchNotificationData,
} from '@/features/notifications/pushNotifications';
import { registerThisDeviceForPush } from '@/features/notifications/pushRegistration';
import { useNotificationRecipientId } from '@/hooks/useNotifications';
import { queryKeys } from '@/lib/queryKeys';
import { supabase } from '@/lib/supabase';

configurePushPresentation();

function notificationId(data: unknown): string | null {
  const id = (data as { notification_id?: unknown } | null)?.notification_id;
  return typeof id === 'string' ? id : null;
}

/** App-wide notification wiring: device registration, live badge refresh, and tap / cold-start routing. */
export function NotificationsBridge() {
  const { session, profile, isLoading } = useAuth();
  const recipientId = useNotificationRecipientId();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [pendingTap, setPendingTap] = useState<unknown>(() => getLaunchNotificationData());
  const handledTapId = useRef<string | null>(null);

  const refresh = useCallback(
    (includeLists: boolean) => {
      if (!recipientId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadNotificationCounts(recipientId) });
      if (includeLists) {
        void queryClient.invalidateQueries({ queryKey: ['cashier-pending-transfers'] });
        void queryClient.invalidateQueries({ queryKey: ['stock-returns'] });
      }
    },
    [queryClient, recipientId],
  );

  // Register (or re-assign) this install whenever a recipient signs in; no prompt here.
  useEffect(() => {
    if (!recipientId) return;
    void registerThisDeviceForPush().catch(() => {
      // Push is optional; in-app badges keep working.
    });
  }, [recipientId]);

  useEffect(() => {
    if (!recipientId) return;
    const channel = supabase
      .channel(`notifications:${recipientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${recipientId}` },
        (payload) => refresh(payload.eventType === 'INSERT'),
      )
      .subscribe();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh(false);
    });
    const removeForeground = addForegroundNotificationListener(() => refresh(true));
    return () => {
      appState.remove();
      removeForeground();
      void supabase.removeChannel(channel);
    };
  }, [recipientId, refresh]);

  // The cold-start response can also reach the listener; handle each notification once.
  useEffect(
    () =>
      addNotificationTapListener((data) => {
        const id = notificationId(data);
        if (id && id === handledTapId.current) return;
        setPendingTap(data);
      }),
    [],
  );

  // Open the tapped notification once its recipient is signed in and their role screens are mounted.
  useEffect(() => {
    if (!pendingTap || isLoading || !session || !profile) return;
    handledTapId.current = notificationId(pendingTap);
    const route = routeForNotification(pendingTap, { userId: recipientId, role: profile.role });
    if (!route) {
      setPendingTap(null);
      clearLaunchNotification();
      return;
    }
    if (!pathname.startsWith(`/${profile.role}/`)) return;
    setPendingTap(null);
    clearLaunchNotification();
    refresh(true);
    if (pathname !== route) router.push(route as Href);
  }, [isLoading, pathname, pendingTap, profile, recipientId, refresh, session]);

  return null;
}
