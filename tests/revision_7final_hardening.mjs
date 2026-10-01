import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationsDir = 'supabase/migrations';
const allMigrations = readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort();
const FINAL_MIG = '20260928150200_revision_7_final_audit_hardening.sql';
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

const id = (n) => `28150200-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seed(db) {
  const owner = id(1);
  const mainMgr = id(2);
  const cashier = id(3);
  const cashier2 = id(4);
  const main = id(10);
  const branch = id(11);
  const branch2 = id(12);
  const drink = id(20);
  const meal = id(21);

  await db.exec(`
    insert into auth.users values
      ('${owner}','o@test'),('${mainMgr}','m@test'),('${cashier}','c@test'),('${cashier2}','c2@test');
    insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
      ('${main}','Main','MAIN',true,true,'counted'),
      ('${branch}','Branch 1','B1',false,true,'cashier_confirm'),
      ('${branch2}','Branch 2','B2',false,true,'cashier_confirm');
    insert into public.profiles(id,full_name,role,branch_id) values
      ('${owner}','Owner','owner',null),
      ('${mainMgr}','Main Manager','manager','${main}'),
      ('${cashier}','Cashier','cashier','${branch}'),
      ('${cashier2}','Cashier Two','cashier','${branch}');
    insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
      ('${drink}','Drink','DRINK',25,true,'piece_stock','keep_at_branch'),
      ('${meal}','Meal','MEAL',80,true,'piece_stock','record_as_unsold');
    insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
      ('${branch}','${drink}',25,true),('${branch}','${meal}',80,true),
      ('${branch2}','${drink}',25,true),('${branch2}','${meal}',80,true);
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      ('${main}','${drink}',100),('${main}','${meal}',100),
      ('${branch}','${drink}',10),('${branch}','${meal}',5),
      ('${branch2}','${drink}',10),('${branch2}','${meal}',5);
  `);
  return { owner, mainMgr, cashier, cashier2, main, branch, branch2, drink, meal };
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

const ownerUpdate = (db, owner, employeeId, { fullName, role, branchId, isActive }) =>
  asUser(db, owner, () =>
    db.query('select public.owner_update_employee($1,$2,$3,$4,$5)', [
      employeeId,
      fullName,
      role,
      branchId,
      isActive,
    ]),
  );

// ---------------------------------------------------------------------------
// Static guards
// ---------------------------------------------------------------------------
{
  assert.ok(existsSync(`supabase/migrations/${FINAL_MIG}`));
  assert.ok(existsSync('docs/pcs-cutover-closing-behavior-review.sql'));
  const mig = readFileSync(`supabase/migrations/${FINAL_MIG}`, 'utf8');
  assert.match(mig, /shifts_one_open_per_branch_idx/);
  assert.match(mig, /lock_shift_inventory_gate/);
  assert.match(mig, /unfinished shift or remittance/i);
  assert.match(mig, /Another selling session is already active/i);
  assert.match(mig, /shift_close_product_summaries/);
  assert.doesNotMatch(mig, /for update skip locked/i);

  // Close cores must not call auto-selecting branch gate for target shift
  const beginBody = mig.slice(mig.indexOf('begin_shift_close_core'), mig.indexOf('finalize_cashier_shift_reconciliation'));
  const finalizeBody = mig.slice(
    mig.indexOf('finalize_cashier_shift_reconciliation'),
    mig.indexOf('close_overdue_shifts'),
  );
  assert.match(beginBody, /lock_shift_inventory_gate/);
  assert.doesNotMatch(beginBody, /lock_branch_inventory_gate/);
  assert.match(finalizeBody, /lock_shift_inventory_gate/);
  // After inventory lock in finalize mutating path, must not FOR UPDATE the target shift again
  const afterInv = finalizeBody.slice(finalizeBody.lastIndexOf('from public.branch_inventory bi'));
  assert.doesNotMatch(afterInv, /from public\.shifts[\s\S]{0,200}for update/i);
  assert.doesNotMatch(finalizeBody, /lock_branch_inventory_gate/);

  const models = readFileSync('src/types/models.ts', 'utf8');
  assert.match(models, /shift_product_reconciliation/);
  assert.match(models, /ShiftCloseBeginResult/);

  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /confirm_shipment_arrival/);
  assert.doesNotMatch(readme, /`receive_stock_transfer`: manager/);
  assert.match(readme, /does \*\*not\*\* restock Main usable inventory|does not restock Main/i);

  const cutoverSql = readFileSync('docs/pcs-cutover-closing-behavior-review.sql', 'utf8');
  assert.match(cutoverSql, /pcs_cutover_product_snapshots/);
  assert.match(cutoverSql, /assigned_closing_stock_behavior/);

  console.log('7final static guards: ok');
}

// ---------------------------------------------------------------------------
// One open selling session per branch
// ---------------------------------------------------------------------------
{
  const db = await boot();
  const ctx = await seed(db);
  const shiftA = await startShift(db, ctx.cashier);
  const again = await startShift(db, ctx.cashier);
  assert.equal(again, shiftA);

  await asUser(db, ctx.cashier2, () =>
    assert.rejects(() => db.query('select public.start_cashier_shift()'), /Another selling session/i),
  );

  await beginClose(db, ctx.cashier, shiftA);
  await finalize(db, ctx.cashier, shiftA, '0.00', [
    { product_id: ctx.drink, actual_remaining: '10', waste_quantity: '0' },
    { product_id: ctx.meal, actual_remaining: '5', waste_quantity: '0' },
  ]);

  // Same business day: still blocked by same-day finalized guard (not the other-cashier rule)
  await asUser(db, ctx.cashier2, () =>
    assert.rejects(() => db.query('select public.start_cashier_shift()'), /final close|business day|frozen/i),
  );

  // Move finalized close off today so a new session can open (test fixture only)
  await db.exec('alter table public.shifts disable trigger shifts_protect_lifecycle');
  await db.query(
    `update public.shifts
     set ended_at = ended_at - interval '2 days',
         sales_cutoff_at = sales_cutoff_at - interval '2 days',
         started_at = started_at - interval '2 days'
     where id = $1`,
    [shiftA],
  );
  await db.exec('alter table public.shifts enable trigger shifts_protect_lifecycle');

  const next = await startShift(db, ctx.cashier2);
  assert.ok(next);
  assert.notEqual(next, shiftA);
  console.log('7final one-open-per-branch: ok');
}

// ---------------------------------------------------------------------------
// Pending remittance employee-change guard
// ---------------------------------------------------------------------------
{
  const db = await boot();
  const ctx = await seed(db);
  const shiftId = await startShift(db, ctx.cashier);
  await beginClose(db, ctx.cashier, shiftId);

  await assert.rejects(
    () =>
      ownerUpdate(db, ctx.owner, ctx.cashier, {
        fullName: 'Cashier',
        role: 'cashier',
        branchId: ctx.branch2,
        isActive: true,
      }),
    /unfinished shift or remittance/i,
  );
  await assert.rejects(
    () =>
      ownerUpdate(db, ctx.owner, ctx.cashier, {
        fullName: 'Cashier',
        role: 'manager',
        branchId: ctx.main,
        isActive: true,
      }),
    /unfinished shift or remittance/i,
  );
  await assert.rejects(
    () =>
      ownerUpdate(db, ctx.owner, ctx.cashier, {
        fullName: 'Cashier',
        role: 'cashier',
        branchId: ctx.branch,
        isActive: false,
      }),
    /unfinished shift or remittance/i,
  );

  // Auto-close pending path
  const db2 = await boot();
  const ctx2 = await seed(db2);
  const openId = await startShift(db2, ctx2.cashier);
  await db2.exec('alter table public.shifts disable trigger shifts_protect_lifecycle');
  await db2.query(`update public.shifts set started_at = now() - interval '2 days' where id=$1`, [openId]);
  await db2.exec('alter table public.shifts enable trigger shifts_protect_lifecycle');
  await db2.query(`select public.close_overdue_shifts()`);
  const pending = (
    await db2.query(
      `select status::text s, reconciliation_required r, inventory_reconciliation_required i
       from public.shifts where id=$1`,
      [openId],
    )
  ).rows[0];
  assert.equal(pending.s, 'closed');
  assert.equal(pending.r, true);

  await assert.rejects(
    () =>
      ownerUpdate(db2, ctx2.owner, ctx2.cashier, {
        fullName: 'Cashier',
        role: 'cashier',
        branchId: ctx2.branch2,
        isActive: true,
      }),
    /unfinished shift or remittance/i,
  );

  await finalize(db2, ctx2.cashier, openId, '0.00', [
    { product_id: ctx2.drink, actual_remaining: '10', waste_quantity: '0' },
    { product_id: ctx2.meal, actual_remaining: '5', waste_quantity: '0' },
  ]);

  await ownerUpdate(db2, ctx2.owner, ctx2.cashier, {
    fullName: 'Cashier Renamed',
    role: 'cashier',
    branchId: ctx2.branch,
    isActive: true,
  });
  console.log('7final employee pending-remittance guard: ok');
}

// ---------------------------------------------------------------------------
// Finalize idempotent products + begin finalized handling
// ---------------------------------------------------------------------------
{
  const db = await boot();
  const ctx = await seed(db);
  const shiftId = await startShift(db, ctx.cashier);
  await beginClose(db, ctx.cashier, shiftId);
  const products = [
    { product_id: ctx.drink, actual_remaining: '10', waste_quantity: '0' },
    { product_id: ctx.meal, actual_remaining: '5', waste_quantity: '0' },
  ];
  const first = await finalize(db, ctx.cashier, shiftId, '0.00', products);
  assert.equal(first.status, 'reconciled');
  assert.ok(Array.isArray(first.products));
  assert.equal(first.products.length, 2);
  assert.ok(first.products.every((p) => 'expected_remaining' in p && 'carried_quantity' in p));

  const again = await finalize(db, ctx.cashier, shiftId, '0.00', products);
  assert.equal(again.idempotent, true);
  assert.ok(Array.isArray(again.products));
  assert.equal(again.products.length, 2);
  assert.equal(Number(again.products.find((p) => p.product_id === ctx.drink).actual_remaining), 10);

  const beginDone = await beginClose(db, ctx.cashier, shiftId);
  assert.equal(beginDone.status, 'reconciled');
  assert.notEqual(beginDone.status, 'pending');
  assert.ok(Array.isArray(beginDone.products));
  console.log('7final finalize/begin idempotency: ok');
}

// ---------------------------------------------------------------------------
// Leftover return receive must not restock Main
// ---------------------------------------------------------------------------
{
  const db = await boot();
  const ctx = await seed(db);
  assert.equal(await qty(db, ctx.main, ctx.drink), 100);

  const xfer = await asUser(db, ctx.mainMgr, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
      ctx.branch,
      JSON.stringify([{ product_id: ctx.drink, quantity_sent: '60' }]),
      null,
      '7f-xfer-norest-00000001',
    ]),
  );
  const xferId = xfer.rows[0].id;
  assert.equal(await qty(db, ctx.main, ctx.drink), 40);

  await startShift(db, ctx.cashier);
  await asUser(db, ctx.cashier, () =>
    db.query('select public.confirm_shipment_arrival($1,$2)', [xferId, '7f-arrive-norest-000001']),
  );
  assert.equal(await qty(db, ctx.branch, ctx.drink), 70); // 10 + 60

  const ret = await asUser(db, ctx.cashier, () =>
    db.query('select public.create_stock_return($1::jsonb,$2,$3) id', [
      JSON.stringify([{ product_id: ctx.drink, quantity_returned: 27 }]),
      'leftover',
      '7f-ret-norest-000000001',
    ]),
  );
  const returnId = ret.rows[0].id;
  const items = (
    await db.query(`select id from public.stock_return_items where stock_return_id=$1`, [returnId])
  ).rows;

  await asUser(db, ctx.mainMgr, () =>
    db.query('select public.receive_stock_return($1,$2::jsonb,$3,$4)', [
      returnId,
      JSON.stringify(items.map((i) => ({ stock_return_item_id: i.id, quantity_received: '27' }))),
      'count',
      '7f-ret-recv-norest-00001',
    ]),
  );

  assert.equal(await qty(db, ctx.main, ctx.drink), 40, 'Main must stay 40 (no restock of 27)');
  const returnIn = (
    await db.query(
      `select count(*)::int c from public.inventory_movements
       where branch_id=$1 and product_id=$2 and movement_type='return_in'`,
      [ctx.main, ctx.drink],
    )
  ).rows[0].c;
  assert.equal(returnIn, 0);
  console.log('7final leftover return no Main restock: ok');
}

// ---------------------------------------------------------------------------
// Cutover review query shape (all snapshot rows)
// ---------------------------------------------------------------------------
{
  const db = await boot();
  const ctx = await seed(db);
  await db.exec(`
    insert into public.pcs_cutover_product_snapshots(
      product_id, product_name_snapshot, sku_snapshot, former_inventory_mode, former_is_active, assigned_closing_stock_behavior
    ) values
      ('${ctx.drink}','Drink','DRINK','piece_stock',true,'keep_at_branch'),
      ('${ctx.meal}','Meal','MEAL','kg_meal',false,'record_as_unsold');
  `);
  const rows = (
    await db.query(`
      select s.product_id, s.former_inventory_mode::text mode, s.assigned_closing_stock_behavior::text provisional,
             p.closing_stock_behavior::text live
      from public.pcs_cutover_product_snapshots s
      left join public.products p on p.id = s.product_id
      order by s.sku_snapshot
    `)
  ).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.mode === 'kg_meal' && r.provisional === 'record_as_unsold'));
  console.log('7final cutover review query: ok');
}

console.log('revision_7final_hardening: ALL PASS');
