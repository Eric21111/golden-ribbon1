import type {
  BranchPerformanceInventoryItem,
  BranchPerformanceRecentTransfer,
  ShiftRemittanceReport,
} from '../../types/models';

/** Expanded branch ids after tapping a card: opens a collapsed card, closes an open one. */
export function toggleExpandedBranch(expanded: ReadonlySet<string>, branchId: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(branchId)) next.delete(branchId);
  else next.add(branchId);
  return next;
}

/** Absolute report window; both undefined means All Time. */
export type ReportWindow = { start?: string; end?: string };

/**
 * Transfers sent inside the window. The details RPC returns the branch's 5 latest transfers regardless
 * of range, so for a window that runs up to now this is exactly the most recent transfers in the period.
 */
export function transfersInWindow(
  transfers: readonly BranchPerformanceRecentTransfer[],
  window: ReportWindow,
): BranchPerformanceRecentTransfer[] {
  if (!window.start || !window.end) return [...transfers];
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  return transfers.filter((transfer) => {
    const sentAt = Date.parse(transfer.sent_at ?? '');
    return Number.isFinite(sentAt) && sentAt >= start && sentAt < end;
  });
}

/** A custom range that ended before now can hold transfers older than the 5 latest the RPC returns. */
export function windowEndsBeforeNow(window: ReportWindow, nowMs: number = Date.now()): boolean {
  if (!window.end) return false;
  const end = Date.parse(window.end);
  return Number.isFinite(end) && end <= nowMs;
}

/** Cash counted at shift close (reconciled shifts only), kept apart from sales revenue. */
export function remittanceSummary(report: ShiftRemittanceReport | undefined) {
  let remittedCents = 0;
  let pendingCents = 0;
  let reconciledShifts = 0;
  let pendingShifts = 0;
  for (const day of report?.days ?? []) {
    reconciledShifts += Number(day.reconciled_shift_count) || 0;
    pendingShifts += Number(day.pending_shift_count) || 0;
    if (day.actual_remitted != null) remittedCents += Math.round((Number(day.actual_remitted) + Number(day.actual_gcash ?? 0)) * 100);
    pendingCents += Math.round((Number(day.pending_expected_cash ?? 0) + Number(day.pending_gcash ?? 0)) * 100);
  }
  return {
    remitted: reconciledShifts > 0 ? remittedCents / 100 : null,
    reconciledShifts,
    pendingShifts,
    pendingExpected: pendingCents / 100,
  };
}

/** Products with stock on hand (first `limit`), plus counts of the rest for the full report. */
export function inventoryPreview(items: readonly BranchPerformanceInventoryItem[], limit = 8) {
  const stocked = items.filter((item) => Number(item.quantity_on_hand) !== 0);
  return {
    shown: stocked.slice(0, limit),
    moreStocked: Math.max(0, stocked.length - limit),
    zeroCount: items.length - stocked.length,
  };
}
