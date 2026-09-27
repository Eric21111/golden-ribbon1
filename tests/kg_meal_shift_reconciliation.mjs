import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dashboard = readFileSync('app/(cashier)/cashier/dashboard.tsx', 'utf8');
assert.match(dashboard, /close_cashier_shift|useCloseShift/);
assert.match(dashboard, /Pending reconciliation/);
assert.doesNotMatch(dashboard, /end_cashier_shift/);
assert.doesNotMatch(dashboard, /Leftover on-hand stock will be returned to Main automatically/);

const incoming = readFileSync('app/(cashier)/cashier/incoming.tsx', 'utf8');
assert.match(incoming, /Unmeasured/);
assert.match(incoming, /isKgMeal/);

const inventoryStatus = readFileSync('src/features/inventory/inventoryStatus.ts', 'utf8');
assert.match(inventoryStatus, /No KG low-stock threshold has been defined/);
assert.match(inventoryStatus, /if \(item\.product\.inventory_mode === 'kg_meal'\) return 'in_stock'/);

const posInventory = readFileSync('src/features/pos/posInventory.ts', 'utf8');
assert.match(posInventory, /MAX_POS_MEAL_QUANTITY = 999999/);
assert.match(posInventory, /not derived from KG delivered/i);

const cartStore = readFileSync('src/stores/cartStore.ts', 'utf8');
assert.match(cartStore, /MAX_POS_MEAL_QUANTITY/);
assert.match(cartStore, /isKgMeal\(product\.inventory_mode\)/);

const posItemSheet = readFileSync('src/features/pos/PosItemSheet.tsx', 'utf8');
assert.match(posItemSheet, /MAX_POS_MEAL_QUANTITY/);
assert.doesNotMatch(posItemSheet, /quantity_on_hand.*kg_meal|10\.500/);

const reconScreen = readFileSync('src/features/reports/InventoryReconciliationScreen.tsx', 'utf8');
assert.match(reconScreen, /formatSnapshottedQuantity/);
assert.match(reconScreen, /item\.inventory_mode/);

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
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
      /create extension if not exists pgcrypto;/g,
      '',
    ),
  );
}

const id = (n) => `18000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const buttered = id(20);
const coke = id(21);
const histTransfer = id(30);
const histItem = id(31);
const histReturn = id(32);
const histReturnItem = id(33);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','main@test'),('${cashier}','cashier@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${branch}','Branch 1','B1',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${buttered}','Buttered Chicken','BCHK',80,true),
    ('${coke}','Coke','COKE',20,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${buttered}',80,true),('${branch}','${coke}',20,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${buttered}',50),('${branch}','${coke}',4),('${main}','${coke}',100);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const qty = async (branchId, productId) => {
  const row = (
    await db.query(
      'select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2',
      [branchId, productId],
    )
  ).rows[0];
  return row ? Number(row.quantity_on_hand) : null;
};

await asUser(mainMgr, () =>
  assert.rejects(
    db.query('select public.set_product_inventory_mode($1,$2)', [buttered, 'kg_meal']),
    /Clear every current balance/,
  ),
);

await db.exec(`update public.branch_inventory set quantity_on_hand = 0 where product_id='${buttered}'`);
await db.exec(`
  insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
  values ('${branch}','${buttered}',3)
  on conflict (branch_id, product_id) do update set quantity_on_hand = 3
`);
await asUser(mainMgr, () =>
  assert.rejects(
    db.query('select public.set_product_inventory_mode($1,$2)', [buttered, 'kg_meal']),
    /Clear every current balance/,
  ),
);

await db.exec(`
  update public.branch_inventory set quantity_on_hand = 0 where product_id='${buttered}';
  insert into public.stock_transfers(
    id, transfer_number, from_branch_id, to_branch_id, status, created_by
  ) values (
    '${id(40)}','TR-OPEN','${main}','${branch}','draft','${mainMgr}'
  );
  insert into public.stock_transfer_items(id, stock_transfer_id, product_id, quantity_sent)
  values ('${id(41)}','${id(40)}','${buttered}',5);
`);
await asUser(mainMgr, () =>
  assert.rejects(
    db.query('select public.set_product_inventory_mode($1,$2)', [buttered, 'kg_meal']),
    /open transfers/,
  ),
);
await db.exec(`
  delete from public.stock_transfer_items where stock_transfer_id='${id(40)}';
  delete from public.stock_transfers where id='${id(40)}';
`);

await db.exec(`
  insert into public.stock_transfers(
    id, transfer_number, from_branch_id, to_branch_id, status, created_by, sent_by, received_by, sent_at, received_at
  ) values (
    '${histTransfer}','TR-HIST','${main}','${branch}','received','${mainMgr}','${mainMgr}','${cashier}',now(),now()
  );
  insert into public.stock_transfer_items(id, stock_transfer_id, product_id, quantity_sent, quantity_received)
  values ('${histItem}','${histTransfer}','${buttered}',5,5);
  insert into public.stock_returns(
    id, return_number, from_branch_id, to_branch_id, status, created_by, returned_by, received_by, received_at,
    from_branch_name, to_branch_name, returned_by_name, idempotency_key, receive_idempotency_key, request_items
  ) values (
    '${histReturn}','RET-HIST','${branch}','${main}','received','${cashier}','${cashier}','${mainMgr}',now(),
    'Branch 1','Main','Cashier','hist-return-key-0001','hist-receive-key-0001','[]'
  );
  insert into public.stock_return_items(
    id, stock_return_id, product_id, quantity_returned, quantity_received, product_name, product_sku
  ) values (
    '${histReturnItem}','${histReturn}','${buttered}',5,5,'Buttered Chicken','BCHK'
  );
`);

const beforeMode = (
  await db.query(
    `select
       (select inventory_mode::text from public.stock_transfer_items where id=$1) as transfer_mode,
       (select quantity_sent from public.stock_transfer_items where id=$1) as sent,
       (select inventory_mode::text from public.stock_return_items where id=$2) as return_mode,
       (select quantity_returned from public.stock_return_items where id=$2) as returned`,
    [histItem, histReturnItem],
  )
).rows[0];
assert.equal(beforeMode.transfer_mode, 'piece_stock');
assert.equal(Number(beforeMode.sent), 5);
assert.equal(beforeMode.return_mode, 'piece_stock');
assert.equal(Number(beforeMode.returned), 5);

await asUser(cashier, () =>
  assert.rejects(
    db.query(`update public.products set inventory_mode='kg_meal' where id='${buttered}'`),
    /permission denied/i,
  ),
);
assert.equal(
  (await db.query(`select inventory_mode::text as mode from public.products where id='${buttered}'`)).rows[0].mode,
  'piece_stock',
);
await asUser(mainMgr, () =>
  assert.rejects(
    db.query(`update public.products set inventory_mode='kg_meal' where id='${buttered}'`),
    /set product inventory mode|permission denied/i,
  ),
);
await asUser(mainMgr, () =>
  assert.rejects(
    db.exec(`
      select set_config('golden.allow_inventory_mode_change','on',true);
      update public.products set inventory_mode='kg_meal' where id='${buttered}';
    `),
    /permission denied|inventory_mode/i,
  ),
);
assert.equal(
  (await db.query(`select inventory_mode::text as mode from public.products where id='${buttered}'`)).rows[0].mode,
  'piece_stock',
);

const changed = await asUser(mainMgr, () =>
  db.query('select inventory_mode::text as mode from public.set_product_inventory_mode($1,$2)', [buttered, 'kg_meal']),
);
assert.equal(changed.rows[0].mode, 'kg_meal');
const same = await asUser(mainMgr, () =>
  db.query('select inventory_mode::text as mode from public.set_product_inventory_mode($1,$2)', [buttered, 'kg_meal']),
);
assert.equal(same.rows[0].mode, 'kg_meal');

const afterMode = (
  await db.query(
    `select
       (select inventory_mode::text from public.stock_transfer_items where id=$1) as transfer_mode,
       (select quantity_sent from public.stock_transfer_items where id=$1) as sent,
       (select inventory_mode::text from public.stock_return_items where id=$2) as return_mode,
       (select quantity_returned from public.stock_return_items where id=$2) as returned`,
    [histItem, histReturnItem],
  )
).rows[0];
assert.equal(afterMode.transfer_mode, 'piece_stock');
assert.equal(Number(afterMode.sent), 5);
assert.equal(afterMode.return_mode, 'piece_stock');
assert.equal(Number(afterMode.returned), 5);

await asUser(mainMgr, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
    JSON.stringify([{ product_id: buttered, quantity: '50.000' }]),
  ]),
);
assert.equal(await qty(main, buttered), 50);

await assert.rejects(
  db.exec(
    `update public.branch_inventory set quantity_on_hand = 1.500 where branch_id='${branch}' and product_id='${buttered}'`,
  ),
  /Main Branch/,
);

await asUser(cashier, () =>
  assert.rejects(
    db.query('select public.create_stock_return($1::jsonb,$2,$3)', [
      JSON.stringify([{ product_id: buttered, quantity_returned: 1 }]),
      'kg return',
      'kg-return-key-000001',
    ]),
    /KG-delivered meal|piece/i,
  ),
);
const returnList = await asUser(cashier, () => db.query('select product_id from public.list_return_inventory()'));
assert.ok(!returnList.rows.some((row) => row.product_id === buttered));

const kgOnly = await asUser(mainMgr, () =>
  db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
    branch,
    JSON.stringify([{ product_id: buttered, quantity_sent: '10.500' }]),
    null,
    'kg-only-transfer-key1',
  ]),
);
const kgTransfer = kgOnly.rows[0].id;
const kgStatus = await asUser(cashier, () =>
  db.query('select public.confirm_shipment_arrival($1,$2) status', [kgTransfer, 'kg-arrival-key-0001']),
);
assert.equal(kgStatus.rows[0].status, 'received');
const kgLine = (
  await db.query(
    'select quantity_sent, quantity_received, inventory_mode::text as mode from public.stock_transfer_items where stock_transfer_id=$1',
    [kgTransfer],
  )
).rows[0];
assert.equal(Number(kgLine.quantity_sent), 10.5);
assert.equal(kgLine.quantity_received, null);
assert.equal(kgLine.mode, 'kg_meal');
assert.equal(await qty(branch, buttered) ?? 0, 0);
assert.equal(
  Number(
    (await db.query('select count(*)::int as n from public.transfer_discrepancies where stock_transfer_id=$1', [kgTransfer]))
      .rows[0].n,
  ),
  0,
);

const mixed = await asUser(mainMgr, () =>
  db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
    branch,
    JSON.stringify([
      { product_id: buttered, quantity_sent: '10.500' },
      { product_id: coke, quantity_sent: '24' },
    ]),
    null,
    'mixed-transfer-key001',
  ]),
);
const mixedId = mixed.rows[0].id;
const mixedItems = (
  await db.query(
    'select id, product_id, inventory_mode::text as mode, quantity_sent from public.stock_transfer_items where stock_transfer_id=$1',
    [mixedId],
  )
).rows;
const cokeLine = mixedItems.find((row) => row.product_id === coke);
const butterLine = mixedItems.find((row) => row.product_id === buttered);
const cokeBefore = await qty(branch, coke);
const mixedStatus = await asUser(cashier, () =>
  db.query('select public.report_shipment_issue($1,$2::jsonb,$3,$4) status', [
    mixedId,
    JSON.stringify([{ stock_transfer_item_id: cokeLine.id, quantity_received: '22' }]),
    'Coke short by 2',
    'mixed-issue-key-0001',
  ]),
);
assert.equal(mixedStatus.rows[0].status, 'received_with_discrepancy');
const mixedAfter = (
  await db.query(
    'select product_id, quantity_received, inventory_mode::text as mode from public.stock_transfer_items where stock_transfer_id=$1',
    [mixedId],
  )
).rows;
const butterAfter = mixedAfter.find((row) => row.product_id === buttered);
const cokeAfter = mixedAfter.find((row) => row.product_id === coke);
assert.equal(butterAfter.quantity_received, null);
assert.equal(butterAfter.mode, 'kg_meal');
assert.equal(Number(cokeAfter.quantity_received), 22);
assert.equal(cokeAfter.mode, 'piece_stock');
assert.equal(await qty(branch, buttered) ?? 0, 0);
assert.equal(await qty(branch, coke), cokeBefore + 22);
const discs = (
  await db.query(
    'select product_id, difference from public.transfer_discrepancies where stock_transfer_id=$1',
    [mixedId],
  )
).rows;
assert.equal(discs.length, 1);
assert.equal(discs[0].product_id, coke);
assert.equal(Number(discs[0].difference), 2);
assert.equal(butterLine.mode, 'kg_meal');

const saleShift = await asUser(cashier, async () => {
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  const sale = await db.query('select total_amount from public.confirm_sale($1,$2::jsonb,$3,$4)', [
    shift,
    JSON.stringify([
      { product_id: buttered, quantity: 2 },
      { product_id: coke, quantity: 1 },
    ]),
    '180.00',
    'kg-sale-key-00000001',
  ]);
  return { shift, total: Number(sale.rows[0].total_amount) };
});
assert.equal(saleShift.total, 180);
assert.equal(await qty(branch, coke), cokeBefore + 22 - 1);
assert.equal(await qty(branch, buttered) ?? 0, 0);
await asUser(cashier, () =>
  assert.rejects(
    db.query('select public.confirm_sale($1,$2::jsonb,$3,$4)', [
      saleShift.shift,
      JSON.stringify([{ product_id: buttered, quantity: 1.5 }]),
      '120.00',
      'kg-fraction-key-0001',
    ]),
    /quantity|whole/i,
  ),
);

const closed = await asUser(cashier, () =>
  db.query('select public.close_cashier_shift($1,$2,$3::jsonb) result', [
    saleShift.shift,
    '180.00',
    JSON.stringify([{ product_id: buttered }]),
  ]),
);
assert.equal(Number(closed.rows[0].result.expected_cash), 180);
assert.equal(Number(closed.rows[0].result.actual_cash), 180);
assert.equal(closed.rows[0].result.result, 'exact');
assert.equal(closed.rows[0].result.shift_status, 'closed');
const salesSum = Number(
  (
    await db.query(
      `select coalesce(sum(total_amount),0) as total from public.sales where shift_id=$1 and status='completed'`,
      [saleShift.shift],
    )
  ).rows[0].total,
);
assert.equal(Number(closed.rows[0].result.expected_cash), salesSum);
assert.equal(
  Number(
    (await db.query('select count(*)::int as n from public.shift_waste_occurrences where shift_id=$1', [saleShift.shift]))
      .rows[0].n,
  ),
  1,
);
await asUser(cashier, () =>
  assert.rejects(
    db.query('select public.close_cashier_shift($1,$2,$3::jsonb)', [saleShift.shift, '0', '[]']),
    /already closed/,
  ),
);
await asUser(cashier, () =>
  assert.rejects(
    db.query('select public.confirm_sale($1,$2::jsonb,$3,$4)', [
      saleShift.shift,
      JSON.stringify([{ product_id: coke, quantity: 1 }]),
      '20.00',
      'after-close-sale-key1',
    ]),
    /not open|already closed|shift/i,
  ),
);
await assert.rejects(
  db.exec(
    `insert into public.shift_waste_occurrences(shift_id, branch_id, product_id, recorded_by)
     values ('${saleShift.shift}','${branch}','${buttered}','${cashier}')`,
  ),
  /unique|duplicate/i,
);

const zeroShift = await asUser(cashier, async () => {
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  await assert.rejects(
    db.query('select public.close_cashier_shift($1,$2,$3::jsonb)', [shift, '   ', '[]']),
    /actual cash/i,
  );
  const result = await db.query('select public.close_cashier_shift($1,$2,$3::jsonb) result', [shift, '0', '[]']);
  return result.rows[0].result;
});
assert.equal(Number(zeroShift.expected_cash), 0);
assert.equal(Number(zeroShift.actual_cash), 0);
assert.equal(zeroShift.result, 'exact');

const duplicateWaste = await asUser(cashier, async () => {
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  await assert.rejects(
    db.query('select public.close_cashier_shift($1,$2,$3::jsonb)', [
      shift,
      '0',
      JSON.stringify([{ product_id: buttered }, { product_id: buttered }]),
    ]),
    /only once/i,
  );
  await db.query('select public.close_cashier_shift($1,$2,$3::jsonb)', [shift, '0', '[]']);
});
assert.ok(duplicateWaste === undefined);

const night = await asUser(cashier, () => db.query('select public.start_cashier_shift() id'));
const nightId = night.rows[0].id;
await db.exec(`
  alter table public.shifts disable trigger shifts_protect_lifecycle;
  update public.shifts
  set started_at = (
    case
      when timezone('Asia/Manila', now()) < (timezone('Asia/Manila', now()))::date + time '21:00'
        then (timezone('Asia/Manila', now()))::date - 1
      else (timezone('Asia/Manila', now()))::date
    end + time '21:00'
  ) at time zone 'Asia/Manila' - interval '2 hours'
  where id = '${nightId}';
  alter table public.shifts enable trigger shifts_protect_lifecycle;
`);
const overdue = (await db.query('select public.close_overdue_shifts() result')).rows[0].result;
assert.equal(Number(overdue.closed_count), 1);
assert.equal(Number(overdue.leftover_return_count), 0);
assert.equal(
  Number((await db.query('select count(*)::int as n from public.shift_reconciliations where shift_id=$1', [nightId])).rows[0].n),
  0,
);
const pending = await asUser(cashier, () => db.query('select public.get_my_pending_shift_reconciliation() result'));
assert.equal(pending.rows[0].result.status, 'pending');
assert.equal(pending.rows[0].result.actual_cash, null);
assert.equal(pending.rows[0].result.difference, null);
assert.equal(pending.rows[0].result.result, null);
assert.equal(pending.rows[0].result.shift_id, nightId);

await asUser(owner, () =>
  assert.rejects(
    db.query('select public.reconcile_closed_shift($1,$2,$3::jsonb)', [nightId, '0', '[]']),
    /cashier/i,
  ),
);
await asUser(mainMgr, () =>
  assert.rejects(
    db.query('select public.reconcile_closed_shift($1,$2,$3::jsonb)', [nightId, '0', '[]']),
    /cashier/i,
  ),
);
const report = await asUser(owner, () =>
  db.query('select public.report_branch_shift_remittances(null) rows'),
);
const pendingRow = report.rows[0].rows.find((row) => row.shift_id === nightId);
assert.equal(pendingRow.status, 'pending');
assert.equal(pendingRow.actual_cash, null);
assert.equal(pendingRow.result, null);

const later = await asUser(cashier, () => db.query('select public.start_cashier_shift() id'));
assert.equal(
  (await db.query('select status from public.shifts where id=$1', [later.rows[0].id])).rows[0].status,
  'open',
);

await asUser(mainMgr, () =>
  assert.rejects(
    db.exec(`insert into public.products(name,sku,selling_price,inventory_mode) values ('Bypass Meal','BYPASSKG',80,'kg_meal')`),
    /permission denied/,
  ),
);
await asUser(cashier, () =>
  assert.rejects(
    db.exec(`insert into public.products(name,sku,selling_price) values ('Cashier Bypass','CASHBYP',1)`),
    /permission denied/,
  ),
);
const rpcCreated = await asUser(mainMgr, () =>
  db.query(
    `select id, inventory_mode::text as mode from public.create_complete_product('RPC Rice','RICEMEAL',null,'[]'::jsonb,'[]'::jsonb,'90.00','kg_meal')`,
  ),
);
const rice = rpcCreated.rows[0].id;
assert.equal(rpcCreated.rows[0].mode, 'kg_meal');
assert.equal(
  (await db.query(`select count(*)::int as n from public.products where sku='BYPASSKG'`)).rows[0].n,
  0,
);

await asUser(mainMgr, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
    JSON.stringify([{ product_id: rice, quantity: '10.500' }]),
  ]),
);
await asUser(mainMgr, () =>
  db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4)', [
    branch,
    JSON.stringify([{ product_id: rice, quantity_sent: '2.250' }]),
    null,
    'rice-transfer-out-key1',
  ]),
);
assert.equal(Number((await qty(main, rice)).toFixed(3)), 8.25);

const afterOut = await asUser(owner, () =>
  db.query('select public.report_inventory_reconciliation($1) result', [main]),
);
const riceAfterOut = (typeof afterOut.rows[0].result === 'string'
  ? JSON.parse(afterOut.rows[0].result)
  : afterOut.rows[0].result
).find((row) => row.product_id === rice);
assert.equal(riceAfterOut.inventory_mode, 'kg_meal');
assert.equal(Number(riceAfterOut.opening_stock).toFixed(3), '10.500');
assert.equal(Number(riceAfterOut.transfer_out).toFixed(3), '2.250');
assert.equal(Number(riceAfterOut.calculated_stock).toFixed(3), '8.250');
assert.equal(Number(riceAfterOut.current_stock).toFixed(3), '8.250');
assert.equal(Number(riceAfterOut.variance).toFixed(3), '0.000');

await asUser(mainMgr, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
    JSON.stringify([{ product_id: rice, quantity: '1.125' }]),
  ]),
);
const afterAdj = await asUser(owner, () =>
  db.query('select public.report_inventory_reconciliation($1) result', [main]),
);
const riceAfterAdj = (typeof afterAdj.rows[0].result === 'string'
  ? JSON.parse(afterAdj.rows[0].result)
  : afterAdj.rows[0].result
).find((row) => row.product_id === rice);
assert.equal(Number(riceAfterAdj.opening_stock).toFixed(3), '10.500');
assert.equal(Number(riceAfterAdj.transfer_out).toFixed(3), '2.250');
assert.equal(Number(riceAfterAdj.adjustment).toFixed(3), '1.125');
assert.equal(Number(riceAfterAdj.calculated_stock).toFixed(3), '9.375');
assert.equal(Number(riceAfterAdj.current_stock).toFixed(3), '9.375');
assert.equal(Number(riceAfterAdj.variance).toFixed(3), '0.000');

const cokeRecon = (typeof afterAdj.rows[0].result === 'string'
  ? JSON.parse(afterAdj.rows[0].result)
  : afterAdj.rows[0].result
).find((row) => row.product_id === coke);
assert.equal(cokeRecon.inventory_mode, 'piece_stock');
assert.equal(Number(cokeRecon.current_stock), Math.trunc(Number(cokeRecon.current_stock)));

const reconDef = (
  await db.query(`select pg_get_functiondef('public.report_inventory_reconciliation(uuid)'::regprocedure) def`)
).rows[0].def;
assert.doesNotMatch(reconDef, /sum\(im\.quantity\)[^;]{0,80}::bigint/);
assert.match(reconDef, /::numeric\(14,3\)/);
assert.match(reconDef, /latest_inventory_mode/);

const confirmDef = (
  await db.query(`select pg_get_functiondef('public.confirm_sale(uuid,jsonb,numeric,text)'::regprocedure) def`)
).rows[0].def;
assert.match(confirmDef, /from public\.shifts[\s\S]{0,400}for update/i);
const closeDef = (
  await db.query(`select pg_get_functiondef('public.close_cashier_shift(uuid,text,jsonb)'::regprocedure) def`)
).rows[0].def;
assert.match(closeDef, /from public\.shifts where id = p_shift_id for update/i);
assert.doesNotMatch(closeDef, /branch_inventory/);

await db.close();
console.log('kg meal shift reconciliation tests passed');
