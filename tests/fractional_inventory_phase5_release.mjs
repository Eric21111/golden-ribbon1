/**
 * Phase 5 — release-safety: ops cannot create 0.5 balances while gates are OFF.
 * Egg cutover stays quarantined. Client activation gate stays false.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

assert.equal(
  readdirSync('supabase/migrations').filter((n) => n.includes('egg_half_unit') || n.includes('egg_cutover')).length,
  0,
);
assert.ok(readdirSync('supabase/migrations_quarantine').some((n) => n.includes('egg_half_unit')));
assert.ok(readdirSync('supabase/migrations').includes('20261123150000_fractional_piece_ops_gate.sql'));

const half = loadTs('src/lib/halfStepQuantity.ts');
assert.equal(half.FRACTIONAL_STOCK_USES_ENABLED, false);

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

const id = (n) => `b5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const rice = id(20);

await db.exec(`
  insert into auth.users values ('${owner}','o@t'),('${manager}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main','MAIN',true,true),('${branch}','Booth','BTH',false,true);
  insert into public.profiles(id,full_name,role,is_active,branch_id) values
    ('${owner}','Owner','owner',true,'${main}'),
    ('${manager}','Mgr','manager',true,'${main}'),
    ('${cashier}','Cash','cashier',true,'${branch}');
  insert into public.products(id,name,sku,inventory_mode,is_active,sell_in_pos,selling_price,stock_unit_code) values
    ('${rice}','Rice','RICE-5','piece_stock',true,false,null,'piece');
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${rice}',100),('${branch}','${rice}',10);
`);

const as = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub','',false); reset role;`);
  }
};

assert.equal((await db.query('select public.fractional_piece_ops_enabled() e')).rows[0].e, false);
assert.equal((await db.query('select public.fractional_recipe_saving_enabled() e')).rows[0].e, false);

await assert.rejects(
  as(manager, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3)', [
      branch,
      JSON.stringify([{ product_id: rice, quantity_sent: '0.5', destination_price: 10 }]),
      '5-xfer-blocked-0000001',
    ]),
  ),
  /half-step stock ops|whole numbers/i,
  'transfer 0.5 blocked while ops gate OFF',
);

await assert.rejects(
  as(manager, () =>
    db.query(`select public.record_main_inventory_waste($1,$2,$3,$4,$5)`, [
      rice,
      0.5,
      100,
      'spoiled half',
      '5-waste-blocked-000001',
    ]),
  ),
  /half-step|whole numbers|quantity/i,
);

await assert.rejects(
  db.query(`select public.parse_inventory_quantity('0.5','piece_stock',false)`),
  /half-step stock ops|whole numbers/i,
);

await assert.rejects(
  as(cashier, () =>
    db.query('select public.create_stock_return($1::jsonb,null,$2)', [
      JSON.stringify([{ product_id: rice, quantity_returned: '0.5' }]),
      '5-return-blocked-000001',
    ]),
  ),
  /half-step stock ops|whole numbers/i,
  'create_stock_return 0.5 blocked while ops gate OFF',
);

// Integer ops still work
const xfer = (
  await as(manager, () =>
    db.query('select public.send_stock_transfer($1,$2::jsonb,null,$3) id', [
      branch,
      JSON.stringify([{ product_id: rice, quantity_sent: '1', destination_price: 10 }]),
      '5-xfer-whole-000000001',
    ]),
  )
).rows[0].id;
assert.ok(xfer);

// Ops ON allows half-steps; recipe enable forces ops ON
await as(owner, () => db.query('select public.set_fractional_piece_ops_enabled(true)'));
assert.equal((await db.query('select public.fractional_piece_ops_enabled() e')).rows[0].e, true);
assert.equal(Number((await db.query(`select public.parse_inventory_quantity('0.5','piece_stock',false) q`)).rows[0].q), 0.5);

await as(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(true)'));
assert.equal((await db.query('select public.fractional_piece_ops_enabled() e')).rows[0].e, true, 'recipe ON keeps ops ON');

await assert.rejects(
  as(owner, () => db.query('select public.set_fractional_piece_ops_enabled(false)')),
  /Turn off fractional recipe/i,
);

await as(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(false)'));
await as(owner, () => db.query('select public.set_fractional_piece_ops_enabled(false)'));
assert.equal((await db.query('select public.fractional_piece_ops_enabled() e')).rows[0].e, false);
assert.equal((await db.query('select public.fractional_recipe_saving_enabled() e')).rows[0].e, false);

console.log('Phase 5 release-safety: ops gated OFF by default; Egg quarantined; gates restore OK');
await db.close();
