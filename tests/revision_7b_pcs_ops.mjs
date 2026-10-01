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
  return db;
}

async function applyAll(db) {
  for (const file of allMigrations) {
    await db.exec(stripCrypto(readFileSync(`${migrationsDir}/${file}`, 'utf8')));
  }
}

const id = (n) => `28140000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seed(db) {
  const owner = id(1);
  const mainMgr = id(2);
  const cashier = id(3);
  const main = id(10);
  const branch = id(11);
  const piece = id(20);
  const formerActive = id(21);
  const formerInactive = id(22);
  const drink = id(23);

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
      ('${piece}','Piece Cake','PIECE',50,true,'piece_stock','keep_at_branch'),
      ('${formerActive}','Former Active Meal','FACTIVE',80,false,'piece_stock','record_as_unsold'),
      ('${formerInactive}','Former Inactive Meal','FINACTIVE',90,false,'piece_stock','record_as_unsold'),
      ('${drink}','Bottled Drink','DRINK',25,true,'piece_stock','keep_at_branch');
    insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
      ('${branch}','${piece}',50,true),
      ('${branch}','${drink}',25,true);
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      ('${main}','${piece}',100),('${branch}','${piece}',10),
      ('${main}','${drink}',40),('${branch}','${drink}',5);
    insert into public.pcs_cutover_product_snapshots(
      product_id, product_name_snapshot, sku_snapshot, former_inventory_mode, former_is_active, assigned_closing_stock_behavior
    ) values
      ('${formerActive}','Former Active Meal','FACTIVE','kg_meal',true,'record_as_unsold'),
      ('${formerInactive}','Former Inactive Meal','FINACTIVE','kg_meal',false,'record_as_unsold');
  `);

  return { owner, mainMgr, cashier, main, branch, piece, formerActive, formerInactive, drink };
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
        'select coalesce(quantity_on_hand,0) as q from public.branch_inventory where branch_id=$1 and product_id=$2',
        [branchId, productId],
      )
    ).rows[0]?.q ?? 0,
  );

// --- Static client guards ---
{
  assert.equal(existsSync('src/features/products/InventoryModeField.tsx'), false);
  assert.equal(existsSync('src/features/products/ClosingStockBehaviorField.tsx'), true);

  const createWizard = readFileSync('src/features/products/CreateProductWizard.tsx', 'utf8');
  const editWizard = readFileSync('src/features/products/EditProductWizard.tsx', 'utf8');
  const productsIndex = readFileSync('app/(manager)/manager/products/index.tsx', 'utf8');
  const cartStore = readFileSync('src/stores/cartStore.ts', 'utf8');
  const posInventory = readFileSync('src/features/pos/posInventory.ts', 'utf8');
  const mig = readFileSync(`${migrationsDir}/20260928140000_revision_7b_pcs_ops_rpcs.sql`, 'utf8');

  assert.match(createWizard, /ClosingStockBehaviorField/);
  assert.match(editWizard, /ClosingStockBehaviorField/);
  assert.doesNotMatch(createWizard, /InventoryModeField|kg_meal/);
  assert.doesNotMatch(editWizard, /InventoryModeField/);
  assert.match(productsIndex, /closingStockBehavior/);
  assert.doesNotMatch(posInventory, /MAX_POS_MEAL_QUANTITY/);
  assert.doesNotMatch(cartStore, /isKgMeal\(/);
  assert.match(mig, /Revision 7C insertion point \(YES\)/);
  assert.match(mig, /former_is_active/);
  assert.match(mig, /Does not increase sellable Main inventory/);
  console.log('7B static client/migration guards: ok');
}

// --- Core RPC behaviors ---
{
  const db = await boot();
  await applyAll(db);
  const ctx = await seed(db);

  // lock_branch_inventory_gate not executable by authenticated
  await asUser(db, ctx.mainMgr, () =>
    assert.rejects(
      () => db.query('select public.lock_branch_inventory_gate($1)', [ctx.main]),
      /permission denied|must be owner|42501|not granted/i,
    ),
  );

  // Closing behavior create/update
  const created = await asUser(db, ctx.mainMgr, () =>
    db.query('select * from public.create_complete_product($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)', [
      'Unsold Cake',
      'UNSOLD1',
      null,
      '[]',
      '[]',
      '40',
      'piece_stock',
      'record_as_unsold',
    ]),
  );
  assert.equal(created.rows[0].closing_stock_behavior, 'record_as_unsold');
  assert.equal(created.rows[0].inventory_mode, 'piece_stock');
  assert.equal(created.rows[0].is_active, false);

  await asUser(db, ctx.mainMgr, () =>
    db.query(
      'select * from public.update_complete_product($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11)',
      [
        created.rows[0].id,
        'Unsold Cake',
        'UNSOLD1',
        null,
        false,
        '[]',
        '[]',
        '[]',
        '40',
        null,
        'keep_at_branch',
      ],
    ),
  );
  const updatedBehavior = (
    await db.query(`select closing_stock_behavior::text as b from public.products where id=$1`, [
      created.rows[0].id,
    ])
  ).rows[0].b;
  assert.equal(updatedBehavior, 'keep_at_branch');

  // Main PCS init reactivation gated by former_is_active
  await asUser(db, ctx.mainMgr, () =>
    db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
      JSON.stringify([
        { product_id: ctx.formerActive, quantity: '12' },
        { product_id: ctx.formerInactive, quantity: '8' },
      ]),
    ]),
  );
  const activeFlags = (
    await db.query(
      `select id, is_active from public.products where id in ($1,$2) order by sku`,
      [ctx.formerActive, ctx.formerInactive],
    )
  ).rows;
  const byId = Object.fromEntries(activeFlags.map((r) => [r.id, r.is_active]));
  assert.equal(byId[ctx.formerActive], true);
  assert.equal(byId[ctx.formerInactive], false);
  assert.equal(await qty(db, ctx.main, ctx.formerActive), 12);
  assert.equal(await qty(db, ctx.main, ctx.formerInactive), 8);

  // Fractional reject on init
  await asUser(db, ctx.mainMgr, () =>
    assert.rejects(
      () =>
        db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
          JSON.stringify([{ product_id: ctx.piece, quantity: '1.5' }]),
        ]),
      /whole numbers|Piece quantities/i,
    ),
  );

  // Transfer + confirm arrival PCS
  const transfer = await asUser(db, ctx.mainMgr, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
      ctx.branch,
      JSON.stringify([{ product_id: ctx.piece, quantity_sent: '4' }]),
      null,
      '7b-send-piece-00000001',
    ]),
  );
  assert.equal(await qty(db, ctx.main, ctx.piece), 96);

  await asUser(db, ctx.cashier, () =>
    db.query('select public.confirm_shipment_arrival($1,$2)', [
      transfer.rows[0].id,
      '7b-arrive-piece-000001',
    ]),
  );
  assert.equal(await qty(db, ctx.branch, ctx.piece), 14);

  // Issue path with discrepancy
  const transfer2 = await asUser(db, ctx.mainMgr, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,$3,$4) id', [
      ctx.branch,
      JSON.stringify([{ product_id: ctx.drink, quantity_sent: '3' }]),
      null,
      '7b-send-drink-00000001',
    ]),
  );
  const itemId = (
    await db.query(
      `select id from public.stock_transfer_items where stock_transfer_id=$1`,
      [transfer2.rows[0].id],
    )
  ).rows[0].id;
  await asUser(db, ctx.cashier, () =>
    db.query('select public.report_shipment_issue($1,$2::jsonb,$3,$4)', [
      transfer2.rows[0].id,
      JSON.stringify([{ stock_transfer_item_id: itemId, quantity_received: '2' }]),
      'short two pcs counted',
      '7b-issue-drink-00000001',
    ]),
  );
  assert.equal(await qty(db, ctx.branch, ctx.drink), 7); // 5 + 2

  // Open shift + POS list + confirm_sale deducts all
  const shiftId = (
    await asUser(db, ctx.cashier, () => db.query('select public.start_cashier_shift() id'))
  ).rows[0].id;

  const posList = await asUser(db, ctx.cashier, () =>
    db.query('select product_id, quantity_on_hand from public.list_cashier_pos_inventory() order by product_sku'),
  );
  assert.ok(posList.rows.every((r) => r.quantity_on_hand != null));
  const piecePos = posList.rows.find((r) => r.product_id === ctx.piece);
  assert.equal(Number(piecePos.quantity_on_hand), 14);

  const sale = await asUser(db, ctx.cashier, () =>
    db.query('select * from public.confirm_sale($1,$2::jsonb,$3,$4)', [
      shiftId,
      JSON.stringify([{ product_id: ctx.piece, quantity: '3' }]),
      150,
      '7b-sale-piece-000000001',
    ]),
  );
  assert.ok(sale.rows[0].id);
  assert.equal(await qty(db, ctx.branch, ctx.piece), 11);

  const saleMove = (
    await db.query(
      `select movement_type::text as t, quantity from public.inventory_movements
       where reference_type='sale' and reference_id=$1 and product_id=$2`,
      [sale.rows[0].id, ctx.piece],
    )
  ).rows[0];
  assert.equal(saleMove.t, 'sale');
  assert.equal(Number(saleMove.quantity), -3);

  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () =>
        db.query('select * from public.confirm_sale($1,$2::jsonb,$3,$4)', [
          shiftId,
          JSON.stringify([{ product_id: ctx.piece, quantity: '999' }]),
          50000,
          '7b-sale-insuff-00000001',
        ]),
      /Insufficient stock/i,
    ),
  );

  // Return create PCS + selling deduct
  const beforeReturnMain = await qty(db, ctx.main, ctx.piece);
  const returnId = (
    await asUser(db, ctx.cashier, () =>
      db.query('select public.create_stock_return($1::jsonb,$2,$3) id', [
        JSON.stringify([{ product_id: ctx.piece, quantity_returned: 2 }]),
        'leftover pcs',
        '7b-return-create-0000001',
      ]),
    )
  ).rows[0].id;
  assert.equal(await qty(db, ctx.branch, ctx.piece), 9);

  const returnItemId = (
    await db.query(`select id from public.stock_return_items where stock_return_id=$1`, [returnId])
  ).rows[0].id;

  // Main receive: PCS count, no restock, no return_in
  await asUser(db, ctx.mainMgr, () =>
    db.query('select public.receive_stock_return($1,$2::jsonb,$3,$4)', [
      returnId,
      JSON.stringify([{ stock_return_item_id: returnItemId, quantity_received: '1' }]),
      'waste count short',
      '7b-return-recv-00000001',
    ]),
  );
  assert.equal(await qty(db, ctx.main, ctx.piece), beforeReturnMain);
  const returnInCount = (
    await db.query(
      `select count(*)::int as c from public.inventory_movements
       where reference_type='stock_return' and reference_id=$1 and movement_type='return_in'`,
      [returnId],
    )
  ).rows[0].c;
  assert.equal(returnInCount, 0);
  const retStatus = (
    await db.query(`select status::text as s from public.stock_returns where id=$1`, [returnId])
  ).rows[0].s;
  assert.equal(retStatus, 'received_with_discrepancy');

  // Freeze insertion points present in selling mutators (source pin)
  const saleSrc = (
    await db.query(`select pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='confirm_sale'`)
  ).rows[0].def;
  assert.match(saleSrc, /Revision 7C insertion point \(YES\)/);
  assert.match(saleSrc, /lock_branch_inventory_gate/);
  assert.doesNotMatch(saleSrc, /inventory_mode = 'kg_meal'/);

  console.log('7B RPC behaviors: ok');
}

// --- Concurrent sale oversell protection ---
{
  const db = await boot();
  await applyAll(db);
  const ctx = await seed(db);
  await db.exec(`
    update public.branch_inventory set quantity_on_hand = 1
    where branch_id='${ctx.branch}' and product_id='${ctx.piece}';
  `);
  const shiftId = (
    await asUser(db, ctx.cashier, () => db.query('select public.start_cashier_shift() id'))
  ).rows[0].id;

  // Sequential contention: second sale must fail after first consumes stock.
  await asUser(db, ctx.cashier, () =>
    db.query('select * from public.confirm_sale($1,$2::jsonb,$3,$4)', [
      shiftId,
      JSON.stringify([{ product_id: ctx.piece, quantity: '1' }]),
      50,
      '7b-concurrent-a-00000001',
    ]),
  );
  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () =>
        db.query('select * from public.confirm_sale($1,$2::jsonb,$3,$4)', [
          shiftId,
          JSON.stringify([{ product_id: ctx.piece, quantity: '1' }]),
          50,
          '7b-concurrent-b-00000001',
        ]),
      /Insufficient stock/i,
    ),
  );
  assert.equal(await qty(db, ctx.branch, ctx.piece), 0);
  console.log('7B sale sufficiency under lock: ok');
}

console.log('Revision 7B PCS ops tests passed.');
