import type { BranchSalesReportItem, ShiftRemittanceReport } from '../../types/models';
import type { DateFilterType } from './DateRangeFilter';
import { remittanceSummary } from './branchPerformanceCards';

export type BranchSalesRemittanceRow = {
  branchId: string;
  branchName: string;
  sales: number;
  transactions: number;
  remitted: number | null;
  reconciledShifts: number;
  isActive: boolean;
};

/** Preserve Total Sales date filter + expand the tapped branch in Sales by Branch. */
export function salesByBranchHref(args: {
  branchId: string;
  rangeType: DateFilterType;
  customStart?: string;
  customEnd?: string;
}): string {
  const params = new URLSearchParams();
  params.set('branchId', args.branchId);
  params.set('range', args.rangeType);
  if (args.rangeType === 'custom') {
    if (args.customStart) params.set('start', args.customStart);
    if (args.customEnd) params.set('end', args.customEnd);
  }
  return `/owner/reports/sales-by-branch?${params.toString()}`;
}

const toCents = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

/** Company-wide remitted cash for the selected range (reconciled shifts only). Never sales revenue. */
export function totalRemittance(report: ShiftRemittanceReport | undefined) {
  return remittanceSummary(report);
}

/**
 * Per-branch remitted cash from shift rows. Sales revenue is intentionally absent here —
 * callers join this with report_sales_by_branch separately.
 */
export function remittanceByBranch(report: ShiftRemittanceReport | undefined): Map<string, {
  branchId: string;
  branchName: string;
  remitted: number | null;
  reconciledShifts: number;
}> {
  const byBranch = new Map<string, {
    branchId: string;
    branchName: string;
    remittedCents: number;
    reconciledShifts: number;
  }>();

  for (const day of report?.days ?? []) {
    for (const shift of day.shifts ?? []) {
      if (!shift.branch_id) continue;
      const current = byBranch.get(shift.branch_id) ?? {
        branchId: shift.branch_id,
        branchName: shift.branch_name,
        remittedCents: 0,
        reconciledShifts: 0,
      };
      if (shift.status === 'reconciled' && shift.actual_cash != null) {
        current.remittedCents += toCents(shift.actual_cash) + toCents(shift.actual_gcash ?? 0);
        current.reconciledShifts += 1;
      }
      byBranch.set(shift.branch_id, current);
    }
  }

  const result = new Map<string, {
    branchId: string;
    branchName: string;
    remitted: number | null;
    reconciledShifts: number;
  }>();
  for (const [id, row] of byBranch) {
    result.set(id, {
      branchId: row.branchId,
      branchName: row.branchName,
      remitted: row.reconciledShifts > 0 ? row.remittedCents / 100 : null,
      reconciledShifts: row.reconciledShifts,
    });
  }
  return result;
}

/** Merge sales and remittance by branch without treating sales as remitted cash. */
export function buildTotalSalesBranchRows(
  sales: readonly BranchSalesReportItem[] | null | undefined,
  remittance: ShiftRemittanceReport | undefined,
): BranchSalesRemittanceRow[] {
  const remittanceMap = remittanceByBranch(remittance);
  const rows = new Map<string, BranchSalesRemittanceRow>();

  for (const item of sales ?? []) {
    if (!item?.branch_id) continue;
    const cash = remittanceMap.get(item.branch_id);
    rows.set(item.branch_id, {
      branchId: item.branch_id,
      branchName: item.branch_name,
      sales: Number(item.total_sales) || 0,
      transactions: Math.max(0, Math.trunc(Number(item.transaction_count) || 0)),
      remitted: cash?.remitted ?? null,
      reconciledShifts: cash?.reconciledShifts ?? 0,
      isActive: item.is_active !== false,
    });
  }

  for (const cash of remittanceMap.values()) {
    if (rows.has(cash.branchId)) continue;
    rows.set(cash.branchId, {
      branchId: cash.branchId,
      branchName: cash.branchName,
      sales: 0,
      transactions: 0,
      remitted: cash.remitted,
      reconciledShifts: cash.reconciledShifts,
      isActive: true,
    });
  }

  return [...rows.values()].sort((a, b) => b.sales - a.sales || a.branchName.localeCompare(b.branchName));
}
