import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

console.log('--- Starting Milestone 8 Automated Verification ---');

const db = new PGlite();

// Setup base roles and auth schema
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

// Apply all migrations in order
for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
  console.log(`Applying ${file}...`);
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

// User UUIDs
const ownerId = '10000000-0000-4000-8000-000000000001';
const cashierId = '10000000-0000-4000-8000-000000000002';
const managerId = '10000000-0000-4000-8000-000000000003';

// Branch UUIDs
const mainBranchId = '20000000-0000-4000-8000-000000000001';
const branch1Id = '20000000-0000-4000-8000-000000000002';

// Product UUIDs
const prod1Id = '30000000-0000-4000-8000-000000000001'; // Chicken Nuggets

await db.exec(`
  insert into auth.users values
    ('${ownerId}', 'owner@example.test'),
    ('${cashierId}', 'cashier@example.test'),
    ('${managerId}', 'manager@example.test');

  insert into public.branches (id, name, code, is_main_branch, is_active) values
    ('${mainBranchId}', 'Main Commissary', 'MAIN', true, true),
    ('${branch1Id}', 'Branch 1', 'BR-01', false, true);

  insert into public.profiles (id, full_name, role, branch_id) values
    ('${ownerId}', 'Big Boss', 'owner', null),
    ('${managerId}', 'Branch Manager', 'manager', '${branch1Id}'),
    ('${cashierId}', 'Cashier One', 'cashier', '${branch1Id}');

  insert into public.products (id, name, sku, selling_price, is_active) values
    ('${prod1Id}', 'Chicken Nuggets', 'CHICKEN-NUG', 120.00, true);
`);

// ============================================================================
// TEST 1: AUTHORIZATION ENFORCEMENT
// ============================================================================
console.log('Testing Owner-only authorization...');

// As Cashier: must fail
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${cashierId}', false);`);
await assert.rejects(db.query(`select public.report_branch_performance()`), /Owner access required/);
await assert.rejects(db.query(`select public.get_branch_performance_details('${branch1Id}')`), /Owner access required/);
await assert.rejects(db.query(`select public.report_transfer_discrepancies()`), /Owner access required/);
await assert.rejects(db.query(`select public.report_return_discrepancies()`), /Owner access required/);
await assert.rejects(db.query(`select public.report_inventory_reconciliation()`), /Owner access required/);

// As Manager: must fail
await db.exec(`select set_config('request.jwt.claim.sub', '${managerId}', false);`);
await assert.rejects(db.query(`select public.report_branch_performance()`), /Owner access required/);
await assert.rejects(db.query(`select public.report_inventory_reconciliation()`), /Owner access required/);

console.log('✓ Authorization properly rejects non-owners.');

// ============================================================================
// TEST 2: INVENTORY MOVEMENTS & RECONCILIATION EQUATION
// ============================================================================
console.log('Testing Inventory Reconciliation math...');

// Reset to superuser to populate known inventory movements for Branch 1
await db.exec('reset role;');

// Scenario from User Prompt:
// 1. Opening stock: 100
// 2. Transfer in: 50 (Main sent 52, Branch received 50 -> 2 missing)
// 3. Sale: 30
// 4. Return out: 20 (Branch sent 20, Main received 18 -> 2 missing)
// Expected calculated stock = 100 + 50 - 30 - 20 = 100
// Transfer missing = 2
// Return missing = 2
// Neither discrepancy alters the inventory equation!

await db.exec(`
  -- 1. Opening stock: +100
  insert into public.inventory_movements (branch_id, product_id, movement_type, quantity, reference_type, created_by)
  values ('${branch1Id}', '${prod1Id}', 'opening_stock', 100, 'opening_stock', '${ownerId}');

  -- Mock transfer and transfer discrepancy (2 missing)
  insert into public.stock_transfers (id, transfer_number, from_branch_id, to_branch_id, status, created_by, sent_by, received_by, sent_at, received_at)
  values ('40000000-0000-4000-8000-000000000001', 'TR-000021', '${mainBranchId}', '${branch1Id}', 'received_with_discrepancy', '${ownerId}', '${ownerId}', '${managerId}', now(), now());


  insert into public.stock_transfer_items (id, stock_transfer_id, product_id, quantity_sent, quantity_received)
  values ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '${prod1Id}', 52, 50);

  insert into public.transfer_discrepancies (stock_transfer_id, stock_transfer_item_id, product_id, quantity_expected, quantity_received, difference, discrepancy_type, recorded_by)
  values ('40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '${prod1Id}', 52, 50, 2, 'missing', '${managerId}');

  -- 2. Transfer in: +50
  insert into public.inventory_movements (branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by)
  values ('${branch1Id}', '${prod1Id}', 'transfer_in', 50, 'stock_transfer', '40000000-0000-4000-8000-000000000001', '${ownerId}');

  -- Mock return and return discrepancy (2 missing)
  insert into public.stock_returns (id, return_number, from_branch_id, to_branch_id, status, created_by, returned_by, from_branch_name, to_branch_name, returned_by_name, idempotency_key, request_items, returned_at, received_by, received_at, receive_idempotency_key)
  values ('60000000-0000-4000-8000-000000000001', 'RET-000010', '${branch1Id}', '${mainBranchId}', 'received_with_discrepancy', '${managerId}', '${managerId}', 'Branch 1', 'Main Commissary', 'Branch Manager', 'idempotency-key-return-0001', '[]'::jsonb, now(), '${ownerId}', now(), 'receive-return-key-0001');


  insert into public.stock_return_items (id, stock_return_id, product_id, quantity_returned, quantity_received, product_name, product_sku)
  values ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '${prod1Id}', 20, 18, 'Chicken Nuggets', 'CHICKEN-NUG');

  insert into public.return_discrepancies (stock_return_id, stock_return_item_id, product_id, quantity_expected, quantity_received, difference, discrepancy_type, recorded_by)
  values ('60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '${prod1Id}', 20, 18, 2, 'missing', '${ownerId}');

  -- 4. Return out: -20
  insert into public.inventory_movements (branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by)
  values ('${branch1Id}', '${prod1Id}', 'return_out', -20, 'stock_return', '60000000-0000-4000-8000-000000000001', '${managerId}');

  -- Shift & Sale
  insert into public.shifts (id, branch_id, cashier_id, status)
  values ('80000000-0000-4000-8000-000000000001', '${branch1Id}', '${cashierId}', 'open');

  insert into public.sales (id, sale_number, branch_id, shift_id, cashier_id, total_amount, subtotal, amount_paid, change_amount, status, sold_at, idempotency_key, request_items)
  values
    ('90000000-0000-4000-8000-000000000001', 'SALE-0001', '${branch1Id}', '80000000-0000-4000-8000-000000000001', '${cashierId}', 3600.00, 3600.00, 4000.00, 400.00, 'completed', now(), 'idempotency-key-sale-0001', '[]'::jsonb);

  insert into public.sale_items (sale_id, product_id, quantity, unit_price, subtotal)
  values
    ('90000000-0000-4000-8000-000000000001', '${prod1Id}', 30, 120.00, 3600.00);

  -- 3. Sale: -30
  insert into public.inventory_movements (branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by)
  values ('${branch1Id}', '${prod1Id}', 'sale', -30, 'sale', '90000000-0000-4000-8000-000000000001', '${cashierId}');

  -- Set actual current inventory to 100 (matches calculated stock!)
  insert into public.branch_inventory (branch_id, product_id, quantity_on_hand)
  values ('${branch1Id}', '${prod1Id}', 100);

`);

// Switch to Owner
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ownerId}', false);`);

// Query reconciliation
const reconRes1 = await db.query(`select public.report_inventory_reconciliation('${branch1Id}') as res;`);
const recon1 = reconRes1.rows[0].res;
assert.equal(recon1.length, 1);
const rItem1 = recon1[0];

console.log('Reconciliation result (Balanced):', rItem1);
assert.equal(rItem1.opening_stock, 100);
assert.equal(rItem1.transfer_in, 50);
assert.equal(rItem1.sale, 30);
assert.equal(rItem1.return_out, 20);
assert.equal(rItem1.adjustment, 0);
assert.equal(rItem1.calculated_stock, 100); // 100 + 50 - 30 - 20
assert.equal(rItem1.current_stock, 100);
assert.equal(rItem1.variance, 0);
assert.equal(rItem1.has_reconciliation_issue, false);
assert.equal(rItem1.transfer_missing_qty, 2); // Audit metric reported
assert.equal(rItem1.return_missing_qty, 2);   // Audit metric reported
console.log('✓ Balanced reconciliation verified with correct category breakdown.');

// Now simulate an unaccounted shrinkage: physical stock is only 95
await db.exec('reset role;');
await db.exec(`update public.branch_inventory set quantity_on_hand = 95 where branch_id = '${branch1Id}' and product_id = '${prod1Id}';`);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ownerId}', false);`);

const reconRes2 = await db.query(`select public.report_inventory_reconciliation('${branch1Id}') as res;`);
const rItem2 = reconRes2.rows[0].res[0];
console.log('Reconciliation result (Issue):', rItem2);
assert.equal(rItem2.calculated_stock, 100);
assert.equal(rItem2.current_stock, 95);
assert.equal(rItem2.variance, -5);
assert.equal(rItem2.has_reconciliation_issue, true);
console.log('✓ Variance correctly detected and flagged as Reconciliation Issue.');

// ============================================================================
// TEST 3: BRANCH PERFORMANCE (COMPLETED SALES ONLY & MISSING/EXCESS SEPARATION)
// ============================================================================
console.log('Testing Branch Performance report...');

// Add a completed sale and a cancelled sale
await db.exec('reset role;');
await db.exec(`
  insert into public.sales (id, sale_number, branch_id, shift_id, cashier_id, total_amount, subtotal, amount_paid, change_amount, status, sold_at, idempotency_key, request_items)
  values
    ('90000000-0000-4000-8000-000000000002', 'SALE-0002', '${branch1Id}', '80000000-0000-4000-8000-000000000001', '${cashierId}', 5000.00, 5000.00, 5000.00, 0.00, 'voided', now(), 'idempotency-key-sale-0002', '[]'::jsonb);



  insert into public.sale_items (sale_id, product_id, quantity, unit_price, subtotal)
  values
    ('90000000-0000-4000-8000-000000000002', '${prod1Id}', 50, 100.00, 5000.00);
`);


await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ownerId}', false);`);
const perfRes = await db.query(`select public.report_branch_performance('all_time') as res;`);
const perf = perfRes.rows[0].res;
assert.equal(perf.length, 1);
const bPerf = perf[0];
console.log('Branch Performance result:', bPerf);
assert.equal(bPerf.branch_name, 'Branch 1');
assert.equal(bPerf.transaction_count, 1); // Only completed sale
assert.equal(Number(bPerf.total_sales), 3600.00); // Only completed sale (excludes 5000 cancelled)
assert.equal(bPerf.quantity_sold, 30);
assert.equal(bPerf.transfer_missing_qty, 2);
assert.equal(bPerf.transfer_excess_qty, 0);
assert.equal(bPerf.return_missing_qty, 2);
assert.equal(bPerf.return_excess_qty, 0);
assert.equal(bPerf.total_missing_qty, 4);
assert.equal(bPerf.total_excess_qty, 0);
console.log('✓ Branch Performance accurately counts only completed sales and distinguishes missing vs excess.');

// ============================================================================
// TEST 4: TRANSFER & RETURN DISCREPANCY REPORTS
// ============================================================================
console.log('Testing Transfer & Return Discrepancy reports...');
const tdRes = await db.query(`select public.report_transfer_discrepancies(null, 'all', 'all_time') as res;`);
const td = tdRes.rows[0].res;
assert.equal(td.length, 1);
assert.equal(td[0].transfer_number, 'TR-000021');
assert.equal(td[0].product_name, 'Chicken Nuggets');
assert.equal(td[0].quantity_sent, 52);
assert.equal(td[0].quantity_received, 50);
assert.equal(td[0].difference, 2);
assert.equal(td[0].discrepancy_type, 'missing');
console.log('✓ Transfer Discrepancy report output verified.');

const rdRes = await db.query(`select public.report_return_discrepancies(null, 'all', 'all_time') as res;`);
const rd = rdRes.rows[0].res;
assert.equal(rd.length, 1);
assert.equal(rd[0].return_number, 'RET-000010');
assert.equal(rd[0].product_name, 'Chicken Nuggets');
assert.equal(rd[0].quantity_returned, 20);
assert.equal(rd[0].quantity_received, 18);
assert.equal(rd[0].difference, 2);
assert.equal(rd[0].discrepancy_type, 'missing');
console.log('✓ Return Discrepancy report output verified.');

// Branch detail performance test
const detailRes = await db.query(`select public.get_branch_performance_details('${branch1Id}', 'all_time') as res;`);
const details = detailRes.rows[0].res;
assert.equal(details.branch.name, 'Branch 1');
assert.equal(details.products_sold.length, 1);
assert.equal(details.transfer_discrepancies.length, 1);
assert.equal(details.return_discrepancies.length, 1);
assert.equal(details.recent_transfers.length, 1);
assert.equal(details.recent_returns.length, 1);
console.log('✓ Branch Performance Details verified.');

console.log('\n--- ALL MILESTONE 8 TESTS PASSED SUCCESSFULLY! ---');
