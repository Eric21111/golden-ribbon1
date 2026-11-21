import type { DateFilterType } from './DateRangeFilter';
import { productSalesBranchHref } from './productSalesDashboard';
import { salesByBranchHref } from './totalSalesDashboard';
import { shiftRemittanceBranchHref } from './shiftRemittanceBranches';
import { inventoryReconBranchHref } from './inventoryReconOverview';
import { wasteHistoryBranchHref } from './wasteHistoryBranches';

const DATE_FILTERS = new Set<DateFilterType>(['all_time', 'today', 'this_week', 'this_month', 'custom']);

export function firstSearchParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function parseReportDateFilter(value: string): DateFilterType {
  return DATE_FILTERS.has(value as DateFilterType) ? (value as DateFilterType) : 'today';
}

/** Append `range` (+ custom `start`/`end`) to a report path. */
export function appendReportRangeQuery(
  path: string,
  args: { rangeType: DateFilterType; customStart?: string; customEnd?: string },
): string {
  const params = new URLSearchParams();
  params.set('range', args.rangeType);
  if (args.rangeType === 'custom') {
    if (args.customStart) params.set('start', args.customStart);
    if (args.customEnd) params.set('end', args.customEnd);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export type BranchHubRangeArgs = {
  branchId: string;
  rangeType: DateFilterType;
  customStart?: string;
  customEnd?: string;
};

/** Owner Branch Hub for one branch, preserving the selected report range. */
export function branchHubHref(args: BranchHubRangeArgs): string {
  return appendReportRangeQuery(`/owner/reports/branch/${args.branchId}`, args);
}

/** Existing sales history drill-down (Sales Overview deep link). */
export function branchSalesHistoryHref(args: BranchHubRangeArgs): string {
  return salesByBranchHref({
    branchId: args.branchId,
    rangeType: args.rangeType,
    customStart: args.customStart,
    customEnd: args.customEnd,
  });
}

export function branchRemittanceHref(args: BranchHubRangeArgs): string {
  return shiftRemittanceBranchHref({
    role: 'owner',
    branchId: args.branchId,
    rangeType: args.rangeType,
    customStart: args.customStart,
    customEnd: args.customEnd,
  });
}

export function branchWasteHref(args: BranchHubRangeArgs): string {
  return wasteHistoryBranchHref({
    role: 'owner',
    branchId: args.branchId,
    rangeType: args.rangeType,
    customStart: args.customStart,
    customEnd: args.customEnd,
  });
}

export function branchInventoryReconciliationHref(args: BranchHubRangeArgs): string {
  return inventoryReconBranchHref(args);
}

export function branchTransferReturnIssuesHref(args: BranchHubRangeArgs): string {
  return transferReturnIssuesHref(args);
}

/** Transfer & Return Issues, optionally scoped to one branch, with the selected report range. */
export function transferReturnIssuesHref(args: {
  branchId?: string;
  rangeType: DateFilterType;
  customStart?: string;
  customEnd?: string;
}): string {
  const params = new URLSearchParams();
  if (args.branchId) params.set('branchId', args.branchId);
  params.set('range', args.rangeType);
  if (args.rangeType === 'custom') {
    if (args.customStart) params.set('start', args.customStart);
    if (args.customEnd) params.set('end', args.customEnd);
  }
  return `/owner/reports/discrepancies?${params.toString()}`;
}

export function salesOverviewHref(args: {
  rangeType: DateFilterType;
  customStart?: string;
  customEnd?: string;
}): string {
  return appendReportRangeQuery('/owner/reports/sales-overview', args);
}

export type BranchHubLinkId =
  | 'sales'
  | 'remittance'
  | 'inventory'
  | 'discrepancies'
  | 'waste'
  | 'product_sales';

export type BranchHubLink = {
  id: BranchHubLinkId;
  title: string;
  description: string;
  icon:
    | 'receipt-outline'
    | 'cash-outline'
    | 'checkmark-done-outline'
    | 'alert-circle-outline'
    | 'leaf-outline'
    | 'pricetag-outline'
    | 'wallet-outline';
  accent: 'blue' | 'gold' | 'green' | 'red' | 'teal';
  href: string | null;
  unavailableReason?: string;
};

/**
 * Report shortcuts for Owner Branch Hub. Sales detail is inline; Product Sales and
 * Shift Remittances open existing range-aware routes.
 */
export function buildBranchHubLinks(args: {
  branchId: string;
  rangeType: DateFilterType;
  customStart?: string;
  customEnd?: string;
  isMainBranch: boolean;
}): BranchHubLink[] {
  if (args.isMainBranch) {
    return [
      {
        id: 'product_sales',
        title: 'Product Sales',
        description: 'Items sold and product revenue',
        icon: 'pricetag-outline',
        accent: 'teal',
        href: null,
        unavailableReason: 'Main warehouse is not a selling branch for this report.',
      },
      {
        id: 'remittance',
        title: 'Shift Remittances',
        description: 'Cash and GCash counted at shift close',
        icon: 'wallet-outline',
        accent: 'gold',
        href: null,
        unavailableReason: 'Main warehouse is not a selling branch for this report.',
      },
    ];
  }

  const range = {
    branchId: args.branchId,
    rangeType: args.rangeType,
    customStart: args.customStart,
    customEnd: args.customEnd,
  };

  return [
    {
      id: 'product_sales',
      title: 'Product Sales',
      description: 'Items sold and product revenue for this branch',
      icon: 'pricetag-outline',
      accent: 'teal',
      href: productSalesBranchHref(range),
    },
    {
      id: 'remittance',
      title: 'Shift Remittances',
      description: 'Cash and GCash counted at shift close',
      icon: 'wallet-outline',
      accent: 'gold',
      href: branchRemittanceHref(range),
    },
  ];
}
