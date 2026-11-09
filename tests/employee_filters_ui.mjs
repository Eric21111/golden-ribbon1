// Employees list: the same search + funnel + sort and status pills as the other lists, instead of three unlabeled "All" dropdowns.
// Status is the row of pills (All / Active / Inactive); Role and Branch are rows in the funnel; Sort is Name A-Z / Z-A / Active first.
// The matching and ordering are plain functions tested for real; the shared filter sheet and tags are rendered with TWO rows; the
// screen is checked as wiring.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const f = loadTs('src/features/employees/employeeFilters.ts');
const E = (name, role, branch_id, is_active, email = `${name.toLowerCase()}@x.com`) => ({ id: name, full_name: name, email, role, branch_id, branch_name: branch_id, is_active });
const people = [E('Zed', 'cashier', 'sm1', true), E('Amy', 'manager', 'main', false), E('Bob', 'cashier', 'sm2', true), E('Cleo', 'cashier', 'sm1', false)];
const names = (list) => list.map((e) => e.full_name);

// ---------------------------------------------------------------- 1. the rules
{
  assert.deepEqual(f.EMPLOYEE_SORT_OPTIONS.map((o) => o.label), ['Name (A–Z)', 'Name (Z–A)', 'Active first']);
  assert.deepEqual(names(f.sortEmployees(people, 'name-asc')), ['Amy', 'Bob', 'Cleo', 'Zed']);
  assert.deepEqual(names(f.sortEmployees(people, 'name-desc')), ['Zed', 'Cleo', 'Bob', 'Amy']);
  assert.deepEqual(names(f.sortEmployees(people, 'active-first')), ['Bob', 'Zed', 'Amy', 'Cleo'], 'active ones first, A-Z inside each group');
  assert.deepEqual(names(people), ['Zed', 'Amy', 'Bob', 'Cleo'], 'the list passed in is not reordered');
  // the same matching as before
  const match = (o) => names(people.filter((e) => f.matchesEmployeeFilters(e, { search: '', role: 'all', branchId: '', status: 'all', ...o })));
  assert.deepEqual(match({}), ['Zed', 'Amy', 'Bob', 'Cleo']);
  assert.deepEqual(match({ role: 'cashier' }), ['Zed', 'Bob', 'Cleo']);
  assert.deepEqual(match({ branchId: 'sm1' }), ['Zed', 'Cleo']);
  assert.deepEqual(match({ status: 'inactive' }), ['Amy', 'Cleo']);
  assert.deepEqual(match({ role: 'cashier', branchId: 'sm1', status: 'active' }), ['Zed'], 'they combine');
  assert.deepEqual(match({ search: 'BOB@' }), ['Bob'], 'search by email');
  assert.deepEqual(f.EMPLOYEE_ROLE_CHOICES.map((c) => c.value), ['all', 'manager', 'cashier']);
  assert.deepEqual(f.EMPLOYEE_STATUS_CHOICES.map((c) => c.value), ['all', 'active', 'inactive']);
  console.log('1. rules: ok');
}

// ---------------------------------------------------------------- 2. the shared sheet and tags with TWO rows
{
  const controls = loadTs('src/features/products/ProductFilterControls.tsx', {
    'react-native': rnw,
    '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
    '@/components/GlyphIcon': { GlyphIcon: () => null },
    '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => React.createElement('b', null, p.label) },
    '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet: (p) => React.createElement('section', null, p.children) },
  });
  const listFilters = loadTs('src/features/products/listFilters.ts');
  const changed = [];
  const row = (title, options, value) => ({ title, options, value, onChange: (v) => changed.push([title, v]) });
  const role = (value) => row('Role', f.EMPLOYEE_ROLE_CHOICES, value);
  const branch = (value) => row('Branch', [{ label: 'All branches', value: 'all' }, { label: 'SM 1', value: 'sm1' }, { label: 'Main (Main)', value: 'main' }], value);
  const sheet = (extra) => renderToStaticMarkup(React.createElement(controls.ListFiltersSheet, { visible: true, filters: listFilters.DEFAULT_LIST_FILTERS, keys: [], extra, onChange() {}, onClose() {} }));
  const text = flat(sheet([role('all'), branch('all')]));
  assert.match(text, /Role\|All\|Branch\|All branches\|$/, 'two rows in the sheet, nothing to reset');
  assert.doesNotMatch(text, /Reset|Done|Category/);
  const on = flat(sheet([role('cashier'), branch('all')]));
  assert.match(on, /Role\|Cashiers\|Branch\|All branches\|Reset\|$/, 'one on: Reset appears');
  // tags: one per row that is on, with Clear all
  const summary = (extra) => flat(renderToStaticMarkup(React.createElement(controls.ListFilterSummary, { countText: '2 of 4 employees', filters: listFilters.DEFAULT_LIST_FILTERS, keys: [], extra, onChange() {} })));
  assert.equal(summary([role('all'), branch('all')]), '', 'nothing while both are off');
  assert.match(summary([role('cashier'), branch('all')]), /2 of 4 employees\|Clear all\|Cashiers\|$/);
  assert.match(summary([role('cashier'), branch('sm1')]), /2 of 4 employees\|Clear all\|Cashiers\|SM 1\|$/, 'a tag for each');
  // the one-row form still works (Opening stock) and a single row still closes the sheet on a pick
  assert.match(summary(role('manager')), /Managers/);
  const src = read('src/features/products/ProductFilterControls.tsx');
  assert.ok(src.includes('extra?: ExtraListFilter | ExtraListFilter[];'));
  assert.ok(src.includes("extras.forEach((row) => row.onChange('all'));"), 'Reset and Clear all clear every extra row');
  assert.ok(src.includes('if (rowCount === 1) onClose();'), 'a sheet with one row closes on its pick, like Sort; with two it stays open');
  console.log('2. sheet and tags: ok');
}

// ---------------------------------------------------------------- 3. the screen
{
  const src = read('src/features/employees/EmployeeHub.tsx');
  assert.doesNotMatch(src, /FilterDropdown/, 'the three unlabeled dropdowns are gone');
  assert.ok(src.includes('<FilterChipRow options={EMPLOYEE_STATUS_CHOICES} value={status} onChange={setStatus} />'), 'status is the pills');
  assert.ok(src.includes('<FilterIconButton count={activeFilters} onPress={() => setFiltersOpen(true)} />'));
  assert.ok(src.includes('const activeFilters = (role !== \'all\' ? 1 : 0) + (branchId ? 1 : 0);'), 'the badge counts Role and Branch (Status is visible as pills)');
  assert.match(src, /<ListFiltersSheet\n\s+visible=\{filtersOpen\}\n\s+filters=\{DEFAULT_LIST_FILTERS\}\n\s+keys=\{NO_LIST_FILTERS\}\n\s+extra=\{filterRows\}/, 'Role and Branch in the funnel');
  assert.ok(src.includes("value: branchId || 'all',") && src.includes("onChange: (value: string) => setBranchId(value === 'all' ? '' : value),"), 'the branch filter keeps its own "" for no branch');
  assert.ok(src.includes("{ label: 'All branches', value: 'all' },"));
  assert.ok(src.includes('sortEmployees(') && src.includes('`${search}|${role}|${branchId}|${status}|${sort}`'), 'sorted, and a change of sort goes back to page 1');
  assert.ok(src.includes("active={sort !== 'name-asc'}"));
  assert.ok(src.includes('countText={`${filtered.length} of ${employees?.length ?? 0} employees`}'));
  // the same matching and the same empty states
  assert.ok(src.includes('matchesEmployeeFilters(employee, { search, role, branchId, status })'));
  assert.ok(src.includes('const hasFilters = Boolean(search.trim() || role !== \'all\' || branchId || status !== \'all\');'));
  console.log('3. screen: ok');
}

console.log('employee_filters_ui: ALL PASS');
