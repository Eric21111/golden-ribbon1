/**
 * Development-only M105 fixture inspector/cleaner.
 * Does not embed service-role credentials. Uses the linked Supabase CLI.
 *
 *   node tests/cleanup_m105_fixtures.mjs           # inspect only
 *   node tests/cleanup_m105_fixtures.mjs --apply   # delete confirmed SAFE fixtures
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');

function loadEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function extractJson(text) {
  const obj = text.indexOf('{');
  const arr = text.indexOf('[');
  const start = obj >= 0 && (arr < 0 || obj < arr) ? obj : arr;
  if (start < 0) throw new Error('CLI output did not contain JSON.');
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  return JSON.parse(text.slice(start, end + 1));
}

function runCli(args) {
  return execSync(`npx ${args.map((arg) => JSON.stringify(arg)).join(' ')}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function linkedSql(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'm105-clean-'));
  const file = join(dir, 'query.sql');
  writeFileSync(file, sql);
  const out = runCli(['supabase', 'db', 'query', '--linked', '--file', file, '-o', 'json']);
  const parsed = extractJson(out);
  return parsed.rows ?? parsed;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function firstRow(value) {
  const rows = asArray(value);
  return rows[0] ?? value;
}

const INSPECT_SQL = `
with fixture_users as (
  select u.id, u.email, p.full_name, p.role, p.branch_id, p.is_active, b.name as branch_name, b.is_main_branch
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.branches b on b.id = p.branch_id
  where u.email ~* '^m105\\.[a-z0-9-]+\\.[0-9]{8}@example\\.com$'
),
fixture_products as (
  select id, name, sku
  from public.products
  where sku ~* '^m105-' or name ~* '^m105 '
),
fixture_branches as (
  select id, name, code, is_main_branch
  from public.branches
  where code ~* '^m105-' or name = 'M105 Branch 2'
),
fks as (
  select
    tc.table_name,
    kcu.column_name,
    rc.delete_rule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
  join information_schema.referential_constraints rc
    on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public'
    and ccu.table_schema = 'public'
    and ccu.table_name = 'profiles'
  order by tc.table_name, kcu.column_name
)
select jsonb_build_object(
  'foreign_keys', (select coalesce(jsonb_agg(to_jsonb(fks)), '[]'::jsonb) from fks),
  'users', (select coalesce(jsonb_agg(to_jsonb(fixture_users) order by email), '[]'::jsonb) from fixture_users),
  'orphan_auth', (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email) order by email), '[]'::jsonb)
    from fixture_users where full_name is null
  ),
  'products', (select coalesce(jsonb_agg(to_jsonb(fixture_products) order by sku), '[]'::jsonb) from fixture_products),
  'branches', (select coalesce(jsonb_agg(to_jsonb(fixture_branches) order by code), '[]'::jsonb) from fixture_branches),
  'refs', (
    select jsonb_build_object(
      'shifts', (select count(*) from public.shifts s where s.cashier_id in (select id from fixture_users)),
      'sales', (select count(*) from public.sales s where s.cashier_id in (select id from fixture_users)),
      'sale_items_on_fixture_products', (
        select count(*) from public.sale_items si where si.product_id in (select id from fixture_products)
      ),
      'transfers_by_users', (
        select count(*) from public.stock_transfers st
        where st.created_by in (select id from fixture_users)
           or st.sent_by in (select id from fixture_users)
           or st.received_by in (select id from fixture_users)
      ),
      'returns_by_users', (
        select count(*) from public.stock_returns sr
        where sr.created_by in (select id from fixture_users)
           or sr.returned_by in (select id from fixture_users)
           or sr.received_by in (select id from fixture_users)
      ),
      'movements_on_fixture_products', (
        select count(*) from public.inventory_movements im where im.product_id in (select id from fixture_products)
      ),
      'movements_by_users_on_other_products', (
        select count(*) from public.inventory_movements im
        where im.created_by in (select id from fixture_users)
          and im.product_id not in (select id from fixture_products)
      ),
      'sales_by_users_on_other_products', (
        select count(*)
        from public.sale_items si
        join public.sales s on s.id = si.sale_id
        where s.cashier_id in (select id from fixture_users)
          and si.product_id not in (select id from fixture_products)
      ),
      'transfer_items_on_other_products', (
        select count(*)
        from public.stock_transfer_items sti
        join public.stock_transfers st on st.id = sti.stock_transfer_id
        where sti.product_id not in (select id from fixture_products)
          and (
            st.created_by in (select id from fixture_users)
            or st.sent_by in (select id from fixture_users)
            or st.received_by in (select id from fixture_users)
          )
      ),
      'return_items_on_other_products', (
        select count(*)
        from public.stock_return_items sri
        join public.stock_returns sr on sr.id = sri.stock_return_id
        where sri.product_id not in (select id from fixture_products)
          and (
            sr.created_by in (select id from fixture_users)
            or sr.returned_by in (select id from fixture_users)
            or sr.received_by in (select id from fixture_users)
          )
      )
    )
  )
) as report;
`;

const env = loadEnv();
const url = env.EXPO_PUBLIC_SUPABASE_URL;
if (!url) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL in .env');
  process.exit(1);
}

console.log(APPLY ? '\n=== M105 fixture cleanup (APPLY) ===' : '\n=== M105 fixture inspection (read-only) ===');

const raw = linkedSql(INSPECT_SQL);
const report = firstRow(raw)?.report ?? firstRow(raw);
const data = typeof report === 'string' ? JSON.parse(report) : report;

console.log('\nForeign keys referencing public.profiles:');
for (const fk of data.foreign_keys ?? []) {
  console.log(`  ${fk.table_name}.${fk.column_name}  ON DELETE ${fk.delete_rule}`);
}

console.log('\nCandidate accounts:');
const users = data.users ?? [];
if (users.length === 0) console.log('  (none)');
for (const user of users) {
  const classification = user.full_name == null ? 'SAFE TEST FIXTURE (orphan Auth)' : 'SAFE TEST FIXTURE';
  console.log(
    [
      `  ${user.id}`,
      user.full_name ?? '(no profile)',
      user.role ?? '—',
      user.branch_name ?? '—',
      user.is_active == null ? '—' : (user.is_active ? 'active' : 'inactive'),
      user.email,
      classification,
    ].join(' | '),
  );
}

console.log('\nFixture products:', (data.products ?? []).length);
for (const product of data.products ?? []) {
  console.log(`  ${product.id} | ${product.name} | ${product.sku}`);
}
console.log('\nFixture branches:', (data.branches ?? []).length);
for (const branch of data.branches ?? []) {
  console.log(`  ${branch.id} | ${branch.name} | ${branch.code}`);
}

const refs = data.refs ?? {};
console.log('\nReference counts:', JSON.stringify(refs, null, 2));

const mixed =
  Number(refs.movements_by_users_on_other_products ?? 0) > 0
  || Number(refs.sales_by_users_on_other_products ?? 0) > 0
  || Number(refs.transfer_items_on_other_products ?? 0) > 0
  || Number(refs.return_items_on_other_products ?? 0) > 0;

if (mixed) {
  console.error('\nCleanup blocked: fixture accounts reference non-fixture business products.');
  process.exit(1);
}

if (!APPLY) {
  console.log(`\n${users.length} SAFE TEST FIXTURE Auth identities identified. Re-run with --apply to clean.`);
  process.exit(0);
}

if (users.length === 0 && (data.products ?? []).length === 0) {
  console.log('\nNothing to clean.');
  process.exit(0);
}

console.log('\nPushing fixture-cleanup migration as superuser...');
runCli(['supabase', 'db', 'push', '--linked', '--yes']);

const afterRaw = linkedSql(INSPECT_SQL);
const afterReport = firstRow(afterRaw)?.report ?? firstRow(afterRaw);
const after = typeof afterReport === 'string' ? JSON.parse(afterReport) : afterReport;
const remainingUsers = after.users ?? [];
const remainingProducts = after.products ?? [];
console.log(`Remaining M105 Auth identities: ${remainingUsers.length}`);
console.log(`Remaining M105 products: ${remainingProducts.length}`);
if (remainingUsers.length || remainingProducts.length) {
  console.error('Cleanup leftovers remain.');
  process.exit(1);
}

const reconRaw = linkedSql(`
  select count(*)::int as variance_rows
  from (
    select bi.branch_id, bi.product_id,
           bi.quantity_on_hand - coalesce(sum(im.quantity), 0) as variance
    from public.branch_inventory bi
    left join public.inventory_movements im
      on im.branch_id = bi.branch_id and im.product_id = bi.product_id
    group by bi.branch_id, bi.product_id, bi.quantity_on_hand
    having bi.quantity_on_hand - coalesce(sum(im.quantity), 0) <> 0
  ) v;
`);
const varianceRows = Number(firstRow(reconRaw)?.variance_rows ?? 0);
console.log(`Reconciliation variance rows: ${varianceRows}`);
if (varianceRows !== 0) {
  console.error('Reconciliation variance is not 0 after cleanup.');
  process.exit(1);
}

console.log('\nM105 fixture cleanup completed. Reconciliation variance = 0.');
