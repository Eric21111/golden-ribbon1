import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dashboard = readFileSync('app/(cashier)/cashier/dashboard.tsx', 'utf8');
const returnPage = readFileSync('app/(cashier)/cashier/returns/create.tsx', 'utf8');
assert.match(returnPage, /createStockReturn/);
assert.match(dashboard, /title="Leftover return"/);
assert.match(dashboard, /router\.push\('\/cashier\/returns\/create'\)/);
assert.match(dashboard, /\{sameDayClosedHint \? <Row>\{leftoverReturnTile\}<\/Row> : null\}/);
assert.doesNotMatch(dashboard, /Go to Leftover Return/);

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
  for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
  }
  return db;
}

const id = (n) => `28110000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seed(db, n) {
  const owner = id(n + 1);
  const mainMgr = id(n + 2);
  const cashier = id(n + 3);
  const main = id(n + 10);
  const branch = id(n + 11);
  const meal = id(n + 20);
  const kept = id(n + 21);
  await db.exec(`
    insert into auth.users values ('${owner}','o@t'),('${mainMgr}','m@t'),('${cashier}','c@t');
    insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
      ('${main}','Main','MAIN${n}',true,true,'counted'),
      ('${branch}','Branch','B${n}',false,true,'cashier_confirm');
    insert into public.profiles(id,full_name,role,branch_id) values
      ('${owner}','Owner','owner',null),
      ('${mainMgr}','Main Manager','manager','${main}'),
      ('${cashier}','Cashier','cashier','${branch}');
    insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior,is_non_returnable) values
      ('${meal}','Chicken','CHK${n}',80,true,'piece_stock','record_as_unsold',false),
      ('${kept}','Drink','DRK${n}',25,true,'piece_stock','keep_at_branch',true);
    insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
      ('${branch}','${meal}',80,true),('${branch}','${kept}',25,true);
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      ('${branch}','${meal}',15),('${branch}','${kept}',8),('${main}','${meal}',40);
  `);
  return { owner, mainMgr, cashier, main, branch, meal, kept };
}

const asUser = async (db, userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const onHand = async (db, branch, product) =>
  Number((await db.query('select quantity_on_hand q from public.branch_inventory where branch_id=$1 and product_id=$2', [branch, product])).rows[0].q);
const awaiting = async (db, branch, product) =>
  Number((await db.query('select quantity_awaiting_return q from public.branch_inventory where branch_id=$1 and product_id=$2', [branch, product])).rows[0].q);

async function sellAndClose(db, ctx) {
  const shift = (await asUser(db, ctx.cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  await asUser(db, ctx.cashier, () =>
    db.query('select public.confirm_sale($1,$2::jsonb,$3,$4)', [
      shift,
      JSON.stringify([{ product_id: ctx.meal, quantity: 10 }]),
      '800.00',
      `close-sale-${ctx.meal.slice(0, 8)}`,
    ]),
  );
  assert.equal(await onHand(db, ctx.branch, ctx.meal), 5);
  const preview = (await asUser(db, ctx.cashier, () => db.query('select public.begin_cashier_shift_close($1) preview', [shift]))).rows[0].preview;
  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () => db.query('select public.create_stock_return($1::jsonb,null,$2)', [
        JSON.stringify([{ product_id: ctx.meal, quantity_returned: 5 }]),
        'return-before-finalize-01',
      ]),
      /frozen|pending/i,
    ),
  );
  const products = preview.products.map((p) => ({
    product_id: p.product_id,
    actual_remaining: String(p.system_balance_before_waste),
    waste_quantity: '0',
  }));
  const result = (await asUser(db, ctx.cashier, () =>
    db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb) r', [shift, '800.00', JSON.stringify(products)]),
  )).rows[0].r;
  const replay = (await asUser(db, ctx.cashier, () =>
    db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb) r', [shift, '800.00', JSON.stringify(products)]),
  )).rows[0].r;
  assert.equal(result.result, 'exact');
  assert.equal(Number(result.expected_cash), 800);
  assert.equal(replay.idempotent, true);
  return { shift, products };
}

{
  const db = await boot();
  const ctx = await seed(db, 1);
  await sellAndClose(db, ctx);

  assert.equal(await onHand(db, ctx.branch, ctx.meal), 5, 'the 5 leftover pieces stay on hand');
  assert.equal(await awaiting(db, ctx.branch, ctx.meal), 5, 'those 5 are reserved for the return');
  assert.equal(await onHand(db, ctx.branch, ctx.kept), 8);
  assert.equal(await awaiting(db, ctx.branch, ctx.kept), 0, 'carryover is not reserved');
  const recon = (await db.query(
    'select unsold_quantity, carried_quantity from public.shift_product_reconciliations where product_id=$1',
    [ctx.meal],
  )).rows[0];
  assert.equal(Number(recon.unsold_quantity), 5);
  assert.equal(Number(recon.carried_quantity), 0);
  assert.equal(Number((await db.query("select count(*)::int n from public.inventory_movements where movement_type='unsold'")).rows[0].n), 0);
  assert.equal(Number((await db.query('select count(*)::int n from public.stock_returns')).rows[0].n), 0, 'End Shift does not create a return');

  const listed = (await asUser(db, ctx.cashier, () => db.query('select product_id, quantity_on_hand from public.list_return_inventory()'))).rows;
  assert.deepEqual(listed.map((row) => [row.product_id, Number(row.quantity_on_hand)]), [[ctx.meal, 5]]);

  const reopened = (await asUser(db, ctx.cashier, () =>
    db.query("select public.reopen_cashier_shift('Need to sell the rest of today') id"),
  )).rows[0].id;
  const pos = (await asUser(db, ctx.cashier, () =>
    db.query('select product_id, quantity_on_hand, sellable_quantity from public.list_cashier_pos_inventory()'),
  )).rows;
  const mealPos = pos.find((row) => row.product_id === ctx.meal);
  const keptPos = pos.find((row) => row.product_id === ctx.kept);
  assert.equal(Number(mealPos.quantity_on_hand), 5);
  assert.equal(Number(mealPos.sellable_quantity), 0, 'POS does not offer reserved leftovers');
  assert.equal(Number(keptPos.sellable_quantity), 8);
  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () => db.query('select public.confirm_sale($1,$2::jsonb,$3,$4)', [
        reopened,
        JSON.stringify([{ product_id: ctx.meal, quantity: 1 }]),
        '80.00',
        'reserved-sale-key-0001',
      ]),
      /Insufficient stock/,
    ),
  );
  await asUser(db, ctx.cashier, () =>
    db.query('select public.confirm_sale($1,$2::jsonb,$3,$4)', [
      reopened,
      JSON.stringify([{ product_id: ctx.kept, quantity: 1 }]),
      '25.00',
      'carryover-sale-key001',
    ]),
  );
  assert.equal(await onHand(db, ctx.branch, ctx.kept), 7);
  assert.equal(await onHand(db, ctx.branch, ctx.meal), 5);

  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () => db.query('select public.create_stock_return($1::jsonb,null,$2)', [
        JSON.stringify([{ product_id: ctx.kept, quantity_returned: 1 }]),
        'return-carryover-key01',
      ]),
      /non-returnable/i,
    ),
  );

  const returnId = (await asUser(db, ctx.cashier, () =>
    db.query('select public.create_stock_return($1::jsonb,null,$2) id', [
      JSON.stringify([{ product_id: ctx.meal, quantity_returned: 5 }]),
      'manual-return-key-0001',
    ]),
  )).rows[0].id;
  const replayId = (await asUser(db, ctx.cashier, () =>
    db.query('select public.create_stock_return($1::jsonb,null,$2) id', [
      JSON.stringify([{ product_id: ctx.meal, quantity_returned: 5 }]),
      'manual-return-key-0001',
    ]),
  )).rows[0].id;
  assert.equal(replayId, returnId);
  const created = (await db.query('select status::text s, from_branch_id from public.stock_returns where id=$1', [returnId])).rows[0];
  assert.equal(created.s, 'in_transit');
  assert.equal(created.from_branch_id, ctx.branch);
  const items = (await db.query('select id, quantity_returned from public.stock_return_items where stock_return_id=$1', [returnId])).rows;
  assert.equal(items.length, 1);
  assert.equal(Number(items[0].quantity_returned), 5);
  assert.equal(Number((await db.query('select count(*)::int n from public.stock_returns')).rows[0].n), 1);
  assert.equal(await onHand(db, ctx.branch, ctx.meal), 0);
  assert.equal(await awaiting(db, ctx.branch, ctx.meal), 0);
  const outs = (await db.query(
    "select quantity from public.inventory_movements where product_id=$1 and movement_type='return_out'",
    [ctx.meal],
  )).rows;
  assert.deepEqual(outs.map((row) => Number(row.quantity)), [-5]);
  const sales = (await db.query(
    "select quantity from public.inventory_movements where product_id=$1 and movement_type='sale'",
    [ctx.meal],
  )).rows;
  assert.deepEqual(sales.map((row) => Number(row.quantity)), [-10]);

  await asUser(db, ctx.cashier, () =>
    assert.rejects(
      () => db.query('select public.create_stock_return($1::jsonb,null,$2)', [
        JSON.stringify([{ product_id: ctx.meal, quantity_returned: 5 }]),
        'manual-return-key-0002',
      ]),
      /Insufficient stock/,
    ),
  );

  const status = (await asUser(db, ctx.mainMgr, () =>
    db.query('select public.receive_stock_return($1,$2::jsonb,null,$3) s', [
      returnId,
      JSON.stringify([{ stock_return_item_id: items[0].id, quantity_received: '5' }]),
      'receive-exact-key-0001',
    ]),
  )).rows[0].s;
  assert.equal(status, 'received');
  assert.equal(Number((await db.query('select count(*)::int n from public.return_discrepancies')).rows[0].n), 0);
  assert.equal(await onHand(db, ctx.branch, ctx.meal), 0, 'receiving does not deduct the branch again');
  await db.close();
}

{
  const db = await boot();
  const ctx = await seed(db, 2);
  await sellAndClose(db, ctx);
  const returnId = (await asUser(db, ctx.cashier, () =>
    db.query('select public.create_stock_return($1::jsonb,null,$2) id', [
      JSON.stringify([{ product_id: ctx.meal, quantity_returned: 5 }]),
      'manual-return-key-0003',
    ]),
  )).rows[0].id;
  const itemId = (await db.query('select id from public.stock_return_items where stock_return_id=$1', [returnId])).rows[0].id;
  const status = (await asUser(db, ctx.mainMgr, () =>
    db.query('select public.receive_stock_return($1,$2::jsonb,null,$3) s', [
      returnId,
      JSON.stringify([{ stock_return_item_id: itemId, quantity_received: '4' }]),
      'receive-short-key-0001',
    ]),
  )).rows[0].s;
  assert.equal(status, 'received_with_discrepancy');
  const disc = (await db.query('select discrepancy_type::text t, difference from public.return_discrepancies')).rows;
  assert.equal(disc.length, 1);
  assert.equal(disc[0].t, 'missing');
  assert.equal(Number(disc[0].difference), 1);
  assert.equal(await onHand(db, ctx.branch, ctx.meal), 0);
  assert.equal(
    Number((await db.query("select count(*)::int n from public.inventory_movements where product_id=$1 and movement_type='return_out'", [ctx.meal])).rows[0].n),
    1,
  );
  await db.close();
}

{
  const db = await boot();
  const ctx = await seed(db, 3);
  await db.exec(`update public.branch_inventory set quantity_on_hand = 6 where branch_id='${ctx.branch}' and product_id='${ctx.meal}'`);
  const shift = (await asUser(db, ctx.cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  await db.exec(`
    alter table public.shifts disable trigger shifts_protect_lifecycle;
    update public.shifts
    set started_at = (
      case
        when timezone('Asia/Manila', now()) < (timezone('Asia/Manila', now()))::date + time '21:00'
          then (timezone('Asia/Manila', now()))::date - 1
        else (timezone('Asia/Manila', now()))::date
      end + time '21:00'
    ) at time zone 'Asia/Manila' - interval '2 hours'
    where id = '${shift}' and status = 'open';
    alter table public.shifts enable trigger shifts_protect_lifecycle;
  `);
  const overdue = (await db.query('select public.close_overdue_shifts() result')).rows[0].result;
  assert.equal(Number(overdue.closed_count), 1);
  assert.equal(Number(overdue.leftover_return_count), 0);
  assert.equal((await db.query('select status from public.shifts where id=$1', [shift])).rows[0].status, 'closed');
  assert.equal(await onHand(db, ctx.branch, ctx.meal), 6, '9 PM close does not deduct leftovers');
  assert.equal(await awaiting(db, ctx.branch, ctx.meal), 0);
  assert.equal(Number((await db.query('select count(*)::int n from public.stock_returns')).rows[0].n), 0);
  await db.close();
}

console.log('Leftover return after close passed: reserve 5, manual return deducts once, exact and short receive, carryover, 9 PM.');
