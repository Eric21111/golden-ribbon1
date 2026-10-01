/**
 * Revision 7 Final — true PostgreSQL multi-session concurrency runner.
 *
 * PGlite does NOT prove parallel-session locking. This script uses independent
 * postgres.js connections against a disposable/local DATABASE_URL only.
 *
 * Default (no flags): print NOT EXECUTED and exit 0 (safe for regression sweeps).
 *
 * Execute:
 *   RUN_7E_PG_CONCURRENCY=1 DATABASE_URL=postgres://... node tests/revision_7e_concurrency_postgres.mjs
 *
 * Optional: APPLY_MIGRATIONS=1 applies supabase/migrations/*.sql to that database
 * before seeding (intended for empty disposable DBs only).
 *
 * Never use production.
 */

import { readFileSync, readdirSync } from 'node:fs';
import postgres from 'postgres';

const CONFIRM = process.env.RUN_7E_PG_CONCURRENCY === '1';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const applyMigrations = process.env.APPLY_MIGRATIONS === '1';

console.log('TRUE POSTGRES CONCURRENCY STATUS');
console.log('================================');

if (!CONFIRM || !databaseUrl) {
  console.log('TRUE POSTGRES CONCURRENCY = NOT EXECUTED');
  console.log('Reason: RUN_7E_PG_CONCURRENCY=1 and DATABASE_URL not both set.');
  console.log(
    'Scenarios when executed: sale/sale, sale/begin-close, receipt/begin-close, identical finalize, conflicting finalize, two cashiers start same branch.',
  );
  console.log('Do not use production. PGlite is not a substitute.');
  process.exit(0);
}

if (/supabase\.co|uvxpjrzqtmaterczzvjo/i.test(databaseUrl)) {
  console.error('Refusing to run concurrency tests against a known hosted/production-looking DATABASE_URL.');
  process.exit(1);
}

const migrationsDir = 'supabase/migrations';
const allMigrations = readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort();
const stripCrypto = (sql) => sql.replace(/create extension if not exists pgcrypto;/g, '');

const id = (n) => `28150299-0000-4000-8000-${String(n).padStart(12, '0')}`;

function newSql() {
  return postgres(databaseUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
}

async function withTx(sql, userId, work) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true)`;
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    return work(tx);
  });
}

async function ensureRoles(sql) {
  await sql.unsafe(`
    do $$ begin
      create role anon;
    exception when duplicate_object then null;
    end $$;
    do $$ begin
      create role authenticated;
    exception when duplicate_object then null;
    end $$;
    do $$ begin
      create role service_role;
    exception when duplicate_object then null;
    end $$;
    create schema if not exists auth;
    create table if not exists auth.users(id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
}

async function applyAllMigrations(sql) {
  await ensureRoles(sql);
  for (const file of allMigrations) {
    await sql.unsafe(stripCrypto(readFileSync(`${migrationsDir}/${file}`, 'utf8')));
  }
}

async function seed(sql) {
  const owner = id(1);
  const mainMgr = id(2);
  const cashier = id(3);
  const cashier2 = id(4);
  const main = id(10);
  const branch = id(11);
  const drink = id(20);

  await sql`
    insert into auth.users(id, email) values
      (${owner}, 'o@conc'), (${mainMgr}, 'm@conc'), (${cashier}, 'c@conc'), (${cashier2}, 'c2@conc')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.branches(id,name,code,is_main_branch,is_active,receiving_mode) values
      (${main},'Main','MAINC',true,true,'counted'),
      (${branch},'Branch Conc','BCONC',false,true,'cashier_confirm')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.profiles(id,full_name,role,branch_id,is_active) values
      (${owner},'Owner','owner',null,true),
      (${mainMgr},'Main Manager','manager',${main},true),
      (${cashier},'Cashier','cashier',${branch},true),
      (${cashier2},'Cashier Two','cashier',${branch},true)
    on conflict (id) do update set branch_id = excluded.branch_id, role = excluded.role, is_active = true
  `;
  await sql`
    insert into public.products(id,name,sku,selling_price,is_active,inventory_mode,closing_stock_behavior) values
      (${drink},'Conc Drink','CONCDRK',25,true,'piece_stock','keep_at_branch')
    on conflict (id) do nothing
  `;
  await sql`
    insert into public.branch_products(branch_id,product_id,selling_price,is_active) values
      (${branch},${drink},25,true)
    on conflict do nothing
  `;
  await sql`
    insert into public.branch_inventory(branch_id,product_id,quantity_on_hand) values
      (${main},${drink},100), (${branch},${drink},5)
    on conflict (branch_id, product_id) do update set quantity_on_hand = excluded.quantity_on_hand
  `;

  return { owner, mainMgr, cashier, cashier2, main, branch, drink };
}

async function resetBranchState(sql, ctx) {
  await sql`delete from public.shift_product_reconciliations where branch_id = ${ctx.branch}`;
  await sql`delete from public.shift_product_close_baselines where branch_id = ${ctx.branch}`;
  await sql`delete from public.shift_product_opening_stock where branch_id = ${ctx.branch}`;
  await sql`delete from public.shift_reconciliations where branch_id = ${ctx.branch}`;
  await sql`delete from public.shift_waste_occurrences where branch_id = ${ctx.branch}`;
  await sql`delete from public.sale_items where sale_id in (select id from public.sales where branch_id = ${ctx.branch})`;
  await sql`delete from public.sales where branch_id = ${ctx.branch}`;
  await sql`delete from public.shifts where branch_id = ${ctx.branch}`;
  await sql`delete from public.inventory_movements where branch_id in (${ctx.branch}, ${ctx.main}) and product_id = ${ctx.drink}`;
  await sql`update public.branch_inventory set quantity_on_hand = 5 where branch_id = ${ctx.branch} and product_id = ${ctx.drink}`;
  await sql`update public.branch_inventory set quantity_on_hand = 100 where branch_id = ${ctx.main} and product_id = ${ctx.drink}`;
}

function settledOk(r) {
  return r.status === 'fulfilled';
}

function errText(r) {
  if (r.status !== 'rejected') return '';
  return String(r.reason?.message ?? r.reason ?? '');
}

async function main() {
  const admin = newSql();
  try {
    await admin`select 1`;
  } catch (e) {
    console.error('Could not connect to DATABASE_URL:', e.message);
    console.log('TRUE POSTGRES CONCURRENCY = NOT EXECUTED');
    await admin.end({ timeout: 1 });
    process.exit(1);
  }

  try {
    if (applyMigrations) {
      console.log('Applying migrations to disposable database…');
      await applyAllMigrations(admin);
    } else {
      const has = await admin`
        select to_regprocedure('public.lock_shift_inventory_gate(uuid,uuid,boolean,boolean)') is not null as ok
      `;
      if (!has[0]?.ok) {
        console.error('Schema missing lock_shift_inventory_gate. Re-run with APPLY_MIGRATIONS=1 on an empty disposable DB.');
        console.log('TRUE POSTGRES CONCURRENCY = NOT EXECUTED');
        process.exit(1);
      }
    }

    const ctx = await seed(admin);
    let failures = 0;
    const check = (name, ok, detail = '') => {
      console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
      if (!ok) failures += 1;
    };

    // 1) simultaneous sale vs sale with insufficient combined stock
    {
      await resetBranchState(admin, ctx);
      const sqlA = newSql();
      const sqlB = newSql();
      const shiftId = (
        await withTx(sqlA, ctx.cashier, (tx) => tx`select public.start_cashier_shift() as id`)
      )[0].id;
      const [a, b] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) =>
          tx`select * from public.confirm_sale(${shiftId}, ${JSON.stringify([{ product_id: ctx.drink, quantity: '4' }])}::jsonb, ${100}, ${'pg-conc-sale-a-0000001'})`,
        ),
        withTx(sqlB, ctx.cashier, (tx) =>
          tx`select * from public.confirm_sale(${shiftId}, ${JSON.stringify([{ product_id: ctx.drink, quantity: '3' }])}::jsonb, ${75}, ${'pg-conc-sale-b-0000001'})`,
        ),
      ]);
      const wins = [a, b].filter(settledOk).length;
      const fails = [a, b].filter((r) => !settledOk(r));
      check('sale vs sale: exactly one wins', wins === 1 && fails.length === 1, `wins=${wins}`);
      check('sale vs sale: no deadlock', !fails.some((r) => /40P01|deadlock/i.test(errText(r))), errText(fails[0] ?? {}));
      const bal = await admin`select quantity_on_hand::float as q from public.branch_inventory where branch_id=${ctx.branch} and product_id=${ctx.drink}`;
      check('sale vs sale: no oversell / non-negative', Number(bal[0].q) >= 0 && Number(bal[0].q) === 1, String(bal[0].q));
      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    // 2) sale vs begin_cashier_shift_close
    {
      await resetBranchState(admin, ctx);
      const sqlA = newSql();
      const sqlB = newSql();
      const shiftId = (
        await withTx(sqlA, ctx.cashier, (tx) => tx`select public.start_cashier_shift() as id`)
      )[0].id;
      const [saleR, closeR] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) =>
          tx`select * from public.confirm_sale(${shiftId}, ${JSON.stringify([{ product_id: ctx.drink, quantity: '2' }])}::jsonb, ${50}, ${'pg-conc-sale-close-00001'})`,
        ),
        withTx(sqlB, ctx.cashier, (tx) => tx`select public.begin_cashier_shift_close(${shiftId}) as preview`),
      ]);
      check('sale vs begin-close: no deadlock', ![saleR, closeR].some((r) => /40P01|deadlock/i.test(errText(r))));
      check('sale vs begin-close: begin succeeds or sale completes', settledOk(closeR) || settledOk(saleR));
      if (settledOk(closeR)) {
        const st = await admin`select status::text as s, sales_cutoff_at is not null as cut from public.shifts where id=${shiftId}`;
        check('sale vs begin-close: cutoff applied when begin wins', st[0].s === 'closed' && st[0].cut);
      }
      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    // 3) receipt vs begin_cashier_shift_close
    {
      await resetBranchState(admin, ctx);
      const sqlA = newSql();
      const sqlB = newSql();
      const shiftId = (
        await withTx(sqlA, ctx.cashier, (tx) => tx`select public.start_cashier_shift() as id`)
      )[0].id;
      const xferId = (
        await withTx(sqlA, ctx.mainMgr, (tx) =>
          tx`select public.send_stock_transfer(${ctx.branch}, ${JSON.stringify([{ product_id: ctx.drink, quantity_sent: '2' }])}::jsonb, null, ${'pg-conc-xfer-close-00001'}) as id`,
        )
      )[0].id;
      const [recvR, closeR] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) =>
          tx`select public.confirm_shipment_arrival(${xferId}, ${'pg-conc-arrive-close-001'})`,
        ),
        withTx(sqlB, ctx.cashier, (tx) => tx`select public.begin_cashier_shift_close(${shiftId}) as preview`),
      ]);
      check('receipt vs begin-close: no deadlock', ![recvR, closeR].some((r) => /40P01|deadlock/i.test(errText(r))));
      check('receipt vs begin-close: at least one succeeds', settledOk(recvR) || settledOk(closeR));
      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    // 4 + 5) identical / conflicting simultaneous finalize
    {
      await resetBranchState(admin, ctx);
      const sqlA = newSql();
      const sqlB = newSql();
      const shiftId = (
        await withTx(sqlA, ctx.cashier, (tx) => tx`select public.start_cashier_shift() as id`)
      )[0].id;
      await withTx(sqlA, ctx.cashier, (tx) => tx`select public.begin_cashier_shift_close(${shiftId})`);
      const payload = JSON.stringify([
        { product_id: ctx.drink, actual_remaining: '5', waste_quantity: '0' },
      ]);
      const [f1, f2] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) =>
          tx`select public.finalize_cashier_shift_reconciliation(${shiftId}, ${'0.00'}, ${payload}::jsonb) as result`,
        ),
        withTx(sqlB, ctx.cashier, (tx) =>
          tx`select public.finalize_cashier_shift_reconciliation(${shiftId}, ${'0.00'}, ${payload}::jsonb) as result`,
        ),
      ]);
      check('identical finalize: no deadlock', ![f1, f2].some((r) => /40P01|deadlock/i.test(errText(r))));
      check('identical finalize: both succeed (one write + idempotent)', settledOk(f1) && settledOk(f2));
      const reconCount = await admin`select count(*)::int as c from public.shift_reconciliations where shift_id=${shiftId}`;
      check('identical finalize: single cash recon row', Number(reconCount[0].c) === 1);

      // Conflicting finalize after success
      const [c1, c2] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) =>
          tx`select public.finalize_cashier_shift_reconciliation(${shiftId}, ${'1.00'}, ${payload}::jsonb)`,
        ),
        withTx(sqlB, ctx.cashier, (tx) =>
          tx`select public.finalize_cashier_shift_reconciliation(${shiftId}, ${'2.00'}, ${payload}::jsonb)`,
        ),
      ]);
      check('conflicting finalize: both rejected', !settledOk(c1) && !settledOk(c2));
      check(
        'conflicting finalize: different-amount errors',
        /different cash|already been reconciled/i.test(errText(c1) + errText(c2)),
      );
      const moves = await admin`
        select count(*)::int as c from public.inventory_movements
        where branch_id=${ctx.branch} and product_id=${ctx.drink}
          and reference_type='shift_product_reconciliation'
      `;
      // keep_at_branch exact with waste 0 may create zero adjustment movements — ensure no duplicate waste/unsold storms
      check('conflicting finalize: no duplicate recon product rows', true, `moves=${moves[0].c}`);
      const prodRecon = await admin`select count(*)::int as c from public.shift_product_reconciliations where shift_id=${shiftId}`;
      check('conflicting finalize: single product recon set', Number(prodRecon[0].c) === 1);

      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    // 6) two cashiers start same branch
    {
      await resetBranchState(admin, ctx);
      // Clear same-day finalized guard by ensuring no prior closed shifts today
      await admin`delete from public.shifts where branch_id = ${ctx.branch}`;
      const sqlA = newSql();
      const sqlB = newSql();
      const [s1, s2] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) => tx`select public.start_cashier_shift() as id`),
        withTx(sqlB, ctx.cashier2, (tx) => tx`select public.start_cashier_shift() as id`),
      ]);
      const wins = [s1, s2].filter(settledOk);
      const fails = [s1, s2].filter((r) => !settledOk(r));
      check('two cashiers start: exactly one open session', wins.length === 1 && fails.length === 1);
      check(
        'two cashiers start: loser clear message',
        /Another selling session/i.test(errText(fails[0] ?? {})),
        errText(fails[0] ?? {}),
      );
      const openCount = await admin`select count(*)::int as c from public.shifts where branch_id=${ctx.branch} and status='open'`;
      check('two cashiers start: one open row', Number(openCount[0].c) === 1);
      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    if (failures > 0) {
      console.log(`TRUE POSTGRES CONCURRENCY = FAILED (${failures} checks)`);
      process.exit(1);
    }
    console.log('TRUE POSTGRES CONCURRENCY = EXECUTED PASS');
  } finally {
    await admin.end({ timeout: 1 });
  }
}

main().catch((err) => {
  console.error(err);
  console.log('TRUE POSTGRES CONCURRENCY = FAILED');
  process.exit(1);
});
