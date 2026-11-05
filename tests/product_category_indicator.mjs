// Category icons: one central mapping, driven by the SAVED product_category (never the product name), and the screens
// that use it. Pure logic + source pins; not a rendered / device test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { getCategoryIndicator, categoryRowProps, isProductCategory } = loadTs('src/features/products/productCategoryIndicator.ts');
const { PRODUCT_CATEGORIES } = loadTs('src/features/products/productCategoryPreview.ts');
const theme = read('src/components/dashboard/theme.ts');
const glyphs = JSON.parse(read('node_modules/@react-native-vector-icons/ionicons/glyphmaps/Ionicons.json'));

// ---- the mapping covers exactly the five saved categories, with their real names
const labels = {
  meals: 'Meals & Viands',
  snacks: 'Snacks & Finger Foods',
  drinks: 'Drinks',
  extras: 'Extras & Sides',
  supplies: 'Inventory Supplies',
};
assert.deepEqual(PRODUCT_CATEGORIES.map((c) => c.id), Object.keys(labels));
for (const [id, label] of Object.entries(labels)) {
  const indicator = getCategoryIndicator(id);
  assert.equal(indicator.label, label, `${id}: label comes from the category config`);
  assert.ok(glyphs[indicator.icon] !== undefined || indicator.icon === 'bbq-stick', `${id}: ${indicator.icon} is a real Ionicons glyph or the drawn BBQ stick`);
  assert.match(theme, new RegExp(`\\n  ${indicator.color}: \\{ chip:`), `${id}: ${indicator.color} is a statChipColors key`);
}
// Utensils (Meals), BBQ stick (Snacks), Cup, Plus Circle, Package. Ionicons has no skewer, so GlyphIcon draws it.
assert.deepEqual(Object.keys(labels).map((id) => getCategoryIndicator(id).icon), [
  'restaurant-outline', 'bbq-stick', 'cafe-outline', 'add-circle-outline', 'cube-outline',
]);
const colors = Object.keys(labels).map((id) => getCategoryIndicator(id).color);
assert.equal(new Set(colors).size, colors.length, 'every category has its own colour');

// ---- category colours stay clear of the status colours (green = Active / in stock, red = out of stock)
for (const id of Object.keys(labels)) {
  assert.ok(!['green', 'red', 'gold', 'teal'].includes(getCategoryIndicator(id).color), `${id} must not look like a status colour`);
}

// ---- no saved category (or anything unknown) is the neutral "not set", never a guess
for (const value of [null, undefined, '', 'unset', 'something-new', 'toString', '__proto__', 'constructor']) {
  const indicator = getCategoryIndicator(value);
  assert.equal(indicator.label, 'Category not set', `${String(value)} -> not set`);
  assert.equal(indicator.color, 'gray');
  assert.equal(isProductCategory(value), false);
}
assert.deepEqual(categoryRowProps('drinks'), { icon: getCategoryIndicator('drinks').icon, iconColor: getCategoryIndicator('drinks').color, iconLabel: 'Drinks' });

// ---- the mapping module never looks at a product name
const indicatorSource = read('src/features/products/productCategoryIndicator.ts');
assert.doesNotMatch(indicatorSource, /\.name\b|toLowerCase|\/i\b|includes\(/, 'icons come from the category, not from name matching');

// ---- screens
const pin = (file, pattern, why) => assert.match(read(file), pattern, `${file}: ${why}`);
pin('app/(manager)/manager/products/index.tsx', /\{\.\.\.categoryRowProps\(item\.product_category\)\}/, 'product rows');
pin('app/(manager)/manager/products/index.tsx', /options=\{CATEGORY_CHIPS\}/, 'category chips');
pin('src/features/inventory/InventoryListItem.tsx', /\{\.\.\.categoryRowProps\(item\.product\.product_category\)\}/, 'owner + manager inventory rows');
pin('app/(manager)/manager/inventory/index.tsx', /\{\.\.\.categoryRowProps\(item\.product\.product_category\)\}/, 'manager inventory list');
pin('app/(manager)/manager/inventory/index.tsx', /\{\.\.\.categoryRowProps\(selected\.product\.product_category\)\}/, 'stock details');
pin('app/(manager)/manager/catalog.tsx', /<CategoryIcon category=\{item\.product\.product_category\}/, 'branch catalog');
pin('src/features/pos/PosProductRow.tsx', /getCategoryIndicator\(item\.product\.product_category\)/, 'cashier POS rows');
assert.doesNotMatch(read('src/features/pos/PosProductRow.tsx'), /name="fast-food-outline"/, 'the fixed POS icon is gone');
pin('app/(cashier)/cashier/local-purchase.tsx', /<CategoryIcon category=\{row\.product_category\}/, 'cashier local purchase');
pin('src/features/products/InventoryItemPickerModal.tsx', /<CategoryIcon category=\{item\.category\}/, 'stock picker');
pin('src/features/products/VariantRecipePreview.tsx', /<CategoryIcon category=\{item\.category\}/, 'stock used lines');
pin('src/features/products/ProductCategoryField.tsx', /<CategoryIcon category=\{category\.id\}/, 'category dropdown');
pin('src/features/products/recipePreviewData.ts', /category: product\.category \?\? null/, 'picker options carry the saved category');

// ---- cashier data: category comes from the products table, and a failed read must not break the catalog
const service = read('src/services/inventoryService.ts');
assert.match(service, /product_category: categories\.get\(row\.product_id\) \?\? null/);
assert.match(service, /from\('products'\)\.select\('id, product_category'\)/);
assert.match(service, /if \(error \|\| !data\) return new Map\(\);/, 'icons are decoration: a failed category read still loads the list');
assert.equal((service.match(/listCashierProductCategories\(\)/g) ?? []).length, 3, 'defined once, used by the POS and local-purchase lists');

// ---- the BBQ stick is drawn in code, and every place that shows a category icon can draw it
const glyph = read('src/components/GlyphIcon.tsx');
assert.match(glyph, /export type CustomGlyphName = 'bbq-stick';/);
for (const file of ['src/features/products/CategoryIcon.tsx', 'src/components/dashboard/ListRowCard.tsx', 'src/features/pos/PosProductRow.tsx']) {
  assert.match(read(file), /<GlyphIcon name=/, `${file}: draws icons through GlyphIcon`);
}

// ---- accessibility: an icon with no text beside it announces the category; one beside text stays silent
const icon = read('src/features/products/CategoryIcon.tsx');
assert.match(icon, /accessibilityRole=\{decorative \? undefined : 'image'\}/);
assert.match(icon, /accessibilityLabel=\{decorative \? undefined : indicator\.label\}/);
const row = read('src/components/dashboard/ListRowCard.tsx');
assert.match(row, /accessible=\{iconLabel != null\}/);
assert.match(row, /accessibilityLabel=\{iconLabel\}/);

// ---- status badges are untouched: categories never feed ManagerBadge
for (const file of ['src/features/products/CategoryIcon.tsx', 'src/features/products/productCategoryIndicator.ts']) {
  assert.doesNotMatch(read(file), /ManagerBadge|StatusBadge/, `${file}: a category indicator is not a status badge`);
}

console.log('product_category_indicator: ALL PASS');
