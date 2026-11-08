// Create / Edit Product pricing: a product sold in the cashier POS needs a price above ₱0. An empty price is never turned into
// ₱0.00 and is refused with an inline message. Stock-only products (including Inventory Supplies) need no price at all.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { isSellingPrice } = loadTs('src/features/products/productSchema.ts');
const { isPriceMissing, defaultsForProductSetup } = loadTs('src/features/products/wizardGuards.ts');

// ---------------------------------------------------------------- 1. what counts as a selling price
{
  for (const ok of ['1', '0.01', '25', '25.5', '25.50', '9999999999', ' 12 ']) assert.equal(isSellingPrice(ok), true, ok);
  for (const bad of ['', '   ', '0', '0.0', '0.00', '00', '000.00', '-1', '-0.5', 'abc', '12.345', '1,000', '₱5', '5.', '.5', '12345678901']) {
    assert.equal(isSellingPrice(bad), false, `"${bad}" is refused`);
  }
  console.log('1. selling price rule: ok');
}

// ---------------------------------------------------------------- 2. inline flags
{
  const keys = ['a', 'b', 'c'];
  // a list that must be priced flags every empty field once a save was tried
  assert.equal(isPriceMissing({ showErrors: true, prices: {}, keys, key: 'a', required: true }), true);
  assert.equal(isPriceMissing({ showErrors: true, prices: { a: '5' }, keys, key: 'b', required: true }), true);
  assert.equal(isPriceMissing({ showErrors: true, prices: { a: '5' }, keys, key: 'a', required: true }), false, 'a filled field is never "missing"');
  assert.equal(isPriceMissing({ showErrors: false, prices: {}, keys, key: 'a', required: true }), false, 'nothing is flagged before a save is tried');
  // a branch left unpriced on purpose is not flagged field by field
  assert.equal(isPriceMissing({ showErrors: true, prices: {}, keys, key: 'a' }), false);
  assert.equal(isPriceMissing({ showErrors: true, prices: { a: '5' }, keys, key: 'b' }), true, 'a half-priced branch is');
  console.log('2. inline flags: ok');
}

// ---------------------------------------------------------------- 3. wiring in both wizards and the step
{
  const create = read('src/features/products/CreateProductWizard.tsx');
  const edit = read('src/features/products/EditProductWizard.tsx');
  const step = read('src/features/products/BranchPricingStep.tsx');
  for (const [name, src] of [['create', create], ['edit', edit]]) {
    assert.match(src, /function isValidPrice\(raw: string\): boolean \{\n  return isSellingPrice\(raw\);\n\}/, `${name}: every price check means "more than 0"`);
    assert.doesNotMatch(src, /PRICE_PATTERN/, `${name}: no second, looser price rule`);
    assert.match(src, /failStep3\('Turn on at least one branch\.'\)/, `${name}: Different per Branch with every branch off says so`);
    assert.match(src, /failStep3\('Complete the pricing for all selected branches\.'\)/, `${name}: a branch that is on must be fully priced`);
    assert.match(src, /failStep3\('Enter a price for every variant on each selected branch\.'\)/, `${name}: ...also for options`);
    assert.match(src, /new Set\(branchOptions\.filter\(\(branch\) => !offBranchIds\.includes\(branch\.id\)\)\.map\(\(branch\) => branch\.id\)\)/, `${name}: the branches that are on are the ones priced`);
    // a failed price check never reaches the save
    assert.match(src, /if \(variants\.length === 0 && !isValidPrice\(topLevelPrice\)\) \{\n\s+failStep3\('Enter a valid selling price\.'\);\n\s+return;/);
    assert.match(src, /if \(variantValues\.some\(\(variant\) => !isValidPrice\(variant\.default_price\)\)\) \{\n\s+failStep3\('Enter a price for every variant\.'\);\n\s+return;/);
    // stock only: no pricing step, no price sent
    assert.match(src, /sellInPos: false,/, `${name}: a stock-only product is saved without a price`);
    assert.match(src, /default_price: '',/);
  }
  assert.doesNotMatch(step, /It will save at ₱0\.00|No price set/, 'no "saves at 0.00" promise: an empty price blocks the save');
  assert.match(read('src/features/products/pricingReveal.ts'), /'Must be above ₱0'/, 'a typed 0 says what is wrong');
  assert.match(step, /const problem = priceProblem\(value\);/, 'the field shows that message');
  assert.match(step, /\{problem \?\? 'Enter a price'\}/, 'an empty price says so after a save was tried');
  assert.match(step, /required\n/, 'Same for All lists are required');
  assert.match(step, /highlightMissing=\{Boolean\(error\)\}\n\s+required\n/, 'every price in a branch that is on is required');
  assert.match(step, /accessibilityLabel=\{`Add to \$\{branch\.name\}`\}/, 'each branch has an Add to branch switch');
  assert.match(step, /numberOfLines=\{2\}/, 'a long branch name wraps instead of pushing the switch off a narrow screen');
  assert.equal(defaultsForProductSetup('supplies').sellSeparately, false, 'Inventory Supplies start as stock only');
  // a stock-only save returns before any price or branch check, so it needs no price and no branch turned on
  for (const [name, src] of [['create', create], ['edit', edit]]) {
    const stockOnly = src.indexOf('if (!sellable) {');
    const firstCheck = src.indexOf("failStep3('Turn on at least one branch.')");
    assert.ok(stockOnly > 0 && firstCheck > stockOnly, `${name}: the stock-only branch comes first`);
    const block = src.slice(stockOnly, firstCheck);
    assert.match(block, /sellInPos: false,[\s\S]*?return;/, `${name}: it saves and returns`);
    assert.doesNotMatch(block.slice(0, block.indexOf('return;')), /isValidPrice|offBranchIds|pricedBranchIds|failStep3/, `${name}: and checks nothing about prices or branches`);
  }
  console.log('3. wiring: ok');
}

console.log('product_price_validation: ALL PASS');
