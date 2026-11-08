// Filter and Sort buttons look the same on every manager list: one shared component each (funnel / up-down arrows).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : /\.tsx$/.test(name) ? [full] : [];
});
const files = [...walk('app'), ...walk('src')].filter((p) => !p.endsWith('ToolbarIconButtons.tsx'));

const toolbar = read('src/components/dashboard/ToolbarIconButtons.tsx');
assert.match(toolbar, /icon="funnel-outline"/);
assert.match(toolbar, /icon="swap-vertical-outline"/);
assert.match(toolbar, /width: 46,\n\s+height: 46,\n\s+borderRadius: 14,/);

const sortScreens = [
  'app/(manager)/manager/catalog.tsx',
  'app/(manager)/manager/inventory/index.tsx',
  'app/(manager)/manager/transfers/index.tsx',
  'app/(manager)/manager/returns/index.tsx',
  'app/(manager)/manager/products/index.tsx',
  'src/features/transfers/CreateTransferScreen.tsx',
  'src/features/inventory/InventorySetupScreen.tsx',
];
for (const p of sortScreens) {
  const src = read(p);
  assert.match(src, /<SortIconButton\n/, `${p}: Sort uses the shared button`);
  assert.match(src, /active=\{sort !== /, `${p}: tinted when the sort is not the default`);
}
assert.equal((read('src/features/reports/DiscrepancyReportsScreens.tsx').match(/<FilterIconButton/g) ?? []).length, 2, 'both discrepancy screens use the shared Filter button');
assert.match(read('src/features/products/ProductFilterControls.tsx'), /<FilterIconButton count=\{count\} onPress=\{onPress\} \/>/);

for (const p of files) {
  const src = read(p);
  assert.doesNotMatch(src, /"options-outline"/, `${p}: no one-off filter/sort icon`);
  if (/accessibilityLabel=\{`Sort: /.test(src)) assert.fail(`${p}: a hand-made Sort button is left`);
}
console.log('toolbar_icon_buttons: ALL PASS');
