/**
 * Phase 5 — intermediate migration-state probes.
 * Simulates Supabase CLI behavior: each fractional migration commits separately.
 * After every prefix of the seven files, fractional recipe saves and half-step ops
 * must stay blocked (gates OFF / not yet installed).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const FRACTIONAL = [
  '20261123120000_piece_half_step_stock_uses.sql',
  '20261123120100_confirm_sale_half_step_deductions.sql',
  '20261123130000_fractional_inventory_feature_gate.sql',
  '20261123130100_fractional_inventory_parse_and_schema.sql',
  '20261123130200_fractional_inventory_ops_rpcs.sql',
  '20261123140000_fractional_inventory_reports.sql',
  '20261123150000_fractional_piece_ops_gate.sql',
];

for (const name of FRACTIONAL) {
  const sql = readFileSync(`supabase/migrations/${name}`, 'utf8');
  assert.match(sql, /No explicit BEGIN\/COMMIT/i, `${name} must document CLI txn policy`);
  assert.equal(
    (sql.match(/^\s*begin\s*;/gim) || []).length,
    0,
    `${name} must not embed BEGIN (breaks CLI transaction wrapper)`,
  );
  assert.equal(
    (sql.match(/^\s*commit\s*;/gim) || []).length,
    0,
    `${name} must not embed COMMIT (breaks CLI transaction wrapper)`,
  );
}

const BOOT = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`;

const loadSql = (file) =>
  readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, '');

const allMigrations = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort();
const baseline = allMigrations.filter((n) => n < FRACTIONAL[0]);
assert.ok(baseline.length > 0, 'baseline migrations required');

const db = new PGlite();
await db.exec(BOOT);
for (const file of baseline) {
  await db.exec(loadSql(file));
}

const id = (n) => `b5200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const rice = id(20);
const meal = id(21);

await db.exec(`
  insert into auth.users values ('${owner}','o@t'),('${manager}','m@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main','MAIN',true,true),('${branch}','Booth','BTH',false,true);
  insert into public.profiles(id,full_name,role,is_active,branch_id) values
    ('${owner}','Owner','owner',true,'${main}'),
    ('${manager}','Mgr','manager',true,'${main}'),
    ('${cashier}','Cash','cashier',true,'${branch}');
  insert into public.products(id,name,sku,inventory_mode,is_active,sell_in_pos,selling_price,stock_unit_code) values
    ('${rice}','Rice','RICE-INT','piece_stock',true,false,null,'piece'),
    ('${meal}','Meal','MEAL-INT','piece_stock',true,true,50,null);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values ('${branch}','${meal}',50,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${main}','${rice}',100),('${branch}','${rice}',10),('${branch}','${meal}',5);
`);

const as = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub','',false); reset role;`);
  }
};

const updateMeal = (stockUses) =>
  as(manager, () =>
    db.query(
      `select * from public.update_complete_product(
        p_product_id:=$1, p_name:='Meal', p_sku:='MEAL-INT', p_description:=null, p_is_active:=true,
        p_variants:='[]'::jsonb, p_deleted_variant_ids:='[]'::jsonb, p_branches:=$2::jsonb,
        p_selling_price:='50', p_stock_uses:=$3::jsonb)`,
      [
        meal,
        JSON.stringify([{ branch_id: branch, selling_price: '50.00' }]),
        JSON.stringify(stockUses),
      ],
    ),
  );

const probeAfter = async (label) => {
  await assert.rejects(
    () => updateMeal([{ ingredient_product_id: rice, quantity: 0.5 }]),
    /whole number from 1 to 99|fractional|half-step|not enabled/i,
    `${label}: fractional recipe save must stay blocked`,
  );

  // Integer recipe save must keep working (old-app compatible path).
  await updateMeal([{ ingredient_product_id: rice, quantity: 1 }]);

  if (label >= '20261123130100') {
    await assert.rejects(
      db.query(`select public.parse_inventory_quantity('0.5','piece_stock',false)`),
      /whole numbers|half-step/i,
      `${label}: parse 0.5 must stay blocked while ops gated/not enabled`,
    );
  }

  if (label >= '20261123130200') {
    await assert.rejects(
      as(manager, () =>
        db.query(`select public.record_main_inventory_waste($1,$2,$3,$4,$5)`, [
          rice,
          0.5,
          100,
          'intermediate probe',
          `int-waste-${label.slice(-6)}0001`.slice(0, 24),
        ]),
      ),
      /half-step|whole numbers|not enabled|quantity/i,
      `${label}: waste 0.5 must stay blocked`,
    );
  }

  if (label >= '20261123150000') {
    await assert.rejects(
      as(cashier, () =>
        db.query('select public.create_stock_return($1::jsonb,null,$2)', [
          JSON.stringify([{ product_id: rice, quantity_returned: '0.5' }]),
          `int-ret-${label.slice(-6)}000001`.slice(0, 24),
        ]),
      ),
      /half-step|whole numbers|not enabled/i,
      `${label}: return 0.5 must stay blocked with ops OFF`,
    );
    const gates = (
      await db.query(
        `select fractional_recipe_saving_enabled r, fractional_piece_ops_enabled o
         from public.inventory_feature_settings where id`,
      )
    ).rows[0];
    assert.equal(gates.r, false, `${label}: recipe gate OFF`);
    assert.equal(gates.o, false, `${label}: ops gate OFF`);
  }
};

let applied = '';
for (const file of FRACTIONAL) {
  await db.exec(loadSql(file));
  applied = file.replace(/\.sql$/, '');
  await probeAfter(applied);
  console.log(`intermediate OK after ${file}`);
}

console.log('Phase 5 intermediate: each committed prefix blocks fractional recipe/ops; gates OFF at end');
await db.close();
