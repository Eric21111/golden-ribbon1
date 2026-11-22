/**
 * Phase 4B — client ops/reporting compatibility for exact 0.5 piece_stock.
 * Gates temporarily ON only inside this disposable PGlite DB.
 * Production app keeps FRACTIONAL_STOCK_USES_ENABLED = false.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';
import { verifiedClose } from './_verified_cashier_close.mjs';

assert.equal(
  readdirSync('supabase/migrations').filter((n) => n.includes('egg_half_unit') || n.includes('egg_cutover')).length,
  0,
  'no Egg cutover in active migrations',
);
assert.ok(readdirSync('supabase/migrations').includes('20261123140000_fractional_inventory_reports.sql'));
assert.ok(readdirSync('supabase/migrations').includes('20261123150000_fractional_piece_ops_gate.sql'));

const half = loadTs('src/lib/halfStepQuantity.ts');
const format = loadTs('src/lib/format.ts');
const closeDisplay = loadTs('src/features/shifts/closeDisplay.ts');
const closeCount = loadTs('src/features/shifts/closeCountList.ts');
const stockCorrection = loadTs('src/features/pos/stockCorrection.ts');

assert.equal(half.FRACTIONAL_STOCK_USES_ENABLED, false, 'client activation gate stays OFF');
assert.equal(format.PIECE_QUANTITY_MAX_LENGTH, 8);
assert.equal(format.formatLiveStock(9.5), '9.5 pcs', 'display still renders half-steps');
assert.equal(format.formatLiveStock(10), '10 pcs');
assert.equal(format.formatLiveStock(0), '0 pcs');
assert.equal(format.formatLiveStock(24.5), '24.5 pcs');
assert.equal(format.formatLiveStock(24.3), format.INVALID_QUANTITY_LABEL);
assert.equal(format.formatLiveStock(0.5, 'piece_stock', 'half_egg'), format.INVALID_QUANTITY_LABEL);
assert.equal(format.isValidPieceQuantity('9.5'), false, 'ops input gated OFF');
assert.equal(format.isValidPieceQuantity('24'), true);
assert.equal(format.isValidPieceQuantity('0.5'), false);
assert.equal(format.isValidPieceQuantity('0'), false);
assert.equal(format.isValidPieceQuantity('0.3'), false);
assert.equal(closeDisplay.isValidClosePieceQuantity('9.5'), false);
assert.equal(closeDisplay.isValidClosePieceQuantity('0'), true);
assert.equal(closeDisplay.isValidClosePieceQuantity('0.3'), false);
assert.equal(closeCount.systemPieces({ system_balance_before_waste: 9.5 }), 9.5);
assert.equal(stockCorrection.parseStockCount('9.5'), null);
assert.equal(stockCorrection.parseStockCount('0.3'), null);
assert.equal(
  half.isValidPieceOpsQuantity(9.5, { fractionalOps: true }),
  true,
  'helpers accept half-steps when explicitly enabled',
);

// Old-client risk surface: pre-4B screens rejected half-steps in typing filters.
const quantityList = readFileSync('src/features/stock/QuantityListScreen.tsx', 'utf8');
assert.match(quantityList, /acceptsPieceOpsQuantityText/);
assert.match(quantityList, /decimal-pad/);
assert.doesNotMatch(quantityList, /\/\^\\d\{1,6\}\$/);

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

const id = (n) => `b4100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
    ('${rice}','Rice','RICE-4B','piece_stock',true,false,null,'piece'),
    ('${meal}','Rice Meal','MEAL-4B','piece_stock',true,true,50,null),
    ('${portionEgg}','Egg','EGG-4B','piece_stock',true,false,null,'half_egg');
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

const onHand = async (branchId, productId) =>
  Number(
    (
      await db.query(
        `select quantity_on_hand::float8 q from public.branch_inventory where branch_id=$1 and product_id=$2`,
        [branchId, productId],
      )
    ).rows[0].q,
  );

// Temporary test activation only (disposable DB).
assert.equal((await db.query('select public.fractional_recipe_saving_enabled() e')).rows[0].e, false);
await as(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(true)'));
assert.equal((await db.query('select public.fractional_recipe_saving_enabled() e')).rows[0].e, true);

await as(manager, () =>
  db.query(
    `select * from public.update_complete_product(
      p_product_id:=$1, p_name:='Rice Meal', p_sku:='MEAL-4B', p_description:=null, p_is_active:=true,
      p_variants:='[]'::jsonb, p_deleted_variant_ids:='[]'::jsonb, p_branches:=$2::jsonb,
      p_selling_price:='50', p_stock_uses:=$3::jsonb)`,
    [
      meal,
      JSON.stringify([{ branch_id: branch, selling_price: '50.00' }]),
      JSON.stringify([{ ingredient_product_id: rice, quantity: 0.5 }]),
    ],
  ),
);

const shift = (await as(cashier, () => db.query('select public.start_cashier_shift() id'))).rows[0].id;

const sell = (key) =>
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

assert.equal(await onHand(branch, rice), 10);
const saleId = (await sell('4b-sale-half-00000001')).rows[0].id;
assert.equal(await onHand(branch, rice), 9.5, '10 → 9.5 after sale');
assert.equal(format.formatLiveStock(9.5), '9.5 pcs');

const itemId = (
  await db.query('select id::text from public.sale_items where sale_id=$1 and product_id=$2', [saleId, meal])
).rows[0].id;
await as(cashier, () =>
  db.query('select public.void_cashier_sale_item($1::uuid,1,1,$2,$3)', [itemId, 'Wrong quantity', '']),
);
assert.equal(await onHand(branch, rice), 10, '9.5 → 10 after void');

// Sell again so close preview sees 9.5; remittance detail must preserve fraction.
await sell('4b-sale-half-00000002');
assert.equal(await onHand(branch, rice), 9.5);

const preview = (await as(cashier, () => verifiedClose(db, shift))).rows[0].p;
const ricePreview = (preview.products || []).find((p) => p.product_id === rice);
assert.ok(ricePreview);
assert.equal(Number(ricePreview.system_balance_before_waste), 9.5);
assert.equal(closeCount.systemPieces({ system_balance_before_waste: 9.5 }), 9.5);
assert.equal(format.formatLiveStock(ricePreview.system_balance_before_waste), '9.5 pcs');

const counts = (preview.products || []).map((p) => ({
  product_id: p.product_id,
  actual_remaining: String(p.system_balance_before_waste),
  waste_quantity: '0',
}));
const result = (
  await as(cashier, () =>
    db.query(`select public.finalize_cashier_shift_reconciliation($1,$2::text,$3::jsonb,$4::text) r`, [
      shift,
      String(preview.expected_cash ?? 50),
      JSON.stringify(counts),
      '0',
    ]),
  )
).rows[0].r;
assert.equal(result.status, 'reconciled');
assert.equal(await onHand(branch, rice), 9.5);

const detail = (
  await as(manager, () => db.query('select public.get_shift_remittance_detail($1) d', [shift]))
).rows[0].d;
const products = detail.products || detail?.inventory_products || [];
const remRice = products.find((p) => p.product_id === rice);
assert.ok(remRice, 'remittance includes rice');
assert.equal(Number(remRice.actual_remaining ?? remRice.expected_remaining), 9.5);
assert.equal(
  format.formatLiveStock(remRice.actual_remaining ?? remRice.expected_remaining),
  '9.5 pcs',
);

// list_return_inventory includes half-step balances and returns numeric (not truncated).
const listed = await as(cashier, () => db.query('select * from public.list_return_inventory()'));
const riceRow = listed.rows.find((r) => r.product_id === rice);
assert.ok(riceRow, 'half-step rice appears in return inventory');
assert.equal(Number(riceRow.quantity_on_hand), 9.5);

// Portion-coded balances stay integer-only at the inventory guard (no double conversion path).
await assert.rejects(
  () =>
    db.exec(
      `update public.branch_inventory set quantity_on_hand = 9.5 where branch_id='${branch}' and product_id='${portionEgg}'`,
    ),
  /whole numbers/i,
  'portion egg rejects fractional on-hand',
);
const listed2 = await as(cashier, () => db.query('select * from public.list_return_inventory()'));
assert.ok(
  listed2.rows.find((r) => r.product_id === portionEgg),
  'integer portion egg remains returnable',
);

const recon = (
  await as(owner, () => db.query('select public.report_inventory_reconciliation($1) d', [branch]))
).rows[0].d;
const reconRice = recon.find((r) => r.product_id === rice);
assert.ok(reconRice);
assert.equal(Number(reconRice.current_stock), 9.5);
// Two 0.5 sales (one later voided) still leave sale-movement abs sum = 1 — not truncated by bigint.
assert.equal(Number(reconRice.sale), 1);
assert.equal(Number(reconRice.sale) % 0.5, 0);

// Restore gates OFF (matches production default).
await as(owner, () => db.query('select public.set_fractional_recipe_saving_enabled(false)'));
await as(owner, () => db.query('select public.set_fractional_piece_ops_enabled(false)'));
assert.equal((await db.query('select public.fractional_recipe_saving_enabled() e')).rows[0].e, false);
assert.equal((await db.query('select public.fractional_piece_ops_enabled() e')).rows[0].e, false);
assert.equal(half.FRACTIONAL_STOCK_USES_ENABLED, false);

console.log('Phase 4B fractional inventory UI/reporting: ok');
await db.close();