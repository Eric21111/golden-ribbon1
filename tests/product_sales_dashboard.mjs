import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const {
  summarizeProductSales,
  mergeProductSalesByProductId,
  buildProductSalesBranchRows,
  productSalesOverviewHref,
  productSalesBranchHref,
} = loadTs('src/features/reports/productSalesDashboard.ts');

assert.deepEqual(summarizeProductSales(undefined), { itemsSold: 0, revenue: 0 });
assert.deepEqual(
  summarizeProductSales([
    { product_id: 'p1', product_name: 'A', product_sku: 'A', quantity_sold: 2, total_revenue: 50 },
    { product_id: 'p2', product_name: 'B', product_sku: 'B', quantity_sold: 1, total_revenue: 25.5 },
  ]),
  { itemsSold: 3, revenue: 75.5 },
);

const merged = mergeProductSalesByProductId([
  [{ product_id: 'p1', product_name: 'Old', product_sku: 'SKU1', quantity_sold: 2, total_revenue: 40 }],
  [{ product_id: 'p1', product_name: 'New', product_sku: 'SKU1', quantity_sold: 3, total_revenue: 60 }],
  [{ product_id: 'p2', product_name: 'Other', product_sku: 'SKU2', quantity_sold: 1, total_revenue: 10 }],
]);
assert.equal(merged.length, 2);
assert.equal(merged[0].product_id, 'p1');
assert.equal(merged[0].quantity_sold, 5);
assert.equal(merged[0].total_revenue, 100);
assert.equal(merged[0].product_name, 'New');

const rows = buildProductSalesBranchRows(
  [
    { id: 'b2', name: 'SM2', is_active: true },
    { id: 'b1', name: 'SM1', is_active: true },
  ],
  new Map([
    ['b1', { itemsSold: 4, revenue: 80 }],
    ['b2', { itemsSold: 1, revenue: 20 }],
  ]),
);
assert.deepEqual(
  rows.map((row) => row.branchId),
  ['b1', 'b2'],
);
assert.equal(rows[0].itemsSold, 4);

assert.equal(productSalesOverviewHref({ rangeType: 'today' }), '/owner/reports/product-sales?range=today');
assert.equal(
  productSalesBranchHref({ branchId: 'b1', rangeType: 'this_week' }),
  '/owner/reports/product-sales/b1?range=this_week',
);
assert.match(
  productSalesBranchHref({
    branchId: 'b1',
    rangeType: 'custom',
    customStart: '2026-11-01',
    customEnd: '2026-11-07',
  }),
  /range=custom&start=2026-11-01&end=2026-11-07/,
);

const overview = readFileSync('src/features/reports/ProductSalesOverviewScreen.tsx', 'utf8');
assert.match(overview, /Product revenue/);
assert.match(overview, /Items sold/);
assert.match(overview, /OwnerSummaryKpiPair/);
assert.match(overview, /BRANCHES/);
assert.match(overview, /productSalesBranchHref/);
assert.doesNotMatch(overview, /Remittance|wallet-outline/);

const summary = readFileSync('src/features/reports/ReportsScreens.tsx', 'utf8');
assert.match(summary, /RankProgressRow/);
assert.doesNotMatch(summary, /All branches/);
assert.doesNotMatch(summary, /productSalesOverviewHref/);
assert.match(summary, /OwnerSummaryKpiPair/);
assert.match(summary, /PRODUCTS_PAGE_SIZE = 10/);
assert.match(summary, /useClientPagination/);
assert.match(summary, /Pagination/);

assert.match(
  readFileSync('app/(owner)/owner/reports/product-sales/index.tsx', 'utf8'),
  /ProductSalesOverviewScreen/,
);
assert.doesNotMatch(
  readFileSync('app/(owner)/owner/reports/product-sales/index.tsx', 'utf8'),
  /SellingBranchesHubScreen/,
);

console.log('Product Sales dashboard tests passed: aggregation, hrefs, overview shell.');
