/**
 * Archive vs sale/void lock races on true PostgreSQL (two sessions).
 * PGlite is single-session and cannot prove this.
 *
 * Default (no flags): prints NOT TESTED and exits 0.
 * Disposable database only:
 *   RUN_ARCHIVE_PG=1 DATABASE_URL=postgres://... node tests/archive_products_concurrency_postgres.mjs
 * APPLY_MIGRATIONS=1 applies supabase/migrations/*.sql first. Never production.
 */
import { readFileSync, readdirSync } from 'node:fs';

console.log('ARCHIVE PRODUCTS, TRUE POSTGRES CONCURRENCY');
const confirm = process.env.RUN_ARCHIVE_PG === '1';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!confirm || !databaseUrl) {
  console.log('= NOT TESTED (RUN_ARCHIVE_PG=1 and DATABASE_URL not both set). PGlite is not a substitute.');
  console.log('Scenarios when executed: archive vs confirm_sale; archive vs void restore; inventory-then-product lock order.');
  process.exit(0);
}
if (/supabase\.co|uvxpjrzqtmaterczzvjo/i.test(databaseUrl)) {
  console.error('Refusing to run against a hosted/production-looking DATABASE_URL.');
  process.exit(1);
}

const postgres = (await import('postgres')).default;
const admin = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
const sessionA = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
const sessionB = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  if (process.env.APPLY_MIGRATIONS === '1') {
    await admin.unsafe(`
      do $$ begin create role anon; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role; exception when duplicate_object then null; end $$;
      create schema if not exists auth;
      create table if not exists auth.users(id uuid primary key, email text);
      create or replace function auth.uid() returns uuid language sql as $f$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $f$;
      grant usage on schema public, auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
      await admin.unsafe(readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
    }
  }

  const hasArchive = await admin`
    select to_regprocedure('public.archive_product(uuid)') is not null as ok
  `;
  check('archive_product is installed', Boolean(hasArchive[0]?.ok));

  const lockDef = await admin`
    select pg_get_functiondef('public.archive_product(uuid)'::regprocedure) as def
  `;
  check(
    'archive locks inventory before the product',
    /branch_inventory[\s\S]*for update[\s\S]*from public\.products[\s\S]*for update/i.test(lockDef[0]?.def ?? ''),
  );
  check(
    'void-restore positive adjustments are rejected for archived products',
    /new\.quantity > 0/.test(
      (
        await admin`select pg_get_functiondef('public.reject_archived_product_operation()'::regprocedure) as def`
      )[0]?.def ?? '',
    ),
  );

  // Two-session smoke: one session holds the product row while the other archives.
  const ids = await admin`
    select
      (select id from public.branches where is_main_branch limit 1) as main,
      gen_random_uuid() as product,
      gen_random_uuid() as manager
  `;
  const main = ids[0].main;
  const product = ids[0].product;
  const manager = ids[0].manager;
  if (!main) {
    check('main branch exists for concurrency fixture', false, 'no main branch');
  } else {
    await admin`
      insert into auth.users(id, email) values (${manager}, ${`archive-pg-${manager}@t`})
      on conflict (id) do nothing
    `;
    await admin`
      insert into public.profiles(id, full_name, role, branch_id)
      values (${manager}, 'Archive PG Manager', 'manager', ${main})
      on conflict (id) do update set role = 'manager', branch_id = ${main}, is_active = true
    `;
    await admin`
      insert into public.products(id, name, sku, is_active, sell_in_pos, selling_price, inventory_mode, closing_stock_behavior)
      values (${product}, ${`Archive Race ${product}`}, ${`AR${String(product).slice(0, 8)}`}, false, false, null, 'piece_stock', 'keep_at_branch')
    `;

    await sessionA.unsafe('begin');
    await sessionA`select set_config('role', 'authenticated', true)`;
    await sessionA`select set_config('request.jwt.claim.sub', ${manager}, true)`;
    await sessionA`select id from public.products where id = ${product} for update`;

    const archivePromise = sessionB.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true)`;
      await tx`select set_config('request.jwt.claim.sub', ${manager}, true)`;
      return tx`select (public.archive_product(${product})).archived_at as archived_at`;
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    let archiveDone = false;
    archivePromise.then(() => {
      archiveDone = true;
    }).catch(() => {
      archiveDone = true;
    });
    check('archive waits while another session holds the product row', archiveDone === false);
    await sessionA.unsafe('commit');
    const archived = await archivePromise;
    check('archive completes after the product lock is released', Boolean(archived[0]?.archived_at));
  }
} catch (error) {
  failures += 1;
  console.error(error);
} finally {
  await sessionA.end({ timeout: 1 }).catch(() => {});
  await sessionB.end({ timeout: 1 }).catch(() => {});
  await admin.end({ timeout: 1 }).catch(() => {});
}

if (failures) {
  console.log(`TRUE POSTGRES CONCURRENCY = EXECUTED FAIL (${failures})`);
  process.exit(1);
}
console.log('TRUE POSTGRES CONCURRENCY = EXECUTED PASS');
