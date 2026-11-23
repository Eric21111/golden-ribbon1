// Archive / restore / delete products and delete branches.
// PGlite is one session, so repeated calls prove idempotency and the RPCs' FOR UPDATE locks.
// A second live session is not opened here and production is never touched.
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
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, '');
  try {
    await db.exec(sql);
  } catch (error) {
    throw new Error(`${file}: ${error?.message ?? error}`);
  }
}

const id = (n) => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const manager = id(1);
const cashier = id(2);
const owner = id(3);
const main = id(10);
const booth = id(11);
const emptyBranch = id(12);
const staffedBranch = id(13);
const salesBranch = id(14);

await db.exec(`
  insert into auth.users(id, email) values
    ('${manager}','m@archive'), ('${cashier}','c@archive'), ('${owner}','o@archive');
  insert into public.branches(id, name, code, is_main_branch, is_active, receiving_mode) values
    ('${main}','Main','MAIN-AR', true, true, 'counted'),
    ('${booth}','Booth','BOOTH-AR', false, true, 'cashier_confirm'),
    ('${emptyBranch}','Empty Booth','EMPTY-AR', false, true, 'cashier_confirm'),
    ('${staffedBranch}','Staffed Booth','STAFF-AR', false, true, 'cashier_confirm'),
    ('${salesBranch}','Sales Booth','SALES-AR', false, true, 'cashier_confirm');
  insert into public.profiles(id, full_name, role, branch_id) values
    ('${manager}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${booth}'),
    ('${owner}','Owner','owner', null);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}', false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

async function rejects(work, pattern, label) {
  try {
    await work();
  } catch (error) {
    const text = String(error?.message ?? error);
    assert.match(text, pattern, `${label}: ${text}`);
    return text;
  }
  assert.fail(`${label} should have failed`);
}

const create = (name, sku) =>
  asUser(manager, () => db.query(`select * from public.create_inventory_product($1, $2, null, 'keep_at_branch')`, [name, sku])).then(
    (result) => result.rows[0],
  );

const archive = (productId, user = manager) =>
  asUser(user, () => db.query(`select * from public.archive_product($1)`, [productId])).then((result) => result.rows[0]);
const restore = (productId, user = manager) =>
  asUser(user, () => db.query(`select * from public.restore_product($1)`, [productId])).then((result) => result.rows[0]);

const row = async (productId) =>
  (await db.query(`select id, is_active, archived_at, sku from public.products where id = $1`, [productId])).rows[0];

const defs = await db.query(`
  select
    position('for update' in pg_get_functiondef('public.archive_product(uuid)'::regprocedure)) > 0 as archive_lock,
    position('for update' in pg_get_functiondef('public.restore_product(uuid)'::regprocedure)) > 0 as restore_lock,
    position('for update' in pg_get_functiondef('public.delete_archived_product(uuid)'::regprocedure)) > 0 as delete_product_lock,
    position('for update' in pg_get_functiondef('public.delete_branch(uuid)'::regprocedure)) > 0 as delete_branch_lock,
    position('p.archived_at is null' in pg_get_functiondef('public.pos_inventory_for_branch(uuid)'::regprocedure)) > 0 as pos_hides,
    position('p.archived_at is null' in pg_get_functiondef('public.list_return_inventory()'::regprocedure)) > 0 as returns_hide,
    position('p.archived_at is null' in pg_get_functiondef('public.list_cashier_day_stock()'::regprocedure)) > 0 as day_hides,
    position('pr.archived_at is null' in pg_get_functiondef('public.manager_branch_stock(uuid)'::regprocedure)) > 0 as manager_hides,
    position('for update' in pg_get_functiondef('public.reject_archived_product_operation()'::regprocedure)) > 0 as operation_lock
`);
assert.equal(defs.rows[0].archive_lock, true);
assert.equal(defs.rows[0].restore_lock, true);
assert.equal(defs.rows[0].delete_product_lock, true);
assert.equal(defs.rows[0].delete_branch_lock, true);
assert.equal(defs.rows[0].pos_hides, true);
assert.equal(defs.rows[0].returns_hide, true);
assert.equal(defs.rows[0].day_hides, true);
assert.equal(defs.rows[0].manager_hides, true);
assert.equal(defs.rows[0].operation_lock, true);

const looseDeletes = await db.query(`
  select parent.relname as parent_table, child.relname as child_table, a.attname as column_name, con.confdeltype
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace n on n.oid = child.relnamespace
  join pg_class parent on parent.oid = con.confrelid
  join lateral unnest(con.conkey) as src(att) on true
  join pg_attribute a on a.attrelid = child.oid and a.attnum = src.att
  where con.contype = 'f'
    and n.nspname = 'public'
    and parent.relname in ('products', 'branches')
    and con.confdeltype in ('c', 'n')
`);
const catalogCascade = new Set([
  'products:product_variants:product_id',
  'products:branch_products:product_id',
  'products:product_stock_uses:product_id',
  'products:product_drink_choices:product_id',
]);
for (const fk of looseDeletes.rows) {
  const key = `${fk.parent_table}:${fk.child_table}:${fk.column_name}`;
  assert.equal(fk.confdeltype, 'c', key);
  assert.ok(catalogCascade.has(key), `unexpected cascade or set-null delete: ${key}`);
}
const historyDeletes = await db.query(`
  select child.relname as child_table, con.confdeltype
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace n on n.oid = child.relnamespace
  join pg_class parent on parent.oid = con.confrelid
  where con.contype = 'f'
    and n.nspname = 'public'
    and parent.relname in ('products', 'branches')
    and child.relname in (
      'sales', 'sale_items', 'inventory_movements', 'shifts', 'shift_reconciliations',
      'audit_logs', 'notifications', 'stock_transfers', 'stock_returns'
    )
`);
assert.ok(historyDeletes.rows.length > 0, 'history foreign keys are still present');
for (const fk of historyDeletes.rows) {
  assert.notEqual(fk.confdeltype, 'c', `${fk.child_table} must not cascade`);
  assert.notEqual(fk.confdeltype, 'n', `${fk.child_table} must not null its history`);
}

const disabled = await create('Plain Rice', 'RICE-AR');
assert.equal(disabled.is_active, false);
const archivedDisabled = await archive(disabled.id);
assert.equal(archivedDisabled.id, disabled.id);
assert.equal(archivedDisabled.is_active, false, 'archive keeps the disabled status');
assert.ok(archivedDisabled.archived_at);
const archivedAgain = await archive(disabled.id);
assert.equal(archivedAgain.id, disabled.id);
assert.equal(archivedAgain.is_active, false, 'a repeated archive does not create a copy or change status');
assert.equal((await db.query(`select count(*)::int n from public.products where sku = 'RICE-AR'`)).rows[0].n, 1);

const restoredDisabled = await restore(disabled.id);
assert.equal(restoredDisabled.id, disabled.id);
assert.equal(restoredDisabled.is_active, false, 'restore puts back Disabled');
assert.equal(restoredDisabled.archived_at, null);
const restoredAgain = await restore(disabled.id);
assert.equal(restoredAgain.archived_at, null, 'a repeated restore stays on the same product');

const snack = await create('Plain Snack', 'SNACK-AR');
const enabled = await asUser(manager, () => db.query(`select * from public.set_product_status($1, true)`, [snack.id])).then(
  (result) => result.rows[0],
);
assert.equal(enabled.is_active, true);
const archivedEnabled = await archive(enabled.id);
assert.equal(archivedEnabled.is_active, true, 'archive keeps Enabled');
assert.equal((await restore(enabled.id)).is_active, true, 'restore puts back Enabled');

const live = await create('Still Listed', 'LIVE-AR');
await asUser(manager, () => db.query(`select public.set_product_status($1, true)`, [live.id]));
assert.equal((await row(live.id)).is_active, true, 'existing status changes still work');

await db.exec(`
  update public.products
  set is_active = true, sell_in_pos = true, selling_price = 25
  where id = '${disabled.id}';
  insert into public.branch_products(branch_id, product_id, selling_price, is_active)
  values ('${booth}', '${disabled.id}', 25, true);
`);
const beforeArchivePos = await db.query(
  `select count(*)::int n from public.pos_inventory_for_branch($1) where product_id = $2`,
  [booth, disabled.id],
);
assert.equal(beforeArchivePos.rows[0].n, 1, 'the product is on the cashier POS before archive');
const hidden = await archive(disabled.id);
assert.equal(hidden.is_active, true, 'archive still keeps Enabled after it was turned on');
assert.equal(
  (await db.query(`select count(*)::int n from public.products where id = $1 and archived_at is null`, [hidden.id])).rows[0].n,
  0,
  'archived products are outside the normal list filter',
);
const cashierSees = await asUser(cashier, () =>
  db.query(`select count(*)::int n from public.products where id = $1`, [hidden.id]),
);
assert.equal(cashierSees.rows[0].n, 0, 'cashiers cannot read an archived product');
const managerSees = await asUser(manager, () =>
  db.query(`select count(*)::int n from public.products where id = $1`, [hidden.id]),
);
assert.equal(managerSees.rows[0].n, 1, 'the Main Branch Manager can open Archived Products');

const beforePos = await db.query(`select count(*)::int n from public.pos_inventory_for_branch($1) where product_id = $2`, [
  booth,
  hidden.id,
]);
assert.equal(beforePos.rows[0].n, 0, 'an archived product stays off the cashier POS even if it is enabled and priced');
await restore(hidden.id);
const afterPos = await db.query(`select count(*)::int n from public.pos_inventory_for_branch($1) where product_id = $2`, [
  booth,
  hidden.id,
]);
assert.equal(afterPos.rows[0].n, 1, 'restore returns the same product to the cashier POS');
await archive(hidden.id);

const rice = await create('Recipe Rice', 'RRICE-AR');
const mealDraft = await create('Recipe Meal', 'RMEAL-AR');
const meal = await asUser(manager, () =>
  db.query(`select * from public.set_product_status($1, true)`, [mealDraft.id]),
).then((result) => result.rows[0]);
await db.exec(`
  insert into public.product_stock_uses(product_id, variant_id, ingredient_product_id, quantity)
  values ('${meal.id}', null, '${rice.id}', 1);
`);
await rejects(() => archive(rice.id), /Cannot archive this product while other products still use it in a recipe: Recipe Meal/i, 'recipe blocks archive');
assert.equal((await row(rice.id)).archived_at, null);
assert.equal((await row(meal.id)).archived_at, null);
await archive(meal.id);
await archive(rice.id);
await rejects(
  () => restore(meal.id),
  /Cannot restore this product until archived items it uses are restored: Recipe Rice/i,
  'enabled restore waits for archived ingredients',
);
assert.ok((await row(meal.id)).archived_at, 'blocked restore leaves the product archived');
await restore(rice.id);
const mealBack = await restore(meal.id);
assert.equal(mealBack.id, meal.id);
assert.equal(mealBack.is_active, true);
assert.equal(mealBack.archived_at, null);

const spice = await create('Spice', 'SPICE-AR');
const base = await create('Base Mix', 'BASE-AR');
assert.equal(base.is_active, false);
await db.exec(`
  insert into public.product_stock_uses(product_id, variant_id, ingredient_product_id, quantity)
  values ('${base.id}', null, '${spice.id}', 1);
`);
await archive(base.id);
await archive(spice.id);
const baseBack = await restore(base.id);
assert.equal(baseBack.is_active, false, 'a disabled product is restored without becoming sellable');
assert.equal(baseBack.archived_at, null);

const transferProduct = await create('Transfer Item', 'XFER-AR');
const transferId = id(40);
await db.exec(`
  insert into public.stock_transfers(id, transfer_number, from_branch_id, to_branch_id, status, created_by)
  values ('${transferId}', 'AR-XFER-1', '${main}', '${booth}', 'draft', '${manager}');
  insert into public.stock_transfer_items(stock_transfer_id, product_id, quantity_sent)
  values ('${transferId}', '${transferProduct.id}', 1);
`);
await rejects(
  () => archive(transferProduct.id),
  /Cannot archive this product while a transfer, return, held return, or discrepancy is still open/i,
  'open transfer blocks archive',
);
await db.exec(`update public.stock_transfers set status = 'cancelled' where id = '${transferId}'`);
assert.ok((await archive(transferProduct.id)).archived_at);

const history = await create('Sold Item', 'SOLD-AR');
const movementId = id(41);
await db.exec(`
  insert into public.inventory_movements(id, branch_id, product_id, movement_type, quantity, reference_type, created_by)
  values ('${movementId}', '${main}', '${history.id}', 'opening_stock', 2, 'opening_stock', '${manager}');
`);
await archive(history.id);
await rejects(
  () => asUser(manager, () => db.query(`select public.delete_archived_product($1)`, [history.id])),
  /Cannot delete this product because records must be kept \(inventory movements\)/i,
  'history blocks product delete',
);
assert.equal((await db.query(`select count(*)::int n from public.inventory_movements where id = $1`, [movementId])).rows[0].n, 1);
assert.ok((await row(history.id)).archived_at, 'the product is still archived after a refused delete');

await rejects(
  () =>
    db.exec(`
      insert into public.inventory_movements(branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by)
      values ('${booth}', '${history.id}', 'sale', -1, 'sale', '${id(42)}', '${cashier}');
    `),
  /Archived products cannot be used for new stock operations/i,
  'archived product cannot be sold',
);

const unused = await create('Unused Item', 'UNUSED-AR');
await archive(unused.id);
await asUser(manager, () => db.query(`select public.delete_archived_product($1)`, [unused.id]));
assert.equal((await db.query(`select count(*)::int n from public.products where id = $1`, [unused.id])).rows[0].n, 0);
await rejects(
  () => asUser(manager, () => db.query(`select public.delete_archived_product($1)`, [unused.id])),
  /This product was already deleted/i,
  'repeated delete',
);
await rejects(
  () => asUser(manager, () => db.query(`select public.delete_archived_product($1)`, [live.id])),
  /Only archived products can be deleted/i,
  'live products cannot be deleted from the archive action',
);

await rejects(() => archive(live.id, cashier), /Unauthorized: Main Branch Manager access is required/i, 'cashier cannot archive');
await rejects(() => archive(live.id, owner), /Unauthorized: Main Branch Manager access is required/i, 'owner cannot archive');
await rejects(
  () => db.exec(`update public.products set name = 'Renamed Hidden' where id = '${hidden.id}'`),
  /Archived products cannot be changed/i,
  'archived products cannot be edited in place',
);

await rejects(
  () => asUser(owner, () => db.query(`select public.delete_branch($1)`, [main])),
  /The Main Branch cannot be deleted/i,
  'main branch',
);
assert.equal((await db.query(`select count(*)::int n from public.branches where id = $1`, [main])).rows[0].n, 1);

await db.exec(`
  insert into auth.users(id, email) values ('${id(4)}', 'staff@archive');
  insert into public.profiles(id, full_name, role, branch_id)
  values ('${id(4)}', 'Booth Cashier', 'cashier', '${staffedBranch}');
`);
await rejects(
  () => asUser(owner, () => db.query(`select public.delete_branch($1)`, [staffedBranch])),
  /Cannot delete this branch because records must be kept \(assigned employees\)/i,
  'employees block branch delete',
);
assert.equal((await db.query(`select count(*)::int n from public.profiles where branch_id = $1`, [staffedBranch])).rows[0].n, 1);

const shiftId = id(50);
const saleId = id(51);
const salesCashier = id(5);
await db.exec(`
  insert into auth.users(id, email) values ('${salesCashier}', 'sales@archive');
  insert into public.profiles(id, full_name, role, branch_id)
  values ('${salesCashier}', 'Sales Cashier', 'cashier', '${salesBranch}');
  insert into public.shifts(id, branch_id, cashier_id, status, ended_at)
  values ('${shiftId}', '${salesBranch}', '${salesCashier}', 'closed', now());
  insert into public.sales(
    id, sale_number, branch_id, shift_id, cashier_id, subtotal, total_amount, amount_paid, change_amount,
    status, idempotency_key, request_items
  ) values (
    '${saleId}', 'AR-SALE-1', '${salesBranch}', '${shiftId}', '${salesCashier}', 10, 10, 10, 0,
    'completed', 'archive-branch-sale-key', '[]'
  );
`);
await rejects(
  () => asUser(owner, () => db.query(`select public.delete_branch($1)`, [salesBranch])),
  /Cannot delete this branch because records must be kept \(assigned employees, shifts, sales\)/i,
  'sales block branch delete',
);
assert.equal((await db.query(`select count(*)::int n from public.sales where id = $1`, [saleId])).rows[0].n, 1);

await rejects(
  () => asUser(manager, () => db.query(`select public.delete_branch($1)`, [emptyBranch])),
  /Unauthorized: Owner access is required/i,
  'manager cannot delete a branch',
);
await asUser(owner, () => db.query(`select public.delete_branch($1)`, [emptyBranch]));
assert.equal((await db.query(`select count(*)::int n from public.branches where id = $1`, [emptyBranch])).rows[0].n, 0);
await rejects(
  () => asUser(owner, () => db.query(`select public.delete_branch($1)`, [emptyBranch])),
  /This branch was already deleted/i,
  'repeated branch delete',
);

const renamed = await asUser(owner, () =>
  db.query(`update public.branches set name = 'Booth Renamed' where id = $1 returning name`, [booth]),
);
assert.equal(renamed.rows[0].name, 'Booth Renamed', 'existing branch edits still save');

const stocked = await create('Stocked Rice', 'STOCK-AR');
const localDrink = await create('Local Drink', 'DRINK-AR');
await db.exec(`
  update public.products
  set is_active = true, sell_in_pos = true, selling_price = 20
  where id = '${stocked.id}';
  update public.products
  set is_active = true, is_non_returnable = true
  where id = '${localDrink.id}';
  insert into public.branch_products(branch_id, product_id, selling_price, is_active)
  values ('${booth}', '${stocked.id}', 20, true);
  insert into public.branch_inventory(branch_id, product_id, quantity_on_hand, quantity_awaiting_return)
  values
    ('${booth}', '${stocked.id}', 2, 0),
    ('${main}', '${stocked.id}', 3, 1),
    ('${booth}', '${localDrink.id}', 0, 0);
`);
const stockMovesBefore = (await db.query(`select count(*)::int n from public.inventory_movements where product_id = $1`, [stocked.id])).rows[0].n;
await rejects(
  () => archive(stocked.id),
  /Cannot archive this product while stock remains\. Resolve Booth Renamed: 2 on hand; Main: 3 on hand, 1 awaiting return/,
  'positive stock and held returns block archive',
);
assert.equal((await db.query(`select quantity_on_hand::text on_hand, quantity_awaiting_return::text held from public.branch_inventory where product_id = $1 and branch_id = $2`, [stocked.id, booth])).rows[0].on_hand, '2.000');
assert.equal((await db.query(`select quantity_on_hand::text on_hand, quantity_awaiting_return::text held from public.branch_inventory where product_id = $1 and branch_id = $2`, [stocked.id, main])).rows[0].on_hand, '3.000');
assert.equal((await db.query(`select quantity_awaiting_return::text held from public.branch_inventory where product_id = $1 and branch_id = $2`, [stocked.id, main])).rows[0].held, '1.000');
assert.equal((await db.query(`select count(*)::int n from public.inventory_movements where product_id = $1`, [stocked.id])).rows[0].n, stockMovesBefore);
assert.equal((await row(stocked.id)).archived_at, null);

await db.exec(`
  update public.branch_inventory
  set quantity_on_hand = 0, quantity_awaiting_return = 0
  where product_id = '${stocked.id}';
`);
assert.ok((await archive(stocked.id)).archived_at, 'archive is allowed only after the balances are resolved');
await archive(localDrink.id);
await db.exec(`
  update public.branch_inventory
  set quantity_on_hand = 2
  where product_id = '${stocked.id}' and branch_id in ('${booth}', '${main}');
`);

const dayStock = async () =>
  (await asUser(cashier, () => db.query(`select product_id from public.list_cashier_day_stock()`))).rows;
assert.equal((await dayStock()).some((item) => item.product_id === stocked.id), false, 'day stock hides archived products');
assert.equal(
  (await asUser(cashier, () => db.query(`select product_id from public.list_return_inventory()`))).rows.some((item) => item.product_id === stocked.id),
  false,
);
assert.equal(
  (await asUser(manager, () => db.query(`select product_id from public.manager_branch_stock($1)`, [booth]))).rows.some((item) => item.product_id === stocked.id),
  false,
);
assert.equal(
  (await asUser(cashier, () => db.query(`select product_id from public.list_cashier_local_purchase_catalog()`))).rows.some((item) => item.product_id === localDrink.id),
  false,
);

const salesBefore = (await db.query(`select count(*)::int n from public.sales`)).rows[0].n;
const movesBefore = (await db.query(`select count(*)::int n from public.inventory_movements`)).rows[0].n;
const openShift = (await asUser(cashier, () => db.query(`select public.start_cashier_shift() as id`))).rows[0].id;
await rejects(
  () => asUser(cashier, () => db.query(
    `select public.confirm_sale($1, $2::jsonb, 20, 'archive-sale-key-0001', 'standard', 'cash')`,
    [openShift, JSON.stringify([{ product_id: stocked.id, quantity: 1 }])],
  )),
  /Archived products cannot be sold/i,
  'old confirm_sale calls cannot sell an archived product',
);
await rejects(
  () => asUser(manager, () => db.query(
    `select public.send_stock_transfer($1, $2::jsonb, null, 'archive-transfer-key01')`,
    [booth, JSON.stringify([{ product_id: stocked.id, quantity_sent: '1' }])],
  )),
  /Archived products cannot be added to a transfer|Archived products cannot be used for new stock operations/i,
  'direct transfer RPC cannot move an archived product',
);
await rejects(
  () => asUser(cashier, () => db.query(
    `select public.create_stock_return($1::jsonb, null, 'archive-return-key001')`,
    [JSON.stringify([{ product_id: stocked.id, quantity_returned: 1 }])],
  )),
  /Archived products cannot be added to a return|Archived products cannot be used for new stock operations/i,
  'direct return RPC cannot return an archived product',
);
await rejects(
  () => asUser(manager, () => db.query(
    `select public.initialize_main_branch_inventory($1::jsonb, null)`,
    [JSON.stringify([{ product_id: stocked.id, quantity: '1' }])],
  )),
  /Archived products cannot/i,
  'opening stock RPC cannot restock an archived product',
);
await rejects(
  () => asUser(cashier, () => db.query(
    `select public.record_branch_local_purchase($1::jsonb, null, 'archive-local-key0001')`,
    [JSON.stringify([{ product_id: localDrink.id, quantity: '1' }])],
  )),
  /Archived products cannot/i,
  'local purchase RPC cannot restock an archived product',
);
assert.equal((await db.query(`select count(*)::int n from public.sales`)).rows[0].n, salesBefore);
assert.equal((await db.query(`select count(*)::int n from public.inventory_movements`)).rows[0].n, movesBefore);
assert.equal((await db.query(`select quantity_on_hand::text q from public.branch_inventory where product_id = $1 and branch_id = $2`, [stocked.id, booth])).rows[0].q, '2.000');

const voidable = await create('Voidable Snack', 'VOID-AR');
await db.exec(`
  update public.products
  set is_active = true, sell_in_pos = true, selling_price = 15
  where id = '${voidable.id}';
  insert into public.branch_products(branch_id, product_id, selling_price, is_active)
  values ('${booth}', '${voidable.id}', 15, true)
  on conflict do nothing;
  insert into public.branch_inventory(branch_id, product_id, quantity_on_hand, quantity_awaiting_return)
  values ('${booth}', '${voidable.id}', 1, 0)
  on conflict (branch_id, product_id) do update
  set quantity_on_hand = 1, quantity_awaiting_return = 0;
`);
const sold = await asUser(cashier, () =>
  db.query(`select * from public.confirm_sale($1, $2::jsonb, 15, 'archive-void-sale-0001', 'standard', 'cash')`, [
    openShift,
    JSON.stringify([{ product_id: voidable.id, quantity: 1 }]),
  ]),
).then((result) => result.rows[0]);
assert.equal((await db.query(`select quantity_on_hand::text q from public.branch_inventory where product_id = $1 and branch_id = $2`, [voidable.id, booth])).rows[0].q, '0.000');
assert.ok((await archive(voidable.id)).archived_at, 'sold-out product can be archived');
const saleItem = (
  await db.query(`select id, quantity from public.sale_items where sale_id = $1 and product_id = $2`, [sold.id, voidable.id])
).rows[0];
const salesAfterVoidAttempt = (await db.query(`select count(*)::int n, sum(case when status = 'completed' then 1 else 0 end)::int completed from public.sales where id = $1`, [sold.id])).rows[0];
await rejects(
  () => asUser(cashier, () => db.query(
    `select public.void_cashier_sale_item($1, 1, $2, 'Wrong item', null)`,
    [saleItem.id, saleItem.quantity],
  )),
  /Restore this product before voiding a sale that returns its stock|Archived products cannot be used for new stock operations/i,
  'void cannot restore stock onto an archived product',
);
assert.equal((await db.query(`select quantity_on_hand::text q from public.branch_inventory where product_id = $1 and branch_id = $2`, [voidable.id, booth])).rows[0].q, '0.000');
assert.equal((await db.query(`select status from public.sales where id = $1`, [sold.id])).rows[0].status, 'completed');
assert.equal((await db.query(`select quantity from public.sale_items where id = $1`, [saleItem.id])).rows[0].quantity, saleItem.quantity);
assert.equal(salesAfterVoidAttempt.completed, 1);
assert.equal((await dayStock()).some((item) => item.product_id === voidable.id), false, 'failed void leaves no hidden archived stock');

await rejects(
  () => db.query(`delete from public.products where id = $1`, [history.id]),
  /records must be kept|violates/i,
  'a direct delete cannot remove a product that has history',
);
assert.equal((await db.query(`select count(*)::int n from public.inventory_movements where id = $1`, [movementId])).rows[0].n, 1);

const archiveLockOrder = await db.query(`
  select pg_get_functiondef('public.archive_product(uuid)'::regprocedure) as def
`);
assert.match(archiveLockOrder.rows[0].def, /branch_inventory[\s\S]*order by branch_id[\s\S]*for update[\s\S]*from public\.products[\s\S]*for update/i);
assert.match(
  (await db.query(`select pg_get_functiondef('public.reject_archived_product_operation()'::regprocedure) as def`)).rows[0].def,
  /new\.quantity > 0/,
);

console.log('Archive products and delete branches passed.');
