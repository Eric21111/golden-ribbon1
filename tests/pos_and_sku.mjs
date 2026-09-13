import assert from 'node:assert/strict';

function skuFromName(name) {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const base = (cleaned || 'ITEM').slice(0, 40);
  return base.length >= 2 ? base : `${base}X`.slice(0, 40);
}

function uniqueSku(base, existingSkus) {
  const taken = new Set([...existingSkus].map((sku) => sku.trim().toUpperCase()).filter(Boolean));
  const normalized = skuFromName(base);
  if (!taken.has(normalized)) return normalized;
  for (let n = 2; n < 10_000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${normalized.slice(0, Math.max(2, 40 - suffix.length))}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('Unable to allocate SKU');
}

function isOutOfStock(item) {
  return item.quantity_on_hand <= 0;
}

function filterPosInventory(items, search) {
  const term = search.trim().toLowerCase();
  const matched = term
    ? items.filter(
        (item) =>
          item.product.name.toLowerCase().includes(term) ||
          item.product.sku.toLowerCase().includes(term),
      )
    : items.filter((item) => !isOutOfStock(item));

  return [...matched].sort((a, b) => {
    const aOut = isOutOfStock(a) ? 1 : 0;
    const bOut = isOutOfStock(b) ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    return a.product.name.localeCompare(b.product.name);
  });
}

function item(name, sku, qty) {
  return { product: { name, sku }, quantity_on_hand: qty };
}

function authoritativePosBranchId(shift, profile) {
  if (shift?.branch_id) return shift.branch_id;
  return profile?.branch_id ?? profile?.branch?.id ?? null;
}

function mergeCatalogWithBalances(products, balances, branch) {
  const qty = new Map(balances.map((row) => [row.product_id, row.quantity_on_hand]));
  return products.map((product) => ({
    branch,
    product,
    quantity_on_hand: qty.get(product.id) ?? 0,
    updated_at: null,
  }));
}

function hasSellableStock(items) {
  return items.some((row) => row.quantity_on_hand > 0);
}

assert.equal(skuFromName('Beef Meal'), 'BEEF-MEAL');
assert.equal(skuFromName('  chicken butter!! '), 'CHICKEN-BUTTER');
assert.equal(uniqueSku('Beef Meal', ['BEEF-MEAL']), 'BEEF-MEAL-2');
assert.equal(uniqueSku('BF', ['BF', 'BF-2']), 'BF-3');

const rows = [
  item('Out A', 'OUT-A', 0),
  item('In B', 'IN-B', 3),
  item('Out C', 'OUT-C', 0),
  item('In A', 'IN-A', 1),
];

assert.deepEqual(
  filterPosInventory(rows, '').map((row) => row.product.sku),
  ['IN-A', 'IN-B'],
);
assert.deepEqual(
  filterPosInventory(rows, 'out').map((row) => row.product.sku),
  ['OUT-A', 'OUT-C'],
);

assert.equal(
  authoritativePosBranchId({ branch_id: 'shift-branch' }, { branch_id: 'stale-profile', branch: { id: 'stale-nested' } }),
  'shift-branch',
);
assert.equal(authoritativePosBranchId(null, { branch_id: 'assigned', branch: { id: 'nested' } }), 'assigned');
assert.equal(authoritativePosBranchId(null, { branch_id: null, branch: { id: 'nested' } }), 'nested');
assert.equal(authoritativePosBranchId(null, null), null);

const branch = { id: 'branch-1', name: 'Branch 1' };
const catalog = [
  { id: 'p1', name: 'Nuggets', sku: 'NUG', description: null, selling_price: 80, is_active: true, created_at: '', updated_at: '' },
  { id: 'p2', name: 'Rice', sku: 'RICE', description: null, selling_price: 40, is_active: true, created_at: '', updated_at: '' },
];
const hiddenByRls = [];
const buggyGate = mergeCatalogWithBalances(catalog, hiddenByRls, branch);
assert.equal(hasSellableStock(buggyGate), false, 'RLS-empty balances were treated as all out of stock');

const liveBalances = [{ product_id: 'p1', quantity_on_hand: 18 }];
const liveGate = mergeCatalogWithBalances(catalog, liveBalances, branch);
assert.equal(hasSellableStock(liveGate), true, 'POS opens when any active product has quantity_on_hand > 0');
assert.equal(hasSellableStock(mergeCatalogWithBalances(catalog, [{ product_id: 'p1', quantity_on_hand: 0 }], branch)), false);

console.log('pos-and-sku checks passed');
