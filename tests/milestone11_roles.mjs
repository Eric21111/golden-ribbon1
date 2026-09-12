import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

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
for (const file of readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace('create extension if not exists pgcrypto;', ''));
}

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const mgr1 = id(3);
const mgr2 = id(4);
const cashier1 = id(5);
const cashier2 = id(6);
const createdMainMgr = id(7);
const createdSellMgr = id(8);
const createdCashier = id(9);
const main = id(10);
const branch1 = id(11);
const branch2 = id(12);
const chicken = id(20);
const extra = id(21);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','mainmgr@test'),
    ('${mgr1}','mgr1@test'),('${mgr2}','mgr2@test'),
    ('${cashier1}','c1@test'),('${cashier2}','c2@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN',true,true),
    ('${branch1}','Branch 1','BR-01',false,true),
    ('${branch2}','Branch 2','BR-02',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${mgr1}','Selling Manager 1','manager','${branch1}'),
    ('${mgr2}','Selling Manager 2','manager','${branch2}'),
    ('${cashier1}','Cashier 1','cashier','${branch1}'),
    ('${cashier2}','Cashier 2','cashier','${branch2}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${chicken}','Chicken Butter','CB',80,true),
    ('${extra}','Spare Ribs','SR',50,true);
`);

const asUser = async (userId, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

assert.equal((await db.query(`select to_regclass('public.audit_logs') as rel`)).rows[0].rel, null);
assert.equal((await db.query(`
  select count(*)::int as n
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('write_audit_log','list_audit_logs','get_audit_log_detail','list_shift_summaries')
`)).rows[0].n, 0);

const employeeAdminSource = readFileSync('supabase/functions/employee-admin/index.ts', 'utf8');
assert.match(employeeAdminSource, /\.eq\('role', 'owner'\)/);
assert.match(employeeAdminSource, /Owner access is required/);
assert.doesNotMatch(employeeAdminSource, /\.eq\('role', 'manager'\)/);

await asUser(owner, async () => {
  assert.equal((await db.query('select public.can_change_own_email() flag')).rows[0].flag, true);
  await db.query('select public.assert_can_change_own_email()');
  const employees = (await db.query('select * from public.list_employees()')).rows;
  assert.ok(employees.some((row) => row.id === mgr1));
  assert.ok(employees.some((row) => row.id === mainMgr));
  assert.ok(!employees.some((row) => row.id === owner), 'Owner account is excluded from employee administration');
  await assert.rejects(
    db.query(`select public.owner_update_employee('${owner}','Owner','owner','${main}',true)`),
    /Manager or Cashier|Employee account was not found|Owner/,
  );
  await assert.rejects(
    db.query(`select public.owner_update_employee('${mainMgr}','Main Manager','owner','${main}',true)`),
    /Manager or Cashier/,
  );
  await assert.rejects(
    db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":200}]'::jsonb, null)`),
    /Main Branch Manager/,
  );
  await assert.rejects(
    db.query(`select public.send_stock_transfer('${branch1}','[{"product_id":"${chicken}","quantity_sent":10}]'::jsonb,null,'owner-send-denied-key01')`),
    /Main Branch Manager/,
  );
  await assert.rejects(
    db.exec(`insert into public.products(name,sku,selling_price) values ('Owner Product','OWN',1)`),
    /permission denied|new row/,
  );
});

await asUser(mainMgr, async () => {
  assert.equal((await db.query('select public.is_main_branch_manager() flag')).rows[0].flag, true);
  assert.equal((await db.query('select public.can_change_own_email() flag')).rows[0].flag, true);
  await db.query('select public.assert_can_change_own_email()');
  await db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":200},{"product_id":"${extra}","quantity":40}]'::jsonb, 'opening')`);
  const transfer1 = (await db.query(
    `select public.send_stock_transfer('${branch1}','[{"product_id":"${chicken}","quantity_sent":80}]'::jsonb,null,'main-send-branch1-key01') id`,
  )).rows[0].id;
  const transfer2 = (await db.query(
    `select public.send_stock_transfer('${branch2}','[{"product_id":"${chicken}","quantity_sent":50}]'::jsonb,null,'main-send-branch2-key01') id`,
  )).rows[0].id;
  assert.ok(transfer1);
  assert.ok(transfer2);
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  await assert.rejects(
    db.query(`select public.owner_update_employee('${mgr1}','Nope','manager','${branch1}',true)`),
    /Owner access/,
  );
  await assert.rejects(
    db.query(`select public.create_employee_profile_from_server('${owner}','${createdMainMgr}','Main Manager Test','manager','${main}',true)`),
    /permission denied|Owner access/,
  );
  await db.exec(`insert into public.products(name,sku,selling_price) values ('Main Created','MC-01',12)`);
  await db.exec(`insert into public.branches(name,code,is_main_branch,is_active) values ('Branch 3','BR-03',false,true)`);
  await assert.rejects(
    db.exec(`update public.branches set is_active = false where id = '${main}'`),
    /cannot be deactivated/,
  );
});

const transferIds = (await db.query('select id, to_branch_id from public.stock_transfers order by to_branch_id')).rows;
const t1 = transferIds.find((row) => row.to_branch_id === branch1).id;
const t2 = transferIds.find((row) => row.to_branch_id === branch2).id;
const t1Item = (await db.query('select id from public.stock_transfer_items where stock_transfer_id=$1', [t1])).rows[0].id;
const t2Item = (await db.query('select id from public.stock_transfer_items where stock_transfer_id=$1', [t2])).rows[0].id;

await asUser(mgr1, async () => {
  assert.equal((await db.query('select public.can_change_own_email() flag')).rows[0].flag, false);
  await assert.rejects(db.query('select public.assert_can_change_own_email()'), /Owner and Main Branch Manager/);
  await db.query(
    `select public.receive_stock_transfer($1,$2::jsonb,null,'recv-branch1-key0001')`,
    [t1, JSON.stringify([{ stock_transfer_item_id: t1Item, quantity_received: 80 }])],
  );
  await assert.rejects(
    db.query(`select public.send_stock_transfer('${branch2}','[{"product_id":"${chicken}","quantity_sent":1}]'::jsonb,null,'selling-cannot-send001')`),
    /Main Branch Manager/,
  );
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  await assert.rejects(
    db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":1}]'::jsonb, null)`),
    /Main Branch Manager/,
  );
  await assert.rejects(
    db.exec(`insert into public.products(name,sku,selling_price) values ('Selling Product','SP',1)`),
    /permission denied|new row/,
  );
  await assert.rejects(
    db.exec(`insert into public.branches(name,code,is_main_branch,is_active) values ('Hijack','HX',false,true)`),
    /permission denied|new row/,
  );
  await assert.rejects(db.query('select public.get_owner_daily_product_summary()'), /Owner access required/);
  const ownTransfers = (await db.query('select id from public.stock_transfers')).rows;
  assert.equal(ownTransfers.length, 1);
  assert.equal(ownTransfers[0].id, t1);
});

await asUser(mgr2, async () => {
  await db.query(
    `select public.receive_stock_transfer($1,$2::jsonb,null,'recv-branch2-key0001')`,
    [t2, JSON.stringify([{ stock_transfer_item_id: t2Item, quantity_received: 50 }])],
  );
  const ownTransfers = (await db.query('select id from public.stock_transfers')).rows;
  assert.equal(ownTransfers.length, 1);
  assert.equal(ownTransfers[0].id, t2);
});

const sell = async (cashierId, quantity, key, paid) => asUser(cashierId, async () => {
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const sale = (await db.query(
    'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
    [shift, JSON.stringify([{ product_id: chicken, quantity }]), paid, key],
  )).rows[0];
  await db.query('select public.end_cashier_shift($1)', [shift]);
  return sale;
});

await sell(cashier1, 25, 'sale-branch1-today-key01', '2000.00');
await sell(cashier2, 15, 'sale-branch2-today-key01', '1200.00');

await asUser(owner, async () => {
  const metrics = (await db.query('select public.get_owner_dashboard_metrics() metrics')).rows[0].metrics;
  assert.equal(Number(metrics.today_transactions), 2);
  assert.equal(Number(metrics.today_units_sold), 40);
  assert.equal(Number(metrics.today_sales), 3200);

  const summary = (await db.query('select * from public.get_owner_daily_product_summary()')).rows;
  const row = summary.find((item) => item.product_id === chicken);
  assert.ok(row, 'Chicken Butter appears in daily product summary');
  assert.equal(Number(row.quantity_sold), 40);
  assert.equal(Number(row.revenue), 3200);
  assert.equal(Number(row.quantity_returned), 0);

  const byBranch = (await db.query(`select public.report_sales_by_branch('today', null, null) result`)).rows[0].result;
  assert.ok(Array.isArray(byBranch) || typeof byBranch === 'object');
  const products = (await db.query(`select public.report_product_sales('today', null, null, null) result`)).rows[0].result;
  assert.ok(products);
  const performance = (await db.query(`select public.report_branch_performance('today', null, null) result`)).rows[0].result;
  assert.ok(performance);
});

await asUser(mgr1, async () => {
  const returnId = (await db.query(
    `select public.create_stock_return('[{"product_id":"${chicken}","quantity_returned":30}]'::jsonb,null,'return-branch1-key001') id`,
  )).rows[0].id;
  assert.ok(returnId);
});
await asUser(mgr2, async () => {
  const returnId = (await db.query(
    `select public.create_stock_return('[{"product_id":"${chicken}","quantity_returned":20}]'::jsonb,null,'return-branch2-key001') id`,
  )).rows[0].id;
  assert.ok(returnId);
});

await asUser(owner, async () => {
  const summary = (await db.query('select * from public.get_owner_daily_product_summary()')).rows;
  const row = summary.find((item) => item.product_id === chicken);
  assert.equal(Number(row.quantity_sold), 40);
  assert.equal(Number(row.quantity_returned), 50);
  assert.equal(Number(row.returned_declared_qty), 50);
  assert.equal(Number(row.revenue), 3200);
  await assert.rejects(
    db.query(`select public.receive_stock_return((select id from public.stock_returns limit 1),'[]'::jsonb,null,'owner-cannot-receive01')`),
    /Main Branch Manager/,
  );
});

const returnRows = (await db.query('select id, from_branch_id from public.stock_returns order by from_branch_id')).rows;
const r1 = returnRows.find((row) => row.from_branch_id === branch1);
const r2 = returnRows.find((row) => row.from_branch_id === branch2);
const r1Item = (await db.query('select id from public.stock_return_items where stock_return_id=$1', [r1.id])).rows[0].id;

await asUser(mgr1, async () => {
  await assert.rejects(
    db.query(
      `select public.receive_stock_return($1,$2::jsonb,null,'selling-cannot-recv-01')`,
      [r1.id, JSON.stringify([{ stock_return_item_id: r1Item, quantity_received: 30 }])],
    ),
    /Main Branch Manager/,
  );
  const visible = (await db.query('select id from public.stock_returns')).rows;
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, r1.id);
});

await asUser(mgr2, async () => {
  const visible = (await db.query('select id from public.stock_returns')).rows;
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, r2.id);
});

await asUser(mainMgr, async () => {
  const allReturns = (await db.query('select id from public.stock_returns')).rows;
  assert.equal(allReturns.length, 2);
  await db.query(
    `select public.receive_stock_return($1,$2::jsonb,null,'main-recv-return-key01')`,
    [r1.id, JSON.stringify([{ stock_return_item_id: r1Item, quantity_received: 28 }])],
  );
});

await asUser(owner, async () => {
  const summary = (await db.query('select * from public.get_owner_daily_product_summary()')).rows;
  const row = summary.find((item) => item.product_id === chicken);
  assert.equal(Number(row.quantity_sold), 40);
  assert.equal(Number(row.quantity_returned), 50);
  assert.equal(Number(row.returned_declared_qty), 50);
  assert.equal(Number(row.returned_received_qty), 28);
  assert.equal(Number(row.return_missing_qty), 2);
});

await db.exec(`
  reset role;
  insert into public.sales(id,sale_number,branch_id,shift_id,cashier_id,subtotal,total_amount,amount_paid,change_amount,status,sold_at,idempotency_key,request_items)
  values (
    '${id(40)}','SALE-VOID-1','${branch1}',
    (select id from public.shifts where cashier_id='${cashier1}' limit 1),
    '${cashier1}',800,800,800,0,'voided', now(), 'voided-sale-key-000001', '[]'
  );
  insert into public.sale_items(sale_id,product_id,quantity,unit_price,subtotal)
  values ('${id(40)}','${chicken}',10,80,800);
  insert into public.sales(id,sale_number,branch_id,shift_id,cashier_id,subtotal,total_amount,amount_paid,change_amount,status,sold_at,idempotency_key,request_items)
  values (
    '${id(41)}','SALE-YDAY-1','${branch1}',
    (select id from public.shifts where cashier_id='${cashier1}' limit 1),
    '${cashier1}',80,80,80,0,'completed',
    ((timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila') - interval '1 hour',
    'yesterday-sale-key-00001', '[]'
  );
  insert into public.sale_items(sale_id,product_id,quantity,unit_price,subtotal)
  values ('${id(41)}','${chicken}',1,80,80);
  update public.products set selling_price=999 where id='${chicken}';
`);

await asUser(owner, async () => {
  const summary = (await db.query('select * from public.get_owner_daily_product_summary()')).rows;
  const row = summary.find((item) => item.product_id === chicken);
  assert.equal(Number(row.quantity_sold), 40, 'voided sales and prior-day sales are excluded');
  assert.equal(Number(row.revenue), 3200, 'historical unit prices are used');
});

await asUser(cashier1, async () => {
  assert.equal((await db.query('select public.can_change_own_email() flag')).rows[0].flag, false);
  await assert.rejects(db.query('select public.assert_can_change_own_email()'), /Owner and Main Branch Manager/);
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const sale = (await db.query(
    'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
    [shift, JSON.stringify([{ product_id: chicken, quantity: 1 }]), '999.00', 'cashier-regression-key01'],
  )).rows[0];
  assert.equal(Number(sale.total_amount), 999);
  await db.query('select public.end_cashier_shift($1)', [shift]);
});

await db.exec(`
  reset role;
  insert into auth.users values
    ('${createdMainMgr}','mainmgr-created@test'),
    ('${createdSellMgr}','sellmgr-created@test'),
    ('${createdCashier}','cashier-created@test');
`);

await assert.rejects(
  db.query(`select public.create_employee_profile_from_server('${mainMgr}','${createdMainMgr}','Main Manager Test','manager','${main}',true)`),
  /Owner access/,
);
await assert.rejects(
  db.query(`select public.create_employee_profile_from_server('${owner}','${createdSellMgr}','Owner Clone','owner','${main}',true)`),
  /Manager or Cashier/,
);
await db.query(`select public.create_employee_profile_from_server('${owner}','${createdMainMgr}','Main Manager Test','manager','${main}',true)`);
await db.query(`select public.create_employee_profile_from_server('${owner}','${createdSellMgr}','Selling Manager Created','manager','${branch1}',true)`);
await db.query(`select public.create_employee_profile_from_server('${owner}','${createdCashier}','Cashier Created','cashier','${branch1}',true)`);

const createdMain = (await db.query(`select role, branch_id, is_active from public.profiles where id='${createdMainMgr}'`)).rows[0];
assert.equal(createdMain.role, 'manager');
assert.equal(createdMain.branch_id, main);
assert.equal(createdMain.is_active, true);

let extraSend;
await asUser(createdMainMgr, async () => {
  assert.equal((await db.query('select public.is_main_branch_manager() flag')).rows[0].flag, true);
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  await assert.rejects(
    db.query(`select public.owner_update_employee('${mgr1}','Nope','manager','${branch1}',true)`),
    /Owner access/,
  );
  await assert.rejects(db.query('select public.get_owner_daily_product_summary()'), /Owner access required/);
  await db.exec(`insert into public.products(name,sku,selling_price) values ('Created Main Product','CMP-01',15)`);
  extraSend = (await db.query(
    `select public.send_stock_transfer('${branch1}','[{"product_id":"${chicken}","quantity_sent":2}]'::jsonb,null,'created-main-send-key01') id`,
  )).rows[0].id;
  assert.ok(extraSend);
});

const createdTransfer = extraSend;
const createdTransferItem = (await db.query(
  'select id from public.stock_transfer_items where stock_transfer_id=$1',
  [createdTransfer],
)).rows[0].id;

await asUser(createdSellMgr, async () => {
  assert.equal((await db.query('select public.is_main_branch_manager() flag')).rows[0].flag, false);
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  await assert.rejects(db.query('select public.get_owner_daily_product_summary()'), /Owner access required/);
  await assert.rejects(
    db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":1}]'::jsonb, null)`),
    /Main Branch Manager/,
  );
  await assert.rejects(
    db.exec(`insert into public.products(name,sku,selling_price) values ('Selling Created','SC',1)`),
    /permission denied|new row/,
  );
  const ownInv = (await db.query(
    `select quantity_on_hand from public.branch_inventory where branch_id='${branch1}' and product_id='${chicken}'`,
  )).rows;
  assert.ok(ownInv.length > 0, 'Selling Branch Manager can read assigned-branch inventory');
  const mainInv = (await db.query(
    `select quantity_on_hand from public.branch_inventory where branch_id='${main}' and product_id='${chicken}'`,
  )).rows;
  assert.equal(mainInv.length, 0, 'Selling Branch Manager cannot read Main Branch inventory');
  await db.query(
    `select public.receive_stock_transfer($1,$2::jsonb,null,'created-sell-recv-key01')`,
    [createdTransfer, JSON.stringify([{ stock_transfer_item_id: createdTransferItem, quantity_received: 2 }])],
  );
  const returnId = (await db.query(
    `select public.create_stock_return('[{"product_id":"${chicken}","quantity_returned":1}]'::jsonb,null,'created-sell-return-001') id`,
  )).rows[0].id;
  assert.ok(returnId);
});

await asUser(createdCashier, async () => {
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const sale = (await db.query(
    'select (public.confirm_sale($1,$2::jsonb,$3,$4)).*',
    [shift, JSON.stringify([{ product_id: chicken, quantity: 1 }]), '999.00', 'created-cashier-sale-001'],
  )).rows[0];
  assert.equal(Number(sale.total_amount), 999);
  await db.query('select public.end_cashier_shift($1)', [shift]);
});

await asUser(cashier1, async () => {
  await db.query('select public.start_cashier_shift()');
});
await asUser(owner, async () => {
  await assert.rejects(
    db.query(`select public.owner_update_employee('${cashier1}','Cashier 1','cashier','${branch2}',true)`),
    /active shift/,
  );
  await assert.rejects(
    db.query(`select public.owner_update_employee('${cashier1}','Cashier 1','cashier','${branch1}',false)`),
    /active shift/,
  );
});
await asUser(cashier1, async () => {
  const openShift = (await db.query(
    `select id from public.shifts where cashier_id='${cashier1}' and status='open'`,
  )).rows[0].id;
  await db.query('select public.end_cashier_shift($1)', [openShift]);
});
await asUser(owner, async () => {
  await db.query(`select public.owner_update_employee('${mgr2}','Selling Manager 2 Updated','manager','${branch2}',true)`);
  await db.query(`select public.owner_update_employee('${mgr2}','Selling Manager 2 Updated','manager','${branch2}',false)`);
  await db.query(`select public.owner_update_employee('${mgr2}','Selling Manager 2 Updated','manager','${branch2}',true)`);
});

const recon = await asUser(owner, async () => {
  const result = (await db.query('select public.report_inventory_reconciliation() result')).rows[0].result;
  return typeof result === 'string' ? JSON.parse(result) : result;
});
assert.ok(Array.isArray(recon), 'reconciliation returns an array');
assert.ok(recon.every((row) => Number(row.variance) === 0), 'reconciliation variance remains 0');

await db.close();
console.log('Milestone 11 roles, owner account administration, and audit cleanup tests passed.');
