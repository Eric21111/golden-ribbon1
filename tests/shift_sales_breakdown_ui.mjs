import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as rnw from 'react-native-web';
import { loadTs } from './_load_ts.mjs';

let expanded = false;
let enabled;
let result = { data: [], isLoading: false, error: null };
const { ShiftSalesBreakdown, ShiftSalesBreakdownContent } = loadTs('src/features/reports/ShiftSalesBreakdown.tsx', {
  react: { ...React, useState: () => [expanded, () => {}] },
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  '@/hooks/useShifts': { useManagerShiftPayments: (id, active) => {
    assert.equal(id, 'shift-1'); enabled = active; return result;
  } },
  '@/components/dashboard/ManagerFeedback': {
    LoadingState: ({ label }) => React.createElement('div', null, label),
    ErrorState: () => React.createElement('div', null, 'Unable to load breakdown'),
  },
});
const render = () => renderToStaticMarkup(React.createElement(ShiftSalesBreakdown, { shiftId: 'shift-1' }));
assert.match(render(), /Show sales breakdown/);
assert.equal(enabled, false, 'closed section does not request data');
expanded = true;
result = { isLoading: true };
assert.match(render(), /Loading sales breakdown/);
assert.equal(enabled, true);
result = { error: new Error('Network error'), data: [{ method: 'cash', program: 'standard', amount: 999, orders: 1 }] };
assert.match(render(), /Unable to load breakdown/);
assert.doesNotMatch(render(), /999/, 'a failed refresh does not show stale totals as current');
result = { data: [], error: null, isLoading: false };
assert.match(render(), /₱0\.00/, 'successful empty results show zero');

const html = renderToStaticMarkup(React.createElement(ShiftSalesBreakdownContent, { rows: [
  { method: 'cash', program: 'standard', amount: 40, orders: 2 },
  { method: 'cash', program: 'pwd', amount: 18.75, orders: 1 },
  { method: 'gcash', program: 'back_office_guard', amount: 12, orders: 1 },
  { method: 'cash', program: 'employee_meal', amount: 0, orders: 3 },
  { method: 'unrecorded', program: 'standard', amount: 7, orders: 1 },
] }));
for (const label of ['Cash sales', 'GCash sales', 'Standard', 'PWD', 'Back office / security', 'Employee / guest meal orders', 'Unrecorded sales', 'not remitted cash']) {
  assert.ok(html.includes(label), label);
}
assert.match(html, /₱58\.75/);
assert.match(html, /₱12\.00/);
assert.match(html, /₱7\.00/);
console.log('Shift sales breakdown UI: disclosure, loading, failure, zero, tender totals and meal counts passed.');
