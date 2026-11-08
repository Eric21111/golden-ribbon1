// The "no stock of its own" classification checked against products SAVED through the real create flow and against what a real
// sale actually deducts (PGlite = Postgres WASM running every migration; not a native PostgreSQL and not your live Supabase).
// Rule under test: a product is shared (nothing to count) exactly when none of its sales deducts its own stock and nothing else
// needs its own stock. Every product here is saved by create_complete_product, then sold, and the two views must agree.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const { buildStockSetup } = loadTs('src/features/inventory/sharedStock.ts');
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
`);
for (const f of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) await db.exec(read(`supabase/migrations/${f}`).replace(/create extension if not exists pgcrypto;/g, ''));
const id = (n) => `89000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [mgr, cashier, main, booth] = [id(2), id(4), id(10), id(11)];
const J = JSON.stringify;
const as = async (user, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  try { return await work(); } finally { await db.exec('reset role'); }
};
await db.exec(`
  insert into auth.users values ('${mgr}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values ('${main}','Main','MAIN-SS',true,true,'counted'),('${booth}','Booth','BOOTH-SS',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values ('${mgr}','Main Mgr','manager','${main}'),('${cashier}','Cashier','cashier','${booth}');
`);
const create = ({ name, sku, variants = [], price = null, stockUses, drinkChoices }) => as(mgr, () => db.query(
  `select * from public.create_complete_product(p_name := $1, p_sku := $2, p_description := null, p_variants := $3::jsonb, p_branches := $4::jsonb, p_selling_price := $5, p_stock_uses := $6::jsonb, p_drink_choices := $7::jsonb)`,
  [name, sku, J(variants.map(([n, p]) => ({ name: n, default_price: p }))),
    J([variants.length ? { branch_id: booth, variants: variants.map(([n, p]) => ({ name: n, selling_price: p })) } : { branch_id: booth, selling_price: price }]),
    variants.length ? null : price, stockUses === undefined ? null : J(stockUses), drinkChoices === undefined ? null : J(drinkChoices)],
)).then((r) => r.rows[0]);

// ---------------------------------------------------------------- the catalog, saved through the real flow
const rice = await create({ name: 'Rice', sku: 'RICE-SS', price: '15.00' });
const egg = await create({ name: 'Egg', sku: 'EGG-SS', price: '10.00' });
const coke = await create({ name: 'Coke', sku: 'COKE-SS', price: '20.00' });
const extraWater = await create({ name: 'Extra Water', sku: 'XWATER-SS', price: '12.00', stockUses: [{ ingredient_product_id: rice.id, quantity: 1 }] });
const curry = await create({
  name: 'Curry', sku: 'CURRY-SS', variants: [['Viand Only', '70.00'], ['With Rice', '85.00']],
  stockUses: [{ variant_name: 'Viand Only', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'With Rice', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'With Rice', ingredient_product_id: rice.id, quantity: 1 }],
  drinkChoices: [{ variant_name: 'With Rice', drink_product_id: coke.id }, { variant_name: 'With Rice', drink_product_id: extraWater.id }],
});
const extraRice = await create({ name: 'Extra Rice', sku: 'XRICE-SS', price: '20.00', stockUses: [{ ingredient_product_id: rice.id, quantity: 1 }] });
const extraEgg = await create({ name: 'Extra Egg', sku: 'XEGG-SS', variants: [['Small', '10.00'], ['Large', '18.00']], stockUses: [{ variant_name: 'Small', ingredient_product_id: egg.id, quantity: 1 }, { variant_name: 'Large', ingredient_product_id: egg.id, quantity: 2 }] });
const cheese = await create({ name: 'Cheesestick', sku: 'CHEESE-SS', variants: [['3 Pcs', '30.00']], stockUses: [{ variant_name: '3 Pcs', ingredient_product_id: 'self', quantity: 3 }] });
const combo = await create({ name: 'Combo', sku: 'COMBO-SS', price: '50.00', stockUses: [{ ingredient_product_id: 'self', quantity: 1 }, { ingredient_product_id: rice.id, quantity: 1 }] });
const half = await create({ name: 'Half Listed', sku: 'HALF-SS', variants: [['Small', '10.00'], ['Large', '20.00']], stockUses: [{ variant_name: 'Small', ingredient_product_id: rice.id, quantity: 1 }] });
const all = [rice, egg, coke, extraWater, curry, extraRice, extraEgg, cheese, combo, half];
for (const p of all) await as(mgr, () => db.query('select public.set_product_status($1,true)', [p.id]));

// ---------------------------------------------------------------- 1. classify from what was SAVED (the same columns the app reads)
const products = (await db.query('select id, name, sell_in_pos from public.products')).rows;
const variants = (await db.query('select id, product_id, name, sort_order from public.product_variants')).rows;
const stockUses = (await db.query('select id, product_id, variant_id, ingredient_product_id, quantity::numeric q from public.product_stock_uses')).rows.map((r) => ({ ...r, quantity: Number(r.q) }));
const drinkChoices = (await db.query('select id, product_id, variant_id, drink_product_id from public.product_drink_choices')).rows;
const setup = buildStockSetup({ products, variants, stockUses, drinkChoices });
const nameById = new Map(products.map((p) => [p.id, p.name]));
const sharedNames = [...setup.shared].map((x) => nameById.get(x)).sort();
{
  assert.deepEqual(sharedNames, ['Extra Egg', 'Extra Rice'], 'only the two extras that take everything from Rice / Egg');
  assert.deepEqual(setup.sources.get(extraRice.id).map((s) => s.name), ['Rice']);
  assert.deepEqual(setup.sources.get(extraEgg.id).map((s) => s.name), ['Egg']);
  for (const [p, why] of [[rice, 'standalone, and an ingredient'], [egg, 'standalone, and an ingredient'], [coke, 'standalone drink, offered as a drink choice'], [extraWater, 'takes Rice, but is offered as a drink choice (its own stock is what a drink pick deducts)'], [curry, 'its Viand Only option deducts its own stock'], [cheese, 'deducts its own item x3'], [combo, 'mixes its own stock with Rice'], [half, 'Large has no list: it deducts the product itself x1']]) {
    assert.equal(setup.shared.has(p.id), false, `${p.name}: ${why}`);
  }
  console.log('1. classification from saved configurations: ok');
}

// ---------------------------------------------------------------- 2. the same classification, checked against real sales
const openMain = (items) => as(mgr, () => db.query(`select public.initialize_main_branch_inventory($1::jsonb,'open')`, [J(items.map(([product_id, quantity]) => ({ product_id, quantity })))]));
// a leftover own balance on Extra Rice from before (it should never have been counted): it must survive untouched
await openMain([[rice.id, 400], [egg.id, 400], [coke.id, 100], [extraWater.id, 100], [curry.id, 100], [cheese.id, 100], [combo.id, 100], [half.id, 100], [extraRice.id, 7]]);
const transfer = (await as(mgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [booth, J([rice, egg, coke, extraWater, curry, cheese, combo, half].map((p) => ({ product_id: p.id, quantity_sent: 60, destination_price: 10 }))), 'ss-send-000000000001']))).rows[0].id;
await as(cashier, () => db.query('select public.confirm_shipment_arrival($1,$2)', [transfer, 'ss-arrive-00000000001']));
const shift = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const boothBalance = async () => Object.fromEntries((await db.query('select product_id, quantity_on_hand::numeric q from public.branch_inventory where branch_id=$1', [booth])).rows.map((r) => [r.product_id, Number(r.q)]));
const mainBalance = async (productId) => Number((await db.query('select quantity_on_hand::numeric q from public.branch_inventory where branch_id=$1 and product_id=$2', [main, productId])).rows[0]?.q ?? 0);
const variantId = async (product, name) => (await db.query('select id from public.branch_product_variants where branch_id=$1 and product_id=$2 and name=$3', [booth, product.id, name])).rows[0].id;
let keyN = 0;
const ownDeducted = new Map(all.map((p) => [p.id, false]));
const sell = async (product, variantName, drink) => {
  const before = await boothBalance();
  const line = { product_id: product.id, variant_id: variantName ? await variantId(product, variantName) : null, quantity: 1, ...(drink ? { drink_product_id: drink.id } : {}) };
  await as(cashier, () => db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [shift, J([line]), '100000', `ss-sale-${String(++keyN).padStart(14, '0')}`, 'standard']));
  const after = await boothBalance();
  // the sold product's own balance dropping is "it deducted its own stock"; so is a chosen drink's
  if ((after[product.id] ?? 0) < (before[product.id] ?? 0)) ownDeducted.set(product.id, true);
  if (drink && (after[drink.id] ?? 0) < (before[drink.id] ?? 0)) ownDeducted.set(drink.id, true);
  return { before, after };
};
{
  const rice0 = (await boothBalance())[rice.id];
  const xr = await sell(extraRice, null);
  assert.equal(xr.after[rice.id], xr.before[rice.id] - 1, 'Extra Rice sale takes Rice');
  assert.equal(xr.after[extraRice.id], undefined, 'and Extra Rice has no stock row at the branch');
  await sell(extraEgg, 'Small');
  const large = await sell(extraEgg, 'Large');
  assert.equal(large.after[egg.id], large.before[egg.id] - 2, 'Extra Egg Large takes Egg x2');
  await sell(rice, null);
  await sell(egg, null);
  await sell(coke, null);
  await sell(extraWater, null); // takes Rice
  await sell(cheese, '3 Pcs');
  await sell(combo, null);
  await sell(half, 'Small'); // Rice only
  await sell(half, 'Large'); // no list: the product itself
  await sell(curry, 'Viand Only');
  await sell(curry, 'With Rice', extraWater); // the chosen drink's OWN stock goes down
  assert.ok((await boothBalance())[rice.id] < rice0);
  for (const p of all) {
    assert.equal(!ownDeducted.get(p.id), setup.shared.has(p.id), `${p.name}: shared iff no sale deducted its own stock (deducted own = ${ownDeducted.get(p.id)}, shared = ${setup.shared.has(p.id)})`);
  }
  console.log('2. classification matches real sales: ok');
}

// ---------------------------------------------------------------- 3. existing unused balances and history are untouched
{
  assert.equal(await mainBalance(extraRice.id), 7, 'the leftover Extra Rice balance at Main is still 7: classifying only decides what is listed');
  const sales = (await db.query('select count(*)::int n from public.sale_items')).rows[0].n;
  assert.ok(sales >= 12, 'every sale is still on record');
  assert.equal((await db.query('select count(*)::int n from public.product_stock_uses where product_id = $1', [extraRice.id])).rows[0].n, 1, 'the saved recipe is untouched');
  console.log('3. balances and history intact: ok');
}

// ---------------------------------------------------------------- 4. the read-only audit query (docs/opening-stock-shared-audit.sql) agrees with the app
{
  const sql = read('docs/opening-stock-shared-audit.sql');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /(insert|update|delete|alter|drop|create|truncate|grant)/i, 'select statements only');
  const rows = (await db.query(sql.replace(/--.*$/gm, ''))).rows;
  assert.deepEqual(rows.map((r) => r.product).sort(), sharedNames, 'the SQL and the app classify the same products');
  assert.equal(rows.find((r) => r.product === 'Extra Rice').takes_stock_from, 'Rice');
  assert.equal(rows.find((r) => r.product === 'Extra Egg').takes_stock_from, 'Egg');
  assert.equal(Number(rows.find((r) => r.product === 'Extra Rice').own_balance_at_main), 7, 'it reports the leftover own balance too');
  console.log('4. read-only audit SQL matches the app: ok');
}

// ---------------------------------------------------------------- 5. a recipe changes while the form is open: the re-check holds the entry back
{
  const { newlySharedEntries, staleEntriesNotice } = loadTs('src/features/inventory/sharedStock.ts');
  const reread = async () => buildStockSetup({
    products: (await db.query('select id, name, sell_in_pos from public.products')).rows,
    variants: (await db.query('select id, product_id, name, sort_order from public.product_variants')).rows,
    stockUses: (await db.query('select id, product_id, variant_id, ingredient_product_id, quantity::numeric q from public.product_stock_uses')).rows.map((r) => ({ ...r, quantity: Number(r.q) })),
    drinkChoices: (await db.query('select id, product_id, variant_id, drink_product_id from public.product_drink_choices')).rows,
  });
  const edit = (product, stockUses) => as(mgr, () => db.query(
    `select * from public.update_complete_product(p_product_id := $1, p_name := $2, p_sku := $3, p_description := null, p_is_active := true, p_variants := '[]'::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := '[]'::jsonb, p_selling_price := $4, p_stock_uses := $5::jsonb)`,
    [product.id, product.name, product.sku, '50.00', J(stockUses)],
  ));
  // the form is open and the user has typed 25 for Combo (it counts its own stock: not shared)
  const typed = [{ product_id: combo.id, quantity: '25' }, { product_id: rice.id, quantity: '' }];
  const comboBefore = await mainBalance(combo.id);
  let fresh = await reread();
  assert.deepEqual(newlySharedEntries(typed, fresh.shared), [], 'nothing changed: nothing is held back');
  // meanwhile somebody edits Combo so it takes only Rice
  await edit(combo, [{ ingredient_product_id: rice.id, quantity: 1 }]);
  fresh = await reread();
  assert.equal(fresh.shared.has(combo.id), true, 'the re-read sees the new recipe');
  const held = newlySharedEntries(typed, fresh.shared);
  assert.deepEqual(held.map((e) => e.product_id), [combo.id], 'its quantity is held back from the save');
  assert.match(staleEntriesNotice(['Combo']), /Combo now takes its stock from other items, so its quantity was left out./);
  assert.deepEqual(typed[0], { product_id: combo.id, quantity: '25' }, 'what was typed is untouched');
  assert.equal(await mainBalance(combo.id), comboBefore, 'and so is the balance that exists');
  // and back: the recipe uses its own stock again, so it counts again
  await edit(combo, [{ ingredient_product_id: 'self', quantity: 1 }, { ingredient_product_id: rice.id, quantity: 1 }]);
  fresh = await reread();
  assert.equal(fresh.shared.has(combo.id), false);
  assert.deepEqual(newlySharedEntries(typed, fresh.shared), []);
  console.log('5. recipe changed while the form is open: ok');
}

console.log('stock_setup_real_db: ALL PASS');
