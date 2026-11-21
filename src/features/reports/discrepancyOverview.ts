import type { Branch, ReturnDiscrepancyReportItem, TransferDiscrepancyReportItem } from '@/types/models';

export type DiscrepancyUnitRow = {
  difference: number;
  status?: string | null;
  branch_id: string;
  branch_name: string;
};

export type IssueBranchRow = {
  branchId: string;
  branchName: string;
  isMain: boolean;
  isActive: boolean;
  transferUnits: number;
  returnUnits: number;
  transferRecords: number;
  returnRecords: number;
  openCount: number;
  resolvedCount: number;
};

export type IssueCompanyTotals = {
  totalUnits: number;
  transferUnits: number;
  returnUnits: number;
  openCount: number;
  resolvedCount: number;
  recordCount: number;
};

export function discrepancyUnits(rows: readonly DiscrepancyUnitRow[]): number {
  return rows.reduce((sum, row) => sum + Math.abs(Number(row.difference) || 0), 0);
}

export function summarizeIssueRecords(
  transfers: readonly DiscrepancyUnitRow[],
  returns: readonly DiscrepancyUnitRow[],
): IssueCompanyTotals {
  const all = [...transfers, ...returns];
  return {
    totalUnits: discrepancyUnits(all),
    transferUnits: discrepancyUnits(transfers),
    returnUnits: discrepancyUnits(returns),
    openCount: all.filter((row) => (row.status ?? 'open') === 'open').length,
    resolvedCount: all.filter((row) => row.status === 'resolved').length,
    recordCount: all.length,
  };
}

function emptyBranchStats() {
  return {
    transferUnits: 0,
    returnUnits: 0,
    transferRecords: 0,
    returnRecords: 0,
    openCount: 0,
    resolvedCount: 0,
    name: '',
  };
}

function sortIssueBranches(a: IssueBranchRow, b: IssueBranchRow): number {
  if (a.isMain !== b.isMain) return a.isMain ? 1 : -1;
  return a.branchName.localeCompare(b.branchName);
}

function addRecord(
  stats: ReturnType<typeof emptyBranchStats>,
  row: DiscrepancyUnitRow,
  kind: 'transfer' | 'return',
) {
  const units = Math.abs(Number(row.difference) || 0);
  if (kind === 'transfer') {
    stats.transferUnits += units;
    stats.transferRecords += 1;
  } else {
    stats.returnUnits += units;
    stats.returnRecords += 1;
  }
  if ((row.status ?? 'open') === 'open') stats.openCount += 1;
  else if (row.status === 'resolved') stats.resolvedCount += 1;
  stats.name = row.branch_name || stats.name;
}

/** Selling + Main catalog rows, plus any extra branches that already have records in range. */
export function buildIssueBranchRows(
  transfers: readonly TransferDiscrepancyReportItem[],
  returns: readonly ReturnDiscrepancyReportItem[],
  branches: readonly Branch[] | undefined,
): IssueBranchRow[] {
  const stats = new Map<string, ReturnType<typeof emptyBranchStats>>();
  const bump = (row: DiscrepancyUnitRow, kind: 'transfer' | 'return') => {
    const current = stats.get(row.branch_id) ?? emptyBranchStats();
    addRecord(current, row, kind);
    stats.set(row.branch_id, current);
  };
  for (const row of transfers) bump(row, 'transfer');
  for (const row of returns) bump(row, 'return');

  const known = new Map((branches ?? []).map((branch) => [branch.id, branch]));
  const rows: IssueBranchRow[] = [];
  const seen = new Set<string>();

  for (const branch of branches ?? []) {
    if (!branch.is_active && !stats.has(branch.id)) continue;
    const itemStats = stats.get(branch.id) ?? emptyBranchStats();
    seen.add(branch.id);
    rows.push({
      branchId: branch.id,
      branchName: branch.name,
      isMain: Boolean(branch.is_main_branch),
      isActive: Boolean(branch.is_active),
      transferUnits: itemStats.transferUnits,
      returnUnits: itemStats.returnUnits,
      transferRecords: itemStats.transferRecords,
      returnRecords: itemStats.returnRecords,
      openCount: itemStats.openCount,
      resolvedCount: itemStats.resolvedCount,
    });
  }

  for (const [branchId, itemStats] of stats) {
    if (seen.has(branchId)) continue;
    const catalog = known.get(branchId);
    rows.push({
      branchId,
      branchName: catalog?.name ?? itemStats.name ?? 'Branch',
      isMain: Boolean(catalog?.is_main_branch),
      isActive: Boolean(catalog?.is_active ?? true),
      transferUnits: itemStats.transferUnits,
      returnUnits: itemStats.returnUnits,
      transferRecords: itemStats.transferRecords,
      returnRecords: itemStats.returnRecords,
      openCount: itemStats.openCount,
      resolvedCount: itemStats.resolvedCount,
    });
  }

  return rows.sort(sortIssueBranches);
}

export function issueBranchMeta(row: IssueBranchRow): string {
  const records = row.transferRecords + row.returnRecords;
  if (records === 0) return 'No records in this range';
  const units = row.transferUnits + row.returnUnits;
  return `${units} ${units === 1 ? 'unit' : 'units'} · ${records} ${records === 1 ? 'record' : 'records'}`;
}

export function issueBranchBadge(
  row: IssueBranchRow,
): { label: string; tone: 'danger' | 'success' | 'neutral' } {
  if (row.openCount > 0) {
    return { label: `${row.openCount} open`, tone: 'danger' };
  }
  if (row.resolvedCount > 0) {
    return { label: 'Resolved', tone: 'success' };
  }
  return { label: '—', tone: 'neutral' };
}
