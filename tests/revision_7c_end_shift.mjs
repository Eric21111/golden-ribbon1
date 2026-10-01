import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationsDir = 'supabase/migrations';
const allMigrations = readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort();
const stripCrypto = (sql) => sql.replace(/create extension if not exists pgcrypto;/g, '');

async function boot() {
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
  for (const file of allMigrations) {
    await db.exec(stripCrypto(readFileSync(`${migrationsDir}/${file}`, 'utf8')));
  }
  return db;
}

const id = (n) => `28150000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seed(db, { keep = true } = {}) {
  const owner = id(1);
  const mainMgr = id(2);
  const cashier = id(3);
  const main = id(10);
  const branch = id(11);
  const drink = id(20);
  const meal = id(21);

  await db.exec(`
    insert into auth.users values
      ('${owner}','o@test'),('${mainMgr}','m@test'),('${cashier}','c@test');
    insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
      ('${main}','Main','MAIN',true,true,'counted'),
      ('${branch}','Branch 1','B1',false,true,'cashier_confirm');
    insert into public.profiles(id,full_name,role,branch_id) values
      ('${owner}','Owner','owner',null),
      ('${mainMgr}','Main Manager','manager','${main}'),
      ('${cashier}','Cashier','cashier','${branch}');
    insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
      ('${drink}','Drink','DRINK',25,true,'piece_stock','keep_at_branch'),
      ('${meal}','Meal','MEAL',80,true,'piece_stock','${keep ? 'record_as_unsold' : 'keep_at_branch'}');
    insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
      ('${branch}','${drink}',25,true),('${branch}','${meal}',80,true);
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      ('${main}','${drink}',100),('${main}','${meal}',100),
      ('${branch}','${drink}',10),('${branch}','${meal}',5);
  `);
  return { owner, mainMgr, cashier, main, branch, drink, meal };
}

const asUser = async (db, userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const qty = async (db, branchId, productId) =>
  Number(
    (
      await db.query(
        'select coalesce(quantity_on_hand,0) q from public.branch_inventory where branch_id=$1 and product_id=$2',
        [branchId, productId],
      )
    ).rows[0]?.q ?? 0,
  );

const startShift = (db, cashier) =>
  asUser(db, cashier, () => db.query('select public.start_cashier_shift() id')).then((r) => r.rows[0].id);

const beginClose = (db, cashier, shiftId) =>
  asUser(db, cashier, () => db.query('select public.begin_cashier_shift_close($1) preview', [shiftId])).then(
    (r) => r.rows[0].preview,
  );

const finalize = (db, cashier, shiftId, actualCash, products) =>
  asUser(db, cashier, () =>
    db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb) result', [
      shiftId,
      actualCash,
      JSON.stringify(products),
    ]),
  ).then((r) => r.rows[0].result);

// Static guards
{
  assert.ok(existsSync('supabase/migrations/20260928150000_revision_7c_close_baselines_and_lifecycle.sql'));
  assert.ok(existsSync('supabase/migrations/20260928150100_revision_7c_freeze_and_close_rpcs.sql'));
  const mig = readFileSync('supabase/migrations/20260928150100_revision_7c_freeze_and_close_rpcs.sql', 'utf8');
  assert.match(mig, /begin_cashier_shift_close/);
  assert.match(mig, /finalize_cashier_shift_reconciliation/);
  assert.match(mig, /Use finalize cashier shift reconciliation/);
  assert.doesNotMatch(mig, /create or replace function public\.close_cashier_shift/);
  console.log('7C static migration guards: ok');
}

// Core begin + freeze + finalize keep/unsold + cash
{
  const db = await boot();
  const ctx = await seed(db);
  const shiftId = await startShift(db, ctx.cashier);

  // Sale before close
  await asUser(db, ctx.cashier, () =>
    db.query('select * from public.confirm_sale($1,$2::jsonb,$3,$4)', [
      shiftId,
      JSON.stringify([{ product_id: ctx.drink, quantity: '2' }]),
      50,
      '7c-sale-before-00000001',
    ]),
  );
  assert.equal(await qty(db, ctx.branch, ctx.drink), 8);

  const preview = await beginClose(db, ctx.cashier, shiftId);
  assert.ok(preview.sales_cutoff_at);
  assert.equal(preview.status, 'pending');
  assert.ok(Array.isArray(preview.products));
  assert.ok(preview.products.length >= 2);

  // Irreversible: still closed; second begin returns preview
  const preview2 = await beginClose(db, ctx.cashier, shiftId);
  assert.equal(preview2.shift_id, shiftId);

  const shiftRow = (
    await db.query(
      `select status::text s, inventory_reconciliation_required inv, reconciliation_required cash
       from public.shifts where id=$1`,
      [shiftId],
    )
  ).rows[0];
  assert.equal(shiftRow.s, 'closed');
  assert.equal(shiftRow.inv, true);
  assert.equal(shiftRow.cash, true);

  // Mutators rejected after cutoff
  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () =>
        db.query('select * from public.confirm_sale($1,$2::jsonb,$3,$4)', [
          shiftId,
          JSON.stringify([{ product_id: ctx.drink, quantity: '1' }]),
          25,
          '7c-sale-after-000000001',
        ]),
      /frozen|open shift|required/i,
    ),
  );

  // Transfer receive rejected while pending
  const xfer = await asUser(db, ctx.mainMgr, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
      ctx.branch,
      JSON.stringify([{ product_id: ctx.drink, quantity_sent: '1' }]),
      null,
      '7c-xfer-pending-0000001',
    ]),
  );
  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () => db.query('select public.confirm_shipment_arrival($1,$2)', [xfer.rows[0].id, '7c-arrive-frozen-000001']),
      /frozen/i,
    ),
  );
  // Transfer remains pending
  const xferStatus = (
    await db.query(`select status::text s from public.stock_transfers where id=$1`, [xfer.rows[0].id])
  ).rows[0].s;
  assert.equal(xferStatus, 'pending_receipt');

  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () =>
        db.query('select public.create_stock_return($1::jsonb,$2,$3)', [
          JSON.stringify([{ product_id: ctx.drink, quantity_returned: 1 }]),
          'nope',
          '7c-return-frozen-0000001',
        ]),
      /frozen/i,
    ),
  );

  // No new shift while pending
  await asUser(db, ctx.cashier, () =>
    assert.rejects(() => db.query('select public.start_cashier_shift()'), /pending inventory|frozen|Complete pending/i),
  );

  // Product edit after cutoff must not change baseline behavior
  await asUser(db, ctx.mainMgr, () =>
    db.query(
      'select * from public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11)',
      [ctx.meal, 'Meal', 'MEAL', null, true, '[]', '[]', '[]', '80', null, 'keep_at_branch'],
    ),
  );
  const baselineBehavior = (
    await db.query(
      `select closing_stock_behavior::text b from public.shift_product_close_baselines
       where shift_id=$1 and product_id=$2`,
      [shiftId, ctx.meal],
    )
  ).rows[0].b;
  assert.equal(baselineBehavior, 'record_as_unsold');

  const drinkPrev = preview.products.find((p) => p.product_id === ctx.drink);
  const mealPrev = preview.products.find((p) => p.product_id === ctx.meal);
  assert.equal(Number(drinkPrev.system_balance_before_waste), 8);
  assert.equal(Number(mealPrev.system_balance_before_waste), 5);

  const result = await finalize(db, ctx.cashier, shiftId, '50.00', [
    { product_id: ctx.drink, actual_remaining: '8', waste_quantity: '0' },
    { product_id: ctx.meal, actual_remaining: '5', waste_quantity: '0' },
  ]);
  assert.equal(result.result, 'exact');
  assert.equal(Number(result.expected_cash), 50);
  assert.equal(Number(result.actual_cash), 50);
  assert.equal(Number(result.difference), 0);
  assert.equal(await qty(db, ctx.branch, ctx.drink), 8); // keep_at_branch
  assert.equal(await qty(db, ctx.branch, ctx.meal), 0); // record_as_unsold

  // Idempotent retry
  const again = await finalize(db, ctx.cashier, shiftId, '50.00', [
    { product_id: ctx.drink, actual_remaining: 8, waste_quantity: 0 },
    { product_id: ctx.meal, actual_remaining: 5 },
  ]);
  assert.equal(again.idempotent, true);

  // Conflicting retry
  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () =>
        db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb)', [
          shiftId,
          '40.00',
          JSON.stringify([
            { product_id: ctx.drink, actual_remaining: '8', waste_quantity: '0' },
            { product_id: ctx.meal, actual_remaining: '5', waste_quantity: '0' },
          ]),
        ]),
      /already been reconciled|different/i,
    ),
  );

  // Post-finalize same-day freeze (mutators + new shift)
  await asUser(db, ctx.cashier, () =>
    assert.rejects(() => db.query('select public.start_cashier_shift()'), /final close|business day|frozen/i),
  );
  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () => db.query('select public.confirm_shipment_arrival($1,$2)', [xfer.rows[0].id, '7c-arrive-sameday-00001']),
      /frozen/i,
    ),
  );

  console.log('7C begin/finalize/freeze/idempotency: ok');
}

// Next-day resume via fresh DB with old finalized shift dated yesterday
{
  const db = await boot();
  const ctx = await seed(db);
  const shiftId = await startShift(db, ctx.cashier);
  await beginClose(db, ctx.cashier, shiftId);
  const preview = (
    await asUser(db, ctx.cashier, () => db.query('select public.get_my_pending_shift_reconciliation() p'))
  ).rows[0].p;
  assert.ok(preview);
  assert.equal(preview.shift_id, shiftId);

  const products = preview.products.map((p) => ({
    product_id: p.product_id,
    actual_remaining: String(p.system_balance_before_waste),
    waste_quantity: '0',
  }));
  await finalize(db, ctx.cashier, shiftId, '0.00', products);

  // Bypass lifecycle by recreating "yesterday" finalized shift markers using service role tricks:
  // Disable trigger, rewrite dates, re-enable.
  await db.exec(`alter table public.shifts disable trigger shifts_protect_lifecycle`);
  await db.exec(`
    update public.shifts
    set started_at = ((timezone('Asia/Manila', now())::date - 1) + time '10:00') at time zone 'Asia/Manila',
        sales_cutoff_at = ((timezone('Asia/Manila', now())::date - 1) + time '20:00') at time zone 'Asia/Manila',
        ended_at = ((timezone('Asia/Manila', now())::date - 1) + time '20:00') at time zone 'Asia/Manila'
    where id = '${shiftId}';
  `);
  await db.exec(`alter table public.shifts enable trigger shifts_protect_lifecycle`);

  const newShift = await startShift(db, ctx.cashier);
  assert.ok(newShift);
  assert.notEqual(newShift, shiftId);
  console.log('7C pending resume + next-day start: ok');
}

// Waste > B edge case + cash shortage/excess + mixed
{
  const db = await boot();
  const ctx = await seed(db);
  // Set meal stock to 5
  await db.exec(`update public.branch_inventory set quantity_on_hand=5 where branch_id='${ctx.branch}' and product_id='${ctx.meal}'`);
  await db.exec(`update public.branch_inventory set quantity_on_hand=0 where branch_id='${ctx.branch}' and product_id='${ctx.drink}'`);
  const shiftId = await startShift(db, ctx.cashier);
  await beginClose(db, ctx.cashier, shiftId);

  // Only meal in universe with stock/opening; drink may still be in opening snapshot with 0
  const preview = (
    await asUser(db, ctx.cashier, () => db.query('select public.get_my_pending_shift_reconciliation() p'))
  ).rows[0].p;
  const products = preview.products.map((p) => {
    if (p.product_id === ctx.meal) {
      return { product_id: ctx.meal, actual_remaining: '0', waste_quantity: '10' };
    }
    return { product_id: p.product_id, actual_remaining: '0', waste_quantity: '0' };
  });

  const result = await finalize(db, ctx.cashier, shiftId, '10.00', products);
  assert.equal(result.result, 'excess'); // cash: expected 0, actual 10 → difference -10 excess
  assert.equal(Number(result.difference), -10);

  const mealRecon = (
    await db.query(
      `select expected_remaining, actual_remaining, discrepancy, result::text r, waste_quantity, unsold_quantity, carried_quantity
       from public.shift_product_reconciliations where shift_id=$1 and product_id=$2`,
      [shiftId, ctx.meal],
    )
  ).rows[0];
  assert.equal(Number(mealRecon.expected_remaining), -5);
  assert.equal(Number(mealRecon.actual_remaining), 0);
  assert.equal(Number(mealRecon.discrepancy), 5);
  assert.equal(mealRecon.r, 'excess');
  assert.equal(Number(mealRecon.waste_quantity), 10);
  assert.equal(await qty(db, ctx.branch, ctx.meal), 0);

  const wasteOcc = (
    await db.query(
      `select quantity from public.shift_waste_occurrences where shift_id=$1 and product_id=$2`,
      [shiftId, ctx.meal],
    )
  ).rows[0];
  assert.equal(Number(wasteOcc.quantity), 10);
  console.log('7C waste>B + cash excess: ok');
}

// Inventory shortage + cash shortage + omit product reject + duplicate reject
{
  const db = await boot();
  const ctx = await seed(db);
  const shiftId = await startShift(db, ctx.cashier);
  await beginClose(db, ctx.cashier, shiftId);
  const preview = (
    await asUser(db, ctx.cashier, () => db.query('select public.get_my_pending_shift_reconciliation() p'))
  ).rows[0].p;

  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () =>
        db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb)', [
          shiftId,
          '0',
          JSON.stringify([{ product_id: ctx.drink, actual_remaining: '10', waste_quantity: '0' }]),
        ]),
      /required for every close product/i,
    ),
  );

  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () =>
        db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb)', [
          shiftId,
          '0',
          JSON.stringify([
            ...preview.products.map((p) => ({
              product_id: p.product_id,
              actual_remaining: String(p.system_balance_before_waste),
              waste_quantity: '0',
            })),
            {
              product_id: preview.products[0].product_id,
              actual_remaining: '0',
              waste_quantity: '0',
            },
          ]),
        ]),
      /only once/i,
    ),
  );

  const shortageProducts = preview.products.map((p) => ({
    product_id: p.product_id,
    actual_remaining: String(Math.max(0, Number(p.system_balance_before_waste) - 1)),
    waste_quantity: '0',
  }));
  // Need a sale first for cash shortage — expected 0, pay 0 is exact. Create sale before close in new scenario.
  console.log('7C validation rejects: ok');
}

// Cash shortage with sale + inventory shortage
{
  const db = await boot();
  const ctx = await seed(db);
  const shiftId = await startShift(db, ctx.cashier);
  await asUser(db, ctx.cashier, () =>
    db.query('select * from public.confirm_sale($1,$2::jsonb,$3,$4)', [
      shiftId,
      JSON.stringify([{ product_id: ctx.drink, quantity: '1' }]),
      25,
      '7c-cash-short-sale-00001',
    ]),
  );
  await beginClose(db, ctx.cashier, shiftId);
  const preview = (
    await asUser(db, ctx.cashier, () => db.query('select public.get_my_pending_shift_reconciliation() p'))
  ).rows[0].p;
  const products = preview.products.map((p) => ({
    product_id: p.product_id,
    actual_remaining: String(Math.max(0, Number(p.system_balance_before_waste) - (p.product_id === ctx.drink ? 1 : 0))),
    waste_quantity: '0',
  }));
  const result = await finalize(db, ctx.cashier, shiftId, '10.00', products);
  assert.equal(result.result, 'shortage');
  assert.equal(Number(result.difference), 15);
  const drinkRecon = (
    await db.query(
      `select result::text r, discrepancy from public.shift_product_reconciliations where shift_id=$1 and product_id=$2`,
      [shiftId, ctx.drink],
    )
  ).rows[0];
  assert.equal(drinkRecon.r, 'shortage');
  assert.ok(Number(drinkRecon.discrepancy) < 0);
  console.log('7C cash+inventory shortage: ok');
}

// Auto-close parity
{
  const db = await boot();
  const ctx = await seed(db);
  const shiftId = await startShift(db, ctx.cashier);
  // Make shift overdue relative to 9pm logic by backdating started_at
  await db.exec(`alter table public.shifts disable trigger shifts_protect_lifecycle`);
  await db.exec(`
    update public.shifts
    set started_at = ((timezone('Asia/Manila', now())::date - 1) + time '10:00') at time zone 'Asia/Manila'
    where id='${shiftId}';
  `);
  await db.exec(`alter table public.shifts enable trigger shifts_protect_lifecycle`);

  const closed = (await db.query('select public.close_overdue_shifts() r')).rows[0].r;
  assert.ok(Number(closed.closed_count) >= 1);
  const row = (
    await db.query(
      `select status::text s, sales_cutoff_at is not null cut, inventory_reconciliation_required inv
       from public.shifts where id=$1`,
      [shiftId],
    )
  ).rows[0];
  assert.equal(row.s, 'closed');
  assert.equal(row.cut, true);
  assert.equal(row.inv, true);
  // No fabricated cash/product recon
  const cashCount = (
    await db.query(`select count(*)::int c from public.shift_reconciliations where shift_id=$1`, [shiftId])
  ).rows[0].c;
  assert.equal(cashCount, 0);
  const invCount = (
    await db.query(`select count(*)::int c from public.shift_product_reconciliations where shift_id=$1`, [shiftId])
  ).rows[0].c;
  assert.equal(invCount, 0);

  const preview = (
    await asUser(db, ctx.cashier, () => db.query('select public.get_my_pending_shift_reconciliation() p'))
  ).rows[0].p;
  assert.equal(preview.shift_id, shiftId);
  const products = preview.products.map((p) => ({
    product_id: p.product_id,
    actual_remaining: String(p.system_balance_before_waste),
    waste_quantity: '0',
  }));
  await finalize(db, ctx.cashier, shiftId, '0.00', products);
  console.log('7C auto-close parity: ok');
}

// Legacy cash-only path
{
  const db = await boot();
  const ctx = await seed(db);
  // Insert legacy closed shift without inventory flag / baselines
  const legacyShift = id(99);
  await db.exec(`
    insert into public.shifts(id,branch_id,cashier_id,status,started_at,ended_at,reconciliation_required,inventory_reconciliation_required)
    values ('${legacyShift}','${ctx.branch}','${ctx.cashier}','closed', now() - interval '2 hours', now() - interval '1 hour', true, false);
  `);
  const result = await asUser(db, ctx.cashier, () =>
    db.query('select public.reconcile_closed_shift($1,$2,$3::jsonb) r', [legacyShift, '0.00', '[]']),
  ).then((r) => r.rows[0].r);
  assert.equal(result.result, 'exact');
  assert.equal(result.status, 'reconciled');
  console.log('7C legacy cash-only: ok');
}

// Security: gate not executable; close_cashier_shift gone
{
  const db = await boot();
  const ctx = await seed(db);
  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () => db.query('select public.lock_branch_inventory_gate($1)', [ctx.branch]),
      /permission denied|does not exist|42501/i,
    ),
  );
  const closeExists = (
    await db.query(`
      select count(*)::int c from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='close_cashier_shift'
    `)
  ).rows[0].c;
  assert.equal(closeExists, 0);
  console.log('7C security/grants: ok');
}

// Expected-cash audit: no void/cancel/refund RPCs
{
  const db = await boot();
  const procs = (
    await db.query(`
      select p.proname from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and (
          p.proname ilike '%void%sale%'
          or p.proname ilike '%cancel%sale%'
          or p.proname ilike '%refund%sale%'
          or p.proname ilike '%delete%sale%'
        )
    `)
  ).rows;
  assert.equal(procs.length, 0);
  console.log('7C expected-cash mutation audit: no sale void/cancel/refund RPCs');
}

console.log('Revision 7C end-shift tests passed.');
console.log('Note: PGlite does not prove true parallel-session locking.');
