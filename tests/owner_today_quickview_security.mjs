import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Security and archive behaviour of get_owner_today_branch_sales against the real migrations.
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
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

// Function definition: SECURITY DEFINER, pinned empty search_path, no PUBLIC/anon execute.
const fn = (
  await db.query(`
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text acl,
           has_function_privilege('anon', p.oid, 'execute') anon_exec,
           has_function_privilege('authenticated', p.oid, 'execute') auth_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_owner_today_branch_sales'
  `)
).rows;
assert.equal(fn.length, 1, 'exactly one overload');
assert.equal(fn[0].prosecdef, true);
assert.equal(fn[0].provolatile, 's', 'stable');
assert.deepEqual(fn[0].proconfig, ['search_path=""']);
assert.equal(fn[0].anon_exec, false);
assert.equal(fn[0].auth_exec, true);
assert.doesNotMatch(fn[0].acl, /(^|[{,])=X/, 'PUBLIC has no execute');

// The shared report is untouched by this migration (same definition source as Milestone 11.3).
const report = (
  await db.query(`select prosrc from pg_proc where proname = 'report_sales_by_branch'`)
).rows;
assert.equal(report.length, 1);
assert.match(report[0].prosrc, /where b\.is_active and not b\.is_main_branch/);

const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [owner, inactiveOwner, mainMgr, mgr1, cashier] = [id(1), id(2), id(3), id(4), id(5)];
const [main, sm1, sm2, retired] = [id(10), id(11), id(12), id(13)];
await db.exec(`
  insert into auth.users values
    ('${owner}','o@t'),('${inactiveOwner}','io@t'),('${mainMgr}','mm@t'),('${mgr1}','m1@t'),('${cashier}','c@t');
  insert into public.branches(id,name,code,is_main_branch) values
    ('${main}','Main','MAIN',true),('${sm1}','SM1','SM1',false),('${sm2}','SM2','SM2',false),
    ('${retired}','Retired Stall','RET',false);
  insert into public.profiles(id,full_name,role,branch_id,is_active) values
    ('${owner}','Owner','owner',null,true),
    ('${inactiveOwner}','Former Owner','owner',null,false),
    ('${mainMgr}','Main Manager','manager','${main}',true),
    ('${mgr1}','SM1 Manager','manager','${sm1}',true),
    ('${cashier}','Cashier','cashier','${sm1}',true);
  update public.branches set is_active = false where id = '${retired}';
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};
const call = () => db.query('select public.get_owner_today_branch_sales() r').then((res) => res.rows[0].r);

for (const [label, user] of [
  ['inactive owner', inactiveOwner],
  ['Main Branch Manager', mainMgr],
  ['selling-branch manager', mgr1],
  ['cashier', cashier],
]) {
  await asUser(user, () => assert.rejects(call, /Owner access required/, `${label} is refused`));
}
await asUser('', () => assert.rejects(call, /Owner access required/, 'authenticated without a profile is refused'));

// RLS: the definer function returns aggregates only; the owner's direct table access is unchanged.
await asUser(cashier, async () => {
  const visible = (await db.query('select count(*)::int n from public.daily_branch_sales_summary')).rows[0].n;
  assert.equal(visible, 0, 'cashier still cannot read the archive summary table directly');
});

// Archived (cleaned) day with no remaining live sales: the summary is counted once, inactive branch kept.
await db.exec(`
  insert into public.daily_branch_sales_summary(business_date, branch_id, transaction_count, quantity_sold, revenue)
  values
    ((timezone('Asia/Manila', now()))::date, '${sm1}', 3, 4, 300.00),
    ((timezone('Asia/Manila', now()))::date, '${retired}', 1, 1, 50.00),
    ((timezone('Asia/Manila', now()))::date - 1, '${sm2}', 9, 9, 900.00);
`);
await asUser(owner, async () => {
  const r = await call();
  const byId = Object.fromEntries(r.branches.map((b) => [b.branch_id, b]));
  assert.deepEqual(r.branches.map((b) => b.branch_name), ['Retired Stall', 'SM1', 'SM2']);
  assert.ok(!byId[main], 'Main is never listed');
  assert.equal(Number(byId[sm1].total_sales), 300);
  assert.equal(Number(byId[sm1].transaction_count), 3);
  assert.equal(Number(byId[retired].total_sales), 50);
  assert.equal(byId[retired].is_active, false);
  assert.equal(Number(byId[sm2].total_sales), 0, "yesterday's summary is not counted today");
});

await db.close();
console.log(
  'Owner Today Quickview security tests passed: definer/search_path, grants, role and inactive-owner denial, RLS unchanged, archived-day counting.',
);
