import { normalizeUnreadCounts, type NotificationKind, type UnreadNotificationCounts } from '@/features/notifications/notificationRoutes';
import { supabase } from '@/lib/supabase';

export async function getUnreadNotificationCounts(): Promise<UnreadNotificationCounts> {
  const { data, error } = await supabase.rpc('get_my_unread_notification_counts');
  if (error) throw error;
  return normalizeUnreadCounts(data);
}

export async function markNotificationsRead(kind: NotificationKind, entityId?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('mark_notifications_read', { p_kind: kind, p_entity_id: entityId ?? null });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function registerPushDevice(token: string, platform: 'ios' | 'android'): Promise<void> {
  const { error } = await supabase.rpc('register_push_device', { p_token: token, p_platform: platform });
  if (error) throw error;
}

export async function unregisterPushDevice(token: string): Promise<void> {
  const { error } = await supabase.rpc('unregister_push_device', { p_token: token });
  if (error) throw error;
}
