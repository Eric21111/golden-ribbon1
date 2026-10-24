// Regression coverage for the kg_meal (KG-delivered meal) restrictions that exist TODAY.
//
// History: Revision 7A retired kg_meal. Phase 3 (20261019140000) deliberately re-allowed it ONLY through
// set_product_inventory_mode and ONLY while every balance is clear and nothing is in flight ("Main-trackable kg_meal
// again", no automatic PCS<->KG conversion). Creating or editing a product through the wizard RPCs still refuses
// kg_meal. These tests pin exactly that, so a later migration cannot quietly widen or drop a guard.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (f) => readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/\r\n/g, '\n');
const files = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort();

// ---------------------------------------------------------------- 0. static: the guards live in the LAST definition
{
  const defs = files.filter((f) => /create or replace function public\.set_product_inventory_mode\(/i.test(read(f)));
  const last = read(defs[defs.length - 1]);
  const body = last.slice(last.search(/create or replace function public\.set_product_inventory_mode\(/i));
  const fn = body.slice(0, body.search(/revoke all on function public\.set_product_inventory_mode/i));
  assert.equal(defs[defs.length - 1], '20261019140000_phase3_inventory_operations.sql', 'a newer migration redefined set_product_inventory_mode: re-check every guard below');
  assert.match(fn, /is_main_branch_manager\(\)/, 'Main Branch Manager only');
  assert.match(fn, /v_requested not in \('piece_stock', 'kg_meal'\)/, 'only the two known inventory types');
  assert.match(fn, /quantity_on_hand <> 0/, 'every balance (including Main) must be clear');
  assert.match(fn, /st\.status in \('draft', 'pending_receipt'\)/, 'no open transfers');
  assert.match(fn, /sr\.status in \('draft', 'in_transit'\)/, 'no open returns');
  assert.doesNotMatch(fn, /update public\.branch_inventory|update public\.inventory_movements|quantity_on_hand\s*=/i, 'never converts or rewrites stock');
  assert.match(last, /revoke all on function public\.set_product_inventory_mode\(uuid, text\) from public, anon;/);
  // the wizard RPCs (latest versions) keep refusing kg_meal
  for (const f of ['20261023110000_save_product_stock_uses.sql', '20261024100000_save_product_drink_choices.sql']) {
    assert.match(read(f), /KG-delivered meal inventory is retired\. Use piece stock \(PCS\) only\./, f);
  }
}

// ---------------------------------------------------------------- database
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);
for (const f of files) await db.exec(read(f).replace(/create extension if not exists pgcrypto;/g, ''));

const id = (n) => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mainMgr = id(2);
const boothMgr = id(3);
const cashier = id(4);
const main = id(10);
const booth = id(11);
const clear = id(20);
const stocked = id(21);
const inflight = id(22);
const created = id(23);
await db.exec(`
  insert into auth.users values ('${mainMgr}','m@t'),('${boothMgr}','b@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-KG',true,true,'counted'),('${booth}','Booth','BOOTH-KG',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${mainMgr}','Main Manager','manager','${main}'),('${boothMgr}','Booth Manager','manager','${booth}'),('${cashier}','Cashier','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${clear}','Clear Meal','KG-CLEAR',80,true,'piece_stock','keep_at_branch'),
    ('${stocked}','Stocked Meal','KG-STOCK',80,true,'piece_stock','keep_at_branch'),
    ('${inflight}','Inflight Meal','KG-FLIGHT',80,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${booth}','${clear}',80,true),('${booth}','${stocked}',80,true),('${booth}','${inflight}',80,true);
`);
const as = async (user, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const setMode = (user, product, mode) => as(user, () => db.query('select * from public.set_product_inventory_mode($1,$2)', [product, mode]));
const modeOf = async (product) => (await db.query('select inventory_mode::text m from public.products where id=$1', [product])).rows[0].m;
const rejects = async (work, pattern, label) => {
  let error = null;
  try {
    await work();
  } catch (e) {
    error = e;
  }
  assert.ok(error, `${label}: should have been rejected`);
  assert.match(String(error.message), pattern, `${label}: ${error.message}`);
};
const stockSnapshot = async () => JSON.stringify((await db.query('select branch_id, product_id, quantity_on_hand::text q from public.branch_inventory order by 1,2')).rows);

// ---------------------------------------------------------------- 1. who and what
await rejects(() => setMode(cashier, clear, 'kg_meal'), /Main Branch Manager access is required/, 'cashier');
await rejects(() => setMode(boothMgr, clear, 'kg_meal'), /Main Branch Manager access is required/, 'branch manager');
await rejects(() => as(mainMgr, () => db.query(`select public.set_product_inventory_mode($1,'grams')`, [clear])), /piece stock or kg meal/, 'unknown type');
await rejects(() => setMode(mainMgr, id(99), 'kg_meal'), /Product is missing/, 'unknown product');
assert.equal(await modeOf(clear), 'piece_stock', 'nothing changed by the refused calls');
console.log('who and what: ok');

// ---------------------------------------------------------------- 2. guards: balances and in-flight stock
await db.exec(`insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${main}','${stocked}',5), ('${main}','${inflight}',4)`);
let before = await stockSnapshot();
await rejects(() => setMode(mainMgr, stocked, 'kg_meal'), /Clear every current balance, including Main Branch/, 'balance at Main');
assert.equal(await modeOf(stocked), 'piece_stock');
// stock that has gone out but is not yet received: Main is empty, the transfer is still open
await as(mainMgr, () => db.query(`select public.send_stock_transfer($1, $2::jsonb, null, 'kg-restrict-send-000001')`, [booth, JSON.stringify([{ product_id: inflight, quantity_sent: 4, destination_price: 80 }])]));
assert.equal(Number((await db.query(`select quantity_on_hand::numeric q from public.branch_inventory where branch_id=$1 and product_id=$2`, [main, inflight])).rows[0].q), 0);
await rejects(() => setMode(mainMgr, inflight, 'kg_meal'), /open transfers/, 'open transfer');
assert.equal(await modeOf(inflight), 'piece_stock');
// after the branch receives it, the balance is at the branch: still refused, everywhere counts
const transfer = (await db.query(`select id from public.stock_transfers where to_branch_id=$1 order by created_at desc limit 1`, [booth])).rows[0].id;
await as(cashier, () => db.query(`select public.confirm_shipment_arrival($1,'kg-restrict-arrive-0001')`, [transfer]));
await rejects(() => setMode(mainMgr, inflight, 'kg_meal'), /Clear every current balance/, 'balance at a selling branch');
assert.equal(await modeOf(inflight), 'piece_stock');
// stock that has left the branch on a return but is not yet received: every balance is zero, the return is still open
await as(cashier, () => db.query(`select public.create_stock_return($1::jsonb, null, 'kg-restrict-return-0001')`, [JSON.stringify([{ product_id: inflight, quantity_returned: 4 }])]));
const branchBalance = Number((await db.query(`select coalesce(sum(quantity_on_hand),0)::numeric q from public.branch_inventory where product_id=$1`, [inflight])).rows[0].q);
assert.equal(branchBalance, 0, 'all balances are clear while the return is in transit');
await rejects(() => setMode(mainMgr, inflight, 'kg_meal'), /open returns/, 'open return');
assert.equal(await modeOf(inflight), 'piece_stock');
console.log('balance, open transfer and open return guards: ok');

// ---------------------------------------------------------------- 3. what Phase 3 deliberately allows: a clear product, no conversion
{
  const snap = await stockSnapshot();
  const row = (await setMode(mainMgr, clear, 'kg_meal')).rows[0];
  assert.equal(row.inventory_mode, 'kg_meal');
  assert.equal(await modeOf(clear), 'kg_meal');
  assert.equal(await stockSnapshot(), snap, 'switching changes no stock and creates no conversion');
  assert.equal((await db.query(`select count(*)::int n from public.inventory_movements where product_id=$1`, [clear])).rows[0].n, 0, 'no movement is written');
  // idempotent when already in that mode
  assert.equal((await setMode(mainMgr, clear, 'kg_meal')).rows[0].inventory_mode, 'kg_meal');
  // and once it holds stock, it can not go back while the balance is not clear
  await db.exec(`insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${main}','${clear}',2.5)`);
  await rejects(() => setMode(mainMgr, clear, 'piece_stock'), /Clear every current balance/, 'back to piece stock with a balance');
  assert.equal(await modeOf(clear), 'kg_meal');
  await db.exec(`update public.branch_inventory set quantity_on_hand = 0 where product_id='${clear}'`);
  assert.equal((await setMode(mainMgr, clear, 'piece_stock')).rows[0].inventory_mode, 'piece_stock');
  console.log('clear product may switch, with no conversion: ok');
}

// ---------------------------------------------------------------- 4. the product wizard RPCs still refuse kg_meal
await rejects(
  () => as(mainMgr, () => db.query(`select * from public.create_complete_product(p_name := 'Kg Created', p_sku := 'KG-NEW', p_description := null, p_variants := '[]'::jsonb, p_branches := $1::jsonb, p_selling_price := '50.00', p_inventory_mode := 'kg_meal')`, [JSON.stringify([{ branch_id: booth, selling_price: '50.00' }])])),
  /retired|piece stock/i,
  'create_complete_product kg_meal',
);
assert.equal((await db.query(`select count(*)::int n from public.products where sku='KG-NEW'`)).rows[0].n, 0, 'nothing was created');
// Editing delegates to set_product_inventory_mode (Phase 3 contract), so the very same guards apply; the app never sends
// an inventory type on edit (NULL leaves it untouched).
await rejects(
  () => as(mainMgr, () => db.query(`select * from public.update_complete_product(p_product_id := $1, p_name := 'Stocked Meal', p_sku := 'KG-STOCK', p_description := null, p_is_active := true, p_variants := '[]'::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := $2::jsonb, p_selling_price := '80.00', p_inventory_mode := 'kg_meal')`, [stocked, JSON.stringify([{ branch_id: booth, selling_price: '80.00' }])])),
  /Clear every current balance/,
  'update_complete_product kg_meal on a stocked product',
);
assert.equal(await modeOf(stocked), 'piece_stock', 'a refused edit leaves the mode alone');
{
  const latestUpdate = files.filter((f) => /create (or replace )?function public\.update_complete_product\(/i.test(read(f))).pop();
  assert.match(read(latestUpdate), /if p_inventory_mode is not null then\s+perform public\.set_product_inventory_mode\(p_product_id, p_inventory_mode\);/, 'edit delegates to the guarded function');
  assert.doesNotMatch(readFileSync('src/services/productService.ts', 'utf8').slice(readFileSync('src/services/productService.ts', 'utf8').indexOf('update_complete_product')), /p_inventory_mode/, 'the app never sends an inventory type on edit');
}
console.log('wizard RPCs refuse kg_meal: ok');

// ---------------------------------------------------------------- 5. the UI never offers it on create/edit
{
  const src = (p) => readFileSync(p, 'utf8');
  for (const f of ['src/features/products/CreateProductWizard.tsx', 'src/features/products/EditProductWizard.tsx']) {
    assert.doesNotMatch(src(f), /kg_meal|InventoryModeField/, f);
  }
}

console.log('kg_meal_restriction: ALL PASS');
