import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const { requiresRemittanceCount, buildFinalizePayload } = loadTs('src/features/shifts/remittanceProducts.ts');
const migration = '20261110120000_remittance_idle_product_counts.sql';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema public,auth to authenticated; grant execute on function auth.uid() to authenticated;`);
for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f < migration).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}
const id = n => `71100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cashier = id(1), otherCashier = id(2), branch = id(10), otherBranch = id(11);
const idle = id(20), oldZero = id(21), carried = id(22), soldOut = id(23), purchased = id(24), netZero = id(25), unexpected = id(26);
const all = [idle, oldZero, carried, soldOut, purchased, netZero, unexpected];
await db.exec(`insert into auth.users values ('${cashier}','a@test'),('${otherCashier}','b@test');
  insert into public.branches(id,name,code) values ('${branch}','Booth A','RA'),('${otherBranch}','Booth B','RB');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${cashier}','Cashier A','cashier','${branch}'),('${otherCashier}','Cashier B','cashier','${otherBranch}');`);
for (const [i, product] of all.entries()) {
  await db.query(`insert into public.products(id,name,sku,selling_price,closing_stock_behavior)
    values ($1,$2,$3,10,'keep_at_branch')`, [product, `Product ${i}`, `RP-${i}`]);
  await db.query('insert into public.branch_products(branch_id,product_id,selling_price) values ($1,$2,10)', [branch, product]);
}
await db.exec(`insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
  ('${branch}','${oldZero}',0),('${branch}','${carried}',5);
  set role authenticated; select set_config('request.jwt.claim.sub','${cashier}',false);`);
const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
await db.exec('reset role');
await db.exec(`insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
  ('${branch}','${soldOut}',2),('${branch}','${purchased}',3),('${branch}','${netZero}',0),('${branch}','${unexpected}',1);
  insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by) values
  ('${branch}','${soldOut}','transfer_in',2,'stock_transfer','${id(50)}','${cashier}'),
  ('${branch}','${purchased}','adjustment',3,'local_purchase','${id(51)}','${cashier}'),
  ('${branch}','${netZero}','adjustment',3,'adjustment','${id(52)}','${cashier}'),
  ('${branch}','${netZero}','adjustment',-3,'adjustment','${id(53)}','${cashier}'),
  ('${otherBranch}','${idle}','adjustment',1,'adjustment','${id(54)}','${otherCashier}');
  set role authenticated;`);
await db.query('select public.confirm_sale($1,$2::jsonb,20,$3)', [shift, JSON.stringify([{ product_id: soldOut, quantity: 2 }]), 'remittance-sold-out-test-key']);
const legacy = (await db.query('select public.begin_cashier_shift_close($1) p', [shift])).rows[0].p;
assert.equal(legacy.products.length, all.length);
assert.ok(legacy.products.every(requiresRemittanceCount), 'new app stays conservative against an old preview');
await db.exec('reset role');
const baselinesBefore = (await db.query('select * from public.shift_product_close_baselines order by product_id')).rows;
await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
assert.deepEqual((await db.query('select * from public.shift_product_close_baselines order by product_id')).rows, baselinesBefore,
  'migration must not rewrite existing pending baselines');
await db.exec('set role authenticated');
const preview = (await db.query('select public.get_my_pending_shift_reconciliation() p')).rows[0].p;
const byId = new Map(preview.products.map(p => [p.product_id, p]));
assert.equal(byId.get(idle).requires_count, false, 'assigned-only product absent; another branch movement does not count');
assert.equal(byId.get(oldZero).requires_count, false, 'old empty inventory row absent');
for (const product of [carried, soldOut, purchased, netZero, unexpected]) {
  assert.equal(byId.get(product).requires_count, true, `stock/activity must remain visible: ${product}`);
}
assert.equal(byId.get(soldOut).system_balance_before_waste, 0);
assert.equal(byId.get(netZero).adjustment_quantity, 0, 'net zero movements still require physical count');
assert.deepEqual(preview.products.filter(requiresRemittanceCount).map(p => p.product_id).sort(), [carried, soldOut, purchased, netZero, unexpected].sort());
const counts = Object.fromEntries(preview.products.filter(requiresRemittanceCount).map(p => [p.product_id, { actualRemaining: String(p.system_balance_before_waste), wasteQuantity: '0' }]));
const payload = buildFinalizePayload(preview.products, counts);
assert.equal(payload.length, all.length, 'retain the complete finalization contract');
assert.deepEqual(payload.find(p => p.product_id === idle), { product_id: idle, actual_remaining: '0' });
assert.equal(requiresRemittanceCount({ ...byId.get(idle), received_quantity: 2 }), true, 'contradictory metadata must not hide activity');
assert.equal(requiresRemittanceCount({ ...byId.get(idle), opening_quantity: null }), true, 'unknown quantities must not be assumed zero');
await assert.rejects(db.query('select public.build_shift_close_preview((select s from public.shifts s where id=$1))', [shift]), /permission denied/);
await db.exec(`select set_config('request.jwt.claim.sub','${otherCashier}',false)`);
assert.equal((await db.query('select public.get_my_pending_shift_reconciliation() p')).rows[0].p, null);
await assert.rejects(db.query('select public.finalize_cashier_shift_reconciliation($1,20::text,$2::jsonb)', [shift, JSON.stringify(payload)]), /access|authorized/i);
await db.exec(`select set_config('request.jwt.claim.sub','${cashier}',false)`);
// The unmatched current stock is deliberately visible and finalization still refuses inconsistent stock.
await assert.rejects(db.query('select public.finalize_cashier_shift_reconciliation($1,20::text,$2::jsonb)', [shift, JSON.stringify(payload)]), /changed unexpectedly|system stock/i);
await db.exec(`reset role; update public.branch_inventory set quantity_on_hand=0 where branch_id='${branch}' and product_id='${unexpected}'; set role authenticated;`);
const result = (await db.query('select public.finalize_cashier_shift_reconciliation($1,20::text,$2::jsonb) r', [shift, JSON.stringify(payload)])).rows[0].r;
const replay = (await db.query('select public.finalize_cashier_shift_reconciliation($1,20::text,$2::jsonb) r', [shift, JSON.stringify(payload)])).rows[0].r;
assert.equal(replay.idempotent, true);
assert.deepEqual({ ...replay, idempotent: false }, result, 'duplicate finalization preserves the saved result');
await db.exec('reset role');
assert.equal((await db.query("select count(*)::int n from public.inventory_movements where product_id in ($1,$2) and branch_id=$3", [idle, oldZero, branch])).rows[0].n, 0);
assert.equal((await db.query('select count(*)::int n from public.stock_returns')).rows[0].n, 0, 'omitting idle products does not create physical returns');
assert.deepEqual((await db.query('select * from public.shift_product_close_baselines order by product_id')).rows, baselinesBefore);
await db.query('insert into public.branch_products(branch_id,product_id,selling_price) values ($1,$2,10)', [otherBranch, idle]);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${otherCashier}',false)`);
const emptyShift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
const emptyPreview = (await db.query('select public.begin_cashier_shift_close($1) p', [emptyShift])).rows[0].p;
assert.equal(emptyPreview.products.length, 1);
assert.equal(emptyPreview.products[0].requires_count, false, 'pre-shift activity does not require a count this shift');
const emptyPayload = buildFinalizePayload(emptyPreview.products, {});
const emptyResult = (await db.query('select public.finalize_cashier_shift_reconciliation($1,0::text,$2::jsonb) r', [emptyShift, JSON.stringify(emptyPayload)])).rows[0].r;
assert.equal(emptyResult.actual_cash, 0, 'all-idle shift can complete with cash only in the UI');
await db.close();
console.log('Remittance idle products passed: old pending shifts, activity/carry-over/sold-out/zero-net preservation, complete payload, authorization, rollback, and idempotency.');


