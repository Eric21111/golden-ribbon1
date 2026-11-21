import type { ProductSalesReportItem } from '@/types/models';

import type { DateFilterType } from './DateRangeFilter';

export type ProductSalesTotals = {
  itemsSold: number;
  revenue: number;
};

export type ProductSalesBranchRow = {
  branchId: string;
  branchName: string;
  isActive: boolean;
  itemsSold: number;
  revenue: number;
};

type RangeArgs = {
  rangeType: DateFilterType;
  customStart?: string;
  customEnd?: string;
};

function appendRange(path: string, args: RangeArgs): string {
  const params = new URLSearchParams();
  params.set('range', args.rangeType);
  if (args.rangeType === 'custom') {
    if (args.customStart) params.set('start', args.customStart);
    if (args.customEnd) params.set('end', args.customEnd);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Sum PCS quantities and product revenue. Rows from report_product_sales are already keyed by product_id. */
export function summarizeProductSales(items: readonly ProductSalesReportItem[] | undefined): ProductSalesTotals {
  let itemsSold = 0;
  let revenue = 0;
  for (const item of items ?? []) {
    itemsSold += Number(item.quantity_sold) || 0;
    revenue += Number(item.total_revenue) || 0;
  }
  return { itemsSold, revenue };
}

/**
 * Merge product rows by stable product_id (not name). Used when combining per-branch
 * payloads client-side so SKU renames cannot double-count.
 */
export function mergeProductSalesByProductId(
  groups: readonly (readonly ProductSalesReportItem[] | undefined)[],
): ProductSalesReportItem[] {
  const byId = new Map<string, ProductSalesReportItem>();
  for (const group of groups) {
    for (const item of group ?? []) {
      const id = item.product_id;
      if (!id) continue;
      const current = byId.get(id);
      if (!current) {
        byId.set(id, {
          ...item,
          quantity_sold: Number(item.quantity_sold) || 0,
          total_revenue: Number(item.total_revenue) || 0,
        });
        continue;
      }
      current.quantity_sold = Number(current.quantity_sold) + (Number(item.quantity_sold) || 0);
      current.total_revenue = Number(current.total_revenue) + (Number(item.total_revenue) || 0);
      if (item.product_name) current.product_name = item.product_name;
      if (item.product_sku) current.product_sku = item.product_sku;
      if (item.stock_unit_code != null) current.stock_unit_code = item.stock_unit_code;
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue));
}

export function buildProductSalesBranchRows(
  branches: readonly { id: string; name: string; is_active: boolean }[],
  salesByBranchId: ReadonlyMap<string, ProductSalesTotals>,
): ProductSalesBranchRow[] {
  return branches
    .map((branch) => {
      const totals = salesByBranchId.get(branch.id) ?? { itemsSold: 0, revenue: 0 };
      return {
        branchId: branch.id,
        branchName: branch.name,
        isActive: branch.is_active,
        itemsSold: totals.itemsSold,
        revenue: totals.revenue,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.branchName.localeCompare(b.branchName));
}

export function productSalesOverviewHref(args: RangeArgs): string {
  return appendRange('/owner/reports/product-sales', args);
}

export function productSalesBranchHref(args: RangeArgs & { branchId: string }): string {
  return appendRange(`/owner/reports/product-sales/${args.branchId}`, args);
}
