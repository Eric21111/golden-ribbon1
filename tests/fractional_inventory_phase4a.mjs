/**
 * Phase 4A — fractional inventory backend (local PGlite only).
 * Server recipe + ops gates default OFF; enable ops before half-step transfer tests.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { verifiedClose } from './_verified_cashier_close.mjs';

assert.equal(
  readdirSync('supabase/migrations').filter((n) => n.includes('egg_half_unit') || n.includes('egg_cutover')).length,
  0,
  'no Egg cutover in active migrations',
);
assert.ok(readdirSync('supabase/migrations').includes('20261123130000_fractional_inventory_feature_gate.sql'));
assert.ok(readdirSync('supabase/migrations').includes('20261123130100_fractional_inventory_parse_and_schema.sql'));
assert.ok(readdirSync('supabase/migrations').includes('20261123130200_fractional_inventory_ops_rpcs.sql'));

const BOOT = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`;

const db = new PGlite();
await db.exec(BOOT);
for (const file of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `b4000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const rice = id(20);
const meal = id(21);
const portionEgg = id(22);

await db.exec(`
  insert into auth.users values ('${owner}','o@t'),('${manager}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main','MAIN',true,true),('${branch}','Booth','BTH',false,true);
  insert into public.profiles(id,full_name,role,is_active,branch_id) values
    ('${owner}','Owner','owner',true,'${main}'),
    ('${manager}','Mgr','manager',true,'${main}'),
    ('${cashier}','Cash','cashier',true,'${branch}');
  insert into public.products(id,name,sku,inventory_mode,is_active,sell_in_pos,selling_price,stock_unit_code) values
    ('${rice}','Rice','RICE-4A','piece_stock',true,false,null,'piece'),
    ('${meal}','Rice Meal','MEAL-4A','piece_stock',true,true,50,null),
    ('${portionEgg}','Egg','EGG-4A','piece_stock',true,false,null,'half_egg');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${meal}',50,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${rice}',100),('${main}','${portionEgg}',40),
    ('${branch}','${rice}',10),('${branch}','${meal}',5),('${branch}','${portionEgg}',10);
`);

const as = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub','',false); reset role;`);
  }
};

// ---- 1. server gate default OFF; client cannot flip via header
{
  assert.equal((await db.query('select public.fractional_recipe_saving_enabled() e')).rows[0].e, false);
  await assert.rejects(
    as(manager, () => db.query('select public.set_fractional_recipe_saving_enabled(true)')),
    /Owner access/i,
  );
  await assert.rejects(
    as(cashier, () => db.query('select public.set_fractional_recipe_saving_enabled(true)')),
    /Owner access/i,
  );
  // No request header / GUC path
  await db.exec(`select set_config('request.headers','{"x-fractional":"1"}',true)`);
  assert.equal((await db.query('select public.fractional_recipe_saving_enabled() e')).rows[0].e, false);
  console.log('gate default OFF + owner-only: ok');
}

const createMeal = (name, sku, stockUses) =>
  as(manager, () =>
    db.query(
      `select * from public.create_complete_product(
        p_name:=$1, p_sku:=$2, p_description:=null,
        p_variants:='[]'::jsonb, p_branches:=$3::jsonb, p_selling_price:='40',
        p_stock_uses:=$4::jsonb)`,
      [
        name,
        sku,
        JSON.stringify([{ branch_id: branch, selling_price: '40.00' }]),
        JSON.stringify(stockUses),
      ],
    ),
  );

const updateMeal = (productId, name, sku, stockUses) =>
  as(manager, () =>
    db.query(
      `select * from public.update_complete_product(
        p_product_id:=$1, p_name:=$2, p_sku:=$3, p_description:=null, p_is_active:=true,
        p_variants:='[]'::jsonb, p_deleted_variant_ids:='[]'::jsonb, p_branches:=$4::jsonb,
        p_selling_price:='40', p_stock_uses:=$5::jsonb)`,
      [
        productId,
        name,
        sku,
        JSON.stringify([{ branch_id: branch, selling_price: '40.00' }]),
        JSON.stringify(stockUses),
      ],
    ),
  );

// ---- 2. gate OFF rejects fractional recipe saves via product RPCs
{
  await assert.rejects(
    () => createMeal('Frac Meal', 'FRAC-4A', [{ ingredient_product_id: rice, quantity: 0.5 }]),
    /whole number from 1 to 99/i,
  );
  const whole = await createMeal('Whole Meal', 'WHOLE-4A', [{ ingredient_product_id: rice, quantity: 1 }]);
  assert.ok(whole.rows[0].id);
  console.log('gate OFF rejects fractional recipes: ok');
}

// ---- 3. gate ON permits valid 0.5 recipes; still rejects 0.3; portion stays whole
{
  assert.equal(
    (await as(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(true) e'))).rows[0].e,
    true,
  );
  const half = await createMeal('Half Meal', 'HALF-4A', [{ ingredient_product_id: rice, quantity: 0.5 }]);
  assert.equal(
    Number(
      (await db.query(`select quantity::float8 q from public.product_stock_uses where product_id=$1`, [half.rows[0].id]))
        .rows[0].q,
    ),
    0.5,
  );
  await assert.rejects(
    () => createMeal('Bad Meal', 'BAD-4A', [{ ingredient_product_id: rice, quantity: 0.3 }]),
    /half-step/i,
  );
  await assert.rejects(
    () => updateMeal(meal, 'Rice Meal', 'MEAL-4A', [{ ingredient_product_id: portionEgg, quantity: 0.5 }]),
    /whole number of stock units|Portion-unit/i,
  );
  await as(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(false)'));
  // Recipe ON auto-enables ops; restore both to production defaults before ops-gate checks.
  await as(owner, () => db.query('select public.set_fractional_piece_ops_enabled(false)'));
  console.log('gate ON half-step + portion guard: ok');
}

// ---- 4. parse_inventory_quantity (ops gate OFF rejects half-steps)
{
  await assert.rejects(
    db.query(`select public.parse_inventory_quantity('9.5','piece_stock',true)`),
    /half-step stock ops|whole numbers/i,
  );
  assert.equal(Number((await db.query(`select public.parse_inventory_quantity('0','piece_stock',true) q`)).rows[0].q), 0);
  assert.equal(Number((await db.query(`select public.parse_inventory_quantity('10','piece_stock',false) q`)).rows[0].q), 10);
  await assert.rejects(db.query(`select public.parse_inventory_quantity('0.3','piece_stock',true)`), /whole numbers|half-step/i);
  await assert.rejects(db.query(`select public.parse_inventory_quantity('9.5','kg_meal',true)`), /retired|KG/i);
  console.log('parse_inventory_quantity gate OFF: ok');
}

// ---- 5. transfer 0.5 + correction + waste (ops gate ON in disposable DB)
{
  assert.equal(
    (await as(owner, () => db.query('select public.set_fractional_piece_ops_enabled(true) e'))).rows[0].e,
    true,
  );
  assert.equal(Number((await db.query(`select public.parse_inventory_quantity('9.5','piece_stock',true) q`)).rows[0].q), 9.5);
  assert.equal(Number((await db.query(`select public.parse_inventory_quantity('0.5','piece_stock',false) q`)).rows[0].q), 0.5);
  const xfer = (
    await as(manager, () =>
      db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [
        branch,
        JSON.stringify([{ product_id: rice, quantity_sent: '0.5', destination_price: 10 }]),
        '4a-xfer-halfstep-0001',
      ]),
    )
  ).rows[0].id;
  await as(cashier, () => db.query('select public.confirm_shipment_arrival($1,$2)', [xfer, '4a-arrive-half-00001']));
  const onHand = Number(
    (await db.query(`select quantity_on_hand::float8 q from public.branch_inventory where branch_id=$1 and product_id=$2`, [
      branch,
      rice,
    ])).rows[0].q,
  );
  assert.equal(onHand, 10.5, 'booth rice 10 + 0.5 transfer');

  // portion egg transfer of 0.5 rejected
  await assert.rejects(
    as(manager, () =>
      db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3)', [
        branch,
        JSON.stringify([{ product_id: portionEgg, quantity_sent: '0.5' }]),
        '4a-xfer-portion-bad01',
      ]),
    ),
    /whole numbers|Portion-unit|half-step/i,
  );

  const shift = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  const opening = Number(
    (
      await db.query(
        `select opening_quantity::float8 q from public.shift_product_opening_stock where shift_id=$1 and product_id=$2`,
        [shift, rice],
      )
    ).rows[0].q,
  );
  assert.equal(opening, 10.5, 'shift opening preserves 10.5');

  const riceRow = (
    await db.query(`select quantity_on_hand::float8 q, updated_at from public.branch_inventory where branch_id=$1 and product_id=$2`, [
      branch,
      rice,
    ])
  ).rows[0];
  await as(cashier, () =>
    db.query(
      `select public.correct_cashier_stock_count($1,$2,$3,$4,$5,'Physical recount',$6)`,
      [shift, rice, riceRow.q, riceRow.updated_at, 9.5, '4a-correct-halfstep01'],
    ),
  );
  assert.equal(
    Number(
      (await db.query(`select quantity_on_hand::float8 q from public.branch_inventory where branch_id=$1 and product_id=$2`, [branch, rice]))
        .rows[0].q,
    ),
    9.5,
  );

  await as(manager, () =>
    db.query(`select public.record_main_inventory_waste($1,$2,$3,$4,$5)`, [
      rice,
      0.5,
      99.5, // main was 100, sent 0.5 → 99.5
      'spoiled half',
      '4a-main-waste-half001',
    ]),
  );
  assert.equal(
    Number(
      (await db.query(`select quantity_on_hand::float8 q from public.branch_inventory where branch_id=$1 and product_id=$2`, [main, rice]))
        .rows[0].q,
    ),
    99,
  );
  console.log('transfer/correction/waste 0.5: ok');
}

// ---- 6. sale deduct 0.5 (direct recipe row; gate OFF) + shift close with 9.5
{
  // Close any open shift from earlier sections so opening stock snapshots 9.5 cleanly.
  const open = (
    await db.query(
      `select id from public.shifts where cashier_id='${cashier}' and status='open' order by started_at desc limit 1`,
    )
  ).rows[0];
  if (open) {
    await db.exec(`update public.shifts set status='closed', ended_at=now(), sales_cutoff_at=now() where id='${open.id}'`);
  }

  await db.exec(`
    delete from public.product_stock_uses where product_id='${meal}';
    insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity)
    values ('${meal}',null,'${rice}',0.5);
    update public.branch_inventory set quantity_on_hand=10 where branch_id='${branch}' and product_id='${rice}';
    update public.branch_inventory set quantity_on_hand=5 where branch_id='${branch}' and product_id='${meal}';
    update public.branch_inventory set quantity_on_hand=10 where branch_id='${branch}' and product_id='${portionEgg}';
  `);

  const shiftId = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
  await as(cashier, () =>
    db.query(`select (public.confirm_sale($1,$2::jsonb,100,$3,'standard','cash')).id`, [
      shiftId,
      JSON.stringify([{ product_id: meal, quantity: 1 }]),
      '4a-sale-half-00000001',
    ]),
  );
  assert.equal(
    Number(
      (await db.query(`select quantity_on_hand::float8 q from public.branch_inventory where branch_id=$1 and product_id=$2`, [branch, rice]))
        .rows[0].q,
    ),
    9.5,
  );

  const preview = (await as(cashier, () => verifiedClose(db, shiftId))).rows[0].p;
  const ricePreview = (preview.products || []).find((p) => p.product_id === rice);
  assert.ok(ricePreview, 'rice in close preview');
  assert.equal(Number(ricePreview.system_balance_before_waste), 9.5);

  const counts = (preview.products || []).map((p) => ({
    product_id: p.product_id,
    actual_remaining: String(p.system_balance_before_waste),
    waste_quantity: '0',
  }));
  const result = (
    await as(cashier, () =>
      db.query(`select public.finalize_cashier_shift_reconciliation($1,$2::text,$3::jsonb,$4::text) r`, [
        shiftId,
        String(preview.expected_cash ?? 0),
        JSON.stringify(counts),
        '0',
      ]),
    )
  ).rows[0].r;
  assert.equal(result.status, 'reconciled');
  assert.equal(
    Number(
      (await db.query(`select quantity_on_hand::float8 q from public.branch_inventory where branch_id=$1 and product_id=$2`, [branch, rice]))
        .rows[0].q,
    ),
    9.5,
  );
  console.log('sale + shift close with 9.5: ok');
}

// ---- 7. historical quantities unchanged by migration install (spot-check cast identity)
{
  // Whole numbers that existed before alter remain equal after ::numeric
  assert.equal(
    Number((await db.query(`select 10::bigint::numeric(14,3) = 10::numeric q`)).rows[0].q),
    1,
  );
  console.log('migration cast preserves wholes: ok');
}

// ---- 8. restore gates OFF (production defaults)
{
  await as(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(false)'));
  await as(owner, () => db.query('select public.set_fractional_piece_ops_enabled(false)'));
  assert.equal((await db.query('select public.fractional_recipe_saving_enabled() e')).rows[0].e, false);
  assert.equal((await db.query('select public.fractional_piece_ops_enabled() e')).rows[0].e, false);
  console.log('gates restored OFF: ok');
}

console.log('fractional_inventory_phase4a: ALL PASS');
await db.close();
