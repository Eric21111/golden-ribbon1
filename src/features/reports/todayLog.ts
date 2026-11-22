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

/** The separate bits of a log row's context, so the full line and the short dashboard line are built from the same facts. */
function detailPieces(activity: OwnerTodayActivity) {
  const detail = activity.detail ?? {};
  const opening = activity.action === 'opening_stock_set' && detail.product_count != null;
  const products = opening ? Number(detail.product_count) : 0;
  const added = opening ? Number(detail.added_count ?? 0) : 0;
  const outgoing = activity.action === 'transfer_sent' || activity.action === 'return_sent';
  return {
    opening,
    count: opening
      ? plural(products, 'product')
      : detail.item_count != null && activity.action !== 'opening_stock_set'
        ? plural(Number(detail.item_count), 'item')
        : null,
    addedNote: added > 0 ? (added === products ? 'added to existing stock' : `${added} added to existing stock`) : null,
    reopened: activity.action === 'shift_started' && detail.reopened ? 'Reopened after remittance' : null,
    automatic:
      activity.action === 'shift_ended' && detail.possibly_automatic ? 'Automatic 9 PM close or cashier (not recorded)' : null,
    reference: detail.reference ? String(detail.reference) : null,
    counterpart: detail.counterpart_branch_name ? `${outgoing ? 'to' : 'from'} ${detail.counterpart_branch_name}` : null,
    discrepancy: Boolean(detail.with_issue),
  };
}

const join = (parts: (string | null)[]) => {
  const kept = parts.filter((part): part is string => Boolean(part));
  return kept.length ? kept.join(' · ') : null;
};

/** One-line context for a log row, e.g. "TR-000123 · to SM1 · 4 items". */
export function activityDetail(activity: OwnerTodayActivity): string | null {
  const p = detailPieces(activity);
  return join([
    p.opening ? p.count : null,
    p.addedNote,
    p.reopened,
    p.automatic,
    p.reference,
    p.counterpart,
    p.opening ? null : p.count,
    p.discrepancy ? 'with discrepancy' : null,
  ]);
}

/** Who did it, as the name is saved. A shift the system may have closed on its own says so ("Shift of Ana"). */
function actorName(activity: OwnerTodayActivity): string {
  const possiblyAutomatic = activity.action === 'shift_ended' && activity.detail?.possibly_automatic === true;
  return possiblyAutomatic ? `Shift of ${activity.actor_name}` : activity.actor_name;
}

export function describeActivity(activity: OwnerTodayActivity) {
  const role = roleLabel(activity.actor_role);
  const possiblyAutomatic = activity.action === 'shift_ended' && activity.detail?.possibly_automatic === true;
  const name = actorName(activity);
  return {
    time: formatManilaTime(activity.occurred_at),
    action: possiblyAutomatic ? 'Shift closed' : activityLabel(activity.action),
    employee: role ? `${name} · ${role}` : name,
    branch: activity.branch_name,
    detail: activityDetail(activity),
  };
}

/**
 * The short version for the dashboard row: the name only (no role, which names like "SM2-Cashier Angie" already carry),
 * "from / to branch · count · reference" in that order, and the discrepancy as its own flag instead of a trailing phrase.
 * The longer "added to existing stock" wording is left to the full line.
 */
export function describeActivityCompact(activity: OwnerTodayActivity) {
  const p = detailPieces(activity);
  const { time, action, branch } = describeActivity(activity);
  return {
    time,
    action,
    branch,
    actor: actorName(activity),
    detail: join([p.reopened, p.automatic, p.counterpart, p.count, p.reference]),
    discrepancy: p.discrepancy,
  };
}

/** Newest first. Ties keep the server's order (sort is stable), which ranks same-instant steps. */
export function sortActivitiesNewestFirst(activities: readonly OwnerTodayActivity[]): OwnerTodayActivity[] {
  return [...activities].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}
