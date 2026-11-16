import type { Branch, ShiftWasteReport } from '@/types/models';
import type { DateFilterType } from './DateRangeFilter';

export type WasteHistoryBranchRow = {
  branchId: string;
  branchName: string;
  isMain: boolean;
  isActive: boolean;
  occurrenceCount: number;
  daysWithWaste: number;
};

function sortWasteHistoryBranches(a: Branch, b: Branch): number {
  if (a.is_main_branch !== b.is_main_branch) return a.is_main_branch ? 1 : -1;
  return a.name.localeCompare(b.name);
}

/**
 * Hub candidates: every active branch (selling + Main), plus inactive branches that
 * already have waste in the selected range so historical records stay reachable.
 */
export function wasteHistoryBranchCandidates(
  branches: Branch[] | undefined,
  branchIdsWithWaste: ReadonlySet<string>,
): Branch[] {
  return (branches ?? [])
    .filter((branch) => branch.is_active || branchIdsWithWaste.has(branch.id))
    .slice()
    .sort(sortWasteHistoryBranches);
}

/** Summarize waste occurrences per branch for the selected range (read-only). */
export function buildWasteHistoryBranchRows(
  branches: Branch[] | undefined,
  report: ShiftWasteReport | undefined,
): WasteHistoryBranchRow[] {
  const counts = new Map<string, { occurrences: number; days: Set<string>; branchName: string }>();
  for (const day of report?.days ?? []) {
    for (const shift of day.shifts ?? []) {
      if (shift.waste_status !== 'waste_recorded') continue;
      const row = counts.get(shift.branch_id) ?? {
        occurrences: 0,
        days: new Set<string>(),
        branchName: shift.branch_name,
      };
      row.occurrences += shift.occurrences?.length ?? 0;
      if ((shift.occurrences?.length ?? 0) > 0) row.days.add(String(day.business_date).slice(0, 10));
      row.branchName = shift.branch_name || row.branchName;
      counts.set(shift.branch_id, row);
    }
  }

  const known = new Map((branches ?? []).map((branch) => [branch.id, branch]));
  // Prefer the branches table; fall back to report names if a row is somehow missing locally.
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

  return wasteHistoryBranchCandidates(candidates, new Set(counts.keys())).map((branch) => {
    const stats = counts.get(branch.id);
    return {
      branchId: branch.id,
      branchName: branch.name,
      isMain: Boolean(branch.is_main_branch),
      isActive: Boolean(branch.is_active),
      occurrenceCount: stats?.occurrences ?? 0,
      daysWithWaste: stats?.days.size ?? 0,
    };
  });
}

export function wasteHistoryBranchHref(args: {
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
  const base = args.role === 'owner' ? '/owner/reports/waste-history' : '/manager/reports/waste-history';
  return `${base}/${args.branchId}?${params.toString()}`;
}

export function wasteHistoryBranchMeta(row: WasteHistoryBranchRow): string {
  if (row.occurrenceCount === 0) return 'No waste in this range';
  const occ = `${row.occurrenceCount} ${row.occurrenceCount === 1 ? 'occurrence' : 'occurrences'}`;
  const days = `${row.daysWithWaste} ${row.daysWithWaste === 1 ? 'day' : 'days'}`;
  return `${occ} · ${days}`;
}
