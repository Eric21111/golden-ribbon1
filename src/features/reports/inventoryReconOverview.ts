import type {
  Branch,
  DiscrepancyResolutionReason,
  InventoryReconciliationItem,
  InventoryReconciliationResolvedDiscrepancy,
} from '@/types/models';
import type { DateFilterType } from './DateRangeFilter';

export type InventoryReconBranchRow = {
  branchId: string;
  branchName: string;
  isMain: boolean;
  isActive: boolean;
  itemCount: number;
  issueCount: number;
};

export type InventoryReconTotals = {
  itemCount: number;
  balancedCount: number;
  issueCount: number;
};

export const RECON_RESOLUTION_REASON_LABELS: Record<DiscrepancyResolutionReason, string> = {
  confirmed_shortage: 'Confirmed shortage',
  confirmed_excess: 'Confirmed excess',
  counting_error: 'Counting error',
  encoding_error: 'Encoding error',
  transfer_handling_issue: 'Transfer handling issue',
  return_handling_issue: 'Return handling issue',
  other: 'Other',
};

export function reconResolutionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Resolved';
  return RECON_RESOLUTION_REASON_LABELS[reason as DiscrepancyResolutionReason] ?? reason;
}

export function reconResolvedRows(
  item: InventoryReconciliationItem,
): InventoryReconciliationResolvedDiscrepancy[] {
  return item.resolved_discrepancies ?? [];
}

export function reconHasStockMismatch(item: InventoryReconciliationItem): boolean {
  return Number(item.variance) !== 0;
}

export function reconHasOpenReturnIssue(item: InventoryReconciliationItem): boolean {
  return Number(item.return_missing_qty) > 0 || Number(item.return_excess_qty) > 0;
}

export function reconHasOpenTransferIssue(item: InventoryReconciliationItem): boolean {
  return Number(item.transfer_missing_qty) > 0 || Number(item.transfer_excess_qty) > 0;
}

export function reconHasResolvedDiscrepancy(item: InventoryReconciliationItem): boolean {
  return reconResolvedRows(item).length > 0;
}

/** Open stock mismatch or open transfer/return count issues. Resolved rows do not count. */
export function reconItemHasIssue(item: InventoryReconciliationItem): boolean {
  return reconHasStockMismatch(item) || reconHasOpenReturnIssue(item) || reconHasOpenTransferIssue(item);
}

/**
 * Badge from actual open vs resolved status. Zero variance is not treated as resolved.
 * Open return/transfer qty stays an issue even when on-hand already matches the ledger.
 */
export function reconciliationItemBadge(item: InventoryReconciliationItem): {
  label: string;
  tone: 'danger' | 'warning' | 'success';
} {
  if (reconHasStockMismatch(item)) return { label: 'Stock mismatch', tone: 'danger' };
  if (reconHasOpenReturnIssue(item)) return { label: 'Return issue', tone: 'warning' };
  if (reconHasOpenTransferIssue(item)) return { label: 'Transfer issue', tone: 'warning' };
  if (reconHasResolvedDiscrepancy(item)) return { label: 'Resolved', tone: 'success' };
  return { label: 'Balanced', tone: 'success' };
}

export function reconCompactReasonLine(item: InventoryReconciliationItem): string | null {
  const latest = reconResolvedRows(item)[0];
  if (!latest) return null;
  const kind = latest.kind === 'return' ? 'Return' : 'Transfer';
  return `${kind} · ${reconResolutionReasonLabel(latest.resolution_reason)}`;
}

function kindQtyLine(kind: 'Transfer' | 'Return', missing: number, excess: number): string | null {
  const bits = [];
  if (missing > 0) bits.push(`${missing} missing`);
  if (excess > 0) bits.push(`${excess} excess`);
  return bits.length ? `${kind} · ${bits.join(' · ')}` : null;
}

/** Open transfer/return count issues only. Resolved history is separate. */
export function reconOpenStatusLine(item: InventoryReconciliationItem): string | null {
  const open = [
    kindQtyLine('Transfer', Number(item.transfer_missing_qty), Number(item.transfer_excess_qty)),
    kindQtyLine('Return', Number(item.return_missing_qty), Number(item.return_excess_qty)),
  ].filter(Boolean);
  return open.length ? open.join(' · ') : null;
}

/** Reason (+ optional note) for every resolved discrepancy on this product card. */
export function reconResolvedStatusLine(item: InventoryReconciliationItem): string | null {
  const rows = reconResolvedRows(item);
  if (rows.length === 0) return null;
  return rows
    .map((row) => {
      const kind = row.kind === 'return' ? 'Return' : 'Transfer';
      const reason = reconResolutionReasonLabel(row.resolution_reason);
      const note = row.resolution_note?.trim();
      return note ? `${kind} · ${reason} · ${note}` : `${kind} · ${reason}`;
    })
    .join(' · ');
}

/** Collapsed card line: open count issue first, else the latest resolution reason. */
export function reconCollapsedStatusLine(item: InventoryReconciliationItem): string | null {
  return reconOpenStatusLine(item) ?? reconCompactReasonLine(item);
}

export type ReconMovementLine = { label: string; quantity: number };

/** Movement rows for the details sheet. Zero-qty lines are omitted. */
export function reconNonZeroMovementLines(item: InventoryReconciliationItem): ReconMovementLine[] {
  return [
    { label: 'Opening stock', quantity: Number(item.opening_stock) },
    { label: 'Received transfer', quantity: Number(item.transfer_in) },
    { label: 'Sent transfer', quantity: -Number(item.transfer_out) },
    { label: 'Sales', quantity: -Number(item.sale) },
    { label: 'Return received', quantity: Number(item.return_in ?? 0) },
    { label: 'Returned leftover', quantity: -Number(item.return_out) },
    { label: 'Adjustments', quantity: Number(item.adjustment) },
  ].filter((line) => line.quantity !== 0);
}

export function reconResolvedRowDetail(row: InventoryReconciliationResolvedDiscrepancy): {
  title: string;
  meta: string | null;
} {
  const kind = row.kind === 'return' ? 'Return' : 'Transfer';
  const title = `${kind} · ${reconResolutionReasonLabel(row.resolution_reason)}`;
  const parts = [
    row.resolved_by_name?.trim() || '',
    row.resolution_note?.trim() || '',
  ].filter(Boolean);
  return { title, meta: parts.length ? parts.join(' · ') : null };
}

export function summarizeInventoryRecon(items: readonly InventoryReconciliationItem[]): InventoryReconTotals {
  const issueCount = items.filter(reconItemHasIssue).length;
  return {
    itemCount: items.length,
    balancedCount: items.length - issueCount,
    issueCount,
  };
}

function sortReconBranches(a: InventoryReconBranchRow, b: InventoryReconBranchRow): number {
  if (a.isMain !== b.isMain) return a.isMain ? 1 : -1;
  return a.branchName.localeCompare(b.branchName);
}

/** One hub row per catalog branch (selling + Main), plus any extra branches present in the RPC. */
export function buildInventoryReconBranchRows(
  items: readonly InventoryReconciliationItem[],
  branches: readonly Branch[] | undefined,
): InventoryReconBranchRow[] {
  const stats = new Map<string, { name: string; itemCount: number; issueCount: number }>();
  for (const item of items) {
    const row = stats.get(item.branch_id) ?? { name: item.branch_name, itemCount: 0, issueCount: 0 };
    row.itemCount += 1;
    if (reconItemHasIssue(item)) row.issueCount += 1;
    row.name = item.branch_name || row.name;
    stats.set(item.branch_id, row);
  }

  const known = new Map((branches ?? []).map((branch) => [branch.id, branch]));
  const rows: InventoryReconBranchRow[] = [];
  const seen = new Set<string>();

  for (const branch of branches ?? []) {
    if (!branch.is_active && !stats.has(branch.id)) continue;
    const itemStats = stats.get(branch.id);
    seen.add(branch.id);
    rows.push({
      branchId: branch.id,
      branchName: branch.name,
      isMain: Boolean(branch.is_main_branch),
      isActive: Boolean(branch.is_active),
      itemCount: itemStats?.itemCount ?? 0,
      issueCount: itemStats?.issueCount ?? 0,
    });
  }

  for (const [branchId, itemStats] of stats) {
    if (seen.has(branchId)) continue;
    const catalog = known.get(branchId);
    rows.push({
      branchId,
      branchName: catalog?.name ?? itemStats.name,
      isMain: Boolean(catalog?.is_main_branch),
      isActive: Boolean(catalog?.is_active ?? true),
      itemCount: itemStats.itemCount,
      issueCount: itemStats.issueCount,
    });
  }

  return rows.sort(sortReconBranches);
}

function appendRange(
  params: URLSearchParams,
  args: { rangeType: DateFilterType; customStart?: string; customEnd?: string },
) {
  params.set('range', args.rangeType);
  if (args.rangeType === 'custom') {
    if (args.customStart) params.set('start', args.customStart);
    if (args.customEnd) params.set('end', args.customEnd);
  }
}

export function inventoryReconOverviewHref(args: {
  rangeType: DateFilterType;
  customStart?: string;
  customEnd?: string;
}): string {
  const params = new URLSearchParams();
  appendRange(params, args);
  return `/owner/reports/inventory-reconciliation?${params.toString()}`;
}

export function inventoryReconBranchHref(args: {
  branchId: string;
  rangeType: DateFilterType;
  customStart?: string;
  customEnd?: string;
}): string {
  const params = new URLSearchParams();
  params.set('branchId', args.branchId);
  appendRange(params, args);
  return `/owner/reports/inventory-reconciliation?${params.toString()}`;
}

export function inventoryReconBranchMeta(row: InventoryReconBranchRow): string {
  if (row.itemCount === 0) return 'No items in report';
  return `${row.itemCount} ${row.itemCount === 1 ? 'item' : 'items'}`;
}

export function inventoryReconIssueBadge(row: InventoryReconBranchRow): { label: string; tone: 'danger' | 'success' } {
  if (row.issueCount > 0) {
    return { label: `${row.issueCount} ${row.issueCount === 1 ? 'issue' : 'issues'}`, tone: 'danger' };
  }
  return { label: 'No issues', tone: 'success' };
}
