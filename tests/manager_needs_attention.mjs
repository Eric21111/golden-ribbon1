import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { buildAttentionItems, countUnresolved } from '../src/features/reports/managerAttention.ts';

// --- Pure helpers -----------------------------------------------------------------------------
{
  assert.equal(countUnresolved([]), 0);
  assert.equal(countUnresolved([{ status: 'open' }, { status: 'resolved' }, { status: 'open' }]), 2);
  assert.equal(countUnresolved([{ status: null }, {}]), 2, 'missing status is treated as open, like the report badge');

  assert.deepEqual(buildAttentionItems({}), [], 'nothing loaded: no alerts');
  assert.deepEqual(
    buildAttentionItems({ pendingIncoming: 0, pendingOutgoing: 0, returnsInTransit: 0, transferDiscrepancies: 0, returnDiscrepancies: 0 }),
    [],
    'all zero: no alerts',
  );
  assert.deepEqual(
    buildAttentionItems({ pendingIncoming: 1, pendingOutgoing: 2, returnsInTransit: 3, transferDiscrepancies: 4, returnDiscrepancies: 5 }).map(
      (item) => [item.title, item.value, item.href],
    ),
    [
      ['Pending incoming', 1, '/manager/incoming'],
      ['Pending transfers', 2, '/manager/transfers'],
      ['Returns in transit', 3, '/manager/returns'],
      ['Transfer discrepancies', 4, '/manager/reports/transfer-discrepancies'],
      ['Return discrepancies', 5, '/manager/reports/return-discrepancies'],
    ],
  );
}

// --- Source wiring ----------------------------------------------------------------------------
{
  const service = readFileSync('src/services/transferService.ts', 'utf8');
  const count = service.slice(service.indexOf('export async function countPendingOutgoingTransfers'), service.indexOf('export async function getTransfer'));
  assert.match(count, /\.select\('id', \{ count: 'exact', head: true \}\)/, 'exact count, not a capped list');
  assert.match(count, /\.eq\('from_branch_id', fromBranchId\)/);
  assert.match(count, /\.eq\('status', 'pending_receipt'\)/);

  const keys = readFileSync('src/lib/queryKeys.ts', 'utf8');
  assert.match(keys, /pendingOutgoingTransfersCount: \(fromBranchId: string\) =>\s*\['transfers', 'pending-outgoing-count', fromBranchId\]/);

  const hook = readFileSync('src/hooks/useManagerAttention.ts', 'utf8');
  assert.match(hook, /queryKeys\.transferDiscrepanciesReport\(undefined, 'all', 'all_time'\)/);
  assert.match(hook, /queryKeys\.returnDiscrepanciesReport\(undefined, 'all', 'all_time'\)/);
  assert.equal((hook.match(/useQuery\(\{/g) ?? []).length, 3);
  assert.equal((hook.match(/ {4}enabled,\r?\n {2}\}\);/g) ?? []).length, 3, 'every source is gated on the Main Branch Manager');

  // The report screens open on the same arguments, so they share the cache entry the dashboard reads.
  const reports = readFileSync('src/features/reports/DiscrepancyReportsScreens.tsx', 'utf8');
  assert.equal((reports.match(/useState<DateFilterType>\('all_time'\)/g) ?? []).length, 2);
  assert.equal((reports.match(/useState<DiscrepancyFilterType>\('all'\)/g) ?? []).length, 2);

  // Refresh after operations: each mutation already invalidates a prefix of these keys.
  const transfers = readFileSync('src/hooks/useTransfers.ts', 'utf8');
  const sendFlow = transfers.slice(transfers.indexOf('function invalidateInventoryFlow'), transfers.indexOf('export function useSendTransfer'));
  assert.match(sendFlow, /queryKey: \['transfers'\]/, 'sending a transfer refreshes the pending count');
  const shipment = transfers.slice(transfers.indexOf('function invalidateCashierShipment'), transfers.indexOf('export function useConfirmShipmentArrival'));
  assert.match(shipment, /queryKey: \['transfers'\]/, 'receiving clears the pending count');
  assert.match(shipment, /queryKey: \['reports', 'transfer-discrepancies'\]/, 'a reported issue refreshes transfer discrepancies');
  const returns = readFileSync('src/hooks/useReturns.ts', 'utf8');
  assert.match(returns, /queryKey: \['reports', 'return-discrepancies'\]/, 'receiving a return refreshes return discrepancies');
  const resolve = readFileSync('src/features/reports/DiscrepancyDetailScreen.tsx', 'utf8');
  assert.match(resolve, /queryKey: \['reports'\]/, 'resolving refreshes both discrepancy counts');
}

// --- Database: real migrations and real operation RPCs ----------------------------------------
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
const [owner, mainMgr, cashier1, cashier2, sellingMgr] = [id(1), id(2), id(3), id(4), id(5)];
const [main, sm1, sm2] = [id(10), id(11), id(12)];
const [piece, drink] = [id(20), id(21)];

await db.exec(`
  insert into auth.users values
    ('${owner}','o@t'),('${mainMgr}','m@t'),('${cashier1}','c1@t'),('${cashier2}','c2@t'),('${sellingMgr}','sm@t');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN',true,true,'counted'),
    ('${sm1}','SM1','SM1',false,true,'cashier_confirm'),
    ('${sm2}','SM2','SM2',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id,is_active) values
    ('${owner}','Owner','owner',null,true),
    ('${mainMgr}','Mara Main','manager','${main}',true),
    ('${cashier1}','Cara One','cashier','${sm1}',true),
    ('${cashier2}','Cody Two','cashier','${sm2}',true),
    ('${sellingMgr}','Sam Seller','manager','${sm1}',true);
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${piece}','Piece Cake','PIECE',50,true,'piece_stock','keep_at_branch'),
    ('${drink}','Bottled Drink','DRINK',25,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${sm1}','${piece}',50,true),('${sm1}','${drink}',25,true),
    ('${sm2}','${piece}',50,true),('${sm2}','${drink}',25,true);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
// Same filter as countPendingOutgoingTransfers, evaluated under the caller's RLS.
const pendingOutgoing = (userId, fromBranch = main) =>
  asUser(userId, async () =>
    Number(
      (
        await db.query(`select count(id)::int n from public.stock_transfers where from_branch_id = $1 and status = 'pending_receipt'`, [
          fromBranch,
        ])
      ).rows[0].n,
    ),
  );
const report = (userId, fn) =>
  asUser(userId, async () => (await db.query(`select public.${fn}(null, 'all', 'all_time') r`)).rows[0].r);
const dashboardCounts = async (userId = mainMgr) => {
  const metrics = await asUser(userId, async () => (await db.query('select public.get_manager_dashboard_metrics() r')).rows[0].r);
  return {
    pendingIncoming: Number(metrics.pending_incoming_transfers_count),
    pendingOutgoing: await pendingOutgoing(userId),
    returnsInTransit: Number(metrics.returns_in_transit_count),
    transferDiscrepancies: countUnresolved(await report(userId, 'report_transfer_discrepancies')),
    returnDiscrepancies: countUnresolved(await report(userId, 'report_return_discrepancies')),
  };
};
const send = (to, items, key) =>
  asUser(mainMgr, async () =>
    (await db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [to, JSON.stringify(items), null, key])).rows[0].id,
  );

await asUser(mainMgr, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
    JSON.stringify([{ product_id: piece, quantity: '100' }, { product_id: drink, quantity: '40' }]),
  ]),
);

// Empty: nothing needs attention.
assert.deepEqual(await dashboardCounts(), {
  pendingIncoming: 0, pendingOutgoing: 0, returnsInTransit: 0, transferDiscrepancies: 0, returnDiscrepancies: 0,
});
assert.deepEqual(buildAttentionItems(await dashboardCounts()), []);

// Two outgoing transfers awaiting receipt; the existing incoming metric cannot see them.
const t1 = await send(sm1, [{ product_id: piece, quantity_sent: '6' }], 'att-send-t1-000000001');
const t2 = await send(sm2, [{ product_id: drink, quantity_sent: '3' }, { product_id: piece, quantity_sent: '2' }], 'att-send-t2-000000001');
{
  const counts = await dashboardCounts();
  assert.equal(counts.pendingOutgoing, 2);
  assert.equal(counts.pendingIncoming, 0, 'pending incoming only counts transfers sent TO the Main Branch');
}

// Receipt clears pending; a reported shortage creates one open transfer discrepancy (one short product line).
await asUser(cashier1, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t1, 'att-arrive-t1-0000001']));
const t2Items = (await db.query('select id, product_id from public.stock_transfer_items where stock_transfer_id=$1', [t2])).rows;
await asUser(cashier2, () =>
  db.query('select public.report_shipment_issue($1,$2::jsonb,$3,$4)', [
    t2,
    JSON.stringify(t2Items.map((item) => ({ stock_transfer_item_id: item.id, quantity_received: item.product_id === drink ? '2' : '1' }))),
    'short on both',
    'att-issue-t2-00000001',
  ]),
);
{
  const counts = await dashboardCounts();
  assert.equal(counts.pendingOutgoing, 0, 'received transfers are no longer pending');
  assert.equal(counts.transferDiscrepancies, 2, 'two short product lines on the reported transfer');
}

// A return in transit, then received short: return discrepancy appears and in-transit clears.
const ret = (
  await asUser(cashier1, () =>
    db.query('select public.create_stock_return($1::jsonb,$2,$3) id', [
      JSON.stringify([{ product_id: piece, quantity_returned: 3 }]),
      'leftover',
      'att-return-r1-0000001',
    ]),
  )
).rows[0].id;
assert.equal((await dashboardCounts()).returnsInTransit, 1, 'existing returns-in-transit alert preserved');
const retItems = (await db.query('select id from public.stock_return_items where stock_return_id=$1', [ret])).rows;
await asUser(mainMgr, () =>
  db.query('select public.receive_stock_return($1,$2::jsonb,$3,$4)', [
    ret,
    JSON.stringify(retItems.map((item) => ({ stock_return_item_id: item.id, quantity_received: '2' }))),
    'one missing',
    'att-return-recv-00001',
  ]),
);
const t3 = await send(sm1, [{ product_id: drink, quantity_sent: '1' }], 'att-send-t3-000000001');
{
  const counts = await dashboardCounts();
  assert.deepEqual(counts, {
    pendingIncoming: 0, pendingOutgoing: 1, returnsInTransit: 0, transferDiscrepancies: 2, returnDiscrepancies: 1,
  });
  assert.deepEqual(
    buildAttentionItems(counts).map((item) => [item.title, item.value]),
    [['Pending transfers', 1], ['Transfer discrepancies', 2], ['Return discrepancies', 1]],
  );
}

// Resolving excludes the row from the unresolved count while it stays visible in the report.
const [tdOpen] = (await report(mainMgr, 'report_transfer_discrepancies')).filter((row) => row.status === 'open');
await asUser(mainMgr, () => db.query('select public.resolve_transfer_discrepancy($1,$2,$3)', [tdOpen.id, 'counting_error', null]));
const [rdOpen] = await report(mainMgr, 'report_return_discrepancies');
await asUser(mainMgr, () => db.query('select public.resolve_return_discrepancy($1,$2,$3)', [rdOpen.id, 'confirmed_shortage', null]));
{
  const transferRows = await report(mainMgr, 'report_transfer_discrepancies');
  const returnRows = await report(mainMgr, 'report_return_discrepancies');
  assert.equal(transferRows.length, 2, 'resolved rows remain in the report');
  assert.equal(returnRows.length, 1);
  const counts = await dashboardCounts();
  assert.equal(counts.transferDiscrepancies, 1, 'resolved transfer discrepancy excluded');
  assert.equal(counts.returnDiscrepancies, 0, 'resolved return discrepancy excluded');
  assert.deepEqual(
    buildAttentionItems(counts).map((item) => item.title),
    ['Pending transfers', 'Transfer discrepancies'],
  );
}

// Clearing everything: back to nothing.
await asUser(cashier1, () => db.query('select public.confirm_shipment_arrival($1,$2)', [t3, 'att-arrive-t3-0000001']));
const [tdLast] = (await report(mainMgr, 'report_transfer_discrepancies')).filter((row) => row.status === 'open');
await asUser(mainMgr, () => db.query('select public.resolve_transfer_discrepancy($1,$2,$3)', [tdLast.id, 'other', 'found in storage']));
assert.deepEqual(buildAttentionItems(await dashboardCounts()), [], 'no actionable items left');

// Authorization.
{
  await send(sm2, [{ product_id: piece, quantity_sent: '1' }], 'att-send-t4-000000001');
  assert.equal(await pendingOutgoing(mainMgr), 1, 'Main Branch Manager reads outgoing transfers');
  assert.equal(await pendingOutgoing(owner), 1);
  assert.equal(await pendingOutgoing(cashier1), 0, 'cashiers cannot see Main Branch transfers');
  for (const [label, user] of [
    ['selling-branch manager', sellingMgr],
    ['cashier', cashier1],
  ]) {
    for (const fn of ['report_transfer_discrepancies', 'report_return_discrepancies']) {
      await assert.rejects(() => report(user, fn), /Owner or Main Branch Manager access is required/, `${label}: ${fn} refused`);
    }
  }
  assert.ok(Array.isArray(await report(owner, 'report_transfer_discrepancies')), 'owner keeps report access');
}

await db.close();
console.log(
  'Manager Needs Attention tests passed: pending outgoing transfers, unresolved transfer/return discrepancies (resolved excluded), returns in transit preserved, empty state, cache refresh wiring, authorization.',
);
