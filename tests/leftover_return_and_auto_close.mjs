import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const cashierCreate = readFileSync('app/(cashier)/cashier/returns/create.tsx', 'utf8');
assert.match(cashierCreate, /returnLeftoverStock/);
assert.match(cashierCreate, /Confirm leftover return/);
assert.match(cashierCreate, /Every leftover unit on hand is returned automatically/);
assert.doesNotMatch(cashierCreate, /stepQuantity|setQuantity|Max/);
assert.doesNotMatch(cashierCreate, /createReturn\(/);

const dashboard = readFileSync('app/(cashier)/cashier/dashboard.tsx', 'utf8');
assert.match(dashboard, /Leftover on-hand stock will be returned to Main automatically/);
assert.match(dashboard, /leftover_return_id/);

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
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
      /create extension if not exists pgcrypto;/g,
      '',
    ),
  );
}

const id = (n) => `27000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const sellMgr = id(3);
const cashier = id(4);
const otherCashier = id(5);
const main = id(10);
const branch = id(11);
const p1 = id(20);
const p2 = id(21);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','main@test'),('${sellMgr}','sell@test'),
    ('${cashier}','c@test'),('${otherCashier}','c2@test');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${branch}','Branch 1','B1',false);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${sellMgr}','Selling Manager','manager','${branch}'),
    ('${cashier}','Cashier','cashier','${branch}'),
    ('${otherCashier}','Other Cashier','cashier','${branch}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${p1}','Chicken','CH',80,true),('${p2}','Inactive beef','BF',100,false);
  insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
    ('${branch}','${p1}',80,true),('${branch}','${p2}',100,true);
  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
    ('${branch}','${p1}',12),('${branch}','${p2}',5),('${main}','${p1}',40);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const leftover = (userId, key, notes = null) =>
  asUser(userId, () => db.query('select public.return_leftover_stock($1,$2) id', [notes, key]));

await asUser(sellMgr, async () => {
  await assert.rejects(
    db.query("select public.return_leftover_stock(null,'manager-leftover-key01')"),
    /Cashier/,
  );
});

await asUser(owner, async () => {
  await assert.rejects(
    db.query("select public.return_leftover_stock(null,'owner-leftover-key0001')"),
    /Cashier/,
  );
});

assert.equal((await asUser(cashier, () => db.query('select * from public.list_return_inventory()'))).rows.length, 2);

const leftoverId = (await leftover(cashier, 'leftover-confirm-key01')).rows[0].id;
assert.equal((await leftover(cashier, 'leftover-confirm-key01')).rows[0].id, leftoverId);
await assert.rejects(leftover(cashier, 'leftover-confirm-key01', 'changed notes'), /different return/);
await assert.rejects(leftover(cashier, 'leftover-empty-key0001'), /No leftover stock/);

assert.equal(
  Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [
      branch,
      p1,
    ])).rows[0].quantity_on_hand,
  ),
  0,
);
assert.equal(
  Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [
      branch,
      p2,
    ])).rows[0].quantity_on_hand,
  ),
  0,
);
assert.equal(
  Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [
      main,
      p1,
    ])).rows[0].quantity_on_hand,
  ),
  40,
);

const leftoverItems = (await db.query('select product_id, quantity_returned from public.stock_return_items where stock_return_id=$1 order by product_id', [leftoverId])).rows;
assert.deepEqual(
  leftoverItems.map((row) => [row.product_id, Number(row.quantity_returned)]),
  [
    [p1, 12],
    [p2, 5],
  ],
);

await db.exec(`update public.branch_inventory set quantity_on_hand = 8 where branch_id='${branch}' and product_id='${p1}'`);

const shiftSummary = await asUser(cashier, async () => {
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  await db.query('select public.confirm_sale($1,$2::jsonb,$3,$4)', [
    shift,
    JSON.stringify([{ product_id: p1, quantity: 3 }]),
    '240.00',
    'leftover-sale-key000001',
  ]);
  const first = (await db.query('select public.end_cashier_shift($1) result', [shift])).rows[0].result;
  const retry = (await db.query('select public.end_cashier_shift($1) result', [shift])).rows[0].result;
  return { shift, first, retry };
});

assert.equal(shiftSummary.first.status, 'closed');
assert.ok(shiftSummary.first.leftover_return_id);
assert.equal(shiftSummary.retry.leftover_return_id, shiftSummary.first.leftover_return_id);
assert.equal(shiftSummary.retry.ended_at, shiftSummary.first.ended_at);
assert.equal(
  Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [
      branch,
      p1,
    ])).rows[0].quantity_on_hand,
  ),
  0,
);
assert.equal(
  Number(
    (
      await db.query(
        'select quantity_returned from public.stock_return_items where stock_return_id=$1 and product_id=$2',
        [shiftSummary.first.leftover_return_id, p1],
      )
    ).rows[0].quantity_returned,
  ),
  5,
);

await db.exec(`
  update public.branch_inventory set quantity_on_hand = 6 where branch_id='${branch}' and product_id='${p1}';
`);

const currentNight = await asUser(cashier, async () => {
  return (await db.query('select public.start_cashier_shift() id')).rows[0].id;
});
assert.ok(currentNight);

await asUser(cashier, async () => {
  await assert.rejects(db.query('select public.close_overdue_shifts()'), /permission denied|42501/);
});

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
  where id = '${currentNight}' and status = 'open';
  alter table public.shifts enable trigger shifts_protect_lifecycle;
  update public.branch_inventory set quantity_on_hand = 6 where branch_id='${branch}' and product_id='${p1}';
`);

const overdue = (await db.query('select public.close_overdue_shifts() result')).rows[0].result;
assert.equal(Number(overdue.closed_count), 1);
assert.equal(Number(overdue.leftover_return_count), 1);
assert.equal(
  (await db.query('select status from public.shifts where id=$1', [currentNight])).rows[0].status,
  'closed',
);
assert.equal(
  Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [
      branch,
      p1,
    ])).rows[0].quantity_on_hand,
  ),
  0,
);

await db.exec(`
  update public.branch_inventory set quantity_on_hand = 4 where branch_id='${branch}' and product_id='${p1}';
`);
const afterNine = await asUser(cashier, async () => {
  return (await db.query('select public.start_cashier_shift() id')).rows[0].id;
});

const stillOpen = (await db.query('select public.close_overdue_shifts() result')).rows[0].result;
assert.equal(Number(stillOpen.closed_count), 0);
assert.equal((await db.query('select status from public.shifts where id=$1', [afterNine])).rows[0].status, 'open');
assert.equal(
  Number(
    (await db.query('select quantity_on_hand from public.branch_inventory where branch_id=$1 and product_id=$2', [
      branch,
      p1,
    ])).rows[0].quantity_on_hand,
  ),
  4,
);

await asUser(cashier, async () => {
  const sale = (
    await db.query('select (public.confirm_sale($1,$2::jsonb,$3,$4)).*', [
      afterNine,
      JSON.stringify([{ product_id: p1, quantity: 1 }]),
      '80.00',
      'night-shift-sale-key0001',
    ])
  ).rows[0];
  assert.equal(Number(sale.total_amount), 80);
});

await db.close();
console.log(
  'Leftover return tests passed: confirm-only leftover, end-shift leftover, 9pm overdue close, new shift after 9pm stays open.',
);
