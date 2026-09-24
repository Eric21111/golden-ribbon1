import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const reports = readFileSync('src/features/reports/DiscrepancyReportsScreens.tsx', 'utf8');
assert.match(reports, /detailHref/);
assert.doesNotMatch(reports, /\/owner\/reports\/discrepancies\/\$\{/);

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

const id = (n) => `33000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const sellMgr = id(3);
const cashier = id(4);
const main = id(10);
const branch = id(11);
const product = id(20);

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
    values ('${product}','Chicken','CH',80,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active)
    values ('${branch}','${product}',80,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch}','${product}',80),('${main}','${product}',100);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const seedReturn = async (suffix, expected, received) => {
  const returnId = id(100 + suffix);
  const itemId = id(200 + suffix);
  const discId = id(300 + suffix);
  await db.exec(`
    insert into public.stock_returns (
      id, return_number, from_branch_id, to_branch_id, status, created_by, returned_by,
      from_branch_name, to_branch_name, returned_by_name, idempotency_key, request_items,
      returned_at, received_by, received_at, receive_idempotency_key
    ) values (
      '${returnId}', 'RET-RES-${String(suffix).padStart(3, '0')}', '${branch}', '${main}',
      'received_with_discrepancy', '${cashier}', '${cashier}', 'SM1', 'Main', 'Cashier',
      'return-res-key-${String(suffix).padStart(4, '0')}', '[]'::jsonb, now(), '${mainMgr}', now(),
      'recv-res-key-${String(suffix).padStart(4, '0')}'
    );
    insert into public.stock_return_items (
      id, stock_return_id, product_id, quantity_returned, quantity_received, product_name, product_sku
    ) values ('${itemId}', '${returnId}', '${product}', ${expected}, ${received}, 'Chicken', 'CH');
    insert into public.return_discrepancies (
      id, stock_return_id, stock_return_item_id, product_id, quantity_expected, quantity_received,
      difference, discrepancy_type, recorded_by
    ) values (
      '${discId}', '${returnId}', '${itemId}', '${product}', ${expected}, ${received},
      ${expected - received}, '${expected - received > 0 ? 'missing' : 'excess'}', '${mainMgr}'
    );
  `);
  return discId;
};

const seedTransfer = async (suffix, expected, received) => {
  const transferId = id(400 + suffix);
  const itemId = id(500 + suffix);
  const discId = id(600 + suffix);
  await db.exec(`
    insert into public.stock_transfers (
      id, transfer_number, from_branch_id, to_branch_id, status, created_by, sent_by, received_by, sent_at, received_at
    ) values (
      '${transferId}', 'TR-RES-${String(suffix).padStart(3, '0')}', '${main}', '${branch}',
      'received_with_discrepancy', '${mainMgr}', '${mainMgr}', '${cashier}', now(), now()
    );
    insert into public.stock_transfer_items (id, stock_transfer_id, product_id, quantity_sent, quantity_received)
    values ('${itemId}', '${transferId}', '${product}', ${expected}, ${received});
    insert into public.transfer_discrepancies (
      id, stock_transfer_id, stock_transfer_item_id, product_id, quantity_expected, quantity_received,
      difference, discrepancy_type, recorded_by
    ) values (
      '${discId}', '${transferId}', '${itemId}', '${product}', ${expected}, ${received},
      ${expected - received}, '${expected - received > 0 ? 'missing' : 'excess'}', '${cashier}'
    );
  `);
  return discId;
};

const resolveReturn = (userId, discId, reason, note) =>
  asUser(userId, () =>
    db.query('select public.resolve_return_discrepancy($1,$2,$3) result', [discId, reason, note]),
  );
const resolveTransfer = (userId, discId, reason, note) =>
  asUser(userId, () =>
    db.query('select public.resolve_transfer_discrepancy($1,$2,$3) result', [discId, reason, note]),
  );

const returnRow = async (discId) =>
  (await db.query('select * from public.return_discrepancies where id=$1', [discId])).rows[0];
const transferRow = async (discId) =>
  (await db.query('select * from public.transfer_discrepancies where id=$1', [discId])).rows[0];
const mainStock = async () =>
  Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [
      main,
      product,
    ])).rows[0].quantity_on_hand,
  );
const movementCount = async () =>
  Number((await db.query('select count(*)::int as n from public.inventory_movements')).rows[0].n);

const aId = await seedReturn(1, 50, 45);
assert.equal((await returnRow(aId)).status, 'open');

const beforeStock = await mainStock();
const beforeMoves = await movementCount();
const b = (await resolveReturn(mainMgr, aId, 'confirmed_shortage', '2 items were physically missing.')).rows[0].result;
assert.equal(b.status, 'resolved');
assert.equal(b.resolved_by, mainMgr);
assert.ok(b.resolved_at);
assert.equal(b.resolution_reason, 'confirmed_shortage');
assert.match(b.resolution_note, /physically missing/);
assert.equal(Number(b.quantity_expected), 50);
assert.equal(Number(b.quantity_received), 45);
assert.equal(Number(b.difference), 5);

const cId = await seedTransfer(1, 20, 18);
const c = (await resolveTransfer(mainMgr, cId, 'counting_error', 'Initial count encoded incorrectly.')).rows[0].result;
assert.equal(c.status, 'resolved');
assert.equal(c.resolved_by, mainMgr);
assert.equal(Number(c.quantity_expected), 20);
assert.equal(Number(c.quantity_received), 18);
assert.equal(Number(c.difference), 2);

const dId = await seedReturn(2, 12, 10);
await assert.rejects(resolveReturn(cashier, dId, 'confirmed_shortage', 'nope'), /not allowed to resolve/);
await assert.rejects(resolveReturn(owner, dId, 'confirmed_shortage', 'nope'), /not allowed to resolve/);
await assert.rejects(resolveReturn(sellMgr, dId, 'confirmed_shortage', 'nope'), /not allowed to resolve/);
const d = (await resolveReturn(mainMgr, dId, 'confirmed_shortage', 'reviewed')).rows[0].result;
assert.equal(d.status, 'resolved');

const eId = await seedReturn(3, 8, 6);
const first = (await resolveReturn(mainMgr, eId, 'encoding_error', 'first resolve')).rows[0].result;
await assert.rejects(resolveReturn(mainMgr, eId, 'other', 'second resolve'), /already been resolved/);
const afterSecond = await returnRow(eId);
assert.equal(afterSecond.resolved_by, first.resolved_by);
assert.equal(new Date(afterSecond.resolved_at).getTime(), new Date(first.resolved_at).getTime());
assert.equal(afterSecond.resolution_reason, 'encoding_error');
assert.equal(afterSecond.resolution_note, 'first resolve');

const fId = await seedReturn(4, 9, 7);
await assert.rejects(resolveReturn(mainMgr, fId, 'other', '   '), /Enter a note for this resolution/);
await assert.rejects(resolveReturn(mainMgr, fId, 'other', null), /Enter a note for this resolution/);
const f = (await resolveReturn(mainMgr, fId, 'other', 'Documented other cause.')).rows[0].result;
assert.equal(f.resolution_reason, 'other');
assert.equal(f.resolution_note, 'Documented other cause.');

assert.equal(await mainStock(), beforeStock);
assert.equal(await movementCount(), beforeMoves);

const hId = await seedReturn(5, 30, 25);
const historic = await returnRow(hId);
assert.equal(historic.status, 'open');
assert.equal(Number(historic.difference), 5);
assert.equal(historic.resolved_by, null);

const ownerView = await asUser(owner, () =>
  db.query(`select public.report_return_discrepancies(null, 'all', 'all_time') as res`),
);
const resolvedVisible = ownerView.rows[0].res.find((row) => row.id === aId);
assert.ok(resolvedVisible);
assert.equal(resolvedVisible.status, 'resolved');
assert.equal(resolvedVisible.resolution_reason, 'confirmed_shortage');
assert.ok(resolvedVisible.resolved_by_name);

const kId = await seedReturn(6, 15, 11);
await assert.rejects(
  db.exec(`update public.return_discrepancies set quantity_expected = 99 where id='${kId}'`),
  /immutable/,
);
await assert.rejects(
  db.exec(`update public.return_discrepancies set quantity_received = 1 where id='${kId}'`),
  /immutable/,
);
await assert.rejects(
  db.exec(`update public.return_discrepancies set difference = 1 where id='${kId}'`),
  /immutable/,
);
await assert.rejects(
  db.exec(`update public.return_discrepancies set discrepancy_type = 'excess' where id='${kId}'`),
  /immutable/,
);
await assert.rejects(
  db.exec(`update public.return_discrepancies set product_id = '${id(99)}' where id='${kId}'`),
  /immutable|foreign key/,
);
await assert.rejects(
  db.exec(`update public.return_discrepancies set recorded_by = '${owner}' where id='${kId}'`),
  /immutable/,
);
await assert.rejects(
  db.exec(`update public.return_discrepancies set created_at = now() - interval '1 day' where id='${kId}'`),
  /immutable/,
);
await assert.rejects(db.exec(`delete from public.return_discrepancies where id='${kId}'`), /immutable/);
const k = (await resolveReturn(mainMgr, kId, 'return_handling_issue', 'trigger check')).rows[0].result;
assert.equal(k.status, 'resolved');
await assert.rejects(
  db.exec(`update public.return_discrepancies set resolution_note = 'changed' where id='${kId}'`),
  /already been resolved/,
);
await assert.rejects(
  db.exec(`update public.return_discrepancies set status = 'open' where id='${kId}'`),
  /already been resolved/,
);
await assert.rejects(
  db.exec(`update public.return_discrepancies set resolution_reason = 'other' where id='${kId}'`),
  /already been resolved/,
);

await db.close();
console.log(
  'Discrepancy resolution tests passed: open default, resolve return/transfer, auth, double resolve, other-note, no inventory mutation, history, trigger integrity.',
);
