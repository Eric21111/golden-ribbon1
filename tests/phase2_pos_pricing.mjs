import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

function loadTs(entryPath) {
  const cache = new Map();
  function load(filePath) {
    const abs = path.resolve(filePath);
    if (cache.has(abs)) return cache.get(abs);
    const source = readFileSync(abs, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: abs,
    });
    const module = { exports: {} };
    const localRequire = (id) => {
      if (id.startsWith('@/')) {
        const resolved = path.resolve('src', id.slice(2));
        for (const candidate of [`${resolved}.ts`, `${resolved}.tsx`, resolved]) {
          try {
            return load(candidate);
          } catch {
            // try next
          }
        }
        throw new Error(`Unable to resolve ${id}`);
      }
      return require(id);
    };
    vm.runInNewContext(outputText, {
      module,
      exports: module.exports,
      require: localRequire,
      console,
      Number,
      Math,
      Boolean,
      Array,
      Object,
      String,
      RegExp,
      Error,
      JSON,
      undefined,
    }, { filename: abs });
    cache.set(abs, module.exports);
    return module.exports;
  }
  return load(entryPath);
}

const pricing = loadTs('src/features/pos/pricingPrograms.ts');
const {
  chargedUnitPrice,
  previewOrderTotals,
  sortMealVariants,
  BACK_OFFICE_GUARD_FIXED_UNIT_PRICE,
  PWD_DISCOUNT_PERCENT_DEFAULT,
} = pricing;

assert.equal(chargedUnitPrice(80, 'employee_meal'), 0);
assert.equal(chargedUnitPrice(80, 'pwd'), 60);
assert.equal(chargedUnitPrice(80, 'back_office_guard'), 67);
assert.equal(PWD_DISCOUNT_PERCENT_DEFAULT, 25);
assert.equal(BACK_OFFICE_GUARD_FIXED_UNIT_PRICE, 13);
// Settings-aware preview (amount_off vs fixed_unit_price)
assert.equal(
  chargedUnitPrice(80, 'back_office_guard', {
    back_office_guard: {
      program: 'back_office_guard',
      discount_percent: null,
      pricing_mode: 'amount_off',
      fixed_amount: 13,
      label: 'Guard',
    },
  }),
  67,
);
assert.equal(
  chargedUnitPrice(10.01, 'pwd', {
    pwd: { program: 'pwd', discount_percent: 25, pricing_mode: null, fixed_amount: null, label: 'PWD' },
  }),
  7.51,
);

const preview = previewOrderTotals(
  [{ unit_price: 80, quantity: 2 }, { unit_price: 40, quantity: 1 }],
  'pwd',
);
assert.equal(preview.catalogSubtotal, 200);
assert.equal(preview.chargedTotal, 150);
assert.equal(preview.discountAmount, 50);

const free = previewOrderTotals([{ unit_price: 80, quantity: 1 }], 'employee_meal');
assert.equal(free.chargedTotal, 0);
assert.equal(free.catalogSubtotal, 80);

const sorted = sortMealVariants([
  { name: 'With Drinks' },
  { name: 'Ulam Only' },
  { name: 'With Rice' },
  { name: 'Extra Large' },
]);
assert.equal(
  sorted.map((v) => v.name).join('|'),
  'Ulam Only|With Rice|With Drinks|Extra Large',
);

const payment = readFileSync('app/(cashier)/cashier/payment.tsx', 'utf8');
assert.match(payment, /pricingProgram/);
assert.match(payment, /PRICING_PROGRAM_OPTIONS/);
assert.match(payment, /listSalePricingProgramSettings/);
const pricingProgramsSrc = readFileSync('src/features/pos/pricingPrograms.ts', 'utf8');
assert.match(pricingProgramsSrc, /employee_meal/);
assert.match(pricingProgramsSrc, /back_office_guard/);
assert.match(pricingProgramsSrc, /amount_off|₱13 OFF/i);
assert.match(pricingProgramsSrc, /amount_off/);
assert.match(pricingProgramsSrc, /BUSINESS RULE FLAG/);
assert.match(readFileSync('src/features/pos/PosItemSheet.tsx', 'utf8'), /sortMealVariants/);
assert.match(readFileSync('src/features/sales/SalesScreens.tsx', 'utf8'), /discount_amount/);
assert.match(readFileSync('src/services/saleService.ts', 'utf8'), /listSalePricingProgramSettings/);

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
for (const file of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort()) {
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const id = (n) => `20101912-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const cashier = id(3);
const main = id(10);
const branch = id(11);
const meal = id(20);
const drinkVar = id(30);
const riceVar = id(31);
const ulamVar = id(32);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main','MAIN',true,true,'counted'),
    ('${branch}','Booth','B1',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${meal}','Chicken Meal','MEAL',80,true,'piece_stock','keep_at_branch');
  insert into public.product_variants(id,product_id,name,default_price,is_active,sort_order) values
    ('${ulamVar}','${meal}','Ulam Only',60,true,1),
    ('${riceVar}','${meal}','With Rice',80,true,2),
    ('${drinkVar}','${meal}','With Drinks',100,true,3);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${meal}',80,true);
  insert into public.branch_product_variants(id,branch_id,product_id,name,selling_price,is_active) values
    ('${ulamVar}','${branch}','${meal}','Ulam Only',60,true),
    ('${riceVar}','${branch}','${meal}','With Rice',80,true),
    ('${drinkVar}','${branch}','${meal}','With Drinks',100,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch}','${meal}',20);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const qty = async () =>
  Number(
    (await db.query(
      `select quantity_on_hand q from public.branch_inventory where branch_id=$1 and product_id=$2`,
      [branch, meal],
    )).rows[0].q,
  );

const shiftId = await asUser(cashier, () =>
  db.query('select public.start_cashier_shift() id'),
).then((r) => r.rows[0].id);

// Variant required when options exist
await asUser(cashier, () =>
  assert.rejects(
    () =>
      db.query('select public.confirm_sale($1,$2::jsonb,$3,$4,$5)', [
        shiftId,
        JSON.stringify([{ product_id: meal, quantity: 1 }]),
        '80',
        'phase2-novariant-000001',
        'standard',
      ]),
    /meal option|variant/i,
  ),
);

// Standard variant sale
const standard = (
  await asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
      shiftId,
      JSON.stringify([{ product_id: meal, variant_id: riceVar, quantity: 1 }]),
      '80',
      'phase2-standard-rice-0001',
      'standard',
    ]),
  )
).rows[0];
assert.equal(Number(standard.total_amount), 80);
assert.equal(standard.pricing_program, 'standard');
assert.equal(await qty(), 19);

// Employee meal: ₱0 revenue, stock deducted
const employee = (
  await asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
      shiftId,
      JSON.stringify([{ product_id: meal, variant_id: drinkVar, quantity: 1 }]),
      '0',
      'phase2-employee-meal-0001',
      'employee_meal',
    ]),
  )
).rows[0];
assert.equal(Number(employee.total_amount), 0);
assert.equal(Number(employee.catalog_subtotal), 100);
assert.equal(Number(employee.discount_amount), 100);
assert.equal(employee.pricing_program, 'employee_meal');
assert.equal(await qty(), 18);

const empItem = (
  await db.query(`select unit_price, catalog_unit_price, discount_amount, subtotal from public.sale_items where sale_id=$1`, [
    employee.id,
  ])
).rows[0];
assert.equal(Number(empItem.unit_price), 0);
assert.equal(Number(empItem.catalog_unit_price), 100);
assert.equal(Number(empItem.subtotal), 0);

// PWD 25%
const pwd = (
  await asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
      shiftId,
      JSON.stringify([{ product_id: meal, variant_id: riceVar, quantity: 2 }]),
      '120',
      'phase2-pwd-discount-000001',
      'pwd',
    ]),
  )
).rows[0];
assert.equal(Number(pwd.catalog_subtotal), 160);
assert.equal(Number(pwd.total_amount), 120);
assert.equal(Number(pwd.discount_amount), 40);
assert.equal(await qty(), 16);

// Back office / guard is ₱13 off catalog (ulam is 60 → 47)
const guard = (
  await asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
      shiftId,
      JSON.stringify([{ product_id: meal, variant_id: ulamVar, quantity: 1 }]),
      '47',
      'phase2-guard-fixed-0000001',
      'back_office_guard',
    ]),
  )
).rows[0];
assert.equal(Number(guard.total_amount), 47);
assert.equal(Number(guard.discount_amount), 13);
assert.equal(Number(guard.catalog_subtotal), 60);
assert.equal(await qty(), 15);

// Two variants same product: one stock pool (no double deduction)
const multi = (
  await asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
      shiftId,
      JSON.stringify([
        { product_id: meal, variant_id: ulamVar, quantity: 1 },
        { product_id: meal, variant_id: drinkVar, quantity: 1 },
      ]),
      '160',
      'phase2-multi-variant-000001',
      'standard',
    ]),
  )
).rows[0];
assert.equal(Number(multi.total_amount), 160);
assert.equal(await qty(), 13); // -2 only

// Expected cash excludes free meals (sum of total_amount)
const expected = (
  await db.query(
    `select coalesce(sum(total_amount),0)::numeric t from public.sales where shift_id=$1 and status='completed'`,
    [shiftId],
  )
).rows[0].t;
assert.equal(Number(expected), 80 + 0 + 120 + 47 + 160);

// Insufficient stock
await asUser(cashier, () =>
  assert.rejects(
    () =>
      db.query('select public.confirm_sale($1,$2::jsonb,$3,$4,$5)', [
        shiftId,
        JSON.stringify([{ product_id: meal, variant_id: riceVar, quantity: 100 }]),
        '8000',
        'phase2-insuff-stock-000001',
        'standard',
      ]),
    /Insufficient stock/i,
  ),
);
assert.equal(await qty(), 13);

// Mixed cart: meal variant + second product, PWD rounding
const side = id(21);
await db.exec(`
  insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
    ('${side}','Side Drink','SIDE',33.33,true,'piece_stock','keep_at_branch');
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${side}',33.33,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch}','${side}',5);
`);
const mixed = (
  await asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
      shiftId,
      JSON.stringify([
        { product_id: meal, variant_id: ulamVar, quantity: 1 },
        { product_id: side, quantity: 1 },
      ]),
      '70', // round(60*0.75,2)+round(33.33*0.75,2) = 45 + 25.00
      'phase2-mixed-pwd-round-0001',
      'pwd',
    ]),
  )
).rows[0];
assert.equal(Number(mixed.total_amount), 70);
assert.equal(Number(mixed.catalog_subtotal), 93.33);
assert.equal(await qty(), 12);
assert.equal(
  Number(
    (await db.query(`select quantity_on_hand q from public.branch_inventory where branch_id=$1 and product_id=$2`, [
      branch,
      side,
    ])).rows[0].q,
  ),
  4,
);

// Idempotent replay
const again = (
  await asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
      shiftId,
      JSON.stringify([
        { product_id: meal, variant_id: ulamVar, quantity: 1 },
        { product_id: side, quantity: 1 },
      ]),
      '70',
      'phase2-mixed-pwd-round-0001',
      'pwd',
    ]),
  )
).rows[0];
assert.equal(again.id, mixed.id);
assert.equal(await qty(), 12); // no double deduct

// Configurable guard: switch to amount_off ₱13
await db.exec(`
  update public.sale_pricing_program_settings
  set pricing_mode = 'amount_off', fixed_amount = 13
  where program = 'back_office_guard';
`);
const guardOff = (
  await asUser(cashier, () =>
    db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4,$5)).*', [
      shiftId,
      JSON.stringify([{ product_id: meal, variant_id: riceVar, quantity: 1 }]),
      '67',
      'phase2-guard-amount-off-001',
      'back_office_guard',
    ]),
  )
).rows[0];
assert.equal(Number(guardOff.total_amount), 67);
assert.equal(Number(guardOff.catalog_subtotal), 80);
assert.equal(Number(guardOff.discount_amount), 13);
assert.equal(await qty(), 11);

// Shift expected cash = sum(total_amount) includes paid programs only
const expectedFinal = Number(
  (
    await db.query(
      `select coalesce(sum(total_amount),0)::numeric t from public.sales where shift_id=$1 and status='completed'`,
      [shiftId],
    )
  ).rows[0].t,
);
assert.equal(expectedFinal, 80 + 0 + 120 + 47 + 160 + 70 + 67);

// POS inventory variant order prefers sort_order
const pos = await asUser(cashier, () => db.query('select * from public.list_cashier_pos_inventory()'));
const names = pos.rows[0].variants.map((v) => v.name);
assert.deepEqual(names, ['Ulam Only', 'With Rice', 'With Drinks']);

// Migration order: Phase 1 before Phase 2
const migNames = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort();
const i1 = migNames.indexOf('20260928150400_phase1_critical_fixes.sql');
const i2 = migNames.indexOf('20261019120000_phase2_pos_pricing_programs.sql');
assert.ok(i1 >= 0 && i2 > i1, 'Phase 1 migration must sort before Phase 2');

console.log('phase2_pos_pricing: ok');
