/** Client-side branch gating for Void logs. The RPC is company-wide; Owner drill-in must not show other branches. */

export type VoidLogRow = {
  event_id: string;
  recorded_at: string;
  sale_number: string;
  product_name: string;
  variant_name: string | null;
  product_category: string | null;
  branch_name: string;
  cashier_name: string;
  quantity: number;
  amount: number | string;
  reason: string | null;
  note: string | null;
};

export type VoidLogTotals = {
  items: number;
  amount: number;
  transactions: number;
};

export type VoidLogBranchRow = {
  branchId: string | null;
  branchName: string;
  isActive: boolean;
  items: number;
  amount: number;
  transactions: number;
};

export function scopeVoidLogRows<T extends { branch_name: string }>(
  rows: readonly T[] | undefined,
  options: { branchId?: string; branchName?: string; branchLookupPending?: boolean },
): { rows: T[]; waitingForBranch: boolean; branchMissing: boolean } {
  const all = rows ?? [];
  if (!options.branchId) {
    return { rows: [...all], waitingForBranch: false, branchMissing: false };
  }
  if (options.branchLookupPending) {
    return { rows: [], waitingForBranch: true, branchMissing: false };
  }
  const name = options.branchName?.trim();
  if (!name) {
    return { rows: [], waitingForBranch: false, branchMissing: true };
  }
  return {
    rows: all.filter((row) => row.branch_name === name),
    waitingForBranch: false,
    branchMissing: false,
  };
}

/** Inclusive start / exclusive end from already-resolved ISO strings. Missing either bound means All Time. */
export function voidLogTimeBounds(window: { start?: string; end?: string }): { start?: number; end?: number } {
  if (!window.start || !window.end) return {};
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return {};
  return { start, end };
}

export function voidLogsInRange(
  rows: readonly VoidLogRow[],
  bounds: { start?: number; end?: number },
): VoidLogRow[] {
  if (bounds.start == null || bounds.end == null) return [...rows];
  const start = bounds.start;
  const end = bounds.end;
  return rows.filter((row) => {
    const at = Date.parse(row.recorded_at);
    return Number.isFinite(at) && at >= start && at < end;
  });
}

/** Sum item quantities and deducted amount; unique sale_number is the transaction count. */
export function summarizeVoidLogs(rows: readonly VoidLogRow[]): VoidLogTotals {
  let itemCount = 0;
  let amountCents = 0;
  const sales = new Set<string>();
  for (const row of rows) {
    itemCount += Number(row.quantity) || 0;
    amountCents += Math.round((Number(row.amount) || 0) * 100);
    if (row.sale_number) sales.add(row.sale_number);
  }
  return { items: itemCount, amount: amountCents / 100, transactions: sales.size };
}

export function voidLogsBranchMeta(items: number, transactions: number): string {
  const itemLabel = `${items} voided ${Number(items) === 1 ? 'item' : 'items'}`;
  const txLabel = `${transactions} ${Number(transactions) === 1 ? 'transaction' : 'transactions'}`;
  return `${itemLabel} · ${txLabel}`;
}

export function voidLogsBranchHref(args: {
  /** Which role's route tree to open (the Main Manager has its own, same screens). Owner by default. */
  role?: 'owner' | 'manager';
  branchId: string;
  rangeType: string;
  customStart?: string;
  customEnd?: string;
}): string {
  const params = new URLSearchParams();
  params.set('range', args.rangeType);
  if (args.rangeType === 'custom') {
    if (args.customStart) params.set('start', args.customStart);
    if (args.customEnd) params.set('end', args.customEnd);
  }
  const query = params.toString();
  const base = `/${args.role ?? 'owner'}/reports/void-logs/${args.branchId}`;
  return query ? `${base}?${query}` : base;
}

/**
 * Selling branches (non-main) plus any void branch names not in the catalog.
 * Totals come only from `rows` — a branch with no voids in range stays at 0.
 */
export function buildVoidLogBranchRows(
  branches: readonly { id: string; name: string; is_active: boolean; is_main_branch?: boolean }[],
  rows: readonly VoidLogRow[],
): VoidLogBranchRow[] {
  const selling = branches.filter((branch) => !branch.is_main_branch);
  const byName = new Map<string, VoidLogBranchRow>();

  for (const branch of selling) {
    byName.set(branch.name, {
      branchId: branch.id,
      branchName: branch.name,
      isActive: branch.is_active,
      items: 0,
      amount: 0,
      transactions: 0,
    });
  }

  const grouped = new Map<string, VoidLogRow[]>();
  for (const row of rows) {
    const name = row.branch_name;
    const list = grouped.get(name);
    if (list) list.push(row);
    else grouped.set(name, [row]);
  }

  for (const [name, group] of grouped) {
    const totals = summarizeVoidLogs(group);
    const current = byName.get(name);
    if (current) {
      current.items = totals.items;
      current.amount = totals.amount;
      current.transactions = totals.transactions;
      continue;
    }
    byName.set(name, {
      branchId: selling.find((branch) => branch.name === name)?.id ?? null,
      branchName: name,
      isActive: false,
      items: totals.items,
      amount: totals.amount,
      transactions: totals.transactions,
    });
  }

  return [...byName.values()].sort((a, b) => {
    const amount = b.amount - a.amount;
    if (amount !== 0) return amount;
    const items = b.items - a.items;
    if (items !== 0) return items;
    return a.branchName.localeCompare(b.branchName);
  });
}
