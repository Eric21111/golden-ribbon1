// The helper text on the Create/Edit product switches must match what the database really does. This runs the migrations
// in PGlite (Postgres WASM, not a native PostgreSQL) and checks each sentence the form shows:
//   Show in Cashier POS   "Available for separate sale when enabled and priced at the branch" / "Hidden from the cashier menu, but still usable for stock, transfers, and meal options"
//   Enable Product        "Stops new sales, transfers, and local purchases"
//   Keep Unsold Stock at Branch  "cannot be returned to Main, eligible for local purchases"; turning off changes shift close; older products differ
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const { PGlite } = await import('@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);
for (const file of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `20103131-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [mainMgr, cashier] = [id(2), id(3)];
const [main, booth] = [id(10), id(11)];
const [soda, meal, stockOnly, kept] = [id(20), id(21), id(22), id(23)];
await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN',true,true,'counted'),
    ('${booth}','Booth','B1',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Mgr','manager','${main}'),
    ('${cashier}','Cashier','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior,is_non_returnable,sell_in_pos) values
    ('${soda}','Soda','SODA',20,true,'piece_stock','keep_at_branch',true,true),
    ('${meal}','Meal','MEAL',80,true,'piece_stock','record_as_unsold',false,true),
    ('${stockOnly}','Rice Sack','RICE',null,true,'piece_stock','record_as_unsold',false,false),
    ('${kept}','Kept Snack','KEPT',30,true,'piece_stock','keep_at_branch',true,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${booth}','${soda}',20,true),('${booth}','${meal}',80,true),('${booth}','${kept}',30,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${soda}',50),('${main}','${meal}',50),('${main}','${stockOnly}',50),('${main}','${kept}',50),
    ('${booth}','${soda}',5),('${booth}','${meal}',5),('${booth}','${kept}',5);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const posNames = async () =>
  (await asUser(cashier, () => db.query('select product_name from public.list_cashier_pos_inventory()'))).rows.map((r) => r.product_name).sort();
const purchaseNames = async () =>
  (await asUser(cashier, () => db.query('select product_name from public.list_cashier_local_purchase_catalog()'))).rows.map((r) => r.product_name).sort();
const qty = async (branch, product) =>
  Number((await db.query('select quantity_on_hand q from public.branch_inventory where branch_id=$1 and product_id=$2', [branch, product])).rows[0].q);

// ---- Show in Cashier POS: Off = not on the cashier menu, but still stock (transfers) and meals
assert.deepEqual(await posNames(), ['Kept Snack', 'Meal', 'Soda'], 'On: the cashier menu lists it (enabled, branch price)');
assert.ok(!(await posNames()).includes('Rice Sack'), 'Off: not on the cashier menu');
await asUser(mainMgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4)', [booth, JSON.stringify([{ product_id: stockOnly, quantity_sent: '3' }]), null, 'rules-stock-only-0001']));
assert.equal(await qty(main, stockOnly), 47, 'Off: stock still moves in transfers');

// ---- Show in Cashier POS only works together with Enable Product: a disabled product is off the menu even when On
await asUser(mainMgr, () => db.query('select public.set_product_status($1,$2)', [meal, false]));
assert.deepEqual(await posNames(), ['Kept Snack', 'Soda'], 'disabled + shown in POS: still not on the cashier menu');

// ---- Enable Product Off: no transfers, no local purchases, no sales; stock itself is untouched
await asUser(mainMgr, () => db.query('select public.set_product_status($1,$2)', [soda, false]));
assert.equal(await qty(booth, soda), 5);
assert.equal(await qty(main, soda), 50, 'disabling never changes stock quantity');
await assert.rejects(
  asUser(mainMgr, () => db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4)', [booth, JSON.stringify([{ product_id: soda, quantity_sent: '1' }]), null, 'rules-disabled-xfer-01'])),
  /missing or inactive/i,
  'disabled: cannot be sent in a transfer',
);
assert.ok(!(await purchaseNames()).includes('Soda'), 'disabled: not in the local purchase list');
await assert.rejects(
  asUser(cashier, () => db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3)', [JSON.stringify([{ product_id: soda, quantity: '1' }]), null, 'rules-disabled-buy-0001'])),
  /missing or inactive/i,
  'disabled: cannot be recorded as a local purchase',
);
assert.equal(await qty(booth, soda), 5);
// the sale path refuses a disabled product too (confirm_sale is the final authority at the register)
const sale = readFileSync('supabase/migrations/20261024120000_confirm_sale_drink_choice.sql', 'utf8');
assert.match(sale, /if not found or not v_product\.is_active then/, 'confirm_sale rejects a disabled product');

// ---- Keep Unsold Stock at Branch: the same flag drives the local purchase list ("non-returnable" there)
assert.deepEqual(await purchaseNames(), ['Kept Snack'], 'enabled, carried, piece-stock products with the flag on (Soda is disabled; Meal is not flagged)');
assert.ok(!(await purchaseNames()).includes('Meal'), 'flag off: not in the local purchase list');
await assert.rejects(
  asUser(cashier, () => db.query('select public.record_branch_local_purchase($1::jsonb,$2,$3)', [JSON.stringify([{ product_id: stockOnly, quantity: '1' }]), null, 'rules-unflagged-buy-001'])),
  /non-returnable|inactive/i,
  'flag off: cannot be recorded as a local purchase',
);
const returnable = (await asUser(cashier, () => db.query('select product_name from public.list_return_inventory()'))).rows.map((r) => r.product_name);
assert.ok(!returnable.includes('Kept Snack'), 'flag on: excluded from leftover returns');
assert.ok(returnable.includes('Meal'), 'flag off: can be returned');
await assert.rejects(
  asUser(cashier, () => db.query('select public.create_stock_return($1::jsonb,$2,$3)', [JSON.stringify([{ product_id: kept, quantity_returned: 1 }]), null, 'rules-return-kept-0001'])),
  /non-returnable|must stay/i,
  'flag on: a return of it is refused',
);

// ---- Keep Unsold Stock at Branch (is_non_returnable) vs the close-of-shift setting (closing_stock_behavior):
//      two different fields. The flag forces "carried to next day"; turning it off from on switches to "unsold at close";
//      a product that was never flagged keeps whatever it had (older products are "carried to next day" and returnable).
const behavior = async (product) => (await db.query('select is_non_returnable f, closing_stock_behavior::text b from public.products where id=$1', [product])).rows[0];
await db.query(`update public.products set is_non_returnable=false, closing_stock_behavior='keep_at_branch' where id=$1`, [meal]);
assert.deepEqual(await behavior(meal), { f: false, b: 'keep_at_branch' }, 'older product: returnable AND carried to next day (list label "Carried to next day")');
await asUser(mainMgr, () => db.query('select public.set_product_non_returnable($1,$2)', [meal, false]));
assert.deepEqual(await behavior(meal), { f: false, b: 'keep_at_branch' }, 'turning "off" on a never-flagged product changes nothing');
await asUser(mainMgr, () => db.query('select public.set_product_non_returnable($1,$2)', [meal, true]));
assert.deepEqual(await behavior(meal), { f: true, b: 'keep_at_branch' }, 'on: stays at the branch and carries over (list label "Stays at branch")');
await asUser(mainMgr, () => db.query('select public.set_product_non_returnable($1,$2)', [meal, false]));
assert.deepEqual(await behavior(meal), { f: false, b: 'record_as_unsold' }, 'off after on: returnable and unsold at close (list label "Unsold at close")');
// what each close setting does at shift close is proven in revision_7c_end_shift.mjs (carried stays on hand, unsold is zeroed)

console.log('product_setting_helper_rules: ALL PASS');
