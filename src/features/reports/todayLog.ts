import type { OwnerActivityAction, OwnerTodayActivity } from '../../types/models';

const ACTION_LABELS: Record<OwnerActivityAction, string> = {
  opening_stock_set: 'Set opening stock',
  transfer_sent: 'Sent stock out for delivery',
  shift_started: 'Started shift',
  transfer_received: 'Received stock',
  shift_ended: 'Ended shift',
  return_sent: 'Returned stock',
  return_received: 'Received returned stock',
};

export function activityLabel(action: string): string {
  return ACTION_LABELS[action as OwnerActivityAction] ?? 'Activity';
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** h:mm AM/PM in Asia/Manila (UTC+8, no DST), independent of the device time zone. */
export function formatManilaTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const shifted = new Date(ms + MANILA_OFFSET_MS);
  const hours = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

function roleLabel(role: string | null): string | null {
  if (role === 'manager') return 'Manager';
  if (role === 'cashier') return 'Cashier';
  if (role === 'owner') return 'Owner';
  return null;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** One-line context for a log row, e.g. "TR-000123 · to SM1 · 4 items". */
export function activityDetail(activity: OwnerTodayActivity): string | null {
  const detail = activity.detail ?? {};
  const parts: string[] = [];
  if (activity.action === 'opening_stock_set' && detail.product_count != null) {
    const products = Number(detail.product_count);
    const added = Number(detail.added_count ?? 0);
    parts.push(plural(products, 'product'));
    if (added > 0) parts.push(added === products ? 'added to existing stock' : `${added} added to existing stock`);
  }
  if (activity.action === 'shift_started' && detail.reopened) parts.push('Reopened after remittance');
  if (activity.action === 'shift_ended' && detail.possibly_automatic) {
    parts.push('Automatic 9 PM close or cashier (not recorded)');
  }
  if (detail.reference) parts.push(detail.reference);
  if (detail.counterpart_branch_name) {
    const outgoing = activity.action === 'transfer_sent' || activity.action === 'return_sent';
    parts.push(`${outgoing ? 'to' : 'from'} ${detail.counterpart_branch_name}`);
  }
  if (detail.item_count != null && activity.action !== 'opening_stock_set') {
    parts.push(plural(Number(detail.item_count), 'item'));
  }
  if (detail.with_issue) parts.push('with discrepancy');
  return parts.length ? parts.join(' · ') : null;
}

export function describeActivity(activity: OwnerTodayActivity) {
  const role = roleLabel(activity.actor_role);
  const possiblyAutomatic = activity.action === 'shift_ended' && activity.detail?.possibly_automatic === true;
  const name = possiblyAutomatic ? `Shift of ${activity.actor_name}` : activity.actor_name;
  return {
    time: formatManilaTime(activity.occurred_at),
    action: possiblyAutomatic ? 'Shift closed' : activityLabel(activity.action),
    employee: role ? `${name} · ${role}` : name,
    branch: activity.branch_name,
    detail: activityDetail(activity),
  };
}

/** Newest first. Ties keep the server's order (sort is stable), which ranks same-instant steps. */
export function sortActivitiesNewestFirst(activities: readonly OwnerTodayActivity[]): OwnerTodayActivity[] {
  return [...activities].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}
