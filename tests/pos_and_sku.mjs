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

console.log('pos-and-sku checks passed');
