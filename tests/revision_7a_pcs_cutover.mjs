import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationsDir = 'supabase/migrations';
const allMigrations = readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort();
const before7a = allMigrations.filter((n) => n < '20260928130000');
const from7a = allMigrations.filter((n) => n >= '20260928130000');

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
  return db;
}

async function applyFiles(db, files) {
  for (const file of files) {
    await db.exec(stripCrypto(readFileSync(`${migrationsDir}/${file}`, 'utf8')));
  }
}

const id = (n) => `28130000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seedBase(db, { withKg = false, openShift = false, fractionalPiece = false } = {}) {
  const owner = id(1);
  const mainMgr = id(2);
  const cashier = id(3);
  const main = id(10);
  const branch = id(11);
  const piece = id(20);
  const kgProd = id(21);
  const kgNoInv = id(22);

  await db.exec(`
    insert into auth.users values
      ('${owner}','o@test'),('${mainMgr}','m@test'),('${cashier}','c@test');
    insert into public.branches(id,name,code,is_main_branch,is_active) values
      ('${main}','Main','MAIN',true,true),('${branch}','Branch 1','B1',false,true);
    insert into public.profiles(id,full_name,role,branch_id) values
      ('${owner}','Owner','owner',null),
      ('${mainMgr}','Main Manager','manager','${main}'),
      ('${cashier}','Cashier','cashier','${branch}');
    insert into public.products(id,name,sku,selling_price,is_active) values
      ('${piece}','Piece Cake','PIECE',50,true);
    insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
      ('${branch}','${piece}',50,true);
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      ('${main}','${piece}',100),('${branch}','${piece}',7);
  `);

  if (withKg) {
    await db.exec(`
      insert into public.products(id,name,sku,selling_price,is_active,inventory_mode) values
        ('${kgProd}','KG Meal','KGMEAL',80,true,'kg_meal'),
        ('${kgNoInv}','KG No Inv','KGNOINV',90,true,'kg_meal');
      insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
        ('${main}','${kgProd}',12.500);
    `);
  }

  if (openShift) {
    await db.exec(`
      insert into public.shifts(id,branch_id,cashier_id,status,started_at,reconciliation_required)
      values ('${id(30)}','${branch}','${cashier}','open',now(),true);
    `);
  }

  if (fractionalPiece) {
    await db.exec(`
      insert into public.inventory_movements(
        id, branch_id, product_id, movement_type, quantity, inventory_mode,
        reference_type, reference_id, created_by
      ) values (
        '${id(40)}','${main}','${piece}','adjustment',1.5,'piece_stock',
        'test','${id(41)}','${mainMgr}'
      );
    `);
  }

  return { owner, mainMgr, cashier, main, branch, piece, kgProd, kgNoInv };
}

const asUser = async (db, userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

// --- Preflight: open shift blocks cutover ---
{
  const db = await boot();
  await applyFiles(db, before7a);
  await seedBase(db, { openShift: true });
  await assert.rejects(
    () => applyFiles(db, from7a),
    /pcs_cutover_blocked_open_shifts|open shift/i,
  );
  console.log('preflight open shift: ok');
}

// --- Preflight: fractional piece blocks cutover ---
{
  const db = await boot();
  await applyFiles(db, before7a);
  // Insert fractional piece movement while old triggers allow reading product mode.
  // Disable whole check doesn't exist yet; insert via SQL with explicit mode.
  await seedBase(db, {});
  // Bypass snapshot trigger immutability by inserting with piece_stock explicitly;
  // pre-7A trigger overwrites from product (piece_stock). Use direct quantity 1.5.
  await db.exec(`
    insert into public.inventory_movements(
      id, branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by
    ) values (
      '${id(40)}','${id(10)}','${id(20)}','adjustment',1.5,
      'adjustment','${id(41)}','${id(2)}'
    );
  `);
  const mode = (await db.query(`select inventory_mode::text as m, quantity from public.inventory_movements where id='${id(40)}'`)).rows[0];
  assert.equal(mode.m, 'piece_stock');
  assert.equal(Number(mode.quantity), 1.5);

  await assert.rejects(
    () => applyFiles(db, from7a),
    /pcs_cutover_blocked_fractional_piece_movements|Fractional piece_stock/i,
  );
  console.log('preflight fractional piece: ok');
}

// --- Happy path cutover + schema + RPCs ---
{
  const db = await boot();
  await applyFiles(db, before7a);
  const ctx = await seedBase(db, { withKg: true });

  // Historical kg transfer/return decimals (closed)
  await db.exec(`
    insert into public.stock_transfers(
      id, transfer_number, from_branch_id, to_branch_id, status, created_by, sent_by, received_by, sent_at, received_at
    ) values (
      '${id(50)}','TR-KG-HIST','${ctx.main}','${ctx.branch}','received','${ctx.mainMgr}','${ctx.mainMgr}','${ctx.cashier}',now(),now()
    );
    insert into public.stock_transfer_items(id, stock_transfer_id, product_id, quantity_sent, quantity_received, inventory_mode)
    values ('${id(51)}','${id(50)}','${ctx.kgProd}',3.250,null,'kg_meal');
  `);

  await applyFiles(db, from7a);

  // Product snapshots include kg with no inventory row
  const snaps = (
    await db.query(`
      select product_id, former_inventory_mode::text as mode, assigned_closing_stock_behavior::text as behavior
      from public.pcs_cutover_product_snapshots
      order by sku_snapshot
    `)
  ).rows;
  assert.equal(snaps.length, 3);
  const kgNoInvSnap = snaps.find((r) => r.product_id === ctx.kgNoInv);
  assert.ok(kgNoInvSnap);
  assert.equal(kgNoInvSnap.mode, 'kg_meal');
  assert.equal(kgNoInvSnap.behavior, 'record_as_unsold');

  const pieceSnap = snaps.find((r) => r.product_id === ctx.piece);
  assert.equal(pieceSnap.mode, 'piece_stock');
  assert.equal(pieceSnap.behavior, 'keep_at_branch');

  // Balance snapshots + operational zero
  const bal = (
    await db.query(
      `select quantity_on_hand from public.kg_meal_cutover_balance_snapshots where product_id=$1`,
      [ctx.kgProd],
    )
  ).rows[0];
  assert.equal(Number(bal.quantity_on_hand), 12.5);

  const liveKg = (
    await db.query(
      `select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2`,
      [ctx.main, ctx.kgProd],
    )
  ).rows[0];
  assert.equal(Number(liveKg.quantity_on_hand), 0);

  const kgProduct = (
    await db.query(`select inventory_mode::text as mode, is_active, closing_stock_behavior::text as behavior from public.products where id=$1`, [
      ctx.kgProd,
    ])
  ).rows[0];
  assert.equal(kgProduct.mode, 'piece_stock');
  assert.equal(kgProduct.is_active, false);
  assert.equal(kgProduct.behavior, 'record_as_unsold');

  // Historical KG decimals untouched
  const hist = (
    await db.query(`select quantity_sent, quantity_received, inventory_mode::text as mode from public.stock_transfer_items where id=$1`, [
      id(51),
    ])
  ).rows[0];
  assert.equal(Number(hist.quantity_sent), 3.25);
  assert.equal(hist.quantity_received, null);
  assert.equal(hist.mode, 'kg_meal');

  // branch_inventory remains numeric
  const typ = (
    await db.query(`
      select data_type, numeric_precision, numeric_scale
      from information_schema.columns
      where table_schema='public' and table_name='branch_inventory' and column_name='quantity_on_hand'
    `)
  ).rows[0];
  assert.equal(typ.data_type, 'numeric');
  assert.equal(Number(typ.numeric_precision), 14);
  assert.equal(Number(typ.numeric_scale), 3);

  // inventory_reconciliation_required backfill false
  const flagDefault = (
    await db.query(`
      select column_default from information_schema.columns
      where table_schema='public' and table_name='shifts' and column_name='inventory_reconciliation_required'
    `)
  ).rows[0].column_default;
  assert.match(String(flagDefault), /false/);

  // Exactly one create/update signature
  const createSigs = (
    await db.query(`
      select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='create_complete_product'
    `)
  ).rows;
  assert.equal(createSigs.length, 1);
  assert.match(createSigs[0].args, /p_closing_stock_behavior/);

  const updateSigs = (
    await db.query(`
      select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='update_complete_product'
    `)
  ).rows;
  assert.equal(updateSigs.length, 1);
  assert.match(updateSigs[0].args, /p_closing_stock_behavior/);

  // Reject kg_meal on create/set
  await asUser(db, ctx.mainMgr, () =>
    assert.rejects(
      () =>
        db.query('select * from public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)', [
          'Bad KG',
          'BADKG',
          null,
          '[]',
          '[]',
          '10',
          'kg_meal',
        ]),
      /retired|piece stock/i,
    ),
  );

  await asUser(db, ctx.mainMgr, () =>
    assert.rejects(
      () => db.query('select public.set_product_inventory_mode($1,$2)', [ctx.piece, 'kg_meal']),
      /retired|piece stock/i,
    ),
  );

  // Persist closing_stock_behavior atomically on create
  const created = (
    await asUser(db, ctx.mainMgr, () =>
      db.query('select * from public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)', [
        'Keep Product',
        'KEEP-1',
        null,
        '[]',
        '[]',
        '12',
        'piece_stock',
        'record_as_unsold',
      ]),
    )
  ).rows[0];
  assert.equal(created.closing_stock_behavior, 'record_as_unsold');
  assert.equal(created.inventory_mode, 'piece_stock');

  // Update closing behavior atomically; NULL leaves unchanged via 10-arg style omit
  await asUser(db, ctx.mainMgr, () =>
    db.query(
      'select * from public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11)',
      [
        created.id,
        'Keep Product',
        'KEEP-1',
        null,
        false,
        '[]',
        '[]',
        '[]',
        '12',
        null,
        'keep_at_branch',
      ],
    ),
  );
  assert.equal(
    (await db.query(`select closing_stock_behavior::text as b from public.products where id=$1`, [created.id])).rows[0].b,
    'keep_at_branch',
  );

  // Whole-PCS rejects fractional piece movement insert
  await assert.rejects(
    db.exec(`
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by
      ) values (
        '${ctx.main}','${ctx.piece}','adjustment',1.25,
        'adjustment','${id(60)}','${ctx.mainMgr}'
      );
    `),
    /piece_whole|check|violates/i,
  );

  // Legacy kg decimal movement row remains valid (cutover adjustment snapshotted as kg_meal)
  const kgMove = (
    await db.query(`
      select quantity, inventory_mode::text as mode
      from public.inventory_movements
      where notes like 'pcs_cutover:%' and product_id=$1
      limit 1
    `, [ctx.kgProd])
  ).rows[0];
  assert.ok(kgMove);
  assert.equal(kgMove.mode, 'kg_meal');
  assert.equal(Number(kgMove.quantity), -12.5);

  // Waste quantity constraints
  await db.exec(`
    insert into public.shifts(id,branch_id,cashier_id,status,started_at,ended_at,reconciliation_required,inventory_reconciliation_required)
    values ('${id(70)}','${ctx.branch}','${ctx.cashier}','closed',now()-interval '2 hours',now(),true,false);
  `);
  await db.exec(`
    insert into public.shift_waste_occurrences(shift_id,branch_id,product_id,recorded_by,note,quantity)
    values ('${id(70)}','${ctx.branch}','${ctx.piece}','${ctx.cashier}',null,null);
  `);
  await db.exec(`
    insert into public.shift_waste_occurrences(shift_id,branch_id,product_id,recorded_by,note,quantity)
    values ('${id(70)}','${ctx.branch}','${created.id}','${ctx.cashier}',null,3);
  `);
  await assert.rejects(
    db.exec(`
      insert into public.shifts(id,branch_id,cashier_id,status,started_at,ended_at,reconciliation_required,inventory_reconciliation_required)
      values ('${id(71)}','${ctx.branch}','${ctx.cashier}','closed',now()-interval '1 hours',now(),true,false);
      insert into public.shift_waste_occurrences(shift_id,branch_id,product_id,recorded_by,note,quantity)
      values ('${id(71)}','${ctx.branch}','${ctx.piece}','${ctx.cashier}',null,0);
    `),
    /quantity|check|violates/i,
  );

  // Recon table requires product_name_snapshot + adjustment/net_other columns
  const reconCols = (
    await db.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='shift_product_reconciliations'
    `)
  ).rows.map((r) => r.column_name);
  for (const col of [
    'product_name_snapshot',
    'adjustment_quantity',
    'net_other_movement_quantity',
    'received_quantity',
    'outgoing_quantity',
  ]) {
    assert.ok(reconCols.includes(col), `missing ${col}`);
  }

  await assert.rejects(
    db.exec(`
      insert into public.shift_product_reconciliations(
        shift_id, branch_id, product_id, product_name_snapshot, closing_stock_behavior,
        opening_quantity, expected_remaining, actual_remaining, discrepancy, result, recorded_by
      ) values (
        '${id(70)}','${ctx.branch}','${ctx.piece}',null,'keep_at_branch',
        0,0,0,0,'exact','${ctx.cashier}'
      );
    `),
    /null value|not-null|violates/i,
  );

  // Opening snapshot + inventory recon gate
  const shiftId = (
    await asUser(db, ctx.cashier, () => db.query('select public.start_cashier_shift() as id'))
  ).rows[0].id;

  const opening = (
    await db.query(
      `select product_id, opening_quantity from public.shift_product_opening_stock where shift_id=$1 order by product_id`,
      [shiftId],
    )
  ).rows;
  assert.ok(opening.length >= 1);
  const pieceOpen = opening.find((r) => r.product_id === ctx.piece);
  assert.equal(Number(pieceOpen.opening_quantity), 7);

  // Mid-session-first product: no opening row until received; logical opening 0 at close (schema supports coalesce)
  assert.equal(
    opening.find((r) => r.product_id === created.id),
    undefined,
  );

  // Pending inventory recon blocks new shift (set flag in the same open→closed transition)
  await db.exec(`
    update public.shifts
    set status='closed', ended_at=now(), inventory_reconciliation_required=true
    where id='${shiftId}' and status='open'
  `);
  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () => db.query('select public.start_cashier_shift()'),
      /Pending inventory reconciliation/i,
    ),
  );

  // Snapshot trigger no longer depends on products.inventory_mode for new rows
  const src = (
    await db.query(`
      select pg_get_functiondef(p.oid) as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='snapshot_movement_inventory_mode'
    `)
  ).rows[0].def;
  assert.match(src, /piece_stock/);
  assert.doesNotMatch(src, /from public\.products/);

  // Lock gate exists
  const gate = (
    await db.query(`
      select pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='lock_branch_inventory_gate'
    `)
  ).rows[0].def;
  assert.match(gate, /for update/i);
  assert.match(gate, /order by bi\.product_id/i);

  const startDef = (
    await db.query(`
      select pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='start_cashier_shift'
    `)
  ).rows[0].def;
  assert.match(startDef, /lock_branch_inventory_gate/);
  assert.match(startDef, /shift_product_opening_stock/);

  console.log('happy-path cutover + schema + RPCs: ok');
}

// --- Open KG transfer preflight ---
{
  const db = await boot();
  await applyFiles(db, before7a);
  const ctx = await seedBase(db, { withKg: true });
  await db.exec(`
    insert into public.stock_transfers(
      id, transfer_number, from_branch_id, to_branch_id, status, created_by
    ) values (
      '${id(80)}','TR-OPEN-KG','${ctx.main}','${ctx.branch}','draft','${ctx.mainMgr}'
    );
    insert into public.stock_transfer_items(id, stock_transfer_id, product_id, quantity_sent, inventory_mode)
    values ('${id(81)}','${id(80)}','${ctx.kgProd}',2.000,'kg_meal');
  `);
  await assert.rejects(
    () => applyFiles(db, from7a),
    /pcs_cutover_blocked_open_kg_transfers|open KG transfers/i,
  );
  console.log('preflight open KG transfer: ok');
}

console.log('Revision 7A PCS cutover tests passed.');
