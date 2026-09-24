import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const managerCreate = readFileSync('app/(manager)/manager/returns/create.tsx', 'utf8');
assert.doesNotMatch(managerCreate, /createReturn\(/);
assert.match(managerCreate, /Cashiers create leftover returns/);

const inventory = readFileSync('app/(manager)/manager/inventory/index.tsx', 'utf8');
assert.doesNotMatch(inventory, /Create return/);
assert.doesNotMatch(inventory, /Return unsold stock/);
assert.match(inventory, /View returns/);
assert.match(inventory, /\/manager\/returns/);

const hub = readFileSync('src/features/returns/ReturnScreens.tsx', 'utf8');
assert.doesNotMatch(hub, /label: 'Create return'/);
assert.match(hub, /Leftover returns are created by cashiers/);

const receiveUi = readFileSync('src/features/returns/ReceiveReturnScreen.tsx', 'utf8');
assert.doesNotMatch(receiveUi, /Main branch inventory was updated/);
assert.match(receiveUi, /does not restock Main/);

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
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const id = (n) => `32000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const sellMgr = id(3);
const cashier = id(4);
const main = id(10);
const branch = id(11);
const p1 = id(20);

await db.exec(`
  insert into auth.users values
    ('${owner}','o@test'),('${mainMgr}','m@test'),('${sellMgr}','s@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${branch}','SM1','SM1',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${sellMgr}','Selling Manager','manager','${branch}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active)
    values ('${p1}','Chicken','CH',80,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active)
    values ('${branch}','${p1}',80,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch}','${p1}',500),('${main}','${p1}',100);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const createReturn = (userId, qty, key) =>
  asUser(userId, () =>
    db.query('select public.create_stock_return($1::jsonb,$2,$3) id', [
      JSON.stringify([{ product_id: p1, quantity_returned: qty }]),
      null,
      key,
    ]),
  );

const receiveReturn = (userId, returnId, itemId, qty, key) =>
  asUser(userId, () =>
    db.query('select public.receive_stock_return($1,$2::jsonb,null,$3) status', [
      returnId,
      JSON.stringify([{ stock_return_item_id: itemId, quantity_received: qty }]),
      key,
    ]),
  );

const itemOf = async (returnId) =>
  (await db.query('select id, quantity_returned, quantity_received from public.stock_return_items where stock_return_id=$1', [returnId])).rows[0];

const mainStock = async () =>
  Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [main, p1]))
      .rows[0].quantity_on_hand,
  );

const returnInCount = async (returnId) =>
  Number(
    (
      await db.query(
        "select count(*)::int as n from public.inventory_movements where reference_id=$1 and movement_type='return_in'",
        [returnId],
      )
    ).rows[0].n,
  );

const discrepancies = async (returnId) =>
  (
    await db.query(
      'select discrepancy_type, difference, quantity_expected, quantity_received from public.return_discrepancies where stock_return_id=$1',
      [returnId],
    )
  ).rows;

const statusOf = async (returnId) =>
  (await db.query('select status from public.stock_returns where id=$1', [returnId])).rows[0].status;

// A: exact 50/50 — received, no discrepancy, Main stock unchanged, no return_in
const aId = (await createReturn(cashier, 50, 'return-integrity-a-key01')).rows[0].id;
const aItem = await itemOf(aId);
assert.equal(await mainStock(), 100);
const aStatus = (await receiveReturn(mainMgr, aId, aItem.id, 50, 'return-integrity-a-recv1')).rows[0].status;
assert.equal(aStatus, 'received');
assert.equal(Number((await itemOf(aId)).quantity_received), 50);
assert.equal((await discrepancies(aId)).length, 0);
assert.equal(await mainStock(), 100);
assert.equal(await returnInCount(aId), 0);

// B: 50/45 — missing +5, stock unchanged
const bId = (await createReturn(cashier, 50, 'return-integrity-b-key01')).rows[0].id;
const bItem = await itemOf(bId);
const bStatus = (await receiveReturn(mainMgr, bId, bItem.id, 45, 'return-integrity-b-recv1')).rows[0].status;
assert.equal(bStatus, 'received_with_discrepancy');
const bDisc = await discrepancies(bId);
assert.equal(bDisc.length, 1);
assert.equal(bDisc[0].discrepancy_type, 'missing');
assert.equal(Number(bDisc[0].difference), 5);
assert.equal(Number((await itemOf(bId)).quantity_received), 45);
assert.equal(await mainStock(), 100);
assert.equal(await returnInCount(bId), 0);

// C: 50/55 — excess -5, stock unchanged
const cId = (await createReturn(cashier, 50, 'return-integrity-c-key01')).rows[0].id;
const cItem = await itemOf(cId);
const cStatus = (await receiveReturn(mainMgr, cId, cItem.id, 55, 'return-integrity-c-recv1')).rows[0].status;
assert.equal(cStatus, 'received_with_discrepancy');
const cDisc = await discrepancies(cId);
assert.equal(cDisc.length, 1);
assert.equal(cDisc[0].discrepancy_type, 'excess');
assert.equal(Number(cDisc[0].difference), -5);
assert.equal(Number((await itemOf(cId)).quantity_received), 55);
assert.equal(await mainStock(), 100);
assert.equal(await returnInCount(cId), 0);

// D: 10/0 — accepted, shortage 10, stock unchanged
const dId = (await createReturn(cashier, 10, 'return-integrity-d-key01')).rows[0].id;
const dItem = await itemOf(dId);
const dStatus = (await receiveReturn(mainMgr, dId, dItem.id, 0, 'return-integrity-d-recv1')).rows[0].status;
assert.equal(dStatus, 'received_with_discrepancy');
const dDisc = await discrepancies(dId);
assert.equal(dDisc.length, 1);
assert.equal(dDisc[0].discrepancy_type, 'missing');
assert.equal(Number(dDisc[0].difference), 10);
assert.equal(Number((await itemOf(dId)).quantity_received), 0);
assert.equal(await mainStock(), 100);

// E: blank / whitespace / negative / malformed — reject, stay in_transit. Trimmed " 0 " is valid.
const eId = (await createReturn(cashier, 8, 'return-integrity-e-key01')).rows[0].id;
const eItem = await itemOf(eId);
await assert.rejects(receiveReturn(mainMgr, eId, eItem.id, '', 'return-integrity-e-blank'), /valid received quantity/);
await assert.rejects(
  asUser(mainMgr, () =>
    db.query('select public.receive_stock_return($1,$2::jsonb,null,$3)', [
      eId,
      JSON.stringify([{ stock_return_item_id: eItem.id, quantity_received: '   ' }]),
      'return-integrity-e-ws000',
    ]),
  ),
  /valid received quantity/,
);
await assert.rejects(receiveReturn(mainMgr, eId, eItem.id, -1, 'return-integrity-e-neg01'), /cannot be negative/);
await assert.rejects(receiveReturn(mainMgr, eId, eItem.id, '5x', 'return-integrity-e-bad01'), /valid received quantity/);
assert.equal(await statusOf(eId), 'in_transit');
assert.equal((await itemOf(eId)).quantity_received, null);
assert.equal((await discrepancies(eId)).length, 0);

const trimmedZero = (
  await asUser(mainMgr, () =>
    db.query('select public.receive_stock_return($1,$2::jsonb,null,$3) status', [
      eId,
      JSON.stringify([{ stock_return_item_id: eItem.id, quantity_received: ' 0 ' }]),
      'return-integrity-e-zero1',
    ]),
  )
).rows[0].status;
assert.equal(trimmedZero, 'received_with_discrepancy');
assert.equal(Number((await itemOf(eId)).quantity_received), 0);

// F: second receive rejected; no extra discrepancy/movement
const fId = (await createReturn(cashier, 12, 'return-integrity-f-key01')).rows[0].id;
const fItem = await itemOf(fId);
await receiveReturn(mainMgr, fId, fItem.id, 12, 'return-integrity-f-recv1');
const fDiscBefore = (await discrepancies(fId)).length;
const fMovesBefore = await returnInCount(fId);
await assert.rejects(receiveReturn(mainMgr, fId, fItem.id, 12, 'return-integrity-f-recv2'), /already been received/);
assert.equal((await discrepancies(fId)).length, fDiscBefore);
assert.equal(await returnInCount(fId), fMovesBefore);
assert.equal(await statusOf(fId), 'received');

// G: later-step failure rolls back — still in_transit, no partial rows
const gId = (await createReturn(cashier, 20, 'return-integrity-g-key01')).rows[0].id;
const gItem = await itemOf(gId);
await db.exec(`
  create function public.fail_return_discrepancy() returns trigger language plpgsql as $$
  begin
    raise exception 'injected discrepancy failure';
  end $$;
  create trigger fail_return_discrepancy
    before insert on public.return_discrepancies
    for each row execute function public.fail_return_discrepancy();
`);
await assert.rejects(receiveReturn(mainMgr, gId, gItem.id, 15, 'return-integrity-g-recv1'), /injected discrepancy failure/);
await db.exec('drop trigger fail_return_discrepancy on public.return_discrepancies; drop function public.fail_return_discrepancy();');
assert.equal(await statusOf(gId), 'in_transit');
assert.equal((await itemOf(gId)).quantity_received, null);
assert.equal((await discrepancies(gId)).length, 0);
assert.equal(await returnInCount(gId), 0);
assert.equal(await mainStock(), 100);

// H: roles — cashier create OK; cashier/selling-manager/Owner receive rejected;
// Main Manager receive OK; selling-manager + Owner cannot create.
await assert.rejects(
  asUser(sellMgr, () =>
    db.query(
      `select public.create_stock_return($1::jsonb,null,'return-integrity-h-mgr01')`,
      [JSON.stringify([{ product_id: p1, quantity_returned: 1 }])],
    ),
  ),
  /cashiers|Cashier or Manager/,
);
await assert.rejects(
  asUser(owner, () =>
    db.query(
      `select public.create_stock_return($1::jsonb,null,'return-integrity-h-own01')`,
      [JSON.stringify([{ product_id: p1, quantity_returned: 1 }])],
    ),
  ),
  /Cashier or Manager/,
);
const hId = (await createReturn(cashier, 6, 'return-integrity-h-key01')).rows[0].id;
const hItem = await itemOf(hId);
await assert.rejects(receiveReturn(cashier, hId, hItem.id, 6, 'return-integrity-h-cash1'), /Main Branch Manager/);
await assert.rejects(receiveReturn(sellMgr, hId, hItem.id, 6, 'return-integrity-h-sell1'), /Main Branch Manager/);
await assert.rejects(receiveReturn(owner, hId, hItem.id, 6, 'return-integrity-h-ownr1'), /Main Branch Manager/);
const ownerView = await asUser(owner, () => db.query('select id, status from public.stock_returns where id=$1', [hId]));
assert.equal(ownerView.rows.length, 1);
assert.equal(ownerView.rows[0].status, 'in_transit');
const hStatus = (await receiveReturn(mainMgr, hId, hItem.id, 6, 'return-integrity-h-main1')).rows[0].status;
assert.equal(hStatus, 'received');

// I: Main 100, expected 50, received 55 → Main still 100
const iId = (await createReturn(cashier, 50, 'return-integrity-i-key01')).rows[0].id;
const iItem = await itemOf(iId);
assert.equal(await mainStock(), 100);
await receiveReturn(mainMgr, iId, iItem.id, 55, 'return-integrity-i-recv1');
assert.equal(await mainStock(), 100);
assert.equal(await returnInCount(iId), 0);
const iDisc = await discrepancies(iId);
assert.equal(iDisc[0].discrepancy_type, 'excess');
assert.equal(Number(iDisc[0].difference), -5);

await db.close();
console.log(
  'Return inventory integrity tests passed: waste-only receive, exact/shortage/excess/zero, trim, auth including Owner, rollback, no sellable restock.',
);
