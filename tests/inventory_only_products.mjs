// Stock-only meal components: no selling price, hidden from POS, shared by meals and add-ons.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

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
for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const manager = id(1);
const cashier = id(2);
const main = id(10);
const booth = id(11);

await db.exec(`
  insert into auth.users values ('${manager}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN-IO',true,true,'counted'),
    ('${booth}','Booth','BOOTH-IO',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${manager}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${booth}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${id(20)}','Existing Meal','EXIST-IO',75,true);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const J = (value) => JSON.stringify(value);
const rejects = async (work, pattern) => {
  await assert.rejects(work, pattern);
};

const existing = (await db.query(`select selling_price::text price, sell_in_pos from public.products where sku='EXIST-IO'`)).rows[0];
assert.equal(existing.price, '75.00');
assert.equal(existing.sell_in_pos, true);

const rice = await asUser(manager, () =>
  db.query(`select * from public.create_inventory_product('Rice','RICE-IO',null,'keep_at_branch')`),
).then((result) => result.rows[0]);
const egg = await asUser(manager, () =>
  db.query(`select * from public.create_inventory_product('Egg','EGG-IO',null,'keep_at_branch')`),
).then((result) => result.rows[0]);
const bihon = await asUser(manager, () =>
  db.query(`select * from public.create_inventory_product('Bihon','BIHON-IO',null,'keep_at_branch')`),
).then((result) => result.rows[0]);

for (const row of [rice, egg, bihon]) {
  assert.equal(row.sell_in_pos, false);
  assert.equal(row.selling_price, null);
  assert.equal(row.is_active, false);
}

const managerCanSee = await asUser(manager, () =>
  db.query(`select sku from public.products where sku in ('RICE-IO','EGG-IO','BIHON-IO') order by sku`),
).then((result) => result.rows.map((row) => row.sku));
assert.deepEqual(managerCanSee, ['BIHON-IO', 'EGG-IO', 'RICE-IO'], 'inactive stock-only products stay on the manager product list');
const cashierBeforeStock = await asUser(cashier, () =>
  db.query(`select sku from public.products where sku = 'RICE-IO'`),
).then((result) => result.rows);
assert.equal(cashierBeforeStock.length, 0, 'cashiers do not see a component before it is active');
await rejects(
  () => asUser(manager, () => db.query(`select public.create_inventory_product('Rice 2','RICE-IO',null)`)),
  /sku|duplicate|unique/i,
);

const branchPrice = J([{ branch_id: booth, selling_price: '80.00' }]);
const extraPrice = J([{ branch_id: booth, selling_price: '20.00' }]);
const uses = (...lines) => J(lines.map(([ingredient, quantity]) => ({ ingredient_product_id: ingredient, quantity })));

const silog = await asUser(manager, () =>
  db.query(
    `select * from public.create_complete_product(p_name := 'Silog', p_sku := 'SILOG-IO', p_description := null, p_variants := '[]'::jsonb, p_branches := $1::jsonb, p_selling_price := '80.00', p_stock_uses := $2::jsonb)`,
    [branchPrice, uses([rice.id, 1], [egg.id, 1])],
  ),
).then((result) => result.rows[0]);
const pancit = await asUser(manager, () =>
  db.query(
    `select * from public.create_complete_product(p_name := 'Pancit', p_sku := 'PANCIT-IO', p_description := null, p_variants := '[]'::jsonb, p_branches := $1::jsonb, p_selling_price := '70.00', p_stock_uses := $2::jsonb)`,
    [J([{ branch_id: booth, selling_price: '70.00' }]), uses([bihon.id, 1])],
  ),
).then((result) => result.rows[0]);
const extraRice = await asUser(manager, () =>
  db.query(
    `select * from public.create_complete_product(p_name := 'Extra Rice', p_sku := 'XRICE-IO', p_description := null, p_variants := '[]'::jsonb, p_branches := $1::jsonb, p_selling_price := '20.00', p_stock_uses := $2::jsonb)`,
    [extraPrice, uses([rice.id, 1])],
  ),
).then((result) => result.rows[0]);
assert.equal(silog.sell_in_pos, true);
assert.equal(Number(silog.selling_price), 80);

await asUser(manager, () =>
  db.query(`select public.initialize_main_branch_inventory($1::jsonb, 'opening')`, [
    J([
      { product_id: rice.id, quantity: '10' },
      { product_id: egg.id, quantity: '10' },
      { product_id: bihon.id, quantity: '8' },
      { product_id: silog.id, quantity: '1' },
      { product_id: pancit.id, quantity: '1' },
      { product_id: extraRice.id, quantity: '1' },
    ]),
  ]),
);

const opened = (await db.query(`select sku, is_active, selling_price::text price, sell_in_pos from public.products where sku in ('RICE-IO','EGG-IO','BIHON-IO') order by sku`)).rows;
assert.deepEqual(
  opened.map((row) => [row.sku, row.is_active, row.price, row.sell_in_pos]),
  [
    ['BIHON-IO', false, null, false],
    ['EGG-IO', false, null, false],
    ['RICE-IO', false, null, false],
  ],
  'opening stock does not change Product Status or invent a price',
);
for (const productId of [rice.id, egg.id, bihon.id, silog.id, pancit.id, extraRice.id]) {
  await asUser(manager, () => db.query(`select public.set_product_status($1, true)`, [productId]));
}
const enabledRice = (await db.query(`select selling_price::text price, sell_in_pos, is_active from public.products where id=$1`, [rice.id])).rows[0];
assert.equal(enabledRice.is_active, true);
assert.equal(enabledRice.price, null);
assert.equal(enabledRice.sell_in_pos, false);

const transferId = await asUser(manager, () =>
  db.query(`select public.send_stock_transfer($1, $2::jsonb, 'components', 'inventory-only-transfer-01') id`, [
    booth,
    J([
      { product_id: rice.id, quantity_sent: '6' },
      { product_id: egg.id, quantity_sent: '6' },
      { product_id: bihon.id, quantity_sent: '4' },
    ]),
  ]),
).then((result) => result.rows[0].id);
await asUser(cashier, () => db.query(`select public.confirm_shipment_arrival($1, 'inventory-only-arrival-01')`, [transferId]));

const catalog = (await db.query(`select count(*)::int n from public.branch_products where product_id = any($1::uuid[])`, [[rice.id, egg.id, bihon.id]])).rows[0].n;
assert.equal(Number(catalog), 0, 'transfers do not invent a POS price');
const riceMain = Number((await db.query(`select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2`, [main, rice.id])).rows[0].quantity_on_hand);
const riceBooth = Number((await db.query(`select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2`, [booth, rice.id])).rows[0].quantity_on_hand);
assert.equal(riceMain, 4);
assert.equal(riceBooth, 6);

const shiftId = await asUser(cashier, () => db.query(`select public.start_cashier_shift() id`)).then((result) => result.rows[0].id);
const posNames = await asUser(cashier, () => db.query(`select product_name from public.list_cashier_pos_inventory() order by product_name`)).then((result) => result.rows.map((row) => row.product_name));
assert.deepEqual(posNames, ['Extra Rice', 'Pancit', 'Silog']);

await rejects(
  () => asUser(cashier, () =>
    db.query(`select public.confirm_sale($1, $2::jsonb, 100, 'inventory-only-direct-sale', 'standard')`, [
      shiftId,
      J([{ product_id: rice.id, quantity: 1 }]),
    ]),
  ),
  /not available in this branch catalog|not sold in POS/i,
);

const beforeMoves = Number((await db.query(`select count(*)::int n from public.inventory_movements where movement_type='sale'`)).rows[0].n);
const sale = await asUser(cashier, () =>
  db.query(`select (public.confirm_sale($1, $2::jsonb, 500, 'inventory-only-shared-sale1', 'standard')).*`, [
    shiftId,
    J([
      { product_id: silog.id, quantity: 2 },
      { product_id: extraRice.id, quantity: 1 },
      { product_id: pancit.id, quantity: 1 },
    ]),
  ]),
).then((result) => result.rows[0]);
assert.equal(Number(sale.total_amount), 250);

const stock = async (productId) =>
  Number((await db.query(`select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2`, [booth, productId])).rows[0].quantity_on_hand);
assert.equal(await stock(rice.id), 3, 'two silog and one extra rice share Rice once');
assert.equal(await stock(egg.id), 4, 'two silog use two eggs');
assert.equal(await stock(bihon.id), 3);

const saleMoves = (await db.query(
  `select p.sku, m.quantity::int q from public.inventory_movements m join public.products p on p.id=m.product_id where m.reference_id=$1 and m.movement_type='sale' order by p.sku`,
  [sale.id],
)).rows;
assert.deepEqual(saleMoves, [
  { sku: 'BIHON-IO', q: -1 },
  { sku: 'EGG-IO', q: -2 },
  { sku: 'RICE-IO', q: -3 },
]);
assert.equal(saleMoves.length, Number((await db.query(`select count(*)::int n from public.inventory_movements where movement_type='sale'`)).rows[0].n) - beforeMoves);

const riceBeforeReject = await stock(rice.id);
await rejects(
  () => asUser(cashier, () =>
    db.query(`select public.confirm_sale($1, $2::jsonb, 500, 'inventory-only-short-sale1', 'standard')`, [
      shiftId,
      J([{ product_id: silog.id, quantity: 100 }]),
    ]),
  ),
  /insufficient stock/i,
);
assert.equal(await stock(rice.id), riceBeforeReject);

const renamed = await asUser(manager, () =>
  db.query(`select * from public.update_inventory_product($1,'Steamed Rice','RICE-IO',null,true,'keep_at_branch')`, [rice.id]),
).then((result) => result.rows[0]);
assert.equal(renamed.name, 'Steamed Rice');
assert.equal(renamed.selling_price, null);
assert.equal(renamed.sell_in_pos, false);
assert.equal(await stock(rice.id), riceBeforeReject);

await rejects(
  () => asUser(manager, () => db.query(`select public.set_product_sell_in_pos($1, true)`, [rice.id])),
  /selling price/i,
);

const hidden = await asUser(manager, () =>
  db.query(`select * from public.set_product_sell_in_pos($1, false)`, [extraRice.id]),
).then((result) => result.rows[0]);
assert.equal(Number(hidden.selling_price), 20);
assert.equal(hidden.sell_in_pos, false);
const extraBefore = await stock(rice.id);
await rejects(
  () => asUser(cashier, () =>
    db.query(`select public.confirm_sale($1, $2::jsonb, 100, 'inventory-only-hidden-addon', 'standard')`, [
      shiftId,
      J([{ product_id: extraRice.id, quantity: 1 }]),
    ]),
  ),
  /not sold in POS/i,
);
assert.equal(await stock(rice.id), extraBefore);
const posAfterHide = await asUser(cashier, () => db.query(`select product_name from public.list_cashier_pos_inventory()`)).then((result) => result.rows.map((row) => row.product_name));
assert.equal(posAfterHide.includes('Extra Rice'), false);
assert.equal(posAfterHide.includes('Silog'), true);

const restored = await asUser(manager, () =>
  db.query(`select * from public.set_product_sell_in_pos($1, true)`, [extraRice.id]),
).then((result) => result.rows[0]);
assert.equal(restored.sell_in_pos, true);
assert.equal(Number(restored.selling_price), 20);

const history = (await db.query(`select selling_price::text price, sell_in_pos from public.products where sku='EXIST-IO'`)).rows[0];
assert.equal(history.price, '75.00');
assert.equal(history.sell_in_pos, true);

console.log('inventory_only_products: PASS');
