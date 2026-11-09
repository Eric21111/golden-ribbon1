import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Owner-only selling-branch INSERT (post Milestone 11 correction). Manager keeps UPDATE.
const MIGRATION = '20261109100000_owner_only_branch_insert.sql';
const files = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort();
assert.ok(files.includes(MIGRATION), 'owner_only_branch_insert migration exists');

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
for (const file of files) {
  await db.exec(
    readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''),
  );
}

const id = (n) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const sellMgr = id(3);
const cashier = id(4);
const main = id(10);
const existingSell = id(11);
const ownerCreated = id(12);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','main@test'),('${sellMgr}','sell@test'),('${cashier}','cash@test');
  insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
    ('${main}','Main Branch','MAIN',true,true,'counted'),
    ('${existingSell}','Existing Stall','EX1',false,true,'cashier_confirm');
  insert into public.profiles(id,full_name,role,branch_id,is_active) values
    ('${owner}','Owner','owner',null,true),
    ('${mainMgr}','Main Manager','manager','${main}',true),
    ('${sellMgr}','Selling Manager','manager','${existingSell}',true),
    ('${cashier}','Cashier','cashier','${existingSell}',true);
`);

const asUser = async (userId, work) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await work();
  } finally {
    await db.exec('reset role');
  }
};

const insertSelling = (branchId, code) =>
  db.exec(`
    insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode)
    values ('${branchId}','New Stall','${code}',false,true,'cashier_confirm')
  `);

// Policy names after the forward migration.
const policies = (
  await db.query(`
    select polname from pg_policy
    where polrelid = 'public.branches'::regclass and polcmd = 'a'
    order by polname
  `)
).rows.map((row) => row.polname);
assert.deepEqual(policies, ['branches_insert_owner'], 'only Owner insert policy remains');

await asUser(owner, async () => {
  await insertSelling(ownerCreated, 'OWN1');
  const row = (await db.query(`select name, is_main_branch from public.branches where id='${ownerCreated}'`)).rows[0];
  assert.equal(row.name, 'New Stall');
  assert.equal(row.is_main_branch, false);
});

for (const [label, user, code] of [
  ['Main Branch Manager', mainMgr, 'MM1'],
  ['selling-branch manager', sellMgr, 'SM1'],
  ['cashier', cashier, 'CA1'],
]) {
  await asUser(user, () =>
    assert.rejects(
      () => insertSelling(id(20 + code.charCodeAt(0)), code),
      /row-level security|42501|permission denied/i,
      `${label} cannot insert a branch`,
    ),
  );
}

await asUser(owner, async () => {
  await db.exec(`update public.branches set name='Existing Stall Renamed' where id='${existingSell}'`);
  await db.exec(`update public.branches set is_active=false where id='${existingSell}'`);
});
assert.equal(
  (await db.query(`select name, is_active from public.branches where id='${existingSell}'`)).rows[0].name,
  'Existing Stall Renamed',
  'Owner can edit selling branches',
);
assert.equal(
  (await db.query(`select is_active from public.branches where id='${existingSell}'`)).rows[0].is_active,
  false,
  'Owner can soft-deactivate selling branches',
);
await asUser(owner, async () => {
  await db.exec(`update public.branches set is_active=true where id='${existingSell}'`);
});

// RLS UPDATE with no matching USING row is a silent no-op (0 rows), not an exception.
await asUser(mainMgr, async () => {
  await db.exec(`update public.branches set name='Manager Should Fail' where id='${existingSell}'`);
});
assert.equal(
  (await db.query(`select name from public.branches where id='${existingSell}'`)).rows[0].name,
  'Existing Stall Renamed',
  'Main Manager cannot update branches',
);

const mainBefore = (await db.query(`select name, is_main_branch, is_active from public.branches where id='${main}'`))
  .rows[0];
assert.equal(mainBefore.is_main_branch, true);
assert.equal(mainBefore.is_active, true);

await asUser(owner, () =>
  assert.rejects(
    () =>
      db.exec(`
        insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode)
        values ('${id(99)}','Second HQ','SEC',true,true,'counted')
      `),
    /row-level security|42501|permission denied|branches_one_main_branch|duplicate/i,
    'Owner cannot insert a second Main Branch',
  ),
);

const mainAfter = (await db.query(`select name, is_main_branch, is_active from public.branches where id='${main}'`))
  .rows[0];
assert.deepEqual(mainAfter, mainBefore, 'existing Main Branch row is unchanged');

const updatePolicies = (
  await db.query(`
    select polname from pg_policy
    where polrelid = 'public.branches'::regclass and polcmd = 'w'
    order by polname
  `)
).rows.map((row) => row.polname);
assert.deepEqual(updatePolicies, ['branches_update_owner'], 'only Owner update policy remains');

await db.close();
console.log(
  'Owner create branch tests passed: Owner insert/update/deactivate allowed, other roles denied insert, Manager update denied, Main unchanged.',
);
