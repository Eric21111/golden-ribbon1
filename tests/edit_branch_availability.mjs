// Edit Product keeps what is switched off. update_complete_product (20261027100000) writes every branch it is SENT without
// switching existing rows back on, so the wizard has no restore step: it only skips the branches whose prices did not change
// (branchesToSend). Real RPCs on PGlite (Postgres WASM, not a native PostgreSQL), mirroring what the products screen does.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { branchesToSend, branchesToAdd, branchesCarrying, switchedOffAtBranches } = loadTs('src/features/products/branchPricingEdit.ts');
const J = JSON.stringify;

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
`);
// the backend with the edit-keeps-availability migration (20261027100000); later migrations are covered in edit_product_atomic_availability.mjs.
for (const f of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort().filter((n) => n < '20261028')) await db.exec(read(`supabase/migrations/${f}`).replace(/create extension if not exists pgcrypto;/g, ''));
const id = (n) => `85000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [mgr, c1, main, sm1, sm2] = [id(2), id(4), id(10), id(11), id(12)];
const BRANCHES = [{ id: sm1, name: 'SM1' }, { id: sm2, name: 'SM2' }];
const as = async (user, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
await db.exec(`
  insert into auth.users values ('${mgr}','m@t'),('${c1}','c1@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-EB',true,true,'counted'),('${sm1}','SM1','SM1-EB',false,true,'cashier_confirm'),('${sm2}','SM2','SM2-EB',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values ('${mgr}','Main Mgr','manager','${main}'),('${c1}','Cashier One','cashier','${sm1}');
`);
const create = (o) =>
  as(mgr, () =>
    db.query(
      `select * from public.create_complete_product(p_name:=$1,p_sku:=$2,p_description:=null,p_variants:=$3::jsonb,p_branches:=$4::jsonb,p_selling_price:=$5,p_stock_uses:=$6::jsonb)`,
      [o.name, o.sku, J((o.variants ?? []).map(([n, p]) => ({ name: n, default_price: p }))), J(o.branches), o.price ?? null, o.stockUses ? J(o.stockUses) : null],
    ),
  ).then((r) => r.rows[0]);
const rice = await create({ name: 'Rice', sku: 'RICE-EB', price: '10', branches: [{ branch_id: sm1, selling_price: '10' }] });
const V = [['Small', '30.00'], ['Large', '50.00']];
const optionBranches = (list) => list.map((b) => ({ branch_id: b, variants: V.map(([n, p]) => ({ name: n, selling_price: p })) }));
const combo = await create({
  name: 'Combo', sku: 'COMBO-EB', variants: V, branches: optionBranches([sm1, sm2]),
  stockUses: [{ variant_name: 'Small', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'Large', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'Large', ingredient_product_id: rice.id, quantity: 1 }],
});
const solo = await create({ name: 'Solo', sku: 'SOLO-EB', price: '40', branches: [{ branch_id: sm1, selling_price: '40' }] });
for (const p of [rice, combo, solo]) await as(mgr, () => db.query('select public.set_product_status($1,true)', [p.id]));

// switched off by hand (no screen does this): Large at SM1, and the WHOLE product at SM2
await as(mgr, () => db.query('select public.configure_branch_product_variants($1,$2,$3::jsonb)', [sm1, combo.id, J([{ name: 'Large', selling_price: '50.00', is_active: false }])]));
await as(mgr, () => db.query('select public.configure_branch_products($1,$2::jsonb)', [sm2, J([{ product_id: combo.id, selling_price: '30.00', is_active: false }])]));
// a sale of Small at SM1, so there is history to protect
await as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J([{ product_id: combo.id, quantity: 50 }])]));
const t0 = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [sm1, J([{ product_id: combo.id, quantity_sent: 20, destination_price: 30 }]), 'eb-send-0000000000001']))).rows[0].id;
await as(c1, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t0, 'eb-arrive-000000000001']));
const shift = (await as(c1, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const smallId = (await db.query('select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [sm1, combo.id, 'Small'])).rows[0].id;
await as(c1, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J([{ product_id: combo.id, variant_id: smallId, quantity: 2 }]), '1000', 'eb-sale-00000000000001', 'standard']));

// ---------------------------------------------------------------- helpers: what the screen reads and does
const source = async (productId) => ({
  sourceVariants: (await db.query('select id, name, default_price::numeric d from public.product_variants where product_id=$1 order by sort_order, name', [productId])).rows.map((r) => ({ id: r.id, name: r.name, default_price: Number(r.d) })),
  sourceBranchPrices: (await db.query('select branch_id, selling_price::numeric p, is_active from public.branch_products where product_id=$1', [productId])).rows.map((r) => ({ branch_id: r.branch_id, selling_price: Number(r.p), is_active: r.is_active })),
  sourceBranchVariantPrices: (await db.query('select branch_id, name, selling_price::numeric p, is_active from public.branch_product_variants where product_id=$1', [productId])).rows.map((r) => ({ branch_id: r.branch_id, name: r.name, selling_price: Number(r.p), is_active: r.is_active })),
});
const snapshot = async (productId) => JSON.stringify({
  bp: (await db.query('select branch_id, selling_price::numeric p, is_active from public.branch_products where product_id=$1 order by 1', [productId])).rows,
  bpv: (await db.query('select branch_id, name, selling_price::numeric p, is_active from public.branch_product_variants where product_id=$1 order by 1,2', [productId])).rows,
  uses: (await db.query('select variant_id, ingredient_product_id, quantity::numeric q from public.product_stock_uses where product_id=$1 order by 1,2', [productId])).rows,
  master: (await db.query('select id, name, default_price::numeric d, is_active from public.product_variants where product_id=$1 order by 2', [productId])).rows,
});
const history = async () => JSON.stringify({
  sales: (await db.query('select id, total_amount::numeric t from public.sales order by id')).rows,
  items: (await db.query('select id, product_id, variant_id, variant_name, quantity, unit_price::numeric u from public.sale_items order by id')).rows,
  moves: (await db.query('select count(*)::int n from public.inventory_movements')).rows,
});
const optionDraft = (branchId, prices) => ({ branchId, variants: Object.entries(prices).map(([name, selling_price]) => ({ name, selling_price })) });
const variantValues = async (names = {}) => (await source(combo.id)).sourceVariants.map((v, i) => ({ id: v.id, name: names[v.name] ?? v.name, default_price: String(i === 0 ? 30 : 50) }));
const saveCombo = (variants, send) =>
  as(mgr, () =>
    db.query(
      `select * from public.update_complete_product(p_product_id:=$1,p_name:='Combo',p_sku:='COMBO-EB',p_description:=null,p_is_active:=true,p_variants:=$2::jsonb,p_deleted_variant_ids:='[]'::jsonb,p_branches:=$3::jsonb,p_selling_price:=null)`,
      [combo.id, J(variants.map((v) => ({ id: v.id, name: v.name, default_price: v.default_price }))), J(send.map((d) => ({ branch_id: d.branchId, variants: d.variants })))],
    ),
  );
const optionRow = async (b, name) => (await db.query('select selling_price::numeric p, is_active from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [b, combo.id, name])).rows[0];
const productRow = async (b, product = combo) => (await db.query('select selling_price::numeric p, is_active from public.branch_products where branch_id=$1 and product_id=$2', [b, product.id])).rows[0];

const startState = await snapshot(combo.id);
assert.equal((await optionRow(sm1, 'Large')).is_active, false);
assert.equal((await productRow(sm2)).is_active, false);
const startHistory = await history();

// ---------------------------------------------------------------- 1. nothing changed: nothing is sent, nothing is switched back on
{
  const src = await source(combo.id);
  const variants = await variantValues();
  const pricing = [optionDraft(sm1, { Small: '30', Large: '50' }), optionDraft(sm2, { Small: '30', Large: '50' })]; // what "Same for All" would submit untouched
  const send = branchesToSend({ pricing, variants, ...src });
  assert.deepEqual(send, []);
  await saveCombo(variants, send); // an empty branch list is accepted
  assert.equal(await snapshot(combo.id), startState, 'prices, options, off switches, recipes and master options are all unchanged');
  assert.equal(await history(), startHistory);
  console.log('1. untouched save: ok');
}

// ---------------------------------------------------------------- 2. one branch's price changed: only that branch is sent, what was off there stays off
{
  const src = await source(combo.id);
  const variants = (await variantValues()).map((v) => (v.name === 'Small' ? { ...v, default_price: '32' } : v));
  const pricing = [optionDraft(sm1, { Small: '32', Large: '50' }), optionDraft(sm2, { Small: '30', Large: '50' })];
  const send = branchesToSend({ pricing, variants, ...src });
  assert.deepEqual(send.map((d) => d.branchId), [sm1], 'SM2 is not sent');
  await saveCombo(variants, send);
  assert.equal((await optionRow(sm1, 'Large')).is_active, false, 'Large stays off at the branch that was sent, with no second request');
  assert.deepEqual([Number((await optionRow(sm1, 'Small')).p), (await optionRow(sm1, 'Small')).is_active], [32, true], 'the new price is saved and Small is on');
  assert.equal(Number((await optionRow(sm1, 'Large')).p), 50, 'the off option keeps its price');
  assert.deepEqual([Number((await productRow(sm2)).p), (await productRow(sm2)).is_active], [30, false], 'SM2 untouched (still off)');
  assert.deepEqual([Number((await optionRow(sm2, 'Small')).p), Number((await optionRow(sm2, 'Large')).p)], [30, 50]);
  assert.equal(await history(), startHistory, 'sales history untouched');
  console.log('2. one branch changed: ok');
}

// ---------------------------------------------------------------- 3. rename an option, prices untouched: nothing sent, the rename still reaches every branch
{
  const src = await source(combo.id);
  const variants = await variantValues({ Large: 'Big' });
  const pricing = [optionDraft(sm1, { Small: '32', Big: '50' }), optionDraft(sm2, { Small: '30', Big: '50' })];
  const send = branchesToSend({ pricing, variants, ...src });
  assert.deepEqual(send, [], 'a rename is not a price change');
  const usesBefore = (await snapshot(combo.id)).includes('"uses"');
  await saveCombo(variants.map((v) => (v.name === 'Small' ? { ...v, default_price: '32' } : v)), send);
  assert.deepEqual((await optionRow(sm1, 'Big')).is_active, false, 'renamed AND still off at SM1');
  assert.equal(Number((await optionRow(sm2, 'Big')).p), 50, 'renamed at SM2 too, although SM2 was not sent');
  assert.equal((await db.query(`select count(*)::int n from public.product_stock_uses u join public.product_variants v on v.id = u.variant_id where v.name = 'Big'`)).rows[0].n, 2, 'its recipe (meal + Rice) followed the rename');
  assert.ok(usesBefore);
  assert.equal(await history(), startHistory);
  console.log('3. rename: ok');
}

// ---------------------------------------------------------------- 4. a branch with the WHOLE product off is changed: it stays off, at the new price
{
  const src = await source(combo.id);
  const variants = (await variantValues({ Large: 'Big' })).map((v) => (v.name === 'Small' ? { ...v, default_price: '32' } : v));
  const pricing = [optionDraft(sm1, { Small: '32', Big: '50' }), optionDraft(sm2, { Small: '33', Big: '50' })];
  const send = branchesToSend({ pricing, variants, ...src });
  assert.deepEqual(send.map((d) => d.branchId), [sm2]);
  await saveCombo(variants, send);
  assert.deepEqual([Number((await productRow(sm2)).p), (await productRow(sm2)).is_active], [33, false], 'still off, at the new price');
  assert.equal(Number((await optionRow(sm2, 'Small')).p), 33);
  console.log('4. branch product off: ok');
}

// ---------------------------------------------------------------- 5. single price: different prices per branch, and "Same for All" adding a branch
{
  // the product is carried at SM1 only: the Step 3 sentence names SM2
  let src = await source(solo.id);
  assert.deepEqual(branchesToAdd(BRANCHES, src), ['SM2']);
  // untouched
  assert.deepEqual(branchesToSend({ pricing: [{ branchId: sm1, selling_price: '40' }], variants: [], ...src }), []);
  // "Same for All" 40: SM1 already has it (not sent); SM2 is new, so it IS sent and gets the product
  const send = branchesToSend({ pricing: [{ branchId: sm1, selling_price: '40' }, { branchId: sm2, selling_price: '40' }], variants: [], ...src });
  assert.deepEqual(send.map((d) => d.branchId), [sm2]);
  await as(mgr, () => db.query(`select * from public.update_complete_product(p_product_id:=$1,p_name:='Solo',p_sku:='SOLO-EB',p_description:=null,p_is_active:=true,p_variants:='[]'::jsonb,p_deleted_variant_ids:='[]'::jsonb,p_branches:=$2::jsonb,p_selling_price:='40')`, [solo.id, J(send.map((d) => ({ branch_id: d.branchId, selling_price: d.selling_price })))]));
  assert.deepEqual([Number((await productRow(sm2, solo)).p), (await productRow(sm2, solo)).is_active], [40, true], 'SM2 now carries it');
  // different prices per branch open as different prices and an untouched save sends nothing
  await as(mgr, () => db.query(`select * from public.update_complete_product(p_product_id:=$1,p_name:='Solo',p_sku:='SOLO-EB',p_description:=null,p_is_active:=true,p_variants:='[]'::jsonb,p_deleted_variant_ids:='[]'::jsonb,p_branches:=$2::jsonb,p_selling_price:='40')`, [solo.id, J([{ branch_id: sm2, selling_price: '45' }])]));
  src = await source(solo.id);
  assert.deepEqual(src.sourceBranchPrices.map((r) => [r.branch_id === sm1 ? 'SM1' : 'SM2', r.selling_price]).sort(), [['SM1', 40], ['SM2', 45]]);
  assert.deepEqual(branchesToSend({ pricing: [{ branchId: sm1, selling_price: '40' }, { branchId: sm2, selling_price: '45' }], variants: [], ...src }), [], 'different prices, untouched: nothing sent');
  // changing one branch sends only that one and leaves the other price alone
  const one = branchesToSend({ pricing: [{ branchId: sm1, selling_price: '40' }, { branchId: sm2, selling_price: '50' }], variants: [], ...src });
  assert.deepEqual(one.map((d) => d.branchId), [sm2]);
  console.log('5. single price: ok');
}

// ---------------------------------------------------------------- 6. sending EVERY branch (a stale or older client) no longer switches anything back on
{
  const variants = await variantValues({ Large: 'Big' });
  await saveCombo(variants, [optionDraft(sm1, { Small: '32', Big: '50' }), optionDraft(sm2, { Small: '33', Big: '50' })]);
  assert.equal((await optionRow(sm1, 'Big')).is_active, false, 'the option that was off stays off');
  assert.equal((await productRow(sm2)).is_active, false, 'the branch product that was off stays off');
  assert.equal(await history(), startHistory);
  console.log('6. every branch sent: ok');
}

// ---------------------------------------------------------------- 6b. Edit shows the existing branches as they are, including what is switched off
{
  const src = await source(combo.id);
  const wizardVariants = (await variantValues({ Large: 'Big' })).map((v) => ({ key: v.id, id: v.id }));
  assert.deepEqual(branchesCarrying(src).sort(), [sm1, sm2].sort(), 'both branches have option rows: both carry it');
  const off = switchedOffAtBranches(src, wizardVariants);
  assert.deepEqual(off.productOff, [sm2], 'the whole product is off at SM2');
  const bigKey = (await source(combo.id)).sourceVariants.find((v) => v.name === 'Big').id;
  assert.deepEqual(off.optionsOff, { [sm1]: [bigKey] }, 'Big is off at SM1, matched through the option id (works after a rename too)');
  // a branch row with NO option rows is not "carried" yet: it keeps its switch and starts off
  const partial = {
    sourceVariants: [{ id: 'v1', name: 'Small', default_price: 30 }],
    sourceBranchPrices: [{ branch_id: sm1, selling_price: 30, is_active: true }, { branch_id: sm2, selling_price: 30, is_active: true }],
    sourceBranchVariantPrices: [{ branch_id: sm1, name: 'Small', selling_price: 30, is_active: true }],
  };
  assert.deepEqual(branchesCarrying(partial), [sm1]);
  // without options it is the branch rows that count (switched-off rows count too: the product is still listed there)
  assert.deepEqual(branchesCarrying({ sourceVariants: [], sourceBranchPrices: partial.sourceBranchPrices.map((r) => ({ ...r, is_active: false })), sourceBranchVariantPrices: [] }).sort(), [sm1, sm2].sort());
  // nothing is written for a branch that is only being shown: an untouched save still sends nothing and changes nothing
  const before = await snapshot(combo.id);
  const variants = await variantValues({ Large: 'Big' });
  const none = branchesToSend({ pricing: [optionDraft(sm1, { Small: String(Number((await optionRow(sm1, 'Small')).p)), Big: '50' }), optionDraft(sm2, { Small: String(Number((await optionRow(sm2, 'Small')).p)), Big: '50' })], variants, ...src });
  assert.deepEqual(none, [], 'prices as saved: nothing to send');
  assert.equal(await snapshot(combo.id), before);
  console.log('6b. existing branches: ok');
}

// ---------------------------------------------------------------- 7. wiring: the restore step and its warnings are gone
{
  const wizard = read('src/features/products/EditProductWizard.tsx');
  const screen = read('app/(manager)/manager/products/index.tsx');
  const step = read('src/features/products/BranchPricingStep.tsx');
  assert.match(wizard, /const send = branchesToSend\(\{/);
  assert.match(wizard, /\n      send,\n/);
  assert.match(wizard, /mode: \(pricedBranchIds\.length > 0 \? 'different' : 'same'\) as PricingMode,/, 'prefill: not the same everywhere opens as Different per Branch');
  assert.match(screen, /is_active: row\.is_active,/, 'the screen passes the off flags to the wizard');
  for (const [name, src] of [['wizard', wizard], ['screen', screen], ['step', step], ['module', read('src/features/products/branchPricingEdit.ts')]]) {
    assert.doesNotMatch(src, /keepOff|KeepOff|keptOffNotes|planBranchSave|It stays off when you save|may be on again/, `${name}: no restore workaround left`);
  }
  assert.doesNotMatch(screen, /configureBranchProducts|configureBranchProductVariants/, 'the products screen no longer re-switches anything off');
  assert.match(step, /Adds it to \$\{toAdd\.join\(', '\)\}\./, 'Same for All names the branches it would add the product to');
  assert.match(step, /'Add to branch'/, 'the switch says what it does: it adds the product to the branch');
  assert.doesNotMatch(step, /Sell here|Sell at/, 'no "sell" promise: stock and the POS switches still decide whether it can be sold');
  assert.match(step, /Already added/, 'a branch that already carries the product is shown as added');
  assert.match(step, /lockedOnIds\.includes\(branch\.id\)/, 'a branch that already carries the product has no switch');
  console.log('7. wiring: ok');
}

console.log('edit_branch_availability: ALL PASS');
