// Screen wiring for archive, restore, delete, and branch delete. Device taps are not run here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getRetentionActionMessage } from '../src/lib/errors.ts';

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const products = read('app/(manager)/manager/products/index.tsx');
const archived = read('app/(manager)/manager/products/archived.tsx');
const wizard = read('src/features/products/EditProductWizard.tsx');
const sidebar = read('src/components/dashboard/ManagerSidebar.tsx');
const layout = read('app/(manager)/_layout.tsx');
const branchForm = read('src/features/branches/BranchForm.tsx');
const branchList = read('src/features/branches/BranchListScreen.tsx');
const productService = read('src/services/productService.ts');
const migration = read('supabase/migrations/20261118000000_archive_products_and_delete_branches.sql');

assert.match(products, /label="Archived Products"/);
assert.match(products, /\/manager\/products\/archived/);
assert.doesNotMatch(sidebar, /Archived Products/);
assert.match(layout, /manager\/products\/archived/);
assert.match(wizard, /label="Archive Product"/);
assert.match(products, /Archive product\?/);
assert.match(products, /This is not the same as turning Enable Product off/);
assert.match(products, /onArchive=\{requestArchive\}/);
assert.match(archived, /Restore product\?/);
assert.match(archived, /Delete product permanently\?/);
assert.match(archived, /Search name or SKU/);
assert.match(archived, /formatDateShort\(item\.archived_at/);
assert.match(productService, /\.is\('archived_at', null\)/);
assert.match(productService, /\.not\('archived_at', 'is', null\)/);

assert.match(branchList, /Delete branch\?/);
assert.match(branchList, /Turn Active off to deactivate/);
assert.match(branchList, /onDelete=\{editBranch\.is_main_branch \? undefined : requestDelete\}/);
assert.match(branchList, /closingAfterDelete\.current = true/);
assert.match(branchList, /if \(closingAfterDelete\.current\)/);
assert.match(branchList, /deleteMutation\.isPending/);
assert.match(branchForm, /onPress=\{onDelete\}/);
assert.doesNotMatch(branchForm, /onDelete[\s\S]{0,80}handleSubmit/);

const archiveFn = migration.slice(migration.indexOf('function public.archive_product'), migration.indexOf('function public.restore_product'));
assert.match(archiveFn, /set archived_at = now\(\)/);
assert.doesNotMatch(archiveFn, /is_active\s*=/);
assert.match(migration, /while stock remains/);
assert.match(migration, /order by branch_id/);
assert.match(migration, /new\.quantity > 0/);
assert.match(migration, /Restore this product before voiding/);
assert.match(migration, /for update/);
assert.match(migration, /The Main Branch cannot be deleted/);
assert.match(migration, /ON DELETE RESTRICT/);
assert.match(read('tests/archive_products_concurrency_postgres.mjs'), /NOT TESTED/);
assert.match(read('tests/archive_migration_order.mjs'), /20261118000000_archive_products_and_delete_branches/);
assert.match(read('supabase/migrations/20261123190000_reapply_archive_catalog_filters.sql'), /list_return_inventory/);

assert.match(
  getRetentionActionMessage({ message: 'Cannot archive this product while other products still use it in a recipe: Meal.' }),
  /Meal/,
);
assert.match(getRetentionActionMessage({ message: 'Cannot delete this branch because records must be kept (sales). Deactivate the branch instead.' }), /Deactivate/);
assert.match(getRetentionActionMessage({ message: 'permission denied' }), /not authorized/i);

console.log('Archive products UI wiring passed.');
