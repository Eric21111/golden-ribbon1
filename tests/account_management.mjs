import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';

function loadTsModule(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const module = { exports: {} };
  vm.runInNewContext(
    outputText,
    {
      module,
      exports: module.exports,
      require: createRequire(path.resolve(sourcePath)),
    },
    { filename: sourcePath },
  );
  return module.exports;
}

const { createEmployeeSchema } = loadTsModule('src/features/employees/employeeSchemas.ts');
const { employeeScopeLabel } = loadTsModule('src/features/employees/employeeFilters.ts');
const { canChangeOwnEmail, isMainBranchManager, isSellingBranchManager } = loadTsModule('src/features/auth/roles.ts');

const parsedEmail = createEmployeeSchema.safeParse({
  full_name: 'Main Manager Test',
  email: '  Test@Example.com  ',
  password: 'Temporary#1',
  role: 'manager',
  branch_id: '10000000-0000-4000-8000-000000000010',
  is_active: true,
});
assert.equal(parsedEmail.success, true);
assert.equal(parsedEmail.data.email, 'test@example.com');

assert.equal(
  employeeScopeLabel(
    { role: 'manager', branch_id: 'main' },
    [{ id: 'main', is_main_branch: true }],
  ),
  'Main Branch Manager',
);
assert.equal(
  employeeScopeLabel(
    { role: 'manager', branch_id: 'b1' },
    [{ id: 'b1', is_main_branch: false }],
  ),
  'Selling Branch Manager',
);
assert.equal(employeeScopeLabel({ role: 'cashier', branch_id: 'b1' }, []), 'Cashier');

const edge = readFileSync('supabase/functions/employee-admin/index.ts', 'utf8');
assert.match(edge, /email\.trim\(\)\.toLowerCase\(\)/);
assert.match(edge, /findAuthUserByEmail/);
assert.match(edge, /ensureEmployeeProfile/);
assert.match(edge, /reused: true/);
assert.match(edge, /deleteUser/);
assert.match(edge, /\.eq\('role', 'owner'\)/);
assert.doesNotMatch(edge, /\.eq\('role', 'manager'\)/);

const service = readFileSync('src/services/employeeService.ts', 'utf8');
assert.match(service, /createInFlight/);
assert.match(service, /email\.trim\(\)\.toLowerCase\(\)/);

const live = readFileSync('tests/milestone10_5_live_verification.mjs', 'utf8');
assert.match(live, /m105\.live\.\$\{name\}@example\.com/);
assert.match(live, /teardownThisRunProducts/);
assert.doesNotMatch(live, /m105\.\$\{name\}\.\$\{RUN_ID/);

assert.equal(canChangeOwnEmail({ role: 'owner' }), true);
assert.equal(canChangeOwnEmail({ role: 'manager', branch: { is_main_branch: true } }), true);
assert.equal(canChangeOwnEmail({ role: 'manager', branch_id: 'b1', branch: { is_main_branch: false } }), false);
assert.equal(canChangeOwnEmail({ role: 'cashier', branch_id: 'b1' }), false);
assert.equal(isMainBranchManager({ role: 'manager', branch: { is_main_branch: true } }), true);
assert.equal(isSellingBranchManager({ role: 'manager', branch_id: 'b1', branch: { is_main_branch: false } }), true);

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
for (const file of readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace('create extension if not exists pgcrypto;', ''));
}

const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const sellMgr = id(3);
const cashier = id(4);
const main = id(10);
const branch1 = id(11);
const createdMain = id(21);
const createdSell = id(22);
const createdCash = id(23);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','mainmgr@test'),
    ('${sellMgr}','sell@test'),('${cashier}','cash@test'),
    ('${createdMain}','main-created@test'),('${createdSell}','sell-created@test'),
    ('${createdCash}','cash-created@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN',true,true),
    ('${branch1}','Branch 1','BR-01',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${sellMgr}','Selling Manager','manager','${branch1}'),
    ('${cashier}','Cashier','cashier','${branch1}');
`);

const asUser = async (userId, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

await asUser(owner, async () => {
  const listed = (await db.query('select * from public.list_employees()')).rows;
  assert.ok(listed.every((row) => row.role !== 'owner'));
});

await db.query(`select public.create_employee_profile_from_server('${owner}','${createdMain}','Main Manager Test','manager','${main}',true)`);
await db.query(`select public.create_employee_profile_from_server('${owner}','${createdSell}','Selling Manager Created','manager','${branch1}',true)`);
await db.query(`select public.create_employee_profile_from_server('${owner}','${createdCash}','Cashier Created','cashier','${branch1}',true)`);

await assert.rejects(
  db.query(`select public.create_employee_profile_from_server('${owner}','${createdMain}','Main Manager Test','manager','${main}',true)`),
  /duplicate|unique|already/i,
);
await assert.rejects(
  db.query(`select public.create_employee_profile_from_server('${owner}','${id(24)}','Owner Clone','owner','${main}',true)`),
  /Manager or Cashier/,
);
await assert.rejects(
  db.query(`select public.create_employee_profile_from_server('${mainMgr}','${id(25)}','Nope','manager','${main}',true)`),
  /Owner access/,
);

await asUser(mainMgr, async () => {
  assert.equal((await db.query('select public.is_main_branch_manager() flag')).rows[0].flag, true);
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  await db.query('select public.assert_can_change_own_email()');
});
await asUser(createdMain, async () => {
  assert.equal((await db.query('select public.is_main_branch_manager() flag')).rows[0].flag, true);
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
});
await asUser(createdSell, async () => {
  assert.equal((await db.query('select public.is_main_branch_manager() flag')).rows[0].flag, false);
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  await assert.rejects(db.query('select public.assert_can_change_own_email()'), /Owner and Main Branch Manager/);
});
await asUser(sellMgr, async () => {
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  await assert.rejects(db.query('select public.assert_can_change_own_email()'), /Owner and Main Branch Manager/);
});
await asUser(cashier, async () => {
  await assert.rejects(db.query('select * from public.list_employees()'), /Owner access/);
  await assert.rejects(db.query('select public.assert_can_change_own_email()'), /Owner and Main Branch Manager/);
});
await asUser(owner, async () => {
  await db.query('select public.assert_can_change_own_email()');
});

await db.close();
console.log('Account management tests passed: owner creation, denials, email normalize, and duplicate profile protection.');
