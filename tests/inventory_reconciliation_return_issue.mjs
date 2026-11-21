import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = readFileSync('src/features/reports/InventoryReconciliationScreen.tsx', 'utf8');
assert.match(source, /export function hasVisibleReconciliationIssue/);
assert.match(source, /export function reconciliationIssueBadge/);
assert.match(source, /export function hasResolvedDiscrepancy/);
assert.match(source, /export function resolvedDiscrepancySummary/);
assert.match(source, /reconciliationItemBadge/);
const overviewSrc = readFileSync('src/features/reports/inventoryReconOverview.ts', 'utf8');
assert.match(overviewSrc, /label: 'Return issue'/);
assert.match(overviewSrc, /label: 'Resolved'/);
assert.match(overviewSrc, /reconHasResolvedDiscrepancy/);
assert.match(source, /auditDiscrepancySummary/);
assert.match(overviewSrc, /return_in/);
assert.match(source, /Items in report/);
assert.match(source, /With issues/);
assert.doesNotMatch(source, /Count differences stay listed even when stock totals match/);
assert.doesNotMatch(source, /RECONCILIATION OVERVIEW/);
assert.match(source, /export function hasVisibleReconciliationIssue/);
assert.match(source, /reconCollapsedStatusLine\(item\)/);
assert.match(source, /reconResolvedRowDetail\(row\)/);
assert.match(source, /formatLiveStock/);
assert.doesNotMatch(source, /formatSnapshottedQuantity/);
assert.doesNotMatch(source, /has_reconciliation_issue\)\.length/);

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

const id = (n) => `29000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const product = id(20);
const productB = id(21);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${mainMgr}','m@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${branch}','SM1','SM1',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${product}','Chicken','CH',80,true),
    ('${productB}','Rice','RI',40,true);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${product}',80,true),('${branch}','${productB}',40,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch}','${product}',0),('${main}','${product}',40),
    ('${branch}','${productB}',8),('${main}','${productB}',20);
  insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,created_by)
  values ('${branch}','${productB}','opening_stock',8,'opening_stock','${owner}');
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const reconFor = async (branchId, productId) => {
  const result = (
    await asUser(owner, () => db.query(`select public.report_inventory_reconciliation($1) result`, [branchId]))
  ).rows[0].result;
  return result.find((row) => row.product_id === productId);
};

const seedReturnDisc = async (suffix, productId, expected, received) => {
  const returnId = id(100 + suffix);
  const itemId = id(200 + suffix);
  const discId = id(300 + suffix);
  await db.exec(`
    insert into public.stock_returns (
      id, return_number, from_branch_id, to_branch_id, status, created_by, returned_by,
      from_branch_name, to_branch_name, returned_by_name, idempotency_key, request_items,
      returned_at, received_by, received_at, receive_idempotency_key
    ) values (
      '${returnId}', 'RET-RECON-${String(suffix).padStart(3, '0')}', '${branch}', '${main}',
      'received_with_discrepancy', '${cashier}', '${cashier}', 'SM1', 'Main', 'Cashier',
      'return-recon-key-${String(suffix).padStart(4, '0')}', '[]'::jsonb, now(), '${mainMgr}', now(),
      'recv-recon-key-${String(suffix).padStart(4, '0')}'
    );
    insert into public.stock_return_items (
      id, stock_return_id, product_id, quantity_returned, quantity_received, product_name, product_sku
    ) values ('${itemId}', '${returnId}', '${productId}', ${expected}, ${received}, 'Item', 'SKU');
    insert into public.return_discrepancies (
      id, stock_return_id, stock_return_item_id, product_id, quantity_expected, quantity_received,
      difference, discrepancy_type, recorded_by
    ) values (
      '${discId}', '${returnId}', '${itemId}', '${productId}', ${expected}, ${received},
      ${expected - received}, '${expected - received > 0 ? 'missing' : 'excess'}', '${mainMgr}'
    );
  `);
  return discId;
};

const seedTransferDisc = async (suffix, productId, expected, received) => {
  const transferId = id(400 + suffix);
  const itemId = id(500 + suffix);
  const discId = id(600 + suffix);
  await db.exec(`
    insert into public.stock_transfers (
      id, transfer_number, from_branch_id, to_branch_id, status, created_by, sent_by, received_by, sent_at, received_at
    ) values (
      '${transferId}', 'TR-RECON-${String(suffix).padStart(3, '0')}', '${main}', '${branch}',
      'received_with_discrepancy', '${mainMgr}', '${mainMgr}', '${cashier}', now(), now()
    );
    insert into public.stock_transfer_items (id, stock_transfer_id, product_id, quantity_sent, quantity_received)
    values ('${itemId}', '${transferId}', '${productId}', ${expected}, ${received});
    insert into public.transfer_discrepancies (
      id, stock_transfer_id, stock_transfer_item_id, product_id, quantity_expected, quantity_received,
      difference, discrepancy_type, recorded_by
    ) values (
      '${discId}', '${transferId}', '${itemId}', '${productId}', ${expected}, ${received},
      ${expected - received}, '${expected - received > 0 ? 'missing' : 'excess'}', '${cashier}'
    );
  `);
  return discId;
};

const openDiscId = await seedReturnDisc(1, product, 12, 10);

const chickenOpen = await reconFor(branch, product);
assert.ok(chickenOpen);
assert.equal(Number(chickenOpen.variance), 0);
assert.equal(chickenOpen.has_reconciliation_issue, false);
assert.equal(Number(chickenOpen.return_missing_qty), 2);
assert.equal(Number(chickenOpen.return_excess_qty), 0);
assert.equal(Number(chickenOpen.current_stock), 0);
assert.equal(Number(chickenOpen.calculated_stock), 0);
assert.deepEqual(chickenOpen.resolved_discrepancies ?? [], []);

const resolved = (
  await asUser(mainMgr, () =>
    db.query('select public.resolve_return_discrepancy($1,$2,$3) result', [
      openDiscId,
      'confirmed_shortage',
      '2 pieces confirmed missing on return.',
    ]),
  )
).rows[0].result;
assert.equal(resolved.status, 'resolved');
assert.equal(resolved.resolution_reason, 'confirmed_shortage');

const chickenResolved = await reconFor(branch, product);
assert.equal(Number(chickenResolved.return_missing_qty), 0);
assert.equal(Number(chickenResolved.return_excess_qty), 0);
assert.equal(chickenResolved.has_reconciliation_issue, false);
assert.equal(Number(chickenResolved.variance), 0);
assert.equal((chickenResolved.resolved_discrepancies ?? []).length, 1);
assert.equal(chickenResolved.resolved_discrepancies[0].kind, 'return');
assert.equal(chickenResolved.resolved_discrepancies[0].resolution_reason, 'confirmed_shortage');
assert.match(chickenResolved.resolved_discrepancies[0].resolution_note, /confirmed missing/);
assert.equal(Number(chickenResolved.resolved_discrepancies[0].difference), 2);

// Mixed open + resolved on same product.
await seedReturnDisc(2, product, 5, 3);
const chickenMixed = await reconFor(branch, product);
assert.equal(Number(chickenMixed.return_missing_qty), 2);
assert.equal((chickenMixed.resolved_discrepancies ?? []).length, 1);
assert.equal(chickenMixed.resolved_discrepancies[0].resolution_reason, 'confirmed_shortage');
assert.match(chickenMixed.resolved_discrepancies[0].resolution_note, /confirmed missing/);

// Transfer open vs resolved on product B.
const transferDiscId = await seedTransferDisc(1, productB, 10, 8);
const riceOpenTransfer = await reconFor(branch, productB);
assert.equal(Number(riceOpenTransfer.transfer_missing_qty), 2);
assert.equal(Number(riceOpenTransfer.return_missing_qty), 0);
assert.deepEqual(riceOpenTransfer.resolved_discrepancies ?? [], []);

await asUser(mainMgr, () =>
  db.query('select public.resolve_transfer_discrepancy($1,$2,$3) result', [
    transferDiscId,
    'counting_error',
    'Recount matched sent quantity.',
  ]),
);

const riceResolvedTransfer = await reconFor(branch, productB);
assert.equal(Number(riceResolvedTransfer.transfer_missing_qty), 0);
assert.equal(Number(riceResolvedTransfer.transfer_excess_qty), 0);
assert.equal(riceResolvedTransfer.has_reconciliation_issue, false);
assert.equal((riceResolvedTransfer.resolved_discrepancies ?? []).length, 1);
assert.equal(riceResolvedTransfer.resolved_discrepancies[0].kind, 'transfer');
assert.equal(riceResolvedTransfer.resolved_discrepancies[0].resolution_reason, 'counting_error');
assert.match(riceResolvedTransfer.resolved_discrepancies[0].resolution_note, /Recount matched/);

const historicReturn = (
  await db.query(
    'select status, resolution_reason, resolution_note, difference from public.return_discrepancies where id=$1',
    [openDiscId],
  )
).rows[0];
assert.equal(historicReturn.status, 'resolved');
assert.equal(historicReturn.resolution_reason, 'confirmed_shortage');
assert.match(historicReturn.resolution_note, /confirmed missing/);
assert.equal(Number(historicReturn.difference), 2);

await db.close();
console.log(
  'Inventory reconciliation return-issue tests passed: open qty, resolve clears active issue, resolved notes, mixed open/resolved, transfer resolved.',
);
