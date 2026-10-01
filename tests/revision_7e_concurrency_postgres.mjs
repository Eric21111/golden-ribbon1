/**
 * Revision 7 Final Patch 3 — true PostgreSQL multi-session concurrency runner.
 *
 * PGlite does NOT prove parallel-session locking. This script uses independent
 * postgres.js connections against a disposable/local DATABASE_URL only.
 *
 * Default (no flags): print NOT EXECUTED and exit 0 (safe for regression sweeps).
 *
 * Execute:
 *   RUN_7E_PG_CONCURRENCY=1 DATABASE_URL=postgres://... node tests/revision_7e_concurrency_postgres.mjs
 *
 * Optional: APPLY_MIGRATIONS=1 applies supabase/migrations/*.sql (empty disposable DBs).
 * Reruns with APPLY_MIGRATIONS=0 are safe: one shared active Main Branch is reused;
 * each scenario uses a runtime-unique selling branch/product/cashiers/keys;
 * immutable history is never deleted.
 *
 * Never use production.
 */

import { randomBytes, randomUUID } from 'node:crypto';
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
    'Scenarios when executed: sale/sale, sale/begin-close, receipt/begin-close, identical finalize, conflicting first finalize, two cashiers start same branch.',
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
const RUN = randomBytes(4).toString('hex');

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
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role; exception when duplicate_object then null; end $$;
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

/**
 * Exactly one Main Branch for the whole runner.
 * Reuse existing active Main; fail clearly if inactive; never create a second Main.
 */
async function ensureSharedMain(sql) {
  const existing = await sql`
    select id, is_active
    from public.branches
    where is_main_branch = true
    limit 1
  `;
  if (existing.length) {
    if (!existing[0].is_active) {
      throw new Error(
        'Existing Main Branch (is_main_branch=true) is inactive. Activate it or use a disposable DB with an active Main. Refusing to create a second Main (branches_one_main_branch).',
      );
    }
    return { id: existing[0].id };
  }
  const id = randomUUID();
  const code = `M${RUN}`.slice(0, 12);
  await sql`
    insert into public.branches(id, name, code, is_main_branch, is_active, receiving_mode)
    values (${id}, ${`Main ${RUN}`}, ${code}, true, true, 'counted')
  `;
  return { id };
}

/** Per-scenario selling-branch fixture — unique IDs/codes/SKUs/keys; never deletes history. */
async function seedScenario(sql, tag, sharedMain, { cashiers = 1, branchStock = 5, mainStock = 100 } = {}) {
  const prefix = `${RUN}${tag}`.slice(0, 12);
  const owner = randomUUID();
  const mainMgr = randomUUID();
  const cashier = randomUUID();
  const cashier2 = randomUUID();
  const branch = randomUUID();
  const drink = randomUUID();
  const branchCode = `B${prefix}`.slice(0, 12);
  const sku = `S${prefix}`.slice(0, 20);
  const main = sharedMain.id;

  await sql`
    insert into auth.users(id, email) values
      (${owner}, ${`o-${prefix}@conc.test`}),
      (${mainMgr}, ${`m-${prefix}@conc.test`}),
      (${cashier}, ${`c-${prefix}@conc.test`}),
      (${cashier2}, ${`c2-${prefix}@conc.test`})
  `;
  await sql`
    insert into public.branches(id, name, code, is_main_branch, is_active, receiving_mode) values
      (${branch}, ${`Branch ${prefix}`}, ${branchCode}, false, true, 'cashier_confirm')
  `;
  await sql`
    insert into public.profiles(id, full_name, role, branch_id, is_active) values
      (${owner}, ${`Owner ${prefix}`}, 'owner', null, true),
      (${mainMgr}, ${`MainMgr ${prefix}`}, 'manager', ${main}, true),
      (${cashier}, ${`Cashier ${prefix}`}, 'cashier', ${branch}, true),
      (${cashier2}, ${`Cashier2 ${prefix}`}, 'cashier', ${branch}, true)
  `;
  await sql`
    insert into public.products(id, name, sku, selling_price, is_active, inventory_mode, closing_stock_behavior) values
      (${drink}, ${`Drink ${prefix}`}, ${sku}, 25, true, 'piece_stock', 'keep_at_branch')
  `;
  await sql`
    insert into public.branch_products(branch_id, product_id, selling_price, is_active) values
      (${branch}, ${drink}, 25, true)
  `;
  await sql`
    insert into public.branch_inventory(branch_id, product_id, quantity_on_hand) values
      (${main}, ${drink}, ${mainStock}),
      (${branch}, ${drink}, ${branchStock})
  `;

  const key = (label) => `${prefix}-${label}-${randomBytes(4).toString('hex')}`.slice(0, 100);

  return {
    owner,
    mainMgr,
    cashier,
    cashier2: cashiers > 1 ? cashier2 : cashier,
    main,
    branch,
    drink,
    key,
    prefix,
  };
}

function settledOk(r) {
  return r.status === 'fulfilled';
}

function errText(r) {
  if (r.status !== 'rejected') return '';
  return String(r.reason?.message ?? r.reason ?? '');
}

function isDeadlock(r) {
  return /40P01|deadlock/i.test(errText(r));
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

  let failures = 0;
  const check = (name, ok, detail = '') => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
  };

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

    const sharedMain = await ensureSharedMain(admin);
    console.log(`Shared Main Branch: ${sharedMain.id}`);

    // 1) simultaneous sale vs sale
    {
      console.log('\n-- sale vs sale --');
      const ctx = await seedScenario(admin, 's1', sharedMain, { branchStock: 5 });
      const sqlA = newSql();
      const sqlB = newSql();
      const shiftId = (
        await withTx(sqlA, ctx.cashier, (tx) => tx`select public.start_cashier_shift() as id`)
      )[0].id;
      const [a, b] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) =>
          tx`select * from public.confirm_sale(${shiftId}, ${JSON.stringify([{ product_id: ctx.drink, quantity: '4' }])}::text::jsonb, ${100}, ${ctx.key('sa')})`,
        ),
        withTx(sqlB, ctx.cashier, (tx) =>
          tx`select * from public.confirm_sale(${shiftId}, ${JSON.stringify([{ product_id: ctx.drink, quantity: '3' }])}::text::jsonb, ${75}, ${ctx.key('sb')})`,
        ),
      ]);
      const wins = [a, b].filter(settledOk).length;
      const fails = [a, b].filter((r) => !settledOk(r));
      check('sale vs sale: exactly one wins', wins === 1 && fails.length === 1, `wins=${wins}`);
      check('sale vs sale: no deadlock', !fails.some(isDeadlock), errText(fails[0] ?? {}));
      const bal = await admin`select quantity_on_hand::float as q from public.branch_inventory where branch_id=${ctx.branch} and product_id=${ctx.drink}`;
      check('sale vs sale: leftover 1 / non-negative', Number(bal[0].q) === 1, String(bal[0].q));
      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    // 2) sale vs begin-close
    {
      console.log('\n-- sale vs begin-close --');
      const ctx = await seedScenario(admin, 's2', sharedMain, { branchStock: 10 });
      const sqlA = newSql();
      const sqlB = newSql();
      const shiftId = (
        await withTx(sqlA, ctx.cashier, (tx) => tx`select public.start_cashier_shift() as id`)
      )[0].id;
      const [saleR, closeR] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) =>
          tx`select * from public.confirm_sale(${shiftId}, ${JSON.stringify([{ product_id: ctx.drink, quantity: '2' }])}::text::jsonb, ${50}, ${ctx.key('sale')})`,
        ),
        withTx(sqlB, ctx.cashier, (tx) => tx`select public.begin_cashier_shift_close(${shiftId}) as preview`),
      ]);
      check('sale vs begin-close: no deadlock', ![saleR, closeR].some(isDeadlock));
      check('sale vs begin-close: begin succeeds', settledOk(closeR), errText(closeR));
      if (settledOk(closeR)) {
        const st = await admin`select status::text as s, sales_cutoff_at is not null as cut from public.shifts where id=${shiftId}`;
        check('sale vs begin-close: cutoff applied', st[0].s === 'closed' && st[0].cut);
        const preview = closeR.value[0].preview;
        if (settledOk(saleR)) {
          check(
            'sale vs begin-close: sale included when sale won race',
            Number(preview.expected_cash) >= 50,
            String(preview.expected_cash),
          );
        } else {
          check(
            'sale vs begin-close: sale rejected when close won',
            /frozen|open shift|required|cutoff/i.test(errText(saleR)),
            errText(saleR),
          );
        }
        const postCutoff = await withTx(sqlA, ctx.cashier, (tx) =>
          tx`select * from public.confirm_sale(${shiftId}, ${JSON.stringify([{ product_id: ctx.drink, quantity: '1' }])}::text::jsonb, ${25}, ${ctx.key('post')})`.catch((e) => {
            throw e;
          }),
        ).then(
          () => ({ ok: true }),
          (e) => ({ ok: false, msg: String(e.message ?? e) }),
        );
        check('sale vs begin-close: no post-cutoff sale', !postCutoff.ok, postCutoff.msg ?? '');
      }
      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    // 3) receipt vs begin-close
    {
      console.log('\n-- receipt vs begin-close --');
      const ctx = await seedScenario(admin, 's3', sharedMain, { branchStock: 3, mainStock: 50 });
      const sqlA = newSql();
      const sqlB = newSql();
      const shiftId = (
        await withTx(sqlA, ctx.cashier, (tx) => tx`select public.start_cashier_shift() as id`)
      )[0].id;
      const xferId = (
        await withTx(sqlA, ctx.mainMgr, (tx) =>
          tx`select public.send_stock_transfer(${ctx.branch}, ${JSON.stringify([{ product_id: ctx.drink, quantity_sent: '2' }])}::text::jsonb, null, ${ctx.key('xfer')}) as id`,
        )
      )[0].id;
      const [recvR, closeR] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) =>
          tx`select public.confirm_shipment_arrival(${xferId}, ${ctx.key('arrive')})`,
        ),
        withTx(sqlB, ctx.cashier, (tx) => tx`select public.begin_cashier_shift_close(${shiftId}) as preview`),
      ]);
      check('receipt vs begin-close: no deadlock', ![recvR, closeR].some(isDeadlock));
      check('receipt vs begin-close: begin succeeds', settledOk(closeR), errText(closeR));
      if (settledOk(closeR)) {
        const preview = closeR.value[0].preview;
        const prod = (preview.products ?? []).find((p) => p.product_id === ctx.drink);
        const bal = await admin`select quantity_on_hand::float as q from public.branch_inventory where branch_id=${ctx.branch} and product_id=${ctx.drink}`;
        if (settledOk(recvR)) {
          const baselineOk = Number(prod?.system_balance_before_waste) === 5;
          const receivedPresent = prod?.received_quantity != null;
          const receivedOk = !receivedPresent || Number(prod.received_quantity) === 2;
          check(
            'receipt vs begin-close: receipt reflected in begin-close baseline',
            baselineOk && receivedOk,
            `B=${prod?.system_balance_before_waste} received=${prod?.received_quantity} live=${bal[0].q}`,
          );
        } else {
          check(
            'receipt vs begin-close: receipt rejected when close won',
            /frozen|pending|cutoff|open shift/i.test(errText(recvR)),
            errText(recvR),
          );
          const xfer = await admin`select status::text as s from public.stock_transfers where id=${xferId}`;
          check(
            'receipt vs begin-close: no post-cutoff receipt credit',
            xfer[0].s === 'pending_receipt' && Number(bal[0].q) === 3,
            `status=${xfer[0].s} live=${bal[0].q}`,
          );
        }
      }
      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    // 4) identical simultaneous finalize
    {
      console.log('\n-- identical finalize --');
      const ctx = await seedScenario(admin, 's4', sharedMain, { branchStock: 5 });
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
          tx`select public.finalize_cashier_shift_reconciliation(${shiftId}, ${'0.00'}, ${payload}::text::jsonb) as result`,
        ),
        withTx(sqlB, ctx.cashier, (tx) =>
          tx`select public.finalize_cashier_shift_reconciliation(${shiftId}, ${'0.00'}, ${payload}::text::jsonb) as result`,
        ),
      ]);
      check('identical finalize: no deadlock', ![f1, f2].some(isDeadlock));
      check('identical finalize: both succeed', settledOk(f1) && settledOk(f2));
      const reconCount = await admin`select count(*)::int as c from public.shift_reconciliations where shift_id=${shiftId}`;
      check('identical finalize: single cash recon', Number(reconCount[0].c) === 1);
      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    // 5) conflicting simultaneous FIRST finalize (fresh pending shift)
    {
      console.log('\n-- conflicting first finalize --');
      const branchStock = 8;
      const ctx = await seedScenario(admin, 's5', sharedMain, { branchStock });
      const sqlA = newSql();
      const sqlB = newSql();
      const shiftId = (
        await withTx(sqlA, ctx.cashier, (tx) => tx`select public.start_cashier_shift() as id`)
      )[0].id;
      await withTx(sqlA, ctx.cashier, (tx) => tx`select public.begin_cashier_shift_close(${shiftId})`);
      const payloadA = JSON.stringify([
        { product_id: ctx.drink, actual_remaining: '8', waste_quantity: '0' },
      ]);
      const payloadB = JSON.stringify([
        { product_id: ctx.drink, actual_remaining: '6', waste_quantity: '1' },
      ]);
      const [c1, c2] = await Promise.allSettled([
        withTx(sqlA, ctx.cashier, (tx) =>
          tx`select public.finalize_cashier_shift_reconciliation(${shiftId}, ${'0.00'}, ${payloadA}::text::jsonb) as result`,
        ),
        withTx(sqlB, ctx.cashier, (tx) =>
          tx`select public.finalize_cashier_shift_reconciliation(${shiftId}, ${'5.00'}, ${payloadB}::text::jsonb) as result`,
        ),
      ]);
      const wins = [c1, c2].filter(settledOk);
      const fails = [c1, c2].filter((r) => !settledOk(r));
      check('conflicting first finalize: no deadlock', ![c1, c2].some(isDeadlock));
      check('conflicting first finalize: exactly one wins', wins.length === 1 && fails.length === 1, `wins=${wins.length}`);
      const reconCount = await admin`select count(*)::int as c from public.shift_reconciliations where shift_id=${shiftId}`;
      check('conflicting first finalize: one cash recon', Number(reconCount[0].c) === 1);
      const prodRecon = await admin`select count(*)::int as c from public.shift_product_reconciliations where shift_id=${shiftId}`;
      check('conflicting first finalize: one product recon', Number(prodRecon[0].c) === 1);
      const bal = await admin`select quantity_on_hand::float as q from public.branch_inventory where branch_id=${ctx.branch} and product_id=${ctx.drink}`;
      const winRow = await admin`
        select
          actual_remaining::float as a,
          waste_quantity::float as w,
          (
            opening_quantity + received_quantity - outgoing_quantity
            - sold_quantity + adjustment_quantity
          )::float as b
        from public.shift_product_reconciliations where shift_id=${shiftId}
      `;
      const winActual = Number(winRow[0]?.a);
      const winWaste = Number(winRow[0]?.w);
      const winBaseline = Number(winRow[0]?.b ?? branchStock);
      check(
        'conflicting first finalize: stock matches winner',
        Number(bal[0].q) === winActual,
        `live=${bal[0].q} winActual=${winActual}`,
      );

      const expectedWasteMoves = winWaste > 0 ? 1 : 0;
      const expectedUnsoldMoves = 0; // keep_at_branch
      const expectedAdjustQty = winActual + winWaste - winBaseline;
      const expectedAdjustMoves = expectedAdjustQty !== 0 ? 1 : 0;

      const wasteMoves = await admin`
        select count(*)::int as c from public.inventory_movements
        where branch_id=${ctx.branch} and product_id=${ctx.drink}
          and movement_type='waste'
          and reference_type='shift_product_reconciliation'
      `;
      const unsoldMoves = await admin`
        select count(*)::int as c from public.inventory_movements
        where branch_id=${ctx.branch} and product_id=${ctx.drink}
          and movement_type='unsold'
          and reference_type='shift_product_reconciliation'
      `;
      const adjustMoves = await admin`
        select count(*)::int as c, coalesce(sum(quantity), 0)::float as q
        from public.inventory_movements
        where branch_id=${ctx.branch} and product_id=${ctx.drink}
          and movement_type='adjustment'
      `;
      check(
        'conflicting first finalize: waste movement count matches winner',
        Number(wasteMoves[0].c) === expectedWasteMoves,
        `got=${wasteMoves[0].c} expected=${expectedWasteMoves} waste=${winWaste}`,
      );
      check(
        'conflicting first finalize: no unsold movement',
        Number(unsoldMoves[0].c) === expectedUnsoldMoves,
        String(unsoldMoves[0].c),
      );
      check(
        'conflicting first finalize: adjustment movement matches winner',
        Number(adjustMoves[0].c) === expectedAdjustMoves
          && (expectedAdjustMoves === 0 || Number(adjustMoves[0].q) === expectedAdjustQty),
        `count=${adjustMoves[0].c} qty=${adjustMoves[0].q} expectedCount=${expectedAdjustMoves} expectedQty=${expectedAdjustQty}`,
      );
      await sqlA.end({ timeout: 1 });
      await sqlB.end({ timeout: 1 });
    }

    // 6) two cashiers start same branch
    {
      console.log('\n-- two cashiers start --');
      const ctx = await seedScenario(admin, 's6', sharedMain, { cashiers: 2, branchStock: 1 });
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
      console.log(`TRUE POSTGRES CONCURRENCY = EXECUTED FAIL (${failures} checks)`);
      process.exit(1);
    }
    console.log('TRUE POSTGRES CONCURRENCY = EXECUTED PASS');
  } finally {
    await admin.end({ timeout: 1 });
  }
}

main().catch((err) => {
  console.error(err);
  console.log('TRUE POSTGRES CONCURRENCY = EXECUTED FAIL');
  process.exit(1);
});
