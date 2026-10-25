// Disposable staging check: populate a database at the frozen production-head marker,
// then apply the migrations that follow it. Does not connect to production.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
const HEAD = '20260928150300';
const applied = files.filter((name) => name.slice(0, 14) <= HEAD);
const pending = files.filter((name) => name.slice(0, 14) > HEAD);
const strip = (sql) => sql.replace(/create extension if not exists pgcrypto;/g, '');
const id = (n) => `51000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

assert.equal(pending.length, 19, `expected 19 migrations after ${HEAD}, found ${pending.length}: ${pending.join(', ')}`);

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
for (const file of applied) {
  await db.exec(strip(readFileSync(`${dir}/${file}`, 'utf8')));
}
console.log(`production-head schema loaded (${applied.length} migrations through ${HEAD})`);

const owner = id(1);
const mainMgr = id(2);
const cashier = id(3);
const stranded = id(4);
const main = id(10);
const branch = id(11);
const drink = id(20);
const meal = id(21);

await db.exec(`
  insert into auth.users values
    ('${owner}','o@test'),('${mainMgr}','m@test'),('${cashier}','c@test'),('${stranded}','s@test');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN',true,true,'counted'),
    ('${branch}','Branch 1','B1',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id,is_active) values
    ('${owner}','Owner','owner',null,true),
    ('${mainMgr}','Main Manager','manager','${main}',true),
    ('${cashier}','Cashier','cashier','${branch}',true),
    ('${stranded}','Former Cashier','cashier','${branch}',false);
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${drink}','Drink','DRINK',25,true,'piece_stock','keep_at_branch'),
    ('${meal}','Meal','MEAL',80,true,'piece_stock','record_as_unsold');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${drink}',25,true),('${branch}','${meal}',80,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${drink}',100),('${main}','${meal}',100),
    ('${branch}','${drink}',10),('${branch}','${meal}',5);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const shiftId = (
  await asUser(cashier, () => db.query('select public.start_cashier_shift() id'))
).rows[0].id;
const historicalSale = (
  await asUser(cashier, () =>
    db.query('select * from public.confirm_sale($1,$2::jsonb,$3,$4)', [
      shiftId,
      JSON.stringify([{ product_id: drink, quantity: '2' }]),
      50,
      'staging-historical-sale-01',
    ]),
  )
).rows[0];
const preview = (
  await asUser(cashier, () => db.query('select public.begin_cashier_shift_close($1) preview', [shiftId]))
).rows[0].preview;
const products = preview.products.map((row) => ({
  product_id: row.product_id,
  actual_remaining: String(row.system_balance_before_waste),
  waste_quantity: '0',
}));
const finalized = (
  await asUser(cashier, () =>
    db.query('select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb) result', [
      shiftId,
      '50.00',
      JSON.stringify(products),
    ]),
  )
).rows[0].result;
assert.equal(Number(finalized.expected_cash), 50);
assert.equal(Number(finalized.actual_cash), 50);

await db.exec(`
  set session_replication_role = replica;
  insert into public.shifts(
    branch_id, cashier_id, status, started_at, ended_at, sales_cutoff_at,
    reconciliation_required, inventory_reconciliation_required
  ) values (
    '${branch}','${stranded}','closed', now() - interval '3 hours', now() - interval '2 hours', now() - interval '2 hours',
    true, true
  );
  update public.shifts
  set reconciliation_required = true, inventory_reconciliation_required = true
  where id = '${shiftId}';
  reset session_replication_role;
`);

const before = (
  await db.query(`
    select
      (select total_amount::text from public.sales where id = '${historicalSale.id}') as sale_total,
      (select amount_paid::text from public.sales where id = '${historicalSale.id}') as sale_paid,
      (select quantity::text || ':' || unit_price::text from public.sale_items where sale_id = '${historicalSale.id}') as sale_item,
      (select quantity_on_hand::text from public.branch_inventory where branch_id = '${branch}' and product_id = '${drink}') as drink_qty,
      (select quantity_on_hand::text from public.branch_inventory where branch_id = '${branch}' and product_id = '${meal}') as meal_qty,
      (select expected_cash::text || ':' || actual_cash::text || ':' || difference::text from public.shift_reconciliations where shift_id = '${shiftId}') as cash,
      (select string_agg(product_id::text || '=' || expected_remaining::text || '/' || actual_remaining::text || '/' || discrepancy::text, ',' order by product_id) from public.shift_product_reconciliations where shift_id = '${shiftId}') as recon,
      (select count(*)::int from public.inventory_movements) as movements,
      (select count(*)::int from public.sales) as sales
  `)
).rows[0];
assert.equal(before.sale_total, '50.00');
assert.equal(Number(before.drink_qty), 8);
assert.equal(Number(before.meal_qty), 0);
assert.equal(before.sales, 1);

for (const file of pending) {
  try {
    await db.exec(strip(readFileSync(`${dir}/${file}`, 'utf8')));
  } catch (error) {
    console.error(`MIGRATION FAILED: ${file}`);
    throw error;
  }
}
console.log('pending migrations applied on populated data');

const after = (
  await db.query(`
    select
      (select total_amount::text from public.sales where id = '${historicalSale.id}') as sale_total,
      (select amount_paid::text from public.sales where id = '${historicalSale.id}') as sale_paid,
      (select catalog_subtotal::text from public.sales where id = '${historicalSale.id}') as catalog_subtotal,
      (select discount_amount::text from public.sales where id = '${historicalSale.id}') as discount_amount,
      (select quantity::text || ':' || unit_price::text from public.sale_items where sale_id = '${historicalSale.id}') as sale_item,
      (select quantity_on_hand::text from public.branch_inventory where branch_id = '${branch}' and product_id = '${drink}') as drink_qty,
      (select quantity_on_hand::text from public.branch_inventory where branch_id = '${branch}' and product_id = '${meal}') as meal_qty,
      (select expected_cash::text || ':' || actual_cash::text || ':' || difference::text from public.shift_reconciliations where shift_id = '${shiftId}') as cash,
      (select count(*)::int from public.shift_reconciliations where shift_id = '${shiftId}') as cash_rows,
      (select string_agg(product_id::text || '=' || expected_remaining::text || '/' || actual_remaining::text || '/' || discrepancy::text, ',' order by product_id) from public.shift_product_reconciliations where shift_id = '${shiftId}') as recon,
      (select count(*)::int from public.shift_product_reconciliations where shift_id = '${shiftId}') as recon_rows,
      (select count(*)::int from public.inventory_movements) as movements,
      (select count(*)::int from public.sales) as sales,
      (select reconciliation_required::text || ':' || inventory_reconciliation_required::text from public.shifts where id = '${shiftId}') as healed_flags,
      (select reconciliation_required::text || ':' || inventory_reconciliation_required::text from public.shifts where cashier_id = '${stranded}') as stranded_flags
  `)
).rows[0];
assert.equal(after.sale_total, before.sale_total);
assert.equal(after.sale_paid, before.sale_paid);
assert.equal(after.sale_item, before.sale_item);
assert.equal(after.catalog_subtotal, '50.00');
assert.equal(after.discount_amount, '0.00');
assert.equal(Number(after.drink_qty), Number(before.drink_qty));
assert.equal(Number(after.meal_qty), Number(before.meal_qty));
assert.equal(after.cash, before.cash);
assert.equal(after.cash_rows, 1);
assert.equal(after.recon, before.recon);
assert.equal(after.movements, before.movements);
assert.equal(after.sales, before.sales);
await assert.rejects(
  () => db.query(`update public.sales set total_amount = total_amount + 1 where id = $1`, [historicalSale.id]),
  /immutable/i,
);
assert.equal(after.healed_flags, 'false:false');
assert.equal(after.stranded_flags, 'true:true', 'an incomplete remittance for an inactive cashier stays pending');
const noteColumn = (
  await db.query(`select discrepancy_note from public.shift_product_reconciliations where shift_id = $1 limit 1`, [shiftId])
).rows[0];
assert.equal(noteColumn.discrepancy_note, null);
console.log('history preserved; complete stuck flags healed; incomplete strand left pending');
await db.exec(`
  set session_replication_role = replica;
  delete from public.shifts where cashier_id = '${stranded}';
  reset session_replication_role;
`);

const guard = (
  await db.query(`select pricing_mode, fixed_amount::text amount from public.sale_pricing_program_settings where program = 'back_office_guard'`)
).rows[0];
assert.equal(guard.pricing_mode, 'amount_off');
assert.equal(guard.amount, '13.00');

const reopened = (
  await asUser(cashier, () => db.query(`select public.reopen_cashier_shift('Need to finish today sales') id`))
).rows[0].id;
assert.notEqual(reopened, shiftId);
const again = (
  await asUser(cashier, () => db.query(`select public.reopen_cashier_shift('Need to finish today sales') id`))
).rows[0].id;
assert.equal(again, reopened);
assert.equal(
  Number((await db.query(`select count(*) n from public.shift_reopen_events where closed_shift_id = $1`, [shiftId])).rows[0].n),
  1,
);
assert.equal(Number((await db.query(`select count(*) n from public.shift_reconciliations where shift_id = $1`, [shiftId])).rows[0].n), 1);
const opening = Number(
  (await db.query(`select opening_quantity q from public.shift_product_opening_stock where shift_id = $1 and product_id = $2`, [reopened, drink])).rows[0].q,
);
assert.equal(opening, 8);
console.log('reopen: new shift, one audit row, old remittance untouched, opening snapshot matches stock');

const sell = (lines, paid, key, program) =>
  asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
      reopened,
      JSON.stringify(lines),
      paid,
      key,
      program,
    ]),
  ).then((result) => result.rows[0]);
const drinkQty = async () =>
  Number((await db.query(`select quantity_on_hand q from public.branch_inventory where branch_id = $1 and product_id = $2`, [branch, drink])).rows[0].q);

const standard = await sell([{ product_id: drink, quantity: 1 }], '25.00', 'staging-standard-sale-001', 'standard');
assert.equal(Number(standard.total_amount), 25);
assert.equal(await drinkQty(), 7);

const office = await sell([{ product_id: drink, quantity: 1 }], '12.00', 'staging-guard-sale-000001', 'back_office_guard');
assert.equal(Number(office.total_amount), 12);
assert.equal(Number(office.discount_amount), 13);
assert.equal(await drinkQty(), 6);

const pwd = await sell([{ product_id: drink, quantity: 1 }], '18.75', 'staging-pwd-sale-0000001', 'pwd');
assert.equal(Number(pwd.total_amount), 18.75);
assert.equal(Number(pwd.discount_amount), 6.25);
assert.equal(await drinkQty(), 5);

const employee = await sell([{ product_id: drink, quantity: 1 }], '0.00', 'staging-employee-sale-01', 'employee_meal');
assert.equal(Number(employee.total_amount), 0);
assert.equal(await drinkQty(), 4);

await asUser(cashier, () =>
  assert.rejects(
    () =>
      db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
        reopened,
        JSON.stringify([{ product_id: drink, quantity: 100 }]),
        '2500.00',
        'staging-short-stock-0001',
        'standard',
      ]),
    /insufficient stock/i,
  ),
);
assert.equal(await drinkQty(), 4);
console.log('checkout: standard, ₱13 off, PWD, employee meal, insufficient stock');

const created = (
  await asUser(mainMgr, () =>
    db.query(
      `select * from public.create_complete_product(
        p_name := 'Chicken Curry', p_sku := 'CURRY-STG', p_description := null,
        p_variants := $1::jsonb, p_branches := $2::jsonb, p_selling_price := null,
        p_inventory_mode := 'piece_stock', p_closing_stock_behavior := 'keep_at_branch',
        p_stock_uses := null, p_drink_choices := $3::jsonb
      )`,
      [
        JSON.stringify([{ name: 'With Rice', default_price: '85.00' }]),
        JSON.stringify([{ branch_id: branch, variants: [{ name: 'With Rice', selling_price: '85.00' }] }]),
        JSON.stringify([{ variant_name: 'With Rice', drink_product_id: drink }]),
      ],
    ),
  )
).rows[0];
await asUser(mainMgr, () =>
  assert.rejects(
    () =>
      db.query(
        `select * from public.create_complete_product(
          p_name := 'Chicken Curry Copy', p_sku := 'CURRY-STG', p_description := null,
          p_variants := $1::jsonb, p_branches := $2::jsonb, p_selling_price := null,
          p_drink_choices := null
        )`,
        [
          JSON.stringify([{ name: 'With Rice', default_price: '85.00' }]),
          JSON.stringify([{ branch_id: branch, variants: [{ name: 'With Rice', selling_price: '85.00' }] }]),
        ],
      ),
    /sku|already|duplicate|23505/i,
  ),
);
await db.exec(`
  set session_replication_role = replica;
  update public.products set is_active = true where id = '${created.id}';
  reset session_replication_role;
  insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
  values ('${branch}','${created.id}',3)
  on conflict (branch_id, product_id) do update set quantity_on_hand = excluded.quantity_on_hand;
`);
const variantId = (
  await db.query(`select id from public.branch_product_variants where product_id = $1 and name = 'With Rice'`, [created.id])
).rows[0].id;
const beforeDrink = await drinkQty();
const withDrink = await sell(
  [{ product_id: created.id, variant_id: variantId, quantity: 1, drink_product_id: drink }],
  '85.00',
  'staging-drink-choice-001',
  'standard',
);
assert.equal(Number(withDrink.total_amount), 85);
assert.equal(await drinkQty(), beforeDrink - 1);
assert.equal(
  Number((await db.query(`select quantity_on_hand q from public.branch_inventory where branch_id = $1 and product_id = $2`, [branch, created.id])).rows[0].q),
  2,
);
await asUser(cashier, () =>
  assert.rejects(
    () =>
      db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
        reopened,
        JSON.stringify([{ product_id: created.id, variant_id: variantId, quantity: 1 }]),
        '85.00',
        'staging-missing-drink-01',
        'standard',
      ]),
    /choose a drink/i,
  ),
);
console.log('drink choice deducts the drink; missing drink is rejected; duplicate SKU is rejected');

const opened = (
  await asUser(mainMgr, () =>
    db.query(`select * from public.create_complete_product(
      p_name := 'New Side', p_sku := 'SIDE-STG', p_description := null,
      p_variants := '[]'::jsonb, p_branches := $1::jsonb, p_selling_price := '15.00',
      p_drink_choices := null
    )`, [JSON.stringify([{ branch_id: branch, selling_price: '15.00' }])]),
  )
).rows[0];
assert.equal(opened.is_active, false);
await asUser(mainMgr, () =>
  db.query(`select public.initialize_main_branch_inventory($1::jsonb, $2)`, [
    JSON.stringify([{ product_id: opened.id, quantity: '4' }]),
    'staging opening',
  ]),
);
const openedAfter = (await db.query(`select is_active, selling_price::text price from public.products where id = $1`, [opened.id])).rows[0];
assert.equal(openedAfter.is_active, false, 'opening stock does not change Product Status');
assert.equal(openedAfter.price, '15.00');
assert.equal(
  Number((await db.query(`select quantity_on_hand q from public.branch_inventory where branch_id = $1 and product_id = $2`, [main, opened.id])).rows[0].q),
  4,
);
assert.equal(await drinkQty(), beforeDrink - 1, 'opening stock did not change the historical booth drink balance');
console.log('opening stock adds quantity without changing Product Status');

const overloads = (
  await db.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('confirm_sale', 'create_complete_product', 'update_complete_product')
    order by 1, 2
  `)
).rows;
console.log('function overloads after pending migrations:');
for (const row of overloads) console.log(`  ${row.proname}(${row.args})`);

console.log('STAGING MIGRATION QA: PASS');
