// Create / Edit Product branch pricing, end to end as far as it can run without a device:
//  A. the real RPCs on PGlite (Postgres WASM, not native PostgreSQL), called with the payloads the wizards build
//  B. the real BranchPricingStep rendered to HTML (react-dom/server + react-native-web: content and states, NOT layout)
//  C. wiring: scrolling and navigation hooks in the sheet and both wizards
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { branchesToSend, branchesCarrying } = loadTs('src/features/products/branchPricingEdit.ts');
const J = JSON.stringify;

// ================================================================ A. database scenarios
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
`);
// everything the live database has now (the migrations up to and including 20261027100000)
for (const f of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort().filter((n) => n < '20261028')) await db.exec(read(`supabase/migrations/${f}`).replace(/create extension if not exists pgcrypto;/g, ''));
const id = (n) => `87000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [mgr, main, sm1, sm2] = [id(2), id(10), id(11), id(12)];
await db.exec(`
  insert into auth.users values ('${mgr}','m@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-BPS',true,true,'counted'),('${sm1}','SM1','SM1-BPS',false,true,'cashier_confirm'),('${sm2}','SM2','SM2-BPS',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values ('${mgr}','Main Mgr','manager','${main}');
`);
const as = async (work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${mgr}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
};
const q = (sql, params) => as(() => db.query(sql, params));

// what the products screen sends (app/(manager)/manager/products/index.tsx): one price per branch, or option prices per branch
const toBranches = (pricing, hasVariants) => pricing.map((d) => (hasVariants ? { branch_id: d.branchId, variants: d.variants ?? [] } : { branch_id: d.branchId, selling_price: d.selling_price }));
const create = async ({ name, sku, variants = [], pricing, price }) => (await q(
  `select * from public.create_complete_product(p_name:=$1,p_sku:=$2,p_description:=null,p_variants:=$3::jsonb,p_branches:=$4::jsonb,p_selling_price:=$5)`,
  [name, sku, J(variants.map(([n, p]) => ({ name: n, default_price: p }))), J(toBranches(pricing, variants.length > 0)), variants.length > 0 ? null : price],
)).rows[0];
const update = (product, { variants = [], send, price = null, name = product.name }) => q(
  `select * from public.update_complete_product(p_product_id:=$1,p_name:=$2,p_sku:=$3,p_description:=null,p_is_active:=true,p_variants:=$4::jsonb,p_deleted_variant_ids:='[]'::jsonb,p_branches:=$5::jsonb,p_selling_price:=$6)`,
  [product.id, name, product.sku, J(variants), J(toBranches(send, variants.length > 0)), price],
);
const bpRows = async (productId) => (await db.query('select branch_id, selling_price::numeric p, is_active from public.branch_products where product_id=$1 order by branch_id', [productId])).rows.map((r) => ({ ...r, p: Number(r.p) }));
const opRows = async (productId) => (await db.query('select branch_id, name, selling_price::numeric p, is_active from public.branch_product_variants where product_id=$1 order by branch_id, name', [productId])).rows.map((r) => ({ ...r, p: Number(r.p) }));
const source = async (productId) => ({
  sourceVariants: (await db.query('select id, name, default_price::numeric d from public.product_variants where product_id=$1 order by sort_order, name', [productId])).rows.map((r) => ({ id: r.id, name: r.name, default_price: Number(r.d) })),
  sourceBranchPrices: (await bpRows(productId)).map((r) => ({ branch_id: r.branch_id, selling_price: r.p, is_active: r.is_active })),
  sourceBranchVariantPrices: (await opRows(productId)).map((r) => ({ branch_id: r.branch_id, name: r.name, selling_price: r.p, is_active: r.is_active })),
});
const optionDraft = (branchId, prices) => ({ branchId, variants: Object.entries(prices).map(([name, selling_price]) => ({ name, selling_price })) });

// ---- 1. create for ONE branch of two: only that branch carries it
const solo = await create({ name: 'Solo', sku: 'SOLO-BPS', price: '40', pricing: [{ branchId: sm1, selling_price: '40' }] });
assert.deepEqual((await bpRows(solo.id)).map((r) => [r.branch_id, r.p, r.is_active]), [[sm1, 40, true]], 'only SM1 carries it; SM2 got no row');
console.log('A1. create for one branch: ok');

// ---- 2. create for several branches with their own option prices
const V = [['Small', '30'], ['Large', '50']];
const combo = await create({ name: 'Combo', sku: 'COMBO-BPS', variants: V, pricing: [optionDraft(sm1, { Small: '30', Large: '50' }), optionDraft(sm2, { Small: '32', Large: '55' })] });
assert.deepEqual((await opRows(combo.id)).map((r) => [r.branch_id === sm1 ? 'SM1' : 'SM2', r.name, r.p]), [['SM1', 'Large', 50], ['SM1', 'Small', 30], ['SM2', 'Large', 55], ['SM2', 'Small', 32]]);
// "Same for All": every branch, one price
const same = await create({ name: 'Same', sku: 'SAME-BPS', price: '25', pricing: [{ branchId: sm1, selling_price: '25' }, { branchId: sm2, selling_price: '25' }] });
assert.deepEqual((await bpRows(same.id)).map((r) => [r.p, r.is_active]), [[25, true], [25, true]]);
console.log('A2. create for several branches / same for all: ok');

// ---- 3. Edit: add a branch. The branch that already carries it is not touched, even where it is switched off
await q('select public.configure_branch_products($1,$2::jsonb)', [sm1, J([{ product_id: solo.id, selling_price: 40, is_active: false }])]);
{
  const src = await source(solo.id);
  assert.deepEqual(branchesCarrying(src), [sm1], 'SM1 carries it (so it has no switch); SM2 does not');
  const before = await bpRows(solo.id);
  // the wizard shows SM1 as it is and SM2 switched on at 45
  const send = branchesToSend({ pricing: [{ branchId: sm1, selling_price: '40' }, { branchId: sm2, selling_price: '45' }], variants: [], ...src });
  assert.deepEqual(send.map((d) => d.branchId), [sm2], 'only the added branch is written');
  await update(solo, { send, price: '40' });
  const after = await bpRows(solo.id);
  assert.deepEqual(after.filter((r) => r.branch_id === sm1), before.filter((r) => r.branch_id === sm1), 'SM1 is exactly as it was: same price, still switched off');
  assert.deepEqual(after.find((r) => r.branch_id === sm2), { branch_id: sm2, p: 45, is_active: true }, 'SM2 now carries it at its own price');
  console.log('A3. edit adds a branch: ok');
}

// ---- 4. Edit: change prices independently, with an option switched off at SM1
await q('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [sm1, combo.id, J([{ name: 'Large', selling_price: 50, is_active: false }])]);
{
  const masters = (await source(combo.id)).sourceVariants;
  const variants = masters.map((v) => ({ id: v.id, name: v.name, default_price: String(v.name === 'Small' ? 30 : 50) }));
  const snapshot = async () => J({ bp: await bpRows(combo.id), op: await opRows(combo.id) });
  const start = await snapshot();
  // untouched: nothing is sent, nothing changes
  const untouched = branchesToSend({ pricing: [optionDraft(sm1, { Small: '30', Large: '50' }), optionDraft(sm2, { Small: '32', Large: '55' })], variants, ...(await source(combo.id)) });
  assert.deepEqual(untouched, []);
  // SM1 only
  let src = await source(combo.id);
  let send = branchesToSend({ pricing: [optionDraft(sm1, { Small: '31', Large: '50' }), optionDraft(sm2, { Small: '32', Large: '55' })], variants, ...src });
  assert.deepEqual(send.map((d) => d.branchId), [sm1]);
  await update(combo, { variants, send });
  let ops = await opRows(combo.id);
  assert.deepEqual(ops.filter((r) => r.branch_id === sm2).map((r) => [r.name, r.p]), [['Large', 55], ['Small', 32]], 'SM2 untouched');
  assert.deepEqual(ops.find((r) => r.branch_id === sm1 && r.name === 'Small'), { branch_id: sm1, name: 'Small', p: 31, is_active: true });
  assert.equal(ops.find((r) => r.branch_id === sm1 && r.name === 'Large').is_active, false, 'Large stays switched off at SM1 (no second request needed)');
  // SM2 only
  src = await source(combo.id);
  send = branchesToSend({ pricing: [optionDraft(sm1, { Small: '31', Large: '50' }), optionDraft(sm2, { Small: '32', Large: '58' })], variants, ...src });
  assert.deepEqual(send.map((d) => d.branchId), [sm2]);
  const sm1Before = (await opRows(combo.id)).filter((r) => r.branch_id === sm1);
  await update(combo, { variants, send });
  ops = await opRows(combo.id);
  assert.deepEqual(ops.filter((r) => r.branch_id === sm1), sm1Before, 'SM1 untouched by an SM2 edit');
  assert.equal(ops.find((r) => r.branch_id === sm2 && r.name === 'Large').p, 58);
  assert.notEqual(await snapshot(), start);
  // sending EVERY branch (an older client) keeps the switched-off option off as well
  await update(combo, { variants, send: [optionDraft(sm1, { Small: '31', Large: '50' }), optionDraft(sm2, { Small: '32', Large: '58' })] });
  assert.equal((await opRows(combo.id)).find((r) => r.branch_id === sm1 && r.name === 'Large').is_active, false);
  console.log('A4. independent price changes, disabled option kept: ok');
}

// ---- 5. stock-only products: no price, no branch
{
  const created = (await q(`select * from public.create_inventory_product(p_name:=$1,p_sku:=$2,p_description:=null,p_closing_stock_behavior:='keep_at_branch')`, ['Rice Sack', 'RICE-BPS'])).rows[0];
  assert.equal(created.sell_in_pos, false);
  assert.equal(created.selling_price, null, 'no price is invented');
  assert.equal((await bpRows(created.id)).length, 0, 'no branch row');
  const renamed = (await q(`select * from public.update_inventory_product(p_product_id:=$1,p_name:=$2,p_sku:=$3,p_description:=null,p_is_active:=true,p_closing_stock_behavior:=null)`, [created.id, 'Rice Sack 25kg', 'RICE-BPS'])).rows[0];
  assert.equal(renamed.name, 'Rice Sack 25kg');
  assert.equal(renamed.selling_price, null, 'still no price after an edit');
  assert.equal((await bpRows(created.id)).length, 0);
  console.log('A5. stock-only product, no price, no branch: ok');
}

// ================================================================ B. the real pricing step, rendered
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const step = loadTs('src/features/products/BranchPricingStep.tsx', {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: () => null },
  '@/components/BottomSheet': { useSheetReveal: () => () => {}, useSheetScrollToTop: () => () => {} },
});
const noop = () => {};
const text = (props) => renderToStaticMarkup(React.createElement(step.BranchPricingStep, {
  mode: 'different', onModeChange: noop, variants: [], stockSummaries: {}, branches: [{ id: 'a', name: 'SM 1' }, { id: 'b', name: 'SM 2' }],
  uniformBase: '', onUniformBaseChange: noop, uniformPrices: {}, onUniformPriceChange: noop,
  branchOn: { a: true, b: true }, onToggleBranch: noop, drafts: {}, onBranchBaseChange: noop, onBranchVariantPriceChange: noop, ...props,
})).replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const count = (s, needle) => s.split(needle).length - 1;
{
  // Create: both branches on, nothing typed, no error yet
  let out = text({});
  assert.equal(count(out, 'Add to branch'), 2);
  assert.equal(count(out, 'Selling price'), 2);
  assert.doesNotMatch(out, /Enter a price|Must be above|Invalid/, 'no complaints before a save was tried');
  // after a failed save: every empty price says so; a typed 0 and a typo say what is wrong
  out = text({ error: 'Complete the pricing for all selected branches.' });
  assert.equal(count(out, 'Enter a price'), 2, 'both empty prices are flagged');
  assert.match(out, /Complete the pricing for all selected branches\./);
  out = text({ drafts: { a: { base: '0', variantPrices: {} }, b: { base: '4x', variantPrices: {} } } });
  assert.match(out, /Must be above ₱0/);
  assert.match(out, /Invalid price/);
  // a branch that is off shows no price field and is not flagged
  out = text({ branchOn: { a: true, b: false }, error: 'x', drafts: { a: { base: '40', variantPrices: {} } } });
  assert.equal(count(out, 'Selling price'), 1, 'the branch that is off has no price field');
  assert.doesNotMatch(out, /Enter a price/);
  // options: every empty option price in a branch that is on is flagged
  out = text({ variants: [{ key: 'v1', name: 'Small' }, { key: 'v2', name: 'Large' }], error: 'x', drafts: { a: { base: '', variantPrices: { v1: '30' } } } });
  assert.equal(count(out, 'Enter a price'), 3, 'Large at SM 1 and both options at SM 2');
  // Edit: a branch that already carries the product has no switch and says what is off there
  out = text({ lockedOnIds: ['a'], variants: [{ key: 'v1', name: 'Small' }, { key: 'v2', name: 'Large' }], offProductBranchIds: ['a'], offOptionKeysByBranch: { a: ['v2'] }, drafts: { a: { base: '', variantPrices: { v1: '30', v2: '50' } }, b: { base: '', variantPrices: {} } }, branchOn: { a: true, b: false } });
  assert.match(out, /SM 1\|Already added · off at this branch/);
  assert.match(out, /Large\|\s+Off/, 'the option that is switched off at the branch is tagged');
  assert.equal(count(out, 'Add to branch'), 1, 'only the branch that does not carry it has a switch');
  // same for all: the hint names the branches that would be added
  out = text({ mode: 'same', uniformBase: '45', notCarriedBranches: ['SM 2'] });
  assert.match(out, /For all 2 branches\. Adds it to SM 2\./);
  out = text({ mode: 'same', uniformBase: '45' });
  assert.match(out, /For all 2 branches\.\|/);
  // a single selling branch
  out = text({ branches: [{ id: 'a', name: 'SM 1' }], branchOn: { a: true } });
  assert.equal(count(out, 'Add to branch'), 1);
  console.log('B. pricing step states: ok');
}

// ================================================================ C. scrolling and navigation wiring
{
  const sheet = read('src/components/BottomSheet.tsx');
  assert.match(sheet, /scrollRef\.current\?\.scrollTo\(\{ y: 0, animated: false \}\)/);
  assert.match(sheet, /<SheetScrollContext\.Provider value=\{sheetScroll\}>\{body\}<\/SheetScrollContext\.Provider>/);
  for (const [name, src] of [['create', read('src/features/products/CreateProductWizard.tsx')], ['edit', read('src/features/products/EditProductWizard.tsx')]]) {
    assert.match(src, /const scrollToTop = useSheetScrollToTop\(\);\n  useEffect\(\(\) => \{\n    scrollToTop\(\);\n  \}, \[step, scrollToTop\]\);/, `${name}: every step starts at the top`);
    assert.match(src, /if \(field\) reveal\(field, \{ focus: field \}\);/, `${name}: a step 1 error is brought into view and focused`);
    assert.match(src, /setStep\(\(current\) => \(current === 3 \? \(simpleFlow \? 1 : 2\) : 1\)\)/, `${name}: Back goes to the previous step of the flow`);
  }
  console.log('C. scrolling and navigation wiring: ok');
}

console.log('branch_pricing_scenarios: ALL PASS');
