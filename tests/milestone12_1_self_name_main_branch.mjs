import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const MIGRATION_FILES = readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort();
const THIS_MIGRATION = '20260921090000_milestone_12_1_self_name_main_branch.sql';
assert.ok(MIGRATION_FILES.includes(THIS_MIGRATION), 'Milestone 12.1 migration file exists');

const bootDb = async () => {
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
  return db;
};

const asUser = (db) => async (userId, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

// ============================================================================
// Part A — full migration set: self name editing + Main Branch protections
// ============================================================================

const db = await bootDb();
for (const file of MIGRATION_FILES) {
  await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const id = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const sellMgr = id(3);
const cashier1 = id(4);
const cashier2 = id(5);
const main = id(10);
const branch1 = id(11);
const chicken = id(20);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','mainmgr@test'),
    ('${sellMgr}','sellmgr@test'),('${cashier1}','c1@test'),('${cashier2}','c2@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN',true,true),
    ('${branch1}','Branch 1','BR-01',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${sellMgr}','Selling Manager','manager','${branch1}'),
    ('${cashier1}','Cashier One','cashier','${branch1}'),
    ('${cashier2}','Cashier Two','cashier','${branch1}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${chicken}','Chicken Butter','CB',80,true);
`);

const userAs = asUser(db);
const snapshot = async (userId) =>
  (await db.query('select role, branch_id, is_active, full_name from public.profiles where id=$1', [userId])).rows[0];

// --- Owner always has Main Branch branch_id ---
assert.equal((await snapshot(owner)).branch_id, main, 'Owner is auto-assigned to the Main Branch on creation');

// --- Every authenticated role can edit their own name; role/branch/status untouched ---
for (const [label, userId] of [
  ['Owner', owner],
  ['Main Manager', mainMgr],
  ['Selling Manager', sellMgr],
  ['Cashier', cashier1],
]) {
  const before = await snapshot(userId);
  await userAs(userId, async () => {
    const result = (await db.query(`select (public.update_own_name('  ${label} Renamed  ')).*`)).rows[0];
    assert.equal(result.full_name, `${label} Renamed`, `${label} name is trimmed and updated`);
  });
  const after = await snapshot(userId);
  assert.equal(after.full_name, `${label} Renamed`);
  assert.equal(after.role, before.role, `${label} role is unchanged by a name edit`);
  assert.equal(after.branch_id, before.branch_id, `${label} branch is unchanged by a name edit`);
  assert.equal(after.is_active, before.is_active, `${label} active status is unchanged by a name edit`);
}

// --- A user can only ever change their own row (no target-id parameter exists) ---
const cashier2Before = await snapshot(cashier2);
await userAs(cashier1, async () => {
  await db.query(`select public.update_own_name('Cashier One Again')`);
});
const cashier2After = await snapshot(cashier2);
assert.deepEqual(cashier2After, cashier2Before, "Editing cashier1's name never touches cashier2's row");

// --- Validation: empty / too short / too long names are rejected ---
await userAs(cashier1, async () => {
  await assert.rejects(db.query(`select public.update_own_name('')`), /between 2 and 120/);
  await assert.rejects(db.query(`select public.update_own_name('   ')`), /between 2 and 120/);
  await assert.rejects(db.query(`select public.update_own_name('A')`), /between 2 and 120/);
  await assert.rejects(db.query(`select public.update_own_name('${'A'.repeat(121)}')`), /between 2 and 120/);
});

// --- Unauthenticated callers are rejected ---
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','',false);`);
await assert.rejects(db.query(`select public.update_own_name('Nobody')`), /Authentication is required/);
await db.exec('reset role');

// --- Main Branch protections ---
await assert.rejects(
  db.exec(`insert into public.branches(name,code,is_main_branch,is_active) values ('Second HQ','SEC','${true}','${true}')`),
  /branches_one_main_branch|duplicate/,
);
await assert.rejects(db.exec(`update public.branches set is_active=false where id='${main}'`), /cannot be deactivated/);
await assert.rejects(db.exec(`update public.branches set is_main_branch=false where id='${main}'`), /cannot be converted/);
await assert.rejects(db.exec(`update public.branches set name='Corporate HQ' where id='${main}'`), /cannot be renamed/);
await assert.rejects(db.exec(`delete from public.branches where id='${main}'`), /cannot be deleted/);

// Selling branches remain freely editable.
await db.exec(`update public.branches set name='Branch One Renamed' where id='${branch1}'`);
assert.equal(
  (await db.query(`select name from public.branches where id='${branch1}'`)).rows[0].name,
  'Branch One Renamed',
);

// --- Owner attached to the Main Branch is still not a Main Branch Manager ---
await userAs(owner, async () => {
  assert.equal((await db.query('select public.is_main_branch_manager() flag')).rows[0].flag, false);
  await assert.rejects(
    db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":10}]'::jsonb, null)`),
    /Main Branch Manager/,
  );
  await assert.rejects(
    db.query(`select public.send_stock_transfer('${branch1}','[{"product_id":"${chicken}","quantity_sent":1}]'::jsonb,null,'owner-hq-send-key0001')`),
    /Main Branch Manager/,
  );
});

// --- Main Manager still gets Main Branch operational permissions ---
await userAs(mainMgr, async () => {
  assert.equal((await db.query('select public.is_main_branch_manager() flag')).rows[0].flag, true);
  await db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":50}]'::jsonb, 'opening')`);
});

// --- Selling manager / cashiers remain correctly branch-scoped ---
await userAs(sellMgr, async () => {
  assert.equal((await db.query('select public.is_main_branch_manager() flag')).rows[0].flag, false);
  await assert.rejects(
    db.query(`select public.initialize_main_branch_inventory('[{"product_id":"${chicken}","quantity":1}]'::jsonb, null)`),
    /Main Branch Manager/,
  );
});
await userAs(cashier1, async () => {
  const shift = (await db.query('select public.start_cashier_shift() id')).rows[0].id;
  await db.query('select public.end_cashier_shift($1)', [shift]);
});

await db.close();
console.log('Part A passed: self name editing (all roles), Main Branch protections, Owner-is-not-Main-Manager.');

// ============================================================================
// Part B — legacy-data backfill: an Owner created under the OLD "branch_id
// must be null" rule is migrated onto the Main Branch when 12.1 is applied.
// ============================================================================

const legacyIndex = MIGRATION_FILES.indexOf(THIS_MIGRATION);
const priorMigrations = MIGRATION_FILES.slice(0, legacyIndex);

const legacyDb = await bootDb();
for (const file of priorMigrations) {
  await legacyDb.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
}

const legacyOwner = id(90);
const legacyMain = id(91);
await legacyDb.exec(`
  insert into auth.users values ('${legacyOwner}','legacy-owner@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values ('${legacyMain}','Main Branch','MAIN',true,true);
  insert into public.profiles(id,full_name,role,branch_id) values ('${legacyOwner}','Legacy Owner','owner',null);
`);
const legacyBefore = (await legacyDb.query(`select branch_id from public.profiles where id='${legacyOwner}'`)).rows[0];
assert.equal(legacyBefore.branch_id, null, 'Pre-12.1 schema still allows a null-branch Owner (sanity check)');

await legacyDb.exec(readFileSync(`supabase/migrations/${THIS_MIGRATION}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));

const legacyAfter = (await legacyDb.query(`select branch_id from public.profiles where id='${legacyOwner}'`)).rows[0];
assert.equal(legacyAfter.branch_id, legacyMain, 'Existing Owner is backfilled onto the Main Branch by the 12.1 migration');

// Even an explicit attempt to null it back out is re-pinned to the Main
// Branch by the trigger before the NOT NULL constraint is ever reached.
await legacyDb.exec(`update public.profiles set branch_id=null where id='${legacyOwner}'`);
assert.equal(
  (await legacyDb.query(`select branch_id from public.profiles where id='${legacyOwner}'`)).rows[0].branch_id,
  legacyMain,
  'Attempting to null an Owner branch_id is silently re-pinned to the Main Branch',
);

await legacyDb.close();
console.log('Part B passed: existing Owner rows are backfilled onto the Main Branch, branch_id is now required.');

console.log('Milestone 12.1 tests passed: self name editing and permanent Main Branch verified.');
