import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');

const {
  buildTotalSalesBranchRows,
  remittanceByBranch,
  totalRemittance,
} = loadTs('src/features/reports/totalSalesDashboard.ts');

assert.deepEqual(totalRemittance(undefined), {
  remitted: null,
  reconciledShifts: 0,
  pendingShifts: 0,
  pendingExpected: 0,
});

const remittance = {
  days: [
    {
      business_date: '2026-11-16',
      expected_cash: 500,
      actual_remitted: 480,
      actual_gcash: 100,
      total_shortage: 20,
      total_excess: 0,
      reconciled_shift_count: 1,
      pending_shift_count: 1,
      pending_expected_cash: 50,
      pending_gcash: 0,
      shifts: [
        {
          shift_id: 's1',
          branch_id: 'b1',
          branch_name: 'SM1',
          cashier_id: 'c1',
          cashier_name: 'Cashier',
          started_at: '2026-11-16T08:00:00+08:00',
          ended_at: '2026-11-16T16:00:00+08:00',
          status: 'reconciled',
          expected_cash: 500,
          actual_cash: 480,
          actual_gcash: 100,
          difference: -20,
          result: 'shortage',
          reconciled_at: '2026-11-16T16:05:00+08:00',
        },
        {
          shift_id: 's2',
          branch_id: 'b2',
          branch_name: 'SM2',
          cashier_id: 'c2',
          cashier_name: 'Cashier 2',
          started_at: '2026-11-16T08:00:00+08:00',
          ended_at: null,
          status: 'pending',
          expected_cash: 50,
          actual_cash: null,
          difference: null,
          result: null,
          reconciled_at: null,
        },
      ],
    },
  ],
};

const company = totalRemittance(remittance);
assert.equal(company.remitted, 580);
assert.equal(company.reconciledShifts, 1);
assert.equal(company.pendingShifts, 1);

const byBranch = remittanceByBranch(remittance);
assert.equal(byBranch.get('b1').remitted, 580);
assert.equal(byBranch.get('b2').remitted, null);

const rows = buildTotalSalesBranchRows(
  [
    { branch_id: 'b1', branch_name: 'SM1', total_sales: 900, transaction_count: 4 },
    { branch_id: 'b2', branch_name: 'SM2', total_sales: 100, transaction_count: 1 },
  ],
  remittance,
);
assert.equal(rows[0].branchId, 'b1');
assert.equal(rows[0].sales, 900);
assert.equal(rows[0].remitted, 580);
assert.equal(rows[1].sales, 100);
assert.equal(rows[1].remitted, null);

const dashboard = readFileSync('app/(owner)/owner/dashboard.tsx', 'utf8');
assert.match(dashboard, /\/owner\/reports\/total-sales/);
assert.doesNotMatch(dashboard, /ManagerBottomSheet/);

const screenSrc = readFileSync('src/features/reports/TotalSalesDashboardScreen.tsx', 'utf8');
assert.match(screenSrc, /useSalesByBranch/);
assert.match(screenSrc, /useShiftRemittances/);
assert.match(screenSrc, /DateRangeFilter/);
assert.match(screenSrc, /Total remittance/);
assert.match(screenSrc, /Sales revenue is completed orders/);
assert.match(screenSrc, /\/owner\/reports\/sales-by-branch/);
assert.doesNotMatch(screenSrc, /supabase\.rpc/);

let salesState = { data: undefined, isLoading: true, isFetched: false, error: null, isRefetching: false, refetch: () => {} };
let remittanceState = { data: undefined, isLoading: true, isFetched: false, error: null, isRefetching: false, refetch: () => {} };
const Pass = (props) => React.createElement('div', null, props.children);
const Screen = loadTs('src/features/reports/TotalSalesDashboardScreen.tsx', {
  'react-native': rnw,
  'expo-router': { router: { push() {} } },
  '@/components/ConstrainedWidth': { ConstrainedWidth: Pass },
  '@/components/Screen': { Screen: Pass },
  '@/components/dashboard/ListRowCard': {
    ListRowCard: (p) => React.createElement('div', null, p.title, p.meta, p.trailing),
  },
  '@/components/dashboard/ManagerFeedback': {
    EmptyState: (p) => React.createElement('div', null, `EMPTY:${p.title}`),
    ErrorState: (p) => React.createElement('div', null, `ERROR:${p.message}`),
    LoadingState: (p) => React.createElement('div', null, `LOADING:${p.label}`),
  },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: () => null },
  '@/components/dashboard/StatTile': {
    StatTile: (p) => React.createElement('div', null, `${p.label}:${p.value}`),
  },
  '@/components/dashboard/theme': {
    managerColors: { ink: '#111', subtext: '#667', royalBlue: '#13c', green: '#0a0', goldMuted: '#a80', cardBorder: '#ddd', cardSurface: '#f4f6fa' },
  },
  '@/features/reports/DateRangeFilter': {
    DateRangeFilter: () => null,
    resolveReportRange: () => ({ rpcRangeType: 'today', startIso: null, endIso: null }),
  },
  '@/hooks/useSales': { useSalesByBranch: () => salesState },
  '@/hooks/useShifts': { useShiftRemittances: () => remittanceState },
  '@/lib/errors': { getErrorMessage: (e) => String(e.message || e) },
  '@/lib/nameAccent': { accentForName: () => 'blue' },
}).TotalSalesDashboardScreen;

const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
assert.match(flat(renderToStaticMarkup(React.createElement(Screen))), /LOADING:Loading company sales…/);

salesState = {
  data: [
    { branch_id: 'b1', branch_name: 'SM1', total_sales: 900, transaction_count: 4 },
    { branch_id: 'b2', branch_name: 'SM2', total_sales: 100, transaction_count: 1 },
  ],
  isLoading: false,
  isFetched: true,
  error: null,
  isRefetching: false,
  refetch: () => {},
};
remittanceState = {
  data: remittance,
  isLoading: false,
  isFetched: true,
  error: null,
  isRefetching: false,
  refetch: () => {},
};
let text = flat(renderToStaticMarkup(React.createElement(Screen)));
assert.match(text, /Total sales revenue:₱1,000\.00/);
assert.match(text, /Total remittance:₱580\.00/);
assert.match(text, /SM1/);
assert.match(text, /SM2/);
assert.match(text, /Remitted ₱580\.00/);
assert.match(text, /Remitted none yet/);

salesState = { data: [], isLoading: false, isFetched: true, error: null, isRefetching: false, refetch: () => {} };
remittanceState = { data: { days: [] }, isLoading: false, isFetched: true, error: null, isRefetching: false, refetch: () => {} };
assert.match(flat(renderToStaticMarkup(React.createElement(Screen))), /EMPTY:No sales or remittance/);

salesState = {
  data: undefined,
  isLoading: false,
  isFetched: true,
  error: new Error('sales down'),
  isRefetching: false,
  refetch: () => {},
};
remittanceState = { data: remittance, isLoading: false, isFetched: true, error: null, isRefetching: false, refetch: () => {} };
assert.match(flat(renderToStaticMarkup(React.createElement(Screen))), /ERROR:sales down/);

console.log(
  'Total Sales dashboard tests passed: remittance separated from sales, filters wired, branch rows, empty/error/loading.',
);
