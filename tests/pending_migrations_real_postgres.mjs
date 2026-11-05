/**
 * Pre-deployment check of the two pending migrations on TRUE PostgreSQL (not PGlite):
 *   20261026100000_pos_require_active_branch_variant   (POS needs an active branch option)
 *   20261027100000_edit_product_keeps_branch_availability (Edit keeps is_active)
 *   20261028100000_update_complete_product_lock_order   (Edit takes locks in the same order as sales and catalog functions)
 * It builds the deployed schema (everything else), seeds realistic existing records UNDER that schema, then applies the two
 * migrations on top the way a deploy does, and checks: no data changes, the read-only audit queries, behaviour, permissions,
 * the exact set of functions that change, a generated rollback, and a clean re-deploy after the rollback.
 *
 * Default: prints NOT EXECUTED. Execute against a DISPOSABLE server (it creates and drops its own databases):
 *   RUN_PENDING_PG=1 DATABASE_URL=postgres://user:pw@127.0.0.1:PORT/postgres node tests/pending_migrations_real_postgres.mjs
 * Optional ROLLBACK_OUT=<file> writes the generated rollback script. Never use production.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';

console.log('PENDING MIGRATIONS, TRUE POSTGRES CHECK');
const url = process.env.DATABASE_URL || '';
if (process.env.RUN_PENDING_PG !== '1' || !url) {
  console.log('= NOT EXECUTED (RUN_PENDING_PG=1 and DATABASE_URL not both set). Do not use production.');
  process.exit(0);
}
if (/supabase\.co|uvxpjrzqtmaterczzvjo/i.test(url)) {
  console.error('Refusing to run against a hosted/production-looking DATABASE_URL.');
  process.exit(1);
}

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const POS = '20261026100000_pos_require_active_branch_variant.sql';
const MIG = '20261027100000_edit_product_keeps_branch_availability.sql';
const LOCK = '20261028100000_update_complete_product_lock_order.sql';
const all = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort();
assert.deepEqual(all.slice(-3), [POS, MIG, LOCK], 'the three pending migrations are the last three files');
const BASE = all.filter((n) => ![POS, MIG, LOCK].includes(n));
const J = JSON.stringify;
const RUN = randomBytes(3).toString('hex');
const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const opened = [];
const dbUrl = (name) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};
const open = async (tag) => {
  const name = `gr_pm_${RUN}_${tag}`;
  await admin.unsafe(`create database ${name} template template0 encoding 'UTF8'`);
  const sql = postgres(dbUrl(name), { max: 1, prepare: false, onnotice: () => {} });
  opened.push({ name, sql });
  await sql.unsafe(`
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role; exception when duplicate_object then null; end $$;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
    grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
  `);
  return sql;
};
const apply = async (sql, files) => {
  for (const f of files) await sql.unsafe(read(`supabase/migrations/${f}`).replace(/create extension if not exists pgcrypto;/g, ''));
};
const withTx = (sql, user, work) =>
  sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true)`;
    await tx`select set_config('request.jwt.claim.sub', ${user}, true)`;
    return work(tx);
  });
const attempt = (p) => p.then((value) => ({ ok: true, value }), (e) => ({ ok: false, msg: String(e.message ?? e) }));

const catalog = async (sql) => {
  const rows = await sql`
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, coalesce(p.proacl::text, '') as acl,
           coalesce(obj_description(p.oid, 'pg_proc'), '') as cmt
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'`;
  return new Map(rows.map((r) => [r.sig, r]));
};
const diff = (a, b) => ({
  changed: [...b.keys()].filter((k) => a.has(k) && (a.get(k).def !== b.get(k).def || a.get(k).acl !== b.get(k).acl || a.get(k).cmt !== b.get(k).cmt)).sort(),
  added: [...b.keys()].filter((k) => !a.has(k)).sort(),
  removed: [...a.keys()].filter((k) => !b.has(k)).sort(),
});
const snapshot = async (sql) => {
  const tables = await sql`select table_schema as s, table_name as t from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ('public', 'auth') order by 1, 2`;
  const out = {};
  for (const { s, t } of tables) {
    const r = await sql.unsafe(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${s}."${t}" x`);
    out[`${s}.${t}`] = `${r[0].n}:${r[0].h}`;
  }
  return out;
};
const sameSnapshot = (a, b, why) => assert.deepEqual(a, b, why);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  // ------------------------------------------------------------------ the deployed schema + existing records
  const base = await open('base');
  await apply(base, BASE);
  const baseCatalog = await catalog(base);
  console.log(`deployed schema built: ${BASE.length} migrations, ${baseCatalog.size} functions`);

  const up = await open('up');
  await apply(up, BASE);
  const [main, sm1, sm2] = [randomUUID(), randomUUID(), randomUUID()];
  const [mgr, owner, c1, c2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await up`insert into auth.users(id, email) values (${mgr}, 'm@t'), (${owner}, 'o@t'), (${c1}, 'c1@t'), (${c2}, 'c2@t')`;
  await up`insert into public.branches(id, name, code, is_main_branch, is_active, receiving_mode) values
    (${main}, 'Main', 'MAIN-PM', true, true, 'counted'), (${sm1}, 'SM1', 'SM1-PM', false, true, 'cashier_confirm'), (${sm2}, 'SM2', 'SM2-PM', false, true, 'cashier_confirm')`;
  await up`insert into public.profiles(id, full_name, role, branch_id) values
    (${mgr}, 'Main Mgr', 'manager', ${main}), (${owner}, 'Owner', 'owner', null), (${c1}, 'Cashier 1', 'cashier', ${sm1}), (${c2}, 'Cashier 2', 'cashier', ${sm2})`;
  const create = async (o) =>
    (await withTx(up, mgr, (tx) =>
      tx`select * from public.create_complete_product(p_name := ${o.name}, p_sku := ${o.sku}, p_description := null,
        p_variants := ${J((o.variants ?? []).map(([n, p]) => ({ name: n, default_price: p })))}::text::jsonb, p_branches := ${J(o.branches)}::text::jsonb,
        p_selling_price := ${o.price ?? null}, p_stock_uses := ${o.stockUses ? J(o.stockUses) : null}::text::jsonb)`,
    ))[0];
  const priced = (branches, variants) => branches.map((b) => (variants ? { branch_id: b, variants: variants.map(([n, p]) => ({ name: n, selling_price: p })) } : { branch_id: b, selling_price: '40.00' }));
  const selfUse = (names) => names.map((n) => ({ variant_name: n, ingredient_product_id: 'self', quantity: 1 }));
  const CURRY = [['Viand Only', '70.00'], ['With Rice', '85.00']];
  const COMBO = [['Small', '30.00'], ['Large', '50.00']];
  const SPECIAL = [['X', '20.00'], ['Y', '25.00']];
  const LEGACY = [['A', '15.00'], ['B', '18.00']];
  const fries = await create({ name: 'Plain Fries', sku: 'FRIES-PM', price: '40', branches: priced([sm1, sm2]) });
  const curry = await create({ name: 'Beef Curry', sku: 'CURRY-PM', variants: CURRY, branches: priced([sm1], CURRY), stockUses: selfUse(CURRY.map((v) => v[0])) });
  const combo = await create({ name: 'Combo', sku: 'COMBO-PM', variants: COMBO, branches: priced([sm1, sm2], COMBO), stockUses: selfUse(COMBO.map((v) => v[0])) });
  const special = await create({ name: 'Daily Special', sku: 'SPEC-PM', variants: SPECIAL, branches: priced([sm1], SPECIAL), stockUses: selfUse(SPECIAL.map((v) => v[0])) });
  const legacy = await create({ name: 'Legacy Plate', sku: 'LEGC-PM', variants: LEGACY, branches: priced([sm1], LEGACY), stockUses: selfUse(LEGACY.map((v) => v[0])) });
  const products = [fries, curry, combo, special, legacy];
  for (const p of products) await withTx(up, mgr, (tx) => tx`select public.set_product_status(${p.id}, true)`);
  await withTx(up, mgr, (tx) => tx`select public.initialize_main_branch_inventory(${J(products.map((p) => ({ product_id: p.id, quantity: 300 })))}::text::jsonb, 'open')`);
  // SM2 carries the curry with NO option rows (affected: "no option rows"). Done BEFORE the transfers: a transfer to a branch seeds its
  // option rows from the active master options, exactly how real branches got theirs.
  await withTx(up, mgr, (tx) => tx`select public.configure_branch_products(${sm2}, ${J([{ product_id: curry.id, selling_price: 70, is_active: true }])}::text::jsonb)`);
  let n = 0;
  const key = (p) => `${p}-${RUN}-${String(++n).padStart(8, '0')}`;
  for (const [branch, cashier] of [[sm1, c1], [sm2, c2]]) {
    const t = (await withTx(up, mgr, (tx) => tx`select public.send_stock_transfer(${branch}, ${J(products.map((p) => ({ product_id: p.id, quantity_sent: 100, destination_price: 20 })))}::text::jsonb, null, ${key('pm-send')}) as id`))[0].id;
    await withTx(up, cashier, (tx) => tx`select public.confirm_shipment_arrival(${t}, ${key('pm-arrive')})`);
  }
  const shift = {};
  for (const [b, c] of [[sm1, c1], [sm2, c2]]) shift[b] = (await withTx(up, c, (tx) => tx`select public.start_cashier_shift() as id`))[0].id;
  const optId = async (b, p, name) => (await up`select id from public.branch_product_variants where branch_id = ${b} and product_id = ${p.id} and name = ${name}`)[0].id;
  const sell = (cashier, b, lines) => attempt(withTx(up, cashier, (tx) => tx`select * from public.confirm_sale(${shift[b]}, ${J(lines)}::text::jsonb, ${1000}, ${key('pm-sale')}, 'standard')`));
  // history under the deployed schema: a normal option sale, a plain sale, and (while the curry still has options on) a normal curry sale
  assert.ok((await sell(c1, sm1, [{ product_id: combo.id, variant_id: await optId(sm1, combo, 'Small'), quantity: 2 }])).ok);
  assert.ok((await sell(c1, sm1, [{ product_id: fries.id, variant_id: null, quantity: 1 }])).ok);
  // odd states, set the way an admin could have left them
  await withTx(up, mgr, (tx) => tx`select public.configure_branch_product_variants(${sm1}, ${curry.id}, ${J(CURRY.map(([name, p]) => ({ name, selling_price: Number(p), is_active: false })))}::text::jsonb)`);
  const fallbackSale = await sell(c1, sm1, [{ product_id: curry.id, variant_id: null, quantity: 1 }]); // the bug: sold at the base price
  check('deployed schema: all-options-off product is still sold at its base price (the POS bug)', fallbackSale.ok, fallbackSale.msg ?? '');
  await withTx(up, mgr, (tx) => tx`select public.configure_branch_product_variants(${sm1}, ${combo.id}, ${J([{ name: 'Large', selling_price: 50, is_active: false }])}::text::jsonb)`);
  await withTx(up, mgr, (tx) => tx`select public.configure_branch_products(${sm2}, ${J([{ product_id: combo.id, selling_price: 30, is_active: false }])}::text::jsonb)`);
  await up`update public.product_variants set is_active = false where product_id = ${special.id} and name = 'X'`; // retired master option still on at SM1
  await up`update public.product_variants set is_active = false where product_id = ${legacy.id}`; // every master option retired, branch options still on

  // ------------------------------------------------------------------ the read-only audit file
  const auditQueries = read('docs/pos-variant-fallback-audit.sql').split(/\n(?=-- \d\) )/).slice(1).map((q) => q.replace(/^--.*$/gm, '').trim().replace(/;\s*$/, ''));
  check('audit file has 7 single-statement queries', auditQueries.length === 7 && auditQueries.every((q) => !q.includes(';')), String(auditQueries.length));
  const s0 = await snapshot(up);
  const auditPre = [];
  for (const q of auditQueries) auditPre.push(await up.unsafe(q));
  sameSnapshot(await snapshot(up), s0, 'the audit queries changed data');
  check('audit queries are read-only (every table hash unchanged)', true);
  const q1 = auditPre[0].map((r) => [r.state, Number(r.product_branch_pairs), Number(r.on_cashier_menu_today)]);
  check('Q1 before: 1 pair "all options off" + 1 pair "no option rows", both on the cashier menu today', J(q1) === J([['all options off', 1, 1], ['no option rows', 1, 1]]), J(q1));
  check('Q2 before: lists the curry at SM1 and SM2', auditPre[1].length === 2 && auditPre[1].every((r) => r.product === 'Beef Curry'), J(auditPre[1].map((r) => [r.branch, r.product])));
  check('Q3 before: sees the base-price sale of the curry at SM1', auditPre[2].some((r) => r.product === 'Beef Curry' && r.branch === 'SM1' && Number(r.units) === 1), J(auditPre[2].map((r) => [r.branch, r.product, r.units])));
  const q5 = auditPre[4].map((r) => [r.finding, r.product]);
  check('Q5a (fixed) finds the product whose master options are ALL retired', q5.some(([f, p]) => f.startsWith('a.') && p === 'Legacy Plate'), J(q5));
  const q7 = auditPre[6].map((r) => `${r.branch}/${r.product}/${r.option_name}`).sort();
  check('Q7 finds the retired master options still on at SM1 and SM2', J(q7) === J(['SM1/Daily Special/X', 'SM1/Legacy Plate/A', 'SM1/Legacy Plate/B', 'SM2/Daily Special/X', 'SM2/Legacy Plate/A', 'SM2/Legacy Plate/B']), J(q7));
  check('Q6 counts the open shifts', auditPre[5].length === 2 && auditPre[5].every((r) => Number(r.open_shifts) === 1), J(auditPre[5].map((r) => [r.branch, r.open_shifts])));

  // ------------------------------------------------------------------ deploy: POS first, then the edit fix
  const sBefore = await snapshot(up);
  await apply(up, [POS]);
  const afterPos = await snapshot(up);
  await apply(up, [MIG]);
  const afterMig = await snapshot(up);
  await apply(up, [LOCK]);
  const afterLock = await snapshot(up);
  check('applying the lock-order migration changes no stored record', J(afterLock) === J(sBefore));
  check('applying the POS migration changes no stored record', J(afterPos) === J(sBefore));
  check('applying the edit migration changes no stored record', J(afterMig) === J(sBefore));
  const upCatalog = await catalog(up);
  const d = diff(baseCatalog, upCatalog);
  check('exactly these functions changed', J(d.changed) === J(['confirm_sale(uuid,jsonb,numeric,text,text)', 'get_cashier_line_prices(jsonb)', 'list_cashier_pos_inventory()', 'update_branch_product_variant_price(uuid,text)', 'update_complete_product(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb)'].sort()), J(d.changed));
  check('exactly two helper functions were added, nothing removed', J(d.added) === J(['pos_option_required(uuid,uuid)', 'pos_options_unavailable(uuid,uuid)']) && d.removed.length === 0, J(d));
  const tables = (await up`select count(*)::int as n from information_schema.tables where table_schema = 'public'`)[0].n;
  const baseTables = (await base`select count(*)::int as n from information_schema.tables where table_schema = 'public'`)[0].n;
  check('no table, column or constraint added', tables === baseTables && (await up`select count(*)::int as n from information_schema.columns where table_schema = 'public'`)[0].n === (await base`select count(*)::int as n from information_schema.columns where table_schema = 'public'`)[0].n);

  // ------------------------------------------------------------------ permissions
  const priv = async (role, sig) => (await up.unsafe(`select has_function_privilege('${role}', '${sig}', 'execute') as ok`))[0].ok;
  for (const sig of ['public.update_branch_product_variant_price(uuid,text)', 'public.confirm_sale(uuid,jsonb,numeric,text,text)', 'public.list_cashier_pos_inventory()', 'public.get_cashier_line_prices(jsonb)', 'public.update_complete_product(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb)']) {
    check(`${sig.split('(')[0]}: authenticated yes, anon no`, (await priv('authenticated', sig)) === true && (await priv('anon', sig)) === false);
  }
  for (const sig of ['public.pos_options_unavailable(uuid,uuid)', 'public.pos_option_required(uuid,uuid)']) {
    check(`${sig.split('(')[0]}: not callable by API roles`, (await priv('authenticated', sig)) === false && (await priv('anon', sig)) === false);
  }
  const wrongEdit = [];
  for (const [who, label] of [[c1, 'cashier'], [owner, 'owner']]) {
    const r = await attempt(withTx(up, who, (tx) => tx`select * from public.update_complete_product(p_product_id := ${combo.id}, p_name := 'Combo', p_sku := 'COMBO-PM', p_description := null, p_is_active := true, p_variants := '[]'::jsonb, p_deleted_variant_ids := '[]'::jsonb, p_branches := '[]'::jsonb, p_selling_price := '30')`));
    if (r.ok || !/Unauthorized/.test(r.msg)) wrongEdit.push(label);
  }
  check('a cashier and an owner are still refused by update_complete_product', wrongEdit.length === 0, wrongEdit.join(','));

  // ------------------------------------------------------------------ behaviour on the existing records
  const menu = async (cashier) => (await withTx(up, cashier, (tx) => tx`select product_name, variants from public.list_cashier_pos_inventory()`)).map((r) => [r.product_name, (r.variants ?? []).map((v) => v.name ?? v.variant_name).sort()]);
  const m1 = Object.fromEntries(await menu(c1));
  const m2 = Object.fromEntries(await menu(c2));
  check('SM1 menu: the all-options-off curry is gone', !('Beef Curry' in m1));
  check('SM1 menu: combo offers only Small; the plain product and the retired-master options are still there', J(m1.Combo) === J(['Small']) && 'Plain Fries' in m1 && J(m1['Daily Special']) === J(['X', 'Y']) && J(m1['Legacy Plate']) === J(['A', 'B']), J(m1));
  check('SM2 menu: no-option-rows curry is gone, switched-off combo is gone, plain product stays', !('Beef Curry' in m2) && !('Combo' in m2) && 'Plain Fries' in m2, J(Object.keys(m2)));
  const stale = await sell(c1, sm1, [{ product_id: curry.id, variant_id: null, quantity: 1 }]);
  check('an open cart with the affected curry is refused with a clear message', !stale.ok && /option/i.test(stale.msg), stale.msg ?? '');
  check('a normal option sale still works', (await sell(c1, sm1, [{ product_id: combo.id, variant_id: await optId(sm1, combo, 'Small'), quantity: 1 }])).ok);
  check('the switched-off option cannot be sold', !(await sell(c1, sm1, [{ product_id: combo.id, variant_id: await optId(sm1, combo, 'Large'), quantity: 1 }])).ok);
  check('a plain product still sells', (await sell(c1, sm1, [{ product_id: fries.id, variant_id: null, quantity: 1 }])).ok);
  // the edit keeps availability, including a re-save of every branch
  const masters = await up`select id, name, default_price::text as d from public.product_variants where product_id = ${combo.id} order by sort_order, name`;
  const saveCombo = (small) =>
    withTx(up, mgr, (tx) =>
      tx`select * from public.update_complete_product(p_product_id := ${combo.id}, p_name := 'Combo', p_sku := 'COMBO-PM', p_description := null, p_is_active := true,
        p_variants := ${J(masters.map((m) => ({ id: m.id, name: m.name, default_price: m.d })))}::text::jsonb, p_deleted_variant_ids := '[]'::jsonb,
        p_branches := ${J([sm1, sm2].map((b) => ({ branch_id: b, variants: masters.map((m) => ({ name: m.name, selling_price: m.name === 'Small' ? small : m.d })) })))}::text::jsonb, p_selling_price := null)`,
    );
  await saveCombo('33.00');
  const flags = await up`select branch_id = ${sm1} as at_sm1, name, selling_price::numeric as p, is_active from public.branch_product_variants where product_id = ${combo.id} order by 1, 2`;
  const largeSm1 = flags.find((r) => r.at_sm1 && r.name === 'Large');
  check('Edit saved the new price at both branches and kept Large OFF at SM1', Number(flags.find((r) => r.at_sm1 && r.name === 'Small').p) === 33 && largeSm1.is_active === false);
  check('Edit kept the whole combo OFF at SM2', (await up`select is_active from public.branch_products where branch_id = ${sm2} and product_id = ${combo.id}`)[0].is_active === false);
  const history = await up`select count(*)::int as n, coalesce(sum(unit_price * quantity), 0)::numeric as total from public.sale_items where product_id = ${curry.id}`;
  check('the old base-price sale of the curry is untouched in history', history[0].n === 1 && Number(history[0].total) === 70);

  // ------------------------------------------------------------------ rollback (generated from the deployed schema, then verified)
  const rollback = [];
  for (const sig of d.changed) {
    const row = baseCatalog.get(sig);
    rollback.push(`${row.def.trim()};`);
    if (row.cmt) rollback.push(`comment on function public.${sig} is '${row.cmt.replace(/'/g, "''")}';`);
  }
  for (const sig of d.added) rollback.push(`drop function public.${sig};`);
  const rollbackSql = `begin;\n${rollback.join('\n\n')}\ncommit;\n`;
  if (process.env.ROLLBACK_OUT) writeFileSync(process.env.ROLLBACK_OUT, `-- Generated rollback of ${POS} and ${MIG}.\n-- Restores the function bodies of the deployed schema (taken with pg_get_functiondef). Changes no data.\n-- Better still: generate your own from the LIVE database right before deploying.\n${rollbackSql}`);
  const beforeRollback = await snapshot(up);
  await up.unsafe(rollbackSql);
  const rolled = diff(baseCatalog, await catalog(up));
  check('rollback restores every function (body, grants, comments) exactly as deployed', rolled.changed.length === 0 && rolled.added.length === 0 && rolled.removed.length === 0, J(rolled));
  sameSnapshot(await snapshot(up), beforeRollback, 'rollback changed data');
  check('rollback changes no stored record', true);
  const mAfter = Object.fromEntries(await menu(c1));
  check('after rollback the old behaviour is back (curry listed again with no options)', 'Beef Curry' in mAfter);
  // ------------------------------------------------------------------ re-deploy after the rollback
  await apply(up, [POS, MIG, LOCK]);
  const again = diff(upCatalog, await catalog(up));
  check('re-deploying after a rollback gives the same functions as the first deploy', again.changed.length === 0 && again.added.length === 0 && again.removed.length === 0, J(again));
  check('and the POS rule is back', !('Beef Curry' in Object.fromEntries(await menu(c1))));

  // ------------------------------------------------------------------ the edit migration alone (POS still pending) and in the other order
  const only = await open('migonly');
  await apply(only, BASE);
  await apply(only, [MIG, LOCK]);
  const dOnly = diff(baseCatalog, await catalog(only));
  check('the two edit migrations alone (POS still pending) change only the two product-edit functions', J(dOnly.changed) === J(['update_branch_product_variant_price(uuid,text)', 'update_complete_product(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb)']) && dOnly.added.length === 0, J(dOnly));
  const reversed = await open('reversed');
  await apply(reversed, BASE);
  await apply(reversed, [MIG, POS, LOCK]);
  const dRev = diff(upCatalog, await catalog(reversed));
  check('applying them in the other order gives identical functions (they do not depend on each other)', dRev.changed.length === 0 && dRev.added.length === 0 && dRev.removed.length === 0, J(dRev));
} finally {
  for (const { name, sql } of opened) {
    await sql.end({ timeout: 2 }).catch(() => {});
    await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
  }
  await admin.end({ timeout: 2 });
}
console.log(failures === 0 ? '\nPENDING MIGRATIONS (real PostgreSQL): ALL PASS' : `\nPENDING MIGRATIONS (real PostgreSQL): ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
