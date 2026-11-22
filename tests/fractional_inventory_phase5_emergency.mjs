/**
 * Phase 5 — emergency/rollback semantics (disposable PGlite).
 * Confirms whether turning recipe gate OFF stops existing 0.5 recipes from deducting.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { verifiedClose } from './_verified_cashier_close.mjs';

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

const id = (n) => `b5100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
    ('${rice}','Rice','RICE-5E','piece_stock',true,false,null,'piece'),
    ('${meal}','Meal','MEAL-5E','piece_stock',true,true,50,null);
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

const onHand = async () =>
  Number(
    (
      await db.query(
        `select quantity_on_hand::float8 q from public.branch_inventory where branch_id=$1 and product_id=$2`,
        [branch, rice],
      )
    ).rows[0].q,
  );

const updateMeal = (stockUses) =>
  as(manager, () =>
    db.query(
      `select * from public.update_complete_product(
        p_product_id:=$1, p_name:='Meal', p_sku:='MEAL-5E', p_description:=null, p_is_active:=true,
        p_variants:='[]'::jsonb, p_deleted_variant_ids:='[]'::jsonb, p_branches:=$2::jsonb,
        p_selling_price:='50', p_stock_uses:=$3::jsonb)`,
      [
        meal,
        JSON.stringify([{ branch_id: branch, selling_price: '50.00' }]),
        JSON.stringify(stockUses),
      ],
    ),
  );

const sell = (shift, key) =>
  as(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5,$6)).id id', [
      shift,
      JSON.stringify([{ product_id: meal, quantity: 1 }]),
      50,
      key,
      'standard',
      'cash',
    ]),
  );

// Activate, save 0.5 recipe, sell → 9.5
await as(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(true)'));
assert.equal((await db.query('select public.fractional_piece_ops_enabled() e')).rows[0].e, true);
await updateMeal([{ ingredient_product_id: rice, quantity: 0.5 }]);
assert.equal(
  Number((await db.query(`select quantity::float8 q from public.product_stock_uses where product_id=$1`, [meal])).rows[0].q),
  0.5,
);

const shift = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;
await sell(shift, '5e-sale-after-enable-0001');
assert.equal(await onHand(), 9.5, 'sale with active 0.5 recipe deducts');

// Turn recipe saving OFF — leave ops ON (required for close of 9.5)
await as(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(false)'));
assert.equal((await db.query('select public.fractional_recipe_saving_enabled() e')).rows[0].e, false);
assert.equal((await db.query('select public.fractional_piece_ops_enabled() e')).rows[0].e, true, 'ops stays ON after recipe OFF');

// CRITICAL: existing 0.5 recipe still deducts after recipe gate OFF
await sell(shift, '5e-sale-after-disable-0001');
assert.equal(await onHand(), 9.0, 'EXISTING 0.5 recipe STILL deducts after recipe gate OFF');

// New fractional recipe saves are blocked; integer rewrite is allowed
await assert.rejects(
  () => updateMeal([{ ingredient_product_id: rice, quantity: 1.5 }]),
  /whole number from 1 to 99/i,
);
await updateMeal([{ ingredient_product_id: rice, quantity: 1 }]);
assert.equal(
  Number((await db.query(`select quantity::float8 q from public.product_stock_uses where product_id=$1`, [meal])).rows[0].q),
  1,
);

// After rewriting recipe to 1, next sale deducts 1
await sell(shift, '5e-sale-integer-recipe-001');
assert.equal(await onHand(), 8.0);

// Restore fractional recipe while gate OFF via direct table write (service path / emergency risk)
await db.exec(`
  reset role;
  update public.product_stock_uses set quantity = 0.5 where product_id = '${meal}';
`);
await as(cashier, async () => {}); // no-op restore role context
await sell(shift, '5e-sale-direct-row-0000001');
assert.equal(await onHand(), 7.5, 'direct product_stock_uses 0.5 still deducts; gate does not wrap confirm_sale');

// Ops OFF while fractional balance exists: cannot enter 9.5 / 7.5 on close
await as(owner, () => db.query('select public.set_fractional_piece_ops_enabled(false)'));
await assert.rejects(
  db.query(`select public.parse_inventory_quantity('7.5','piece_stock',true)`),
  /half-step stock ops|whole numbers/i,
  'ops OFF blocks half-step close counts',
);

// Emergency safe path: keep/re-enable ops, close with exact half-step counts, do NOT force whole counts
await as(owner, () => db.query('select public.set_fractional_piece_ops_enabled(true)'));
const preview = (await as(cashier, () => verifiedClose(db, shift))).rows[0].p;
const counts = (preview.products || []).map((p) => ({
  product_id: p.product_id,
  actual_remaining: String(p.system_balance_before_waste),
  waste_quantity: '0',
}));
const result = (
  await as(cashier, () =>
    db.query(`select public.finalize_cashier_shift_reconciliation($1,$2::text,$3::jsonb,$4::text) r`, [
      shift,
      String(preview.expected_cash ?? 200),
      JSON.stringify(counts),
      '0',
    ]),
  )
).rows[0].r;
assert.equal(result.status, 'reconciled');
assert.equal(await onHand(), 7.5, 'close preserves fractional balance');

// Bypass audit: clients cannot execute gate readers; setters are owner-only
await assert.rejects(
  as(manager, () => db.query('select public.set_fractional_recipe_saving_enabled(true)')),
  /Owner access/i,
);
await assert.rejects(
  as(cashier, () => db.query('select public.set_fractional_piece_ops_enabled(true)')),
  /Owner access/i,
);
await assert.rejects(
  as(manager, () => db.query('select public.fractional_recipe_saving_enabled()')),
  /permission denied|must be owner|42501|not exist|denied/i,
).catch(async () => {
  // Some roles may get permission denied on EXECUTE (revoked from authenticated)
  const denied = await as(manager, async () => {
    try {
      await db.query('select public.fractional_recipe_saving_enabled()');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(denied, true, 'authenticated cannot call fractional_recipe_saving_enabled');
});

await assert.rejects(
  as(manager, () =>
    db.query(`update public.inventory_feature_settings set fractional_recipe_saving_enabled = true`),
  ),
  /permission denied|policy|42501|denied/i,
);

console.log(
  'Phase 5 emergency: recipe OFF does NOT stop existing 0.5 deductions; rewrite recipe to integer; keep ops ON to close 9.5/7.5',
);
await db.close();
