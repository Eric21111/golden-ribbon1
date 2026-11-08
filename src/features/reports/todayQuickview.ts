import type { BranchSalesReportItem } from '../../types/models';

export type TodayBranchRevenue = {
  branchId: string;
  branchName: string;
  revenue: number;
  transactions: number;
  isActive: boolean;
};

export type TodayQuickview = {
  totalRevenue: number;
  totalTransactions: number;
  branches: TodayBranchRevenue[];
};

type TodayBranchRow = BranchSalesReportItem & { is_active?: boolean | null };

const toCents = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

/**
 * Owner "Today Quickview" from get_owner_today_branch_sales: one row per active selling branch plus any
 * branch deactivated after selling today (Main never sells), completed sales only, Asia/Manila business
 * day. The total is the sum of the branch rows, so it always matches the breakdown. Summed in cents.
 */
export function buildTodayQuickview(rows: readonly TodayBranchRow[] | null | undefined): TodayQuickview {
  const seen = new Set<string>();
  const branches: TodayBranchRevenue[] = [];
  let totalCents = 0;
  let totalTransactions = 0;

  for (const row of rows ?? []) {
    if (!row?.branch_id || seen.has(row.branch_id)) continue;
    seen.add(row.branch_id);
    const cents = toCents(row.total_sales);
    const transactions = Math.max(0, Math.trunc(Number(row.transaction_count) || 0));
    totalCents += cents;
    totalTransactions += transactions;
    branches.push({
      branchId: row.branch_id,
      branchName: row.branch_name,
      revenue: cents / 100,
      transactions,
      isActive: row.is_active !== false,
    });
  }

  return { totalRevenue: totalCents / 100, totalTransactions, branches };
}

export type TodayQuickviewStatus = 'loading' | 'error' | 'ready';

/**
 * Error wins over cached data: after a failed refetch React Query keeps the previous result, which may be
 * an earlier business day's revenue, so it must not be shown as today's.
 */
export function todayQuickviewStatus(query: { data?: unknown; isError: boolean }): TodayQuickviewStatus {
  if (query.isError) return 'error';
  return query.data === undefined ? 'loading' : 'ready';
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Asia/Manila calendar date (YYYY-MM-DD). Manila is UTC+8 with no daylight saving. */
export function manilaBusinessDate(nowMs: number = Date.now()): string {
  return new Date(nowMs + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Milliseconds until the next Asia/Manila midnight (always > 0). */
export function msUntilNextManilaDay(nowMs: number = Date.now()): number {
  const shifted = nowMs + MANILA_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS - shifted;
}
