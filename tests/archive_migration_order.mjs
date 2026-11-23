// The archive migration must be deployable without the unfinished fractional migrations.
// Local fractional files dropped the embedded BEGIN/COMMIT that is still on GitHub.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const files = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort();
const archive = '20261118000000_archive_products_and_delete_branches.sql';
const reapply = '20261123190000_reapply_archive_catalog_filters.sql';
const fractional = [
  '20261123120000_piece_half_step_stock_uses.sql',
  '20261123120100_confirm_sale_half_step_deductions.sql',
  '20261123130000_fractional_inventory_feature_gate.sql',
  '20261123130100_fractional_inventory_parse_and_schema.sql',
  '20261123130200_fractional_inventory_ops_rpcs.sql',
  '20261123140000_fractional_inventory_reports.sql',
  '20261123150000_fractional_piece_ops_gate.sql',
];

assert.ok(files.includes(archive));
assert.ok(files.includes(reapply));
assert.ok(files.indexOf(archive) < files.indexOf(fractional[0]), 'archive sorts before the fractional set');
assert.ok(files.indexOf(fractional.at(-1)) < files.indexOf(reapply), 'catalog reapply sorts after the fractional set');
assert.equal(files.filter((name) => name.includes('archive_products_and_delete_branches')).length, 1);

const archiveSql = readFileSync(`supabase/migrations/${archive}`, 'utf8');
assert.match(archiveSql, /while stock remains/);
assert.match(archiveSql, /list_cashier_day_stock/);
assert.doesNotMatch(archiveSql, /fractional_recipe|is_piece_half_step|inventory_feature_settings/);
assert.doesNotMatch(archiveSql, /^begin;|^commit;/m);

const reapplySql = readFileSync(`supabase/migrations/${reapply}`, 'utf8');
assert.match(reapplySql, /list_return_inventory/);
assert.doesNotMatch(reapplySql, /is_piece_half_step|inventory_feature_settings/);

for (const file of fractional) {
  const local = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(local, /^begin;$/m, `${file} local copy still has an embedded begin`);
  assert.doesNotMatch(local, /^commit;$/m, `${file} local copy still has an embedded commit`);
  const github = execFileSync('git', ['show', `HEAD:supabase/migrations/${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
  assert.match(github, /^begin;$/m, `${file} GitHub copy should still be the older transactional file`);
  assert.match(github, /^commit;$/m, `${file} GitHub copy should still be the older transactional file`);
  assert.notEqual(local, github, `${file} local correction must stay distinct from the GitHub copy`);
}

console.log('Archive migration order passed.');
