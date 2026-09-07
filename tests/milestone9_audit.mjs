/**
 * Milestone 9 — Audit Logs Verification Test
 *
 * Applies all migrations to a local in-memory database and verifies:
 * 1. Audit log table/RLS/RPC structure
 * 2. Owner-only authorization enforcement
 * 3. Direct INSERT/UPDATE/DELETE tamper rejection
 * 4. Audit entries created by business operations
 * 5. Actor identity from trusted context (never from client)
 * 6. Snapshot fields preserved correctly
 * 7. Pagination shape correct
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import postgres from 'postgres';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Read connection string from supabase CLI
import { execSync } from 'child_process';

const DB_URL = (() => {
  try {
    const out = execSync('npx supabase db url', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    return out.trim();
  } catch {
    return process.env.DATABASE_URL ?? '';
  }
})();

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

function readMigrations() {
  return [
    '20260904130000_milestone_1_foundation.sql',
    '20260904160000_milestone_2_inventory_transfers.sql',
    '20260906090000_milestone_3_cashier_shifts.sql',
    '20260906100000_milestone_3_5_employee_management.sql',
    '20260906110000_sale_movement_type.sql',
    '20260906110100_milestone_4_sales.sql',
    '20260906120000_return_movement_type.sql',
    '20260906120100_milestone_5_returns.sql',
    '20260906120200_return_in_movement_type.sql',
    '20260906130000_milestone_6_return_receiving.sql',
    '20260906140000_milestone_7_sales_shifts_reports.sql',
    '20260907100000_milestone_8_branch_performance_reconciliation.sql',
    '20260908090000_milestone_9_audit_logs.sql',
  ].map((f) => ({
    name: f,
    sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'),
  }));
}

const OWNER_ID   = '10000000-0000-4000-8000-000000000001';
const MANAGER_ID = '10000000-0000-4000-8000-000000000002';
const CASHIER_ID = '10000000-0000-4000-8000-000000000003';
const MAIN_BRANCH_ID   = '20000000-0000-4000-8000-000000000001';
const BRANCH_ID        = '20000000-0000-4000-8000-000000000002';
const PRODUCT_ID       = '30000000-0000-4000-8000-000000000001';

async function withDb(fn) {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    await fn(sql);
  } finally {
    await sql.end();
  }
}

async function applyMigrations(sql) {
  // Reset schema for clean test
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;
  await sql`grant all on schema public to postgres, anon, authenticated, service_role`;

  const migrations = readMigrations();
  for (const m of migrations) {
    console.log(`Applying ${m.name}...`);
    await sql.unsafe(m.sql);
  }
}

async function seedBaseData(sql) {
  // Insert auth users
  await sql.unsafe(`
    insert into auth.users(id, email, role)
    values
      ('${OWNER_ID}',   'owner@test.com',   'authenticated'),
      ('${MANAGER_ID}', 'manager@test.com', 'authenticated'),
      ('${CASHIER_ID}', 'cashier@test.com', 'authenticated')
    on conflict do nothing;
  `);

  // Branches
  await sql.unsafe(`
    insert into public.branches(id, name, code, is_main_branch, is_active)
    values
      ('${MAIN_BRANCH_ID}', 'Main Branch', 'MAIN', true, true),
      ('${BRANCH_ID}',      'Branch 1',    'BR1',  false, true)
    on conflict do nothing;
  `);

  // Profiles
  await sql.unsafe(`
    insert into public.profiles(id, full_name, role, branch_id, is_active)
    values
      ('${OWNER_ID}',   'Test Owner',   'owner',   null,         true),
      ('${MANAGER_ID}', 'Test Manager', 'manager', '${BRANCH_ID}', true),
      ('${CASHIER_ID}', 'Test Cashier', 'cashier', '${BRANCH_ID}', true)
    on conflict do nothing;
  `);

  // Product
  await sql.unsafe(`
    insert into public.products(id, name, sku, selling_price, is_active)
    values ('${PRODUCT_ID}', 'Test Product', 'TEST-001', 100.00, true)
    on conflict do nothing;
  `);
}

async function setRole(sql, userId) {
  await sql.unsafe(`select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true)`);
  await sql.unsafe(`set role authenticated`);
}

async function resetRole(sql) {
  await sql.unsafe(`reset role`);
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('\n--- Starting Milestone 9 Audit Log Verification ---\n');

await withDb(async (sql) => {
  await applyMigrations(sql);
  await seedBaseData(sql);

  // =========================================================================
  // Test 1: RLS — Owner can read audit_logs, Manager/Cashier cannot
  // =========================================================================
  console.log('Testing RLS authorization...');

  // Insert a test audit entry as superuser
  await sql.unsafe(`
    insert into public.audit_logs(actor_user_id, actor_name_snapshot, actor_role_snapshot, action, entity_type)
    values ('${OWNER_ID}', 'Test Owner', 'owner', 'product_created', 'product')
  `);

  // Owner can read
  await setRole(sql, OWNER_ID);
  const [ownerRead] = await sql.unsafe(`select count(*) from public.audit_logs`);
  assert(parseInt(ownerRead.count) >= 1, 'Owner can read audit_logs');
  await resetRole(sql);

  // Manager cannot read
  await setRole(sql, MANAGER_ID);
  const [managerRead] = await sql.unsafe(`select count(*) from public.audit_logs`);
  assert(parseInt(managerRead.count) === 0, 'Manager cannot read audit_logs (RLS blocks)');
  await resetRole(sql);

  // Cashier cannot read
  await setRole(sql, CASHIER_ID);
  const [cashierRead] = await sql.unsafe(`select count(*) from public.audit_logs`);
  assert(parseInt(cashierRead.count) === 0, 'Cashier cannot read audit_logs (RLS blocks)');
  await resetRole(sql);

  // =========================================================================
  // Test 2: Tamper-resistance — direct INSERT rejected for authenticated users
  // =========================================================================
  console.log('Testing tamper-resistance...');

  await setRole(sql, MANAGER_ID);
  let insertRejected = false;
  try {
    await sql.unsafe(`
      insert into public.audit_logs(actor_user_id, actor_name_snapshot, actor_role_snapshot, action, entity_type)
      values ('${MANAGER_ID}', 'Hacker', 'owner', 'employee_created', 'employee')
    `);
  } catch {
    insertRejected = true;
  }
  assert(insertRejected, 'Direct INSERT into audit_logs rejected for authenticated user');
  await resetRole(sql);

  // Test UPDATE tamper
  await setRole(sql, OWNER_ID);
  let updateRejected = false;
  try {
    await sql.unsafe(`update public.audit_logs set actor_name_snapshot = 'Tampered'`);
  } catch {
    updateRejected = true;
  }
  assert(updateRejected, 'UPDATE on audit_logs rejected (immutable trigger)');

  // Test DELETE tamper
  let deleteRejected = false;
  try {
    await sql.unsafe(`delete from public.audit_logs`);
  } catch {
    deleteRejected = true;
  }
  assert(deleteRejected, 'DELETE on audit_logs rejected (immutable trigger)');
  await resetRole(sql);

  // =========================================================================
  // Test 3: Product trigger creates audit entries
  // =========================================================================
  console.log('Testing product audit trigger...');

  await setRole(sql, OWNER_ID);
  const productId2 = '30000000-0000-4000-8000-000000000002';

  // INSERT → product_created
  await sql.unsafe(`
    insert into public.products(id, name, sku, selling_price, is_active)
    values ('${productId2}', 'Audit Product', 'AUDIT-001', 50.00, true)
  `);

  const [createdEntry] = await sql.unsafe(`
    select * from public.audit_logs where action = 'product_created' and entity_id = '${productId2}'::uuid
  `);
  assert(createdEntry !== undefined, 'product_created audit entry created on INSERT');
  assert(createdEntry?.actor_name_snapshot === 'Test Owner', 'Actor name snapshot correct for product_created');

  // UPDATE selling_price → product_price_changed
  await sql.unsafe(`update public.products set selling_price = 75.00 where id = '${productId2}'`);
  const [priceEntry] = await sql.unsafe(`
    select * from public.audit_logs where action = 'product_price_changed' and entity_id = '${productId2}'::uuid
  `);
  assert(priceEntry !== undefined, 'product_price_changed audit entry created on price update');
  assert.equal(Number(priceEntry.metadata?.old_price), 50, 'product_price_changed records the historical old price');
  assert.equal(Number(priceEntry.metadata?.new_price), 75, 'product_price_changed records the authoritative new price');

  // UPDATE name → product_updated (not product_price_changed)
  await sql.unsafe(`update public.products set name = 'Updated Product' where id = '${productId2}'`);
  const [updatedEntry] = await sql.unsafe(`
    select * from public.audit_logs where action = 'product_updated' and entity_id = '${productId2}'::uuid
  `);
  assert(updatedEntry !== undefined, 'product_updated audit entry created on name update');

  // Only one price_changed entry (no duplicates)
  const [{ count: priceCount }] = await sql.unsafe(`
    select count(*) from public.audit_logs where action = 'product_price_changed' and entity_id = '${productId2}'::uuid
  `);
  assert(parseInt(priceCount) === 1, 'No duplicate product_price_changed entries');

  await resetRole(sql);

  // =========================================================================
  // Test 4: owner_update_employee audit
  // =========================================================================
  console.log('Testing employee update audit...');

  await setRole(sql, OWNER_ID);
  await sql.unsafe(`
    select public.owner_update_employee('${CASHIER_ID}', 'Updated Cashier', 'cashier', '${BRANCH_ID}', true)
  `);
  const [empUpdated] = await sql.unsafe(`
    select * from public.audit_logs where action = 'employee_updated' and entity_id = '${CASHIER_ID}'::uuid
  `);
  assert(empUpdated !== undefined, 'employee_updated audit entry created');

  // Deactivate → employee_deactivated
  await sql.unsafe(`
    select public.owner_update_employee('${CASHIER_ID}', 'Updated Cashier', 'cashier', '${BRANCH_ID}', false)
  `);
  const [empDeactivated] = await sql.unsafe(`
    select * from public.audit_logs where action = 'employee_deactivated' and entity_id = '${CASHIER_ID}'::uuid
  `);
  assert(empDeactivated !== undefined, 'employee_deactivated audit entry created');

  // Reactivate for remaining tests
  await sql.unsafe(`
    select public.owner_update_employee('${CASHIER_ID}', 'Test Cashier', 'cashier', '${BRANCH_ID}', true)
  `);
  await resetRole(sql);

  // =========================================================================
  // Test 5: initialize_main_branch_inventory → inventory_adjusted
  // =========================================================================
  console.log('Testing inventory_adjusted audit...');

  await setRole(sql, OWNER_ID);
  await sql.unsafe(`
    select public.initialize_main_branch_inventory('[{"product_id":"${PRODUCT_ID}","quantity":100}]'::jsonb, null)
  `);
  const [invAdjusted] = await sql.unsafe(`
    select * from public.audit_logs where action = 'inventory_adjusted' and entity_id = '${PRODUCT_ID}'::uuid
  `);
  assert(invAdjusted !== undefined, 'inventory_adjusted audit entry created');
  await resetRole(sql);

  // =========================================================================
  // Test 6: send_stock_transfer → transfer_created
  // =========================================================================
  console.log('Testing transfer_created audit...');

  await setRole(sql, OWNER_ID);
  const idempKey = 'test-transfer-key-' + Date.now();
  const [[{ send_stock_transfer: transferId }]] = await sql.unsafe(`
    select public.send_stock_transfer(
      '${BRANCH_ID}'::uuid,
      '[{"product_id":"${PRODUCT_ID}","quantity_sent":10}]'::jsonb,
      null,
      '${idempKey}'
    )
  `);
  assert(transferId !== undefined, 'Transfer created successfully');

  const [transferCreated] = await sql.unsafe(`
    select * from public.audit_logs where action = 'transfer_created' and entity_id = '${transferId}'::uuid
  `);
  assert(transferCreated !== undefined, 'transfer_created audit entry created');
  assert(transferCreated?.actor_name_snapshot === 'Test Owner', 'transfer_created actor name snapshot correct');
  await resetRole(sql);

  // =========================================================================
  // Test 7: Shift start/end + sale_completed audit
  // =========================================================================
  console.log('Testing shift and sale audits...');

  await setRole(sql, CASHIER_ID);
  const [[{ start_cashier_shift: shiftId }]] = await sql.unsafe(`select public.start_cashier_shift()`);
  assert(shiftId !== undefined, 'Shift started successfully');

  const [shiftStarted] = await sql.unsafe(`
    select * from public.audit_logs where action = 'shift_started' and entity_id = '${shiftId}'::uuid
  `);
  assert(shiftStarted !== undefined, 'shift_started audit entry created');
  assert(shiftStarted?.actor_name_snapshot === 'Test Cashier', 'shift_started actor name snapshot correct');
  assert(shiftStarted?.actor_role_snapshot === 'cashier', 'shift_started actor role snapshot correct');

  // Confirm a sale
  const saleKey = 'test-sale-key-' + Date.now();
  await sql.unsafe(`
    select public.confirm_sale(
      '${shiftId}'::uuid,
      '[{"product_id":"${PRODUCT_ID}","quantity":2}]'::jsonb,
      250.00,
      '${saleKey}'
    )
  `);
  const [saleCompleted] = await sql.unsafe(`
    select * from public.audit_logs where action = 'sale_completed'
    order by created_at desc limit 1
  `);
  assert(saleCompleted !== undefined, 'sale_completed audit entry created');

  // End shift
  await sql.unsafe(`select public.end_cashier_shift('${shiftId}'::uuid)`);
  const [shiftEnded] = await sql.unsafe(`
    select * from public.audit_logs where action = 'shift_ended' and entity_id = '${shiftId}'::uuid
  `);
  assert(shiftEnded !== undefined, 'shift_ended audit entry created');
  await resetRole(sql);

  // =========================================================================
  // Test 8: list_audit_logs RPC pagination shape
  // =========================================================================
  console.log('Testing list_audit_logs RPC...');

  await setRole(sql, OWNER_ID);
  const [[{ list_audit_logs: auditPage }]] = await sql.unsafe(`
    select public.list_audit_logs(0, 5, null, null, null, null, 'all_time', null, null)
  `);
  assert(typeof auditPage === 'object', 'list_audit_logs returns object');
  assert(Array.isArray(auditPage.items), 'list_audit_logs.items is array');
  assert(typeof auditPage.has_more === 'boolean', 'list_audit_logs.has_more is boolean');
  assert(typeof auditPage.total === 'number', 'list_audit_logs.total is number');
  assert(auditPage.items.length <= 5, 'list_audit_logs respects page_size');
  assert(auditPage.items.every(i => i.actor_name_snapshot !== undefined), 'All items have actor_name_snapshot');
  await resetRole(sql);

  // =========================================================================
  // Test 9: Manager cannot call list_audit_logs
  // =========================================================================
  console.log('Testing list_audit_logs Manager rejection...');

  await setRole(sql, MANAGER_ID);
  let managerAuditRejected = false;
  try {
    await sql.unsafe(`select public.list_audit_logs(0, 10, null, null, null, null, 'all_time', null, null)`);
  } catch {
    managerAuditRejected = true;
  }
  assert(managerAuditRejected, 'list_audit_logs rejects Manager');
  await resetRole(sql);

  // =========================================================================
  // Test 10: Atomicity — rollback of business op rolls back audit
  // =========================================================================
  console.log('Testing atomicity...');

  await setRole(sql, OWNER_ID);
  const countBefore = parseInt((await sql.unsafe(`select count(*) from public.audit_logs where action = 'transfer_created'`))[0].count);

  try {
    await sql.begin(async (tx) => {
      // This will fail because PRODUCT_ID inventory was reduced; force failure with bad branch
      await tx.unsafe(`
        select public.send_stock_transfer(
          '${MAIN_BRANCH_ID}'::uuid,
          '[{"product_id":"${PRODUCT_ID}","quantity_sent":1}]'::jsonb,
          null,
          'invalid-key-that-will-fail-ok'
        )
      `);
    });
  } catch {
    // Expected failure
  }

  const countAfter = parseInt((await sql.unsafe(`select count(*) from public.audit_logs where action = 'transfer_created'`))[0].count);
  assert(countAfter === countBefore, 'Failed business operation does not create orphan audit entry');
  await resetRole(sql);

  // =========================================================================
  // Final summary
  // =========================================================================
  console.log(`\n--- MILESTONE 9 VERIFICATION COMPLETE ---`);
  console.log(`Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) {
    console.error('\n⚠ Some tests failed.');
    process.exit(1);
  } else {
    console.log('\n✓ ALL MILESTONE 9 AUDIT TESTS PASSED SUCCESSFULLY!');
  }
});
