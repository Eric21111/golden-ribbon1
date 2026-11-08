/**
 * Edit Product vs concurrent sales / catalog switches, on true PostgreSQL (separate sessions).
 * PGlite is single-session and cannot prove this. Needs migration 20261027100000_edit_product_keeps_branch_availability applied.
 *
 * Default (no flags): prints NOT EXECUTED and exits 0, so blanket sweeps stay safe.
 * Execute against a DISPOSABLE database only:
 *   RUN_EDIT_AVAIL_PG=1 DATABASE_URL=postgres://... node tests/edit_product_availability_concurrency_postgres.mjs
 * APPLY_MIGRATIONS=1 applies supabase/migrations/*.sql first (empty disposable DB). Never production. Every scenario uses
 * run-unique ids; nothing is deleted.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import postgres from 'postgres';

const CONFIRM = process.env.RUN_EDIT_AVAIL_PG === '1';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
console.log('EDIT PRODUCT AVAILABILITY, TRUE POSTGRES CONCURRENCY');
if (!CONFIRM || !databaseUrl) {
  console.log('= NOT EXECUTED (RUN_EDIT_AVAIL_PG=1 and DATABASE_URL not both set). PGlite is not a substitute. Do not use production.');
  console.log('Scenarios when executed: edit vs sale of an ON option; edit vs sale of an OFF option; edit vs "switch Large ON" in both orders; two edits at once.');
  process.exit(0);
}
if (/supabase\.co|uvxpjrzqtmaterczzvjo/i.test(databaseUrl)) {
  console.error('Refusing to run against a hosted/production-looking DATABASE_URL.');
  process.exit(1);
}

const RUN = randomBytes(4).toString('hex');
// BASELINE=1 runs the same races against a schema WITHOUT the fix (apply with EXCLUDE_MIGRATIONS=<file>) to tell old problems from new ones.
const BASELINE = process.env.BASELINE === '1';
const EXCLUDE = (process.env.EXCLUDE_MIGRATIONS ?? '').split(',').filter(Boolean);
const J = JSON.stringify;
const newSql = () => postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
const withTx = (sql, userId, work) =>
  sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true)`;
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    return work(tx);
  });
const errText = (r) => (r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : '');
const isDeadlock = (r) => /40P01|deadlock/i.test(errText(r));

const admin = newSql();
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
      create or replace function auth.uid() returns uuid language sql as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
      grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
    `);
    for (const f of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql') && !EXCLUDE.includes(n)).sort()) {
      await admin.unsafe(readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, ''));
    }
  }
  const has = await admin`select position('is_active = true' in pg_get_functiondef('public.update_complete_product(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb)'::regprocedure)) = 0 as fixed`;
  if (!has[0]?.fixed && !BASELINE) {
    console.error('update_complete_product still forces is_active = true: apply 20261027100000 first.');
    process.exit(1);
  }

  const mainRow = await admin`select id from public.branches where is_main_branch = true and is_active limit 1`;
  const main = mainRow[0]?.id ?? randomUUID();
  if (!mainRow[0]) await admin`insert into public.branches(id, name, code, is_main_branch, is_active, receiving_mode) values (${main}, ${`Main ${RUN}`}, ${`M${RUN}`}, true, true, 'counted')`;

  // one fixture per scenario: a Main manager, a selling branch with a cashier, a product with options Small (on) and Large (off)
  async function fixture(tag) {
    const mgr = randomUUID();
    const cashier = randomUUID();
    const branch = randomUUID();
    await admin`insert into auth.users(id, email) values (${mgr}, ${`m-${tag}-${RUN}@t`}), (${cashier}, ${`c-${tag}-${RUN}@t`})`;
    await admin`insert into public.branches(id, name, code, is_main_branch, is_active, receiving_mode) values (${branch}, ${`B ${tag}${RUN}`}, ${`B${tag}${RUN}`.slice(0, 12)}, false, true, 'cashier_confirm')`;
    await admin`insert into public.profiles(id, full_name, role, branch_id, is_active) values (${mgr}, ${`Mgr ${tag}`}, 'manager', ${main}, true), (${cashier}, ${`Cashier ${tag}`}, 'cashier', ${branch}, true)`;
    const opts = [{ name: 'Small', selling_price: '30.00' }, { name: 'Large', selling_price: '50.00' }];
    const created = await withTx(admin, mgr, (tx) =>
      tx`select * from public.create_complete_product(p_name := ${`Combo ${tag}${RUN}`}, p_sku := ${`CB${tag}${RUN}`.toUpperCase().slice(0, 30)}, p_description := null,
        p_variants := ${J(opts.map((o) => ({ name: o.name, default_price: o.selling_price })))}::text::jsonb,
        p_branches := ${J([{ branch_id: branch, variants: opts }])}::text::jsonb, p_selling_price := null,
        p_stock_uses := ${J([{ variant_name: 'Small', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'Large', ingredient_product_id: 'self', quantity: 1 }])}::text::jsonb)`,
    );
    const product = created[0].id;
    await withTx(admin, mgr, (tx) => tx`select public.set_product_status(${product}, true)`);
    await withTx(admin, mgr, (tx) => tx`select public.initialize_main_branch_inventory(${J([{ product_id: product, quantity: 100 }])}::text::jsonb, 'open')`);
    const xfer = (await withTx(admin, mgr, (tx) => tx`select public.send_stock_transfer(${branch}, ${J([{ product_id: product, quantity_sent: 50, destination_price: 20 }])}::text::jsonb, null, ${`ea-send-${tag}-${RUN}-0001`}) as id`))[0].id;
    await withTx(admin, cashier, (tx) => tx`select public.confirm_shipment_arrival(${xfer}, ${`ea-arrive-${tag}-${RUN}-0001`})`);
    const shift = (await withTx(admin, cashier, (tx) => tx`select public.start_cashier_shift() as id`))[0].id;
    await withTx(admin, mgr, (tx) => tx`select public.configure_branch_product_variants(${branch}, ${product}, ${J([{ name: 'Large', selling_price: 50, is_active: false }])}::text::jsonb)`);
    const optionId = async (name) => (await admin`select id from public.branch_product_variants where branch_id = ${branch} and product_id = ${product} and name = ${name}`)[0].id;
    const largeOn = async () => (await admin`select is_active from public.branch_product_variants where branch_id = ${branch} and product_id = ${product} and name = 'Large'`)[0].is_active;
    const sale = (sql, name, k) =>
      withTx(sql, cashier, async (tx) => tx`select * from public.confirm_sale(${shift}, ${J([{ product_id: product, variant_id: await optionId(name), quantity: 1 }])}::text::jsonb, ${'1000'}, ${`ea-sale-${tag}-${RUN}-${k}`}, 'standard')`);
    return { mgr, cashier, branch, product, shift, optionId, largeOn, sale };
  }

  // adds f.edit: a price edit of Small at the fixture's branch, sending the real option ids (like the app)
  const withIds = async (f) => {
    const rows = await admin`select id, name, default_price::text as d from public.product_variants where product_id = ${f.product} order by sort_order, name`;
    f.edit = (sql, small) =>
      withTx(sql, f.mgr, async (tx) =>
        tx`select * from public.update_complete_product(p_product_id := ${f.product}, p_name := (select name from public.products where id = ${f.product}), p_sku := (select sku from public.products where id = ${f.product}), p_description := null, p_is_active := true,
          p_variants := ${J(rows.map((r) => ({ id: r.id, name: r.name, default_price: r.d })))}::text::jsonb,
          p_deleted_variant_ids := '[]'::jsonb, p_branches := ${J([{ branch_id: f.branch, variants: rows.map((r) => ({ name: r.name, selling_price: r.name === 'Small' ? small : r.d })) }])}::text::jsonb, p_selling_price := null)`,
      );
    return f;
  };

  console.log('\n-- edit vs sale of an ON option --');
  {
    const f = await withIds(await fixture('s1'));
    const a = newSql();
    const b = newSql();
    const [e, s] = await Promise.allSettled([f.edit(a, '35.00'), f.sale(b, 'Small', '0001')]);
    check('no deadlock', ![e, s].some(isDeadlock), errText(e) || errText(s));
    check('edit succeeds', e.status === 'fulfilled', errText(e));
    check('sale succeeds', s.status === 'fulfilled', errText(s));
    check('Large is still off', (await f.largeOn()) === false);
    const line = await admin`select unit_price::numeric as u from public.sale_items si join public.sales sl on sl.id = si.sale_id where si.product_id = ${f.product}`;
    check('the sale line has the price of one of the two committed states (30 or 35), never a mix', line.length === 1 && [30, 35].includes(Number(line[0].u)), J(line));
    await a.end({ timeout: 1 });
    await b.end({ timeout: 1 });
  }

  console.log('\n-- edit vs sale of an OFF option (needs 20261026100000 for the sale to be refused) --');
  {
    const f = await withIds(await fixture('s2'));
    const a = newSql();
    const b = newSql();
    const [e, s] = await Promise.allSettled([f.edit(a, '36.00'), f.sale(b, 'Large', '0002')]);
    check('no deadlock', ![e, s].some(isDeadlock), errText(e) || errText(s));
    check('edit succeeds', e.status === 'fulfilled', errText(e));
    check('Large is still off after the edit (the edit never switched it on)', (await f.largeOn()) === false);
    console.log(`  INFO sale of the off option: ${s.status}${s.status === 'rejected' ? `: ${errText(s)}` : ' (expected only when 20261026100000 is NOT applied)'}`);
    await a.end({ timeout: 1 });
    await b.end({ timeout: 1 });
  }

  console.log('\n-- edit vs "switch Large ON" (the manager\'s switch survives in both orders) --');
  for (const order of ['edit-first', 'switch-first']) {
    const f = await withIds(await fixture(order === 'edit-first' ? 's3' : 's4'));
    const a = newSql();
    const b = newSql();
    const toggle = (sql) => withTx(sql, f.mgr, (tx) => tx`select public.configure_branch_product_variants(${f.branch}, ${f.product}, ${J([{ name: 'Large', selling_price: 50, is_active: true }])}::text::jsonb)`);
    if (order === 'edit-first') await f.edit(a, '37.00');
    const [e, t] = await Promise.allSettled([order === 'edit-first' ? Promise.resolve() : f.edit(a, '37.00'), toggle(b)]);
    check(`${order}: no deadlock`, ![e, t].some(isDeadlock), errText(e) || errText(t));
    check(`${order}: the manager's switch ON survives (the edit does not switch it off, and does not need to switch it on)`, (await f.largeOn()) === true);
    await a.end({ timeout: 1 });
    await b.end({ timeout: 1 });
  }

  console.log('\n-- two edits at once --');
  {
    const f = await withIds(await fixture('s5'));
    const a = newSql();
    const b = newSql();
    const [x, y] = await Promise.allSettled([f.edit(a, '38.00'), f.edit(b, '39.00')]);
    check('no deadlock', ![x, y].some(isDeadlock), errText(x) || errText(y));
    check('both finish', x.status === 'fulfilled' && y.status === 'fulfilled', errText(x) || errText(y));
    const price = Number((await admin`select selling_price::numeric as p from public.branch_product_variants where branch_id = ${f.branch} and product_id = ${f.product} and name = 'Small'`)[0].p);
    check('last writer wins with one of the two prices', [38, 39].includes(price), String(price));
    check('Large is still off', (await f.largeOn()) === false);
    await a.end({ timeout: 1 });
    await b.end({ timeout: 1 });
  }
} finally {
  await admin.end({ timeout: 1 });
}
console.log(failures === 0 ? '\nEDIT AVAILABILITY CONCURRENCY: PASS' : `\nEDIT AVAILABILITY CONCURRENCY: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
