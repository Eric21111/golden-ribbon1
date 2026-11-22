/**
 * Approach C′ Egg single-inventory cutover — LOCAL PGlite suite only.
 *
 * Does NOT talk to production. Does NOT push.
 *
 * Production-approval conditions (all required):
 * 1. Migration install verified data-safe (this suite).
 * 2. Every branch Egg on_hand == SUM(movements); no open Egg transfers/returns/discrepancies.
 * 3. No open shifts; every device on a build that sends x-gr-half-egg:1 + 0.5 Egg stepper.
 * 4. HALF-EGG unused; recipes reviewed for ×2 within 1..49.
 * 5. Era-aware historical display reviewed/tested (see egg_cutover_era_display.mjs).
 * 6. Explicit operator runs apply_egg_half_unit_cutover() in a privileged SQL session — never via app.
 * 7. Rollback window only before any post-cutover Egg activity.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const QUARANTINE = 'supabase/migrations_quarantine';
const MIGRATION = '20261122120000_egg_half_unit_cutover.sql';
const RECON_MIGRATION = '20261122130000_egg_cutover_recon_era.sql';
const EGG_MIGRATIONS = [MIGRATION, RECON_MIGRATION];
assert.equal(
  readdirSync('supabase/migrations').filter((n) => EGG_MIGRATIONS.includes(n)).length,
  0,
  'Egg cutover SQL must stay quarantined out of the active migration directory',
);
const src = readFileSync(`${QUARANTINE}/${MIGRATION}`, 'utf8');
const reconSrc = readFileSync(`${QUARANTINE}/${RECON_MIGRATION}`, 'utf8');
const codeNoComments = src.replace(/--[^\n]*/g, '');

assert.match(src, /reference_type.*unit_conversion/);
assert.match(src, /apply_egg_half_unit_cutover/);
assert.match(src, /rollback_egg_half_unit_cutover/);
assert.match(src, /stock_unit_cutovers/);
assert.match(src, /guard_post_cutover_egg_client/);
assert.match(src, /x-gr-half-egg/);
assert.doesNotMatch(codeNoComments, /do\s+\$\$[\s\S]*apply_egg_half_unit_cutover/);
assert.doesNotMatch(src, /v_result\s*:=\s*public\.apply_egg_half_unit_cutover/);
assert.match(src, /No automatic cutover/i);
assert.match(src, /revoke all on function public\.apply_egg_half_unit_cutover\(\) from public, anon, authenticated/);
assert.match(src, /grant execute on function public\.apply_egg_half_unit_cutover\(\) to service_role/);
assert.match(reconSrc, /stock_unit_cutover_at/);
assert.match(reconSrc, /unit_conversion/);
assert.match(reconSrc, /Install-only for display/i);
assert.doesNotMatch(reconSrc.replace(/--[^\n]*/g, ''), /update\s+public\.products|update\s+public\.branch_inventory|apply_egg_half_unit_cutover/i);

const format = loadTs('src/lib/format.ts');
assert.equal(format.formatLiveStock(10, 'piece_stock', 'half_egg'), '5 eggs');
assert.equal(format.formatSnapshottedQuantity(10, 'piece_stock', 'half_egg'), '10 half-egg units');

const { portionsToUnits } = loadTs('src/lib/stockUnits.ts');
assert.equal(portionsToUnits(0.5, 'half_egg'), 1);

const supabaseSrc = readFileSync('src/lib/supabase.ts', 'utf8');
assert.match(supabaseSrc, /x-gr-half-egg['"]:\s*['"]1['"]/);

const BOOT = `
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
`;

async function boot({ includeCutoverMigration = true } = {}) {
  const db = new PGlite();
  await db.exec(BOOT);
  for (const file of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
  }
  if (includeCutoverMigration) {
    for (const file of EGG_MIGRATIONS) await execMigration(db, file);
  }
  return db;
}

function execMigration(db, file) {
  return db.exec(readFileSync(`${QUARANTINE}/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `e9900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const main = id(10);
const sm1 = id(11);
const sm2 = id(12);
const eggId = '9f0a71bf-3eaf-4edb-9a98-18177461f270';
const halfEggId = id(20);
const extraEggId = id(21);
const tapaId = id(22);
const riceId = id(23);

async function asUser(db, userId, work) {
  // Session-scoped claim (is_local=false) so it survives separate query() calls; always clear on exit.
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub','',false); reset role;`);
  }
}

/** Simulate current app build header after cutover. */
async function asHalfEggClient(db, userId, work) {
  await db.exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub','${userId}',false);
    select set_config('request.headers', '{"x-gr-half-egg":"1"}', false);
  `);
  try {
    return await work();
  } finally {
    await db.exec(`
      select set_config('request.jwt.claim.sub','',false);
      select set_config('request.headers','',false);
      reset role;
    `);
  }
}

/** Privileged operator: no JWT, default role (owns functions / service path). */
async function asOperator(db, work) {
  await db.exec(`select set_config('request.jwt.claim.sub','',false); select set_config('request.headers','',false); reset role;`);
  return work();
}

async function seedLegacyEggWorld(db) {
  await db.exec(`
    insert into auth.users values ('${owner}','owner@test'),('${manager}','mgr@test'),('${cashier}','c@test');
    insert into public.branches(id,name,code,is_main_branch,is_active) values
      ('${main}','Main Branch','MAIN',true,true),
      ('${sm1}','SM1','SM1',false,true),
      ('${sm2}','SM2','SM2',false,true);
    insert into public.profiles(id,full_name,role,branch_id) values
      ('${owner}','Owner','owner','${main}'),
      ('${manager}','Manager','manager','${main}'),
      ('${cashier}','Cashier','cashier','${sm1}');
    insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior,sell_in_pos,stock_unit_code)
    values
      ('${eggId}','Egg','EGG',null,true,'piece_stock','keep_at_branch',false,null),
      ('${halfEggId}','Half Egg','HALF-EGG',null,true,'piece_stock','keep_at_branch',false,'piece'),
      ('${extraEggId}','Extra Egg','XEGG',15,true,'piece_stock','keep_at_branch',true,null),
      ('${tapaId}','Beef Tapa','TAPA',90,true,'piece_stock','keep_at_branch',true,null),
      ('${riceId}','Rice','RICE',15,true,'piece_stock','keep_at_branch',true,null);
    insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
      ('${sm1}','${extraEggId}',15,true),('${sm1}','${tapaId}',90,true),('${sm1}','${riceId}',15,true),
      ('${sm2}','${extraEggId}',15,true);
    insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values
      ('${extraEggId}',null,'${eggId}',1),
      ('${tapaId}',null,'${eggId}',1);
  `);
  await asUser(db, manager, () =>
    db.query('select public.initialize_main_branch_inventory($1::jsonb, $2)', [
      JSON.stringify([{ product_id: eggId, quantity: '5' }, { product_id: halfEggId, quantity: '3' }]),
      'pre-cutover egg opening',
    ]),
  );
}

async function eggSnapshot(db) {
  const product = (await db.query(
    'select id, sku, stock_unit_code, inventory_mode, sell_in_pos from public.products where id=$1',
    [eggId],
  )).rows[0];
  const inventory = (await db.query(
    `select branch_id::text, quantity_on_hand::float8 q, quantity_awaiting_return::float8 a
     from public.branch_inventory where product_id=$1 order by branch_id`,
    [eggId],
  )).rows;
  const movements = (await db.query(
    `select id::text, branch_id::text, movement_type, reference_type, quantity::float8 q, notes
     from public.inventory_movements where product_id=$1 order by created_at, id`,
    [eggId],
  )).rows;
  const recipes = (await db.query(
    `select product_id::text, quantity::int q from public.product_stock_uses
     where ingredient_product_id=$1 order by product_id`,
    [eggId],
  )).rows;
  const table = await db.query(`select to_regclass('public.stock_unit_cutovers') t`);
  const cutovers = table.rows[0].t
    ? (await db.query(
      'select count(*)::int n from public.stock_unit_cutovers where product_id=$1',
      [eggId],
    )).rows[0].n
    : 0;
  return { product, inventory, movements, recipes, cutovers };
}

const eggOnHand = async (db, branchId) => {
  const r = await db.query(
    'select coalesce(quantity_on_hand,0)::float8 q from public.branch_inventory where branch_id=$1 and product_id=$2',
    [branchId, eggId],
  );
  return r.rows[0] ? Number(r.rows[0].q) : 0;
};
const eggMovements = async (db, branchId) => {
  const r = await db.query(
    'select coalesce(sum(quantity),0)::float8 s from public.inventory_movements where branch_id=$1 and product_id=$2',
    [branchId, eggId],
  );
  return Number(r.rows[0].s);
};
const recipeQty = async (db, productId) => {
  const r = await db.query(
    'select quantity::int q from public.product_stock_uses where product_id=$1 and ingredient_product_id=$2',
    [productId, eggId],
  );
  return r.rows[0]?.q;
};

// ---------------------------------------------------------------------------
// 1) Both Egg migrations install alone change ZERO Egg data
// ---------------------------------------------------------------------------
{
  const db = await boot({ includeCutoverMigration: false });
  await seedLegacyEggWorld(db);
  const before = await eggSnapshot(db);
  assert.equal(before.product.stock_unit_code, null);
  assert.equal(before.inventory[0].q, 5);
  assert.equal(before.recipes.find((r) => r.product_id === extraEggId).q, 1);

  await execMigration(db, MIGRATION);
  const afterCutoverSql = await eggSnapshot(db);
  assert.deepEqual(afterCutoverSql.product, before.product, 'Egg metadata unchanged by cutover migration install');
  assert.deepEqual(afterCutoverSql.inventory, before.inventory, 'Egg balances unchanged by cutover migration install');
  assert.deepEqual(afterCutoverSql.movements, before.movements, 'Egg movements unchanged by cutover migration install');
  assert.deepEqual(afterCutoverSql.recipes, before.recipes, 'Egg recipes unchanged by cutover migration install');
  assert.equal(afterCutoverSql.cutovers, 0, 'no cutover row from cutover migration install');

  await execMigration(db, RECON_MIGRATION);
  const after = await eggSnapshot(db);
  assert.deepEqual(after.product, before.product, 'Egg metadata unchanged by recon era migration install');
  assert.deepEqual(after.inventory, before.inventory, 'Egg balances unchanged by recon era migration install');
  assert.deepEqual(after.movements, before.movements, 'Egg movements unchanged by recon era migration install');
  assert.deepEqual(after.recipes, before.recipes, 'Egg recipes unchanged by recon era migration install');
  assert.equal(after.cutovers, 0, 'no cutover row from recon era migration install');
  assert.equal(
    (await db.query(`select to_regprocedure('public.apply_egg_half_unit_cutover()') is not null ok`)).rows[0].ok,
    true,
  );
  await db.close();
}

// ---------------------------------------------------------------------------
// 2) Explicit operator cutover on disposable DB
// ---------------------------------------------------------------------------
const db = await boot();
await seedLegacyEggWorld(db);

assert.equal(await eggOnHand(db, main), 5);
assert.equal(await recipeQty(db, extraEggId), 1);

// Unauthorized: authenticated owner/cashier cannot execute cutover
await assert.rejects(
  () => asUser(db, owner, () => db.query('select public.apply_egg_half_unit_cutover()')),
  /permission denied|restricted to a privileged database operator/i,
);
await assert.rejects(
  () => asUser(db, cashier, () => db.query('select public.apply_egg_half_unit_cutover()')),
  /permission denied|restricted to a privileged database operator/i,
);

// Operator session: no JWT
const applied = (await asOperator(db, () => db.query('select public.apply_egg_half_unit_cutover() r'))).rows[0].r;
assert.equal(applied.status, 'applied');
assert.equal(applied.product_id, eggId);
assert.equal(await eggOnHand(db, main), 10);
assert.equal(format.formatLiveStock(10, 'piece_stock', 'half_egg'), '5 eggs');
assert.equal((await db.query('select stock_unit_code from public.products where id=$1', [eggId])).rows[0].stock_unit_code, 'half_egg');
assert.equal(await recipeQty(db, extraEggId), 2);
assert.equal(await recipeQty(db, tapaId), 2);

const half = (await db.query('select stock_unit_code, quantity_on_hand::float8 q from public.products p join public.branch_inventory bi on bi.product_id=p.id where p.id=$1 and bi.branch_id=$2', [halfEggId, main])).rows[0];
assert.equal(half.stock_unit_code, 'piece');
assert.equal(half.q, 3);

for (const branchId of [main, sm1, sm2]) {
  assert.equal(await eggOnHand(db, branchId), await eggMovements(db, branchId));
}
const recon = await asUser(db, owner, async () =>
  (await db.query('select public.report_inventory_reconciliation($1) r', [main])).rows[0].r,
);
const found = (Array.isArray(recon) ? recon : []).find((p) => p.product_id === eggId);
assert.ok(found);
assert.equal(Number(found.variance), 0);
assert.equal(Number(found.current_stock), 10);
assert.equal(Number(found.calculated_stock), 10);

const conv = await db.query(
  `select movement_type, reference_type, quantity::float8 q, notes, branch_stock_action
   from public.inventory_movements where product_id=$1 and reference_type='unit_conversion'`,
  [eggId],
);
assert.equal(conv.rows.length, 1);
assert.equal(conv.rows[0].q, 5);
assert.equal(conv.rows[0].branch_stock_action, null);
assert.match(conv.rows[0].notes, /Not a purchase, opening stock/);

assert.equal(
  (await db.query(`select quantity::float8 q from public.inventory_movements where product_id=$1 and movement_type='opening_stock'`, [eggId])).rows[0].q,
  5,
  'historical opening stays 5 whole eggs',
);

const cutoverAt = (await asUser(db, owner, async () =>
  (await db.query('select public.egg_half_unit_cutover_at() t')).rows[0].t,
));
assert.ok(cutoverAt);

// Unresolved historical display: applying live half_egg label to pre-cutover qty misstates physical meaning.
assert.equal(
  format.formatSnapshottedQuantity(5, 'piece_stock', 'half_egg'),
  '5 half-egg units',
  'document gap: pre-cutover 5 whole eggs would be mislabeled if live unit metadata is applied blindly',
);

await db.query(
  `insert into public.product_stock_uses(product_id,variant_id,ingredient_product_id,quantity) values ($1,null,$2,1)`,
  [riceId, eggId],
);
assert.equal(await recipeQty(db, riceId), 1);

// Today Log / opening-stock exclusion
const log = await asUser(db, owner, async () =>
  (await db.query('select public.get_owner_today_activity_log() r')).rows[0].r,
);
assert.equal((log.activities ?? []).filter((a) => String(a.id).includes('unit_conversion')).length, 0);
assert.equal(
  (await db.query(`
    select count(*)::int n from public.inventory_movements m
    join public.branches b on b.id = m.branch_id
    where b.is_main_branch and m.movement_type='adjustment' and m.reference_type='unit_conversion'
      and m.reference_type='adjustment'
  `)).rows[0].n,
  0,
);
// local_purchase / stock-addition style reports must not treat unit_conversion as those types
assert.equal(
  (await db.query(`select count(*)::int n from public.inventory_movements where reference_type='unit_conversion' and reference_type in ('local_purchase','opening_stock')`)).rows[0].n,
  0,
);
assert.equal(
  (await db.query(`select count(*)::int n from public.inventory_movements where reference_type='unit_conversion' and branch_stock_action is not null`)).rows[0].n,
  0,
);

// Outdated client blocked from direct Egg stock writes
await assert.rejects(
  () => asUser(db, manager, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3)', [
      sm1,
      JSON.stringify([{ product_id: eggId, quantity_sent: 2 }]),
      'outdated-egg-transfer-001',
    ]),
  ),
  /half-egg units|Update Golden Ribbon/i,
);

// Current client can transfer Egg; sale of Extra Egg (server recipe) works without header
await asHalfEggClient(db, manager, () =>
  db.query('select public.initialize_main_branch_inventory($1::jsonb, null)', [
    JSON.stringify([{ product_id: riceId, quantity: '20' }, { product_id: tapaId, quantity: '10' }]),
  ]),
);
const transferId = (
  await asHalfEggClient(db, manager, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [
      sm1,
      JSON.stringify([
        { product_id: eggId, quantity_sent: 4 },
        { product_id: tapaId, quantity_sent: 3 },
        { product_id: riceId, quantity_sent: 5 },
      ]),
      'egg-cutover-transfer-001',
    ]),
  )
).rows[0].id;
await asHalfEggClient(db, cashier, () =>
  db.query('select public.confirm_shipment_arrival($1,$2)', [transferId, 'egg-cutover-arrival-001']),
);
assert.equal(await eggOnHand(db, sm1), 4);
assert.equal(await eggOnHand(db, main), 6);

const shift = (await asUser(db, cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
const beforeSale = await eggOnHand(db, sm1);
await asUser(db, cashier, () =>
  db.query('select public.confirm_sale($1,$2::jsonb,20,$3)', [
    shift,
    JSON.stringify([{ product_id: extraEggId, quantity: 1 }]),
    'egg-cutover-sale-0001',
  ]),
);
assert.equal(await eggOnHand(db, sm1), beforeSale - 2);
assert.equal(await eggOnHand(db, main), await eggMovements(db, main));
assert.equal(await eggOnHand(db, sm1), await eggMovements(db, sm1));

// Repeat cutover rejected
await assert.rejects(() => asOperator(db, () => db.query('select public.apply_egg_half_unit_cutover()')), /already applied/i);

// Rollback rejected after post-cutover activity
await assert.rejects(() => asOperator(db, () => db.query('select public.rollback_egg_half_unit_cutover()')), /post-cutover|Rollback refused/i);

// Unauthorized rollback via app
await assert.rejects(
  () => asUser(db, owner, () => db.query('select public.rollback_egg_half_unit_cutover()')),
  /permission denied|restricted to a privileged database operator/i,
);

await assert.rejects(
  () => db.query("update public.products set stock_unit_code='piece' where id=$1", [eggId]),
  /cannot be changed/i,
);

await db.close();

// ---------------------------------------------------------------------------
// 3) Rollback valid only before post-cutover activity
// ---------------------------------------------------------------------------
{
  const db2 = await boot();
  await seedLegacyEggWorld(db2);
  await asOperator(db2, () => db2.query('select public.apply_egg_half_unit_cutover()'));
  const rolled = (await asOperator(db2, () => db2.query('select public.rollback_egg_half_unit_cutover() r'))).rows[0].r;
  assert.equal(rolled.status, 'rolled_back');
  assert.equal(await eggOnHand(db2, main), 5);
  assert.equal((await db2.query('select stock_unit_code from public.products where id=$1', [eggId])).rows[0].stock_unit_code, null);
  assert.equal(await recipeQty(db2, extraEggId), 1);
  const again = (await asOperator(db2, () => db2.query('select public.apply_egg_half_unit_cutover() r'))).rows[0].r;
  assert.equal(again.status, 'applied');
  await db2.close();
}

// ---------------------------------------------------------------------------
// 4) Open shift / balance mismatch still abort operator cutover
// ---------------------------------------------------------------------------
{
  const db3 = await boot();
  await seedLegacyEggWorld(db3);
  await asUser(db3, cashier, () => db3.query('select public.start_cashier_shift()'));
  await assert.rejects(() => asOperator(db3, () => db3.query('select public.apply_egg_half_unit_cutover()')), /open shifts/i);
  await db3.close();
}
{
  const db4 = await boot();
  await seedLegacyEggWorld(db4);
  await db4.query('update public.branch_inventory set quantity_on_hand = 99 where branch_id=$1 and product_id=$2', [main, eggId]);
  await assert.rejects(() => asOperator(db4, () => db4.query('select public.apply_egg_half_unit_cutover()')), /balance mismatch/i);
  await db4.close();
}

console.log(
  'Egg cutover safety passed: install is data-safe, operator-only apply/rollback, recon 0, Today Log exclusion, outdated client blocked, history qty preserved, repeat/rollback-after-activity rejected.',
);
