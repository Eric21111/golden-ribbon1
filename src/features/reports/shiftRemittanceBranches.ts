import type { Branch, ShiftRemittanceReport } from '@/types/models';
import type { DateFilterType } from './DateRangeFilter';

export type ShiftRemittanceBranchRow = {
  branchId: string;
  branchName: string;
  isMain: boolean;
  isActive: boolean;
  shiftCount: number;
  pendingCount: number;
  reconciledCount: number;
};

function sortBranches(a: Branch, b: Branch): number {
  if (a.is_main_branch !== b.is_main_branch) return a.is_main_branch ? 1 : -1;
  return a.name.localeCompare(b.name);
}

/** Active selling branches only (Main is not a remittance store), plus inactive ones that already have remittance rows in range. */
export function remittanceBranchCandidates(
  branches: Branch[] | undefined,
  branchIdsWithRemittance: ReadonlySet<string>,
): Branch[] {
  return (branches ?? [])
    .filter((branch) => !branch.is_main_branch)
    .filter((branch) => branch.is_active || branchIdsWithRemittance.has(branch.id))
    .slice()
    .sort(sortBranches);
}

/** Summarize remittance shifts per branch for the selected range. */
export function buildShiftRemittanceBranchRows(
  branches: Branch[] | undefined,
  report: ShiftRemittanceReport | undefined,
): ShiftRemittanceBranchRow[] {
  const counts = new Map<
    string,
    { shiftCount: number; pendingCount: number; reconciledCount: number; branchName: string }
  >();

  for (const day of report?.days ?? []) {
    for (const shift of day.shifts ?? []) {
      if (!shift.branch_id) continue;
      const row = counts.get(shift.branch_id) ?? {
        shiftCount: 0,
        pendingCount: 0,
        reconciledCount: 0,
        branchName: shift.branch_name,
      };
      row.shiftCount += 1;
      if (shift.status === 'pending') row.pendingCount += 1;
      else row.reconciledCount += 1;
      row.branchName = shift.branch_name || row.branchName;
      counts.set(shift.branch_id, row);
    }
  }

  const known = new Map((branches ?? []).map((branch) => [branch.id, branch]));
  const candidates: Branch[] = [...known.values()];
  for (const [branchId, stats] of counts) {
    if (known.has(branchId)) continue;
    candidates.push({
      id: branchId,
      name: stats.branchName || 'Branch',
      code: 'HIST',
      address: null,
      is_main_branch: false,
      is_active: false,
      receiving_mode: 'counted',
      created_at: '',
      updated_at: '',
    });
  }

  return remittanceBranchCandidates(candidates, new Set(counts.keys())).map((branch) => {
    const stats = counts.get(branch.id);
    return {
      branchId: branch.id,
      branchName: branch.name,
      isMain: Boolean(branch.is_main_branch),
      isActive: Boolean(branch.is_active),
      shiftCount: stats?.shiftCount ?? 0,
      pendingCount: stats?.pendingCount ?? 0,
      reconciledCount: stats?.reconciledCount ?? 0,
    };
  });
}

export function shiftRemittanceBranchHref(args: {
  role: 'owner' | 'manager';
  branchId: string;
  rangeType: DateFilterType;
  customStart?: string;
  customEnd?: string;
}): string {
  const params = new URLSearchParams();
  params.set('range', args.rangeType);
  if (args.rangeType === 'custom') {
    if (args.customStart) params.set('start', args.customStart);
    if (args.customEnd) params.set('end', args.customEnd);
  }
  const base =
    args.role === 'owner' ? '/owner/reports/shift-remittances' : '/manager/reports/shift-remittances';
  return `${base}/branch/${args.branchId}?${params.toString()}`;
}

export function shiftRemittanceBranchMeta(row: ShiftRemittanceBranchRow): string {
  if (row.shiftCount === 0) return 'No remittances in this range';
  const shifts = `${row.shiftCount} ${row.shiftCount === 1 ? 'shift' : 'shifts'}`;
  if (row.pendingCount > 0) {
    return `${shifts} · ${row.pendingCount} pending`;
  }
  return `${shifts} · ${row.reconciledCount} reconciled`;
}
