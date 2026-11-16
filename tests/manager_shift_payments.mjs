import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './_load_ts.mjs';

const { shiftPaymentBreakdown, paymentBreakdown, PRICING_PROGRAM_LABELS } = loadTs(
  'src/features/sales/paymentMethods.ts',
);

assert.equal(PRICING_PROGRAM_LABELS.pwd, 'PWD');
assert.deepEqual(
  shiftPaymentBreakdown(
    [
      { method: 'cash', program: 'standard', amount: 40, orders: 2 },
      { method: 'cash', program: 'pwd', amount: 18.75, orders: 1 },
      { method: 'cash', program: 'employee_meal', amount: 0, orders: 3 },
      { method: 'gcash', program: 'standard', amount: 25, orders: 1 },
      { method: 'gcash', program: 'back_office_guard', amount: 12, orders: 1 },
    ],
    'cash',
  ),
  {
    groups: { standard: 40, pwd: 18.75, back_office_guard: 0, employee_meal: 0 },
    total: 58.75,
    orders: 6,
    employeeMeals: 3,
  },
);

const receipt = (program, amount, method = 'gcash', status = 'completed') => ({
  pricing_program: program,
  total_amount: amount,
  payment_method: method,
  status,
});
assert.deepEqual(paymentBreakdown([receipt('standard', 10.01), receipt('employee_meal', 0)], 'gcash').employeeMeals, 1);

assert.match(readFileSync('supabase/migrations/20261117160000_manager_shift_payments.sql', 'utf8'), /manager_shift_payments/);
assert.match(readFileSync('src/features/reports/ShiftRemittanceDetailScreen.tsx', 'utf8'), /Show standard \/ PWD \/ back office \/ meals/);
assert.match(readFileSync('src/features/reports/ShiftRemittanceDetailScreen.tsx', 'utf8'), /not remitted cash/);
assert.match(readFileSync('src/features/reports/ShiftRemittanceScreen.tsx', 'utf8'), /tenderTitle/);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);
for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const id = (n) => `91800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const manager = id(2);
const cashier = id(3);
const branch = id(10);
const product = id(20);
const shiftId = id(30);

await db.exec(`
  insert into auth.users values ('${owner}','o@test'),('${manager}','m@test'),('${cashier}','c@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${id(9)}','Main','MAIN',true),('${branch}','SM1','SM1',false)
  on conflict do nothing;
`);
const main = (await db.query('select id from public.branches where is_main_branch')).rows[0].id;
await db.exec(`
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${manager}','Main Manager','manager','${main}'),
    ('${cashier}','Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,inventory_mode,is_active)
    values ('${product}','Chicken','CH',80,'piece_stock',true);
  insert into public.branch_products(branch_id,product_id,selling_price) values ('${branch}','${product}',80);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values ('${branch}','${product}',20);
  insert into public.shifts(id,branch_id,cashier_id,status,started_at,ended_at)
    values ('${shiftId}','${branch}','${cashier}','closed','2026-11-08 01:00:00+00','2026-11-08 09:00:00+00');
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const insertSale = async (program, method, amount, key) => {
  await db.exec(`
    insert into public.sales(
      sale_number, branch_id, shift_id, cashier_id, subtotal, total_amount, amount_paid, change_amount,
      status, idempotency_key, request_items, pricing_program, payment_method, discount_amount
    ) values (
      '${key}', '${branch}', '${shiftId}', '${cashier}', ${amount}, ${amount}, ${amount}, 0,
      'completed', '${key}', '[]'::jsonb, '${program}', ${method ? `'${method}'` : 'null'}, 0
    )
  `);
};

await insertSale('standard', 'cash', 40, 'msp-sale-std-cash01');
await insertSale('pwd', 'cash', 18.75, 'msp-sale-pwd-cash01');
await insertSale('employee_meal', 'cash', 0, 'msp-sale-meal-cash1');
await insertSale('employee_meal', 'cash', 0, 'msp-sale-meal-cash2');
await insertSale('standard', 'gcash', 25, 'msp-sale-std-gcash1');
await insertSale('back_office_guard', 'gcash', 12, 'msp-sale-bog-gcash1');
await db.exec(`
  insert into public.sales(
    sale_number, branch_id, shift_id, cashier_id, subtotal, total_amount, amount_paid, change_amount,
    status, idempotency_key, request_items, pricing_program, payment_method, discount_amount
  ) values (
    'msp-sale-void-gcash', '${branch}', '${shiftId}', '${cashier}', 99, 99, 99, 0,
    'voided', 'msp-sale-void-gcash', '[]'::jsonb, 'standard', 'gcash', 0
  )
`);

const rows = (
  await asUser(manager, () => db.query('select * from public.manager_shift_payments($1) order by method, program', [shiftId]))
).rows;
assert.deepEqual(
  rows.map((row) => ({
    method: row.method,
    program: row.program,
    amount: Number(row.amount),
    orders: Number(row.orders),
  })),
  [
    { method: 'cash', program: 'employee_meal', amount: 0, orders: 2 },
    { method: 'cash', program: 'pwd', amount: 18.75, orders: 1 },
    { method: 'cash', program: 'standard', amount: 40, orders: 1 },
    { method: 'gcash', program: 'back_office_guard', amount: 12, orders: 1 },
    { method: 'gcash', program: 'standard', amount: 25, orders: 1 },
  ],
);

const cash = shiftPaymentBreakdown(rows, 'cash');
assert.equal(cash.employeeMeals, 2);
assert.equal(cash.total, 58.75);

await asUser(owner, () => db.query('select * from public.manager_shift_payments($1)', [shiftId]));
await assert.rejects(
  asUser(cashier, () => db.query('select * from public.manager_shift_payments($1)', [shiftId])),
  /Owner or Main Branch Manager/,
);

const before = Number(
  (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [
    branch,
    product,
  ])).rows[0].quantity_on_hand,
);
await asUser(manager, () => db.query('select * from public.manager_shift_payments($1)', [shiftId]));
assert.equal(
  Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [
      branch,
      product,
    ])).rows[0].quantity_on_hand,
  ),
  before,
  'payment breakdown is read-only',
);

await db.close();
console.log('manager_shift_payments: program breakdown, meals count, auth, read-only — PASS');
