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

assert.match(products, /<Text style=\{styles\.sortRowLabel\}>Archived Products<\/Text>/);
// Footer is Create product only. Archived Products and Branch catalogs are the rarely used places: they live in the header ⋯ sheet.
assert.doesNotMatch(products, /label="Archived Products"|footerRow|footerSmallButton/);
assert.doesNotMatch(products, /View branch catalogs/);
assert.match(products, /<MoreIconButton label="More product options"[\s\S]{0,120}setMoreOpen\(true\)/);
assert.match(products, /title="Products" onClose=\{\(\) => setMoreOpen\(false\)\}[\s\S]{0,500}router\.push\('\/manager\/products\/archived' as never\)[\s\S]{0,900}>Branch catalogs</);
assert.match(products, /router\.push\('\/manager\/catalog' as never\)/);
assert.match(products, /\/manager\/products\/archived/);
// Main Manager sidebar: Archived Products is a child of the Products dropdown (like Branches > Branch Catalogs).
assert.match(
  sidebar,
  /label: 'Products',\s*href: '\/manager\/products',[\s\S]{0,200}children: \[\s*\{ label: 'Archived Products', href: '\/manager\/products\/archived', icon: 'archive-outline', selectedIcon: 'archive' \}/,
);
assert.equal((sidebar.match(/Archived Products/g) ?? []).length, 1, 'only the main-manager menu lists it (owner and selling managers do not)');
assert.match(layout, /manager\/products\/archived/);
// Archive is a product-level action: it starts from the ⋯ menu on each row of the list (Edit / Archive), not from the Edit
// form or its header. Tapping the row still opens Edit. The confirm sheet still guards the archive.
assert.doesNotMatch(wizard, /<SectionHeader title="Archive" \/>|Archive Product|onArchive|archiveLoading|archiveError/);
assert.doesNotMatch(read('src/components/BottomSheet.tsx'), /menuItems|setMenuOpen/);
assert.doesNotMatch(products, /menuItems|archiveError|setArchiveError/);
assert.match(products, /accessibilityLabel=\{`More actions for \$\{item\.name\}`\}[\s\S]{0,200}onPress=\{\(\) => setActionProduct\(item\)\}/);
assert.match(products, /<Text style=\{styles\.sortRowLabel\}>Edit product<\/Text>/);
assert.match(products, /<Text style=\{\[styles\.sortRowLabel, styles\.archiveRowLabel\]\}>Archive product<\/Text>/);
assert.match(products, /if \(target\) requestArchive\(target\);/);
assert.match(products, /accessibilityHint="Opens edit product"\s*hideChevron/);
assert.match(read('src/components/dashboard/ListRowCard.tsx'), /onPress && !hideChevron/);
// The row's ⋯ is a button, so it must sit BESIDE the tappable row body, never inside it (web: <button> cannot nest a <button>).
assert.match(products, /hideChevron\s*trailingHasControls/);
assert.match(read('src/components/dashboard/ListRowCard.tsx'), /trailingHasControls && Boolean\(onPress\)/);
assert.match(read('src/components/dashboard/ListRowCard.tsx'), /<\/Pressable>\s*<View style=\{styles\.trailing\}>\{trailing\}<\/View>/);
assert.match(products, /const requestArchive = \(product: Product\) =>/);
// A refused archive (e.g. still used in a recipe) is a modal notice, not a line of text above the list.
assert.match(products, /alertNotice\('Can’t archive product', `\$\{product\.name\} was not archived\. \$\{getRetentionActionMessage\(error\)\}`, 'warning'\)/);
assert.doesNotMatch(products, /setCreateNotice\(`\$\{product\.name\} was not archived/);
// ...and so is the success notice.
assert.match(products, /alertNotice\('Product archived', `\$\{product\.name\} was archived\. Open Archived Products to restore or delete it\.`, 'success'\)/);
assert.doesNotMatch(products, /setCreateNotice\(`\$\{product\.name\} was archived/);
assert.match(products, /Archive product\?/);
assert.match(products, /will be hidden from Products and the cashier\. Stock, recipes, and sales history are kept\. You can restore it anytime\./);
assert.match(products, /\{ confirm: 'Archive', cancel: 'Cancel', tone: 'warning' \}/);
assert.doesNotMatch(archived, /Archived products are hidden from Products and the cashier/);
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
