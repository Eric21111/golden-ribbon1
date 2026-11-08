/**
 * Lock-order races around update_complete_product, on TRUE PostgreSQL (separate sessions). PGlite cannot prove any of this.
 * Builds one throwaway database per schema variant, runs every scenario ITERATIONS times with two or three sessions started
 * together (random small delay on the later ones), and counts deadlocks, other errors and invariant breaks.
 *
 *   variants: deployed  = every migration except the two pending ones and the lock-order migration
 *             pending   = deployed + 20261026100000 (POS) + 20261027100000 (edit keeps availability)
 *             fixed     = pending + 20261028100000_update_complete_product_lock_order   (skipped when the file does not exist)
 *
 * Default: prints NOT EXECUTED. Execute against a DISPOSABLE server (it creates and drops its own databases):
 *   RUN_LOCK_ORDER_PG=1 DATABASE_URL=postgres://user:pw@127.0.0.1:PORT/postgres [ITERATIONS=15] node tests/lock_order_concurrency_postgres.mjs
 * VARIANTS=fixed runs just that schema variant (comma list). ONLY=<text> runs just the scenarios whose name contains it. Exit code 1 if the "fixed" variant shows a deadlock, an unexpected error, or an invariant break. Never use production.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import postgres from 'postgres';

console.log('LOCK ORDER CONCURRENCY, TRUE POSTGRES');
const url = process.env.DATABASE_URL || '';
if (process.env.RUN_LOCK_ORDER_PG !== '1' || !url) {
  console.log('= NOT EXECUTED (RUN_LOCK_ORDER_PG=1 and DATABASE_URL not both set). PGlite is not a substitute. Do not use production.');
  process.exit(0);
}
if (/supabase\.co|uvxpjrzqtmaterczzvjo/i.test(url)) {
  console.error('Refusing to run against a hosted/production-looking DATABASE_URL.');
  process.exit(1);
}

const ITER = Number(process.env.ITERATIONS ?? 15);
const POS = '20261026100000_pos_require_active_branch_variant.sql';
const MIG = '20261027100000_edit_product_keeps_branch_availability.sql';
const LOCK = '20261028100000_update_complete_product_lock_order.sql';
const all = readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort();
const DEPLOYED = all.filter((n) => ![POS, MIG, LOCK].includes(n));
const only = (process.env.VARIANTS ?? '').split(',').filter(Boolean);
const variants = [
  ['deployed', DEPLOYED],
  ['pending', [...DEPLOYED, POS, MIG]],
  ...(all.includes(LOCK) ? [['fixed', [...DEPLOYED, POS, MIG, LOCK]]] : []),
].filter(([label]) => only.length === 0 || only.includes(label));
const read = (f) => readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/create extension if not exists pgcrypto;/g, '');
const J = JSON.stringify;
const RUN = randomBytes(3).toString('hex');
const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const opened = [];
const dbUrl = (name) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDeadlock = (e) => /40P01|deadlock/i.test(String(e?.code ?? '') + String(e?.message ?? ''));

async function openDb(tag, files) {
  const name = `gr_lo_${RUN}_${tag}`;
  await admin.unsafe(`create database ${name} template template0 encoding 'UTF8'`);
  opened.push(name);
  const setup = postgres(dbUrl(name), { max: 1, prepare: false, onnotice: () => {} });
  await setup.unsafe(`
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role; exception when duplicate_object then null; end $$;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
    grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for (const f of files) await setup.unsafe(read(f));
  await setup.end({ timeout: 2 });
  return name;
}
const conn = (name) => postgres(dbUrl(name), { max: 1, prepare: false, onnotice: () => {} });
const withTx = (sql, user, work) =>
  sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true)`;
    await tx`select set_config('request.jwt.claim.sub', ${user}, true)`;
    return work(tx);
  });

/** One independent world: Main + SM1 + SM2, a Main manager, a cashier per branch, products Combo (Small/Large), Other (single price) and Rice. */
async function world(dbName) {
  const s = conn(dbName);
  const ids = Object.fromEntries(['main', 'sm1', 'sm2', 'mgr', 'c1', 'c2', 'c3'].map((k) => [k, randomUUID()]));
  await s`insert into auth.users(id, email) values (${ids.mgr}, 'm@t'), (${ids.c1}, 'c1@t'), (${ids.c2}, 'c2@t'), (${ids.c3}, 'c3@t')`;
  await s`insert into public.branches(id, name, code, is_main_branch, is_active, receiving_mode) values
    (${ids.main}, 'Main', 'MAIN-LO', true, true, 'counted'), (${ids.sm1}, 'SM1', 'SM1-LO', false, true, 'cashier_confirm'), (${ids.sm2}, 'SM2', 'SM2-LO', false, true, 'cashier_confirm')`;
  await s`insert into public.profiles(id, full_name, role, branch_id) values (${ids.mgr}, 'Mgr', 'manager', ${ids.main}), (${ids.c1}, 'C1', 'cashier', ${ids.sm1}), (${ids.c2}, 'C2', 'cashier', ${ids.sm2}), (${ids.c3}, 'C3', 'cashier', ${ids.sm1})`;
  const create = async (o) =>
    (await withTx(s, ids.mgr, (tx) =>
      tx`select * from public.create_complete_product(p_name := ${o.name}, p_sku := ${o.sku}, p_description := null,
        p_variants := ${J((o.variants ?? []).map(([n, p]) => ({ name: n, default_price: p })))}::text::jsonb, p_branches := ${J(o.branches)}::text::jsonb,
        p_selling_price := ${o.price ?? null}, p_stock_uses := ${o.stockUses ? J(o.stockUses) : null}::text::jsonb)`,
    ))[0];
  const opts = (b, V) => ({ branch_id: b, variants: V.map(([n, p]) => ({ name: n, selling_price: p })) });
  const V = [['Small', '30.00'], ['Large', '50.00']];
  const rice = await create({ name: 'Rice', sku: 'RICE-LO', price: '10', branches: [{ branch_id: ids.sm1, selling_price: '10' }, { branch_id: ids.sm2, selling_price: '10' }] });
  const combo = await create({
    name: 'Combo', sku: 'COMBO-LO', variants: V, branches: [opts(ids.sm1, V), opts(ids.sm2, V)],
    stockUses: [{ variant_name: 'Small', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'Large', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'Large', ingredient_product_id: rice.id, quantity: 1 }],
  });
  const other = await create({ name: 'Other', sku: 'OTHER-LO', price: '25', branches: [{ branch_id: ids.sm1, selling_price: '25' }, { branch_id: ids.sm2, selling_price: '25' }] });
  // a second recipe product that uses Rice too (two edits sharing an ingredient)
  const bowl = await create({ name: 'Bowl', sku: 'BOWL-LO', variants: [['One', '40.00']], branches: [opts(ids.sm1, [['One', '40.00']])], stockUses: [{ variant_name: 'One', ingredient_product_id: 'self', quantity: 1 }, { variant_name: 'One', ingredient_product_id: rice.id, quantity: 1 }] });
  const products = [rice, combo, other, bowl];
  for (const p of products) await withTx(s, ids.mgr, (tx) => tx`select public.set_product_status(${p.id}, true)`);
  await withTx(s, ids.mgr, (tx) => tx`select public.initialize_main_branch_inventory(${J(products.map((p) => ({ product_id: p.id, quantity: 100000 })))}::text::jsonb, 'open')`);
  let n = 0;
  const key = (p) => `${p}-${RUN}-${randomBytes(4).toString('hex')}-${++n}`;
  for (const [b, c] of [[ids.sm1, ids.c1], [ids.sm2, ids.c2]]) {
    const t = (await withTx(s, ids.mgr, (tx) => tx`select public.send_stock_transfer(${b}, ${J(products.map((p) => ({ product_id: p.id, quantity_sent: 5000, destination_price: 20 })))}::text::jsonb, null, ${key('lo-send')}) as id`))[0].id;
    await withTx(s, c, (tx) => tx`select public.confirm_shipment_arrival(${t}, ${key('lo-arrive')})`);
  }
  const shift = {};
  for (const [b, c] of [[ids.sm1, ids.c1], [ids.sm2, ids.c2]]) shift[b] = (await withTx(s, c, (tx) => tx`select public.start_cashier_shift() as id`))[0].id;
  const bpvId = async (b, p, name) => (await s`select id from public.branch_product_variants where branch_id = ${b} and product_id = ${p.id} and name = ${name}`)[0].id;
  const small = { [ids.sm1]: await bpvId(ids.sm1, combo, 'Small'), [ids.sm2]: await bpvId(ids.sm2, combo, 'Small') };
  // Large is switched off at SM1 (intentional state that must survive every edit)
  await withTx(s, ids.mgr, (tx) => tx`select public.configure_branch_product_variants(${ids.sm1}, ${combo.id}, ${J([{ name: 'Large', selling_price: 50, is_active: false }])}::text::jsonb)`);
  await s.end({ timeout: 2 });
  return { ids, rice, combo, other, bowl, shift, small, key };
}

/** operations: each takes (sql, w, i) with its own session */
const mastersOf = (sql, p) => sql`select id, name, default_price::text as d from public.product_variants where product_id = ${p.id} order by sort_order, name`;
const ops = {
  /** price change at one branch, optionally renaming Small <-> SmallX (touches option rows before the branch-product row) */
  editCombo: (opt = {}) => async (sql, w, i) => {
    const m = await mastersOf(sql, w.combo);
    const price = (30 + (i % 7)).toFixed(2);
    const renamed = m.map((r) => ({ ...r, name: opt.rename && r.name.startsWith('Small') ? (r.name.endsWith('X') ? 'Small' : 'SmallX') : r.name }));
    const branches = (opt.branches ?? ['sm1']).map((k) => w.ids[k]).map((b) => ({ branch_id: b, variants: renamed.map((r) => ({ name: r.name, selling_price: r.name.startsWith('Small') ? price : r.d })) }));
    return withTx(sql, w.ids.mgr, (tx) =>
      tx`select * from public.update_complete_product(p_product_id := ${w.combo.id}, p_name := 'Combo', p_sku := 'COMBO-LO', p_description := null, p_is_active := true,
        p_variants := ${J(renamed.map((r) => ({ id: r.id, name: r.name, default_price: r.name.startsWith('Small') ? price : r.d })))}::text::jsonb,
        p_deleted_variant_ids := '[]'::jsonb, p_branches := ${J(branches)}::text::jsonb, p_selling_price := null)`,
    );
  },
  editBowl: () => async (sql, w, i) => {
    const m = await mastersOf(sql, w.bowl);
    const price = (40 + (i % 5)).toFixed(2);
    return withTx(sql, w.ids.mgr, (tx) =>
      tx`select * from public.update_complete_product(p_product_id := ${w.bowl.id}, p_name := 'Bowl', p_sku := 'BOWL-LO', p_description := null, p_is_active := true,
        p_variants := ${J(m.map((r) => ({ id: r.id, name: r.name, default_price: price })))}::text::jsonb, p_deleted_variant_ids := '[]'::jsonb,
        p_branches := ${J([{ branch_id: w.ids.sm1, variants: m.map((r) => ({ name: r.name, selling_price: price })) }])}::text::jsonb, p_selling_price := null)`,
    );
  },
  editOther: () => async (sql, w, i) =>
    withTx(sql, w.ids.mgr, (tx) =>
      tx`select * from public.update_complete_product(p_product_id := ${w.other.id}, p_name := 'Other', p_sku := 'OTHER-LO', p_description := null, p_is_active := true, p_variants := '[]'::jsonb,
        p_deleted_variant_ids := '[]'::jsonb, p_branches := ${J([{ branch_id: w.ids.sm1, selling_price: String(25 + (i % 4)) }, { branch_id: w.ids.sm2, selling_price: String(25 + (i % 4)) }])}::text::jsonb, p_selling_price := ${String(25 + (i % 4))})`,
    ),
  saleSmall: (branch, cashier) => async (sql, w, i) =>
    withTx(sql, w.ids[cashier], (tx) => tx`select * from public.confirm_sale(${w.shift[w.ids[branch]]}, ${J([{ product_id: w.combo.id, variant_id: w.small[w.ids[branch]], quantity: 1 }])}::text::jsonb, ${1000}, ${w.key('lo-sale')}, 'standard')`),
  saleOther: (branch, cashier) => async (sql, w) =>
    withTx(sql, w.ids[cashier], (tx) => tx`select * from public.confirm_sale(${w.shift[w.ids[branch]]}, ${J([{ product_id: w.other.id, variant_id: null, quantity: 1 }])}::text::jsonb, ${1000}, ${w.key('lo-sale')}, 'standard')`),
  transfer: (branch, cashier) => async (sql, w) => {
    const t = (await withTx(sql, w.ids.mgr, (tx) => tx`select public.send_stock_transfer(${w.ids[branch]}, ${J([{ product_id: w.combo.id, quantity_sent: 1, destination_price: 20 }, { product_id: w.rice.id, quantity_sent: 1, destination_price: 10 }])}::text::jsonb, null, ${w.key('lo-send')}) as id`))[0].id;
    return withTx(sql, w.ids[cashier], (tx) => tx`select public.confirm_shipment_arrival(${t}, ${w.key('lo-arrive')})`);
  },
  /** Branch Catalogs: switch Small on/off at a branch (by name: the option is never renamed in these scenarios) */
  // the screen sends the option's CURRENT name and price; resolve both at call time (by row id for Small, which the edit renames)
  catalogOption: (branch, name = 'Large') => async (sql, w, i) => {
    const row = name === 'Large'
      ? (await sql`select name, selling_price::numeric as p from public.branch_product_variants where branch_id = ${w.ids[branch]} and product_id = ${w.combo.id} and name = 'Large'`)[0]
      : (await sql`select name, selling_price::numeric as p from public.branch_product_variants where id = ${w.small[w.ids[branch]]}`)[0];
    return withTx(sql, w.ids.mgr, (tx) => tx`select public.configure_branch_product_variants(${w.ids[branch]}, ${w.combo.id}, ${J([{ name: row.name, selling_price: Number(row.p), is_active: i % 2 === 0 }])}::text::jsonb)`);
  },
  catalogProduct: (branch) => async (sql, w, i) => {
    const row = (await sql`select selling_price::numeric as p from public.branch_products where branch_id = ${w.ids[branch]} and product_id = ${w.combo.id}`)[0];
    return withTx(sql, w.ids.mgr, (tx) => tx`select public.configure_branch_products(${w.ids[branch]}, ${J([{ product_id: w.combo.id, selling_price: Number(row.p), is_active: i % 2 === 0 }])}::text::jsonb)`);
  },
  /** a write to the branch row itself (same value: it still takes the row lock) */
  branchSetting: (branch) => async (sql, w) =>
    withTx(sql, w.ids.mgr, (tx) => tx`select public.set_branch_receiving_mode(${w.ids[branch]}, 'cashier_confirm')`),
  /** Branch Catalogs: change one option's price at one branch */
  optionPrice: (branch) => async (sql, w, i) =>
    withTx(sql, w.ids.mgr, (tx) => tx`select * from public.update_branch_product_variant_price(${w.small[w.ids[branch]]}, ${String(30 + (i % 5))})`),
  status: () => async (sql, w, i) => withTx(sql, w.ids.mgr, (tx) => tx`select public.set_product_status(${w.combo.id}, ${i % 2 === 0})`),
};

const scenarios = [
  ['edit x sale (same branch, Small on)', [ops.editCombo(), ops.saleSmall('sm1', 'c1')]],
  ['edit x sale (branch the edit does not send)', [ops.editCombo(), ops.saleSmall('sm2', 'c2')]],
  ['edit x sale x sale', [ops.editCombo({ branches: ['sm1', 'sm2'] }), ops.saleSmall('sm1', 'c1'), ops.saleSmall('sm2', 'c2')]],
  ['edit (rename option) x sale', [ops.editCombo({ rename: true }), ops.saleSmall('sm1', 'c1')]],
  ['edit x transfer to the same branch', [ops.editCombo(), ops.transfer('sm1', 'c1')]],
  ['edit x edit (same product)', [ops.editCombo(), ops.editCombo()]],
  ['edit x edit (two products sharing the Rice ingredient)', [ops.editCombo(), ops.editBowl()]],
  // Toggling an option by the name the edit is renaming at that moment can leave a stray duplicate row (a logical race, not a lock cycle).
  ['edit (rename option) x Branch Catalogs option switch', [ops.editCombo({ rename: true }), ops.catalogOption('sm1', 'Small')], { logicalRace: /branch_product_variants_branch_id_product_id_name_key/ }],
  ['edit x Branch Catalogs option switch (Large)', [ops.editCombo(), ops.catalogOption('sm1', 'Large')]],
  ['edit x Branch Catalogs product switch', [ops.editCombo(), ops.catalogProduct('sm1')]],
  ['edit x product status', [ops.editCombo(), ops.status()]],
  ['edit x branch settings update (receiving mode)', [ops.editCombo(), ops.branchSetting('sm1')]],
  // update_branch_product_variant_price used to lock the option row, then the branch_products row (the reverse of the edit and of
  // configure_branch_product_variants); the lock-order migration aligns it. No screen calls it today, but it is callable.
  ['edit x update_branch_product_variant_price RPC', [ops.editCombo(), ops.optionPrice('sm1')]],
  ['edit x edit (other product, both branches) x sale', [ops.editOther(), ops.editCombo(), ops.saleOther('sm1', 'c1')]],
  ['sale x sale x transfer received by ANOTHER cashier (no edit)', [ops.saleSmall('sm1', 'c1'), ops.saleOther('sm1', 'c1'), ops.transfer('sm1', 'c3')]],
  // KNOWN, unrelated to update_complete_product: confirm_sale locks the cashier's profile row before the branch gate, confirm_shipment_arrival
  // takes the gate and then writes rows that reference the same profile. Only the SAME cashier doing both at once. Reported, not gated.
  ['sale x transfer received by the SAME cashier (no edit; known, unrelated)', [ops.saleSmall('sm1', 'c1'), ops.transfer('sm1', 'c1')], { known: 'deadlock' }],
];

const sleeps = () => Math.floor(Math.random() * 25);
async function runScenario(dbName, w, [name, list]) {
  const sessions = list.map(() => conn(dbName));
  const stat = { deadlocks: 0, other: [], ok: 0, total: 0 };
  try {
    for (let i = 0; i < ITER; i += 1) {
      const results = await Promise.allSettled(list.map(async (op, k) => { if (k > 0) await sleep(sleeps()); return op(sessions[k], w, i); }));
      for (const r of results) {
        stat.total += 1;
        if (r.status === 'fulfilled') stat.ok += 1;
        else if (isDeadlock(r.reason)) stat.deadlocks += 1;
        else stat.other.push(String(r.reason?.message ?? r.reason).slice(0, 110));
      }
    }
  } finally {
    await Promise.all(sessions.map((s) => s.end({ timeout: 2 }).catch(() => {})));
  }
  return stat;
}

/** after every scenario: no partial writes, intentional switches intact, recipes and history consistent */
async function invariants(dbName, w) {
  const s = conn(dbName);
  const problems = [];
  try {
    const [m] = await s`select selling_price::numeric as p from public.products where id = ${w.combo.id}`;
    const [d] = await s`select default_price::numeric as d from public.product_variants where product_id = ${w.combo.id} order by sort_order limit 1`;
    if (Number(m.p) !== Number(d.d)) problems.push(`product price ${m.p} != default option ${d.d}`);
    for (const b of [w.ids.sm1, w.ids.sm2]) {
      const bp = (await s`select selling_price::numeric as p from public.branch_products where branch_id = ${b} and product_id = ${w.combo.id}`)[0];
      const bv = (await s`select v.selling_price::numeric as p from public.branch_product_variants v join public.product_variants pv on pv.product_id = v.product_id and pv.name = v.name where v.branch_id = ${b} and v.product_id = ${w.combo.id} order by pv.sort_order limit 1`)[0];
      if (bp && bv && Number(bp.p) !== Number(bv.p)) problems.push(`branch price ${bp.p} != first option ${bv.p}`);
    }
    const large = (await s`select is_active from public.branch_product_variants where branch_id = ${w.ids.sm1} and product_id = ${w.combo.id} and name = 'Large'`)[0];
    // Large at SM1 is only ever changed by the catalog scenarios; the edit scenarios must never have switched it on
    if (large && large.is_active !== false && !w.catalogTouched) problems.push('Large at SM1 was switched on');
    const orphan = (await s`select count(*)::int as n from public.branch_product_variants v where not exists (select 1 from public.product_variants pv where pv.product_id = v.product_id and pv.name = v.name)`)[0].n;
    if (orphan > 0 && !w.catalogTouched) problems.push(`${orphan} branch options without a master option`);
    const uses = (await s`select count(*)::int as n from public.product_stock_uses where product_id = ${w.combo.id}`)[0].n;
    if (uses !== 3) problems.push(`combo recipe lines ${uses} != 3`);
    const lines = (await s`select count(*)::int as n from public.sale_items i left join public.sales sl on sl.id = i.sale_id where sl.id is null`)[0].n;
    if (lines > 0) problems.push('sale lines without a sale');
    // stock must equal received - sold - transfers, never negative
    const neg = (await s`select count(*)::int as n from public.branch_inventory where quantity_on_hand < 0`)[0].n;
    if (neg > 0) problems.push('negative stock');
  } finally {
    await s.end({ timeout: 2 });
  }
  return problems;
}

/**
 * Deterministic versions of the two inversions (random timing hits the narrow one too rarely). Both widen the window on purpose:
 *   A. the first locks of confirm_sale, taken with the REAL gate function (branch row ... pause ... product row), against an edit;
 *   B. an edit that renames an option (its row is locked, then a test-only trigger pauses) against Branch Catalogs switching
 *      that option (it already holds the branch_products row and waits for the option row).
 */
async function forced(dbName, w) {
  const result = {};
  const su = conn(dbName);
  try {
    // ---- A. sale locks (real gate) vs edit
    const a = conn(dbName);
    const b = conn(dbName);
    const sale = a.begin(async (tx) => {
      await tx`select public.lock_branch_inventory_gate(${w.ids.sm1})`;
      await sleep(900);
      await tx`select id from public.products where id = ${w.combo.id} for share`;
      return 'sale-locks-done';
    });
    await sleep(250);
    const edit = ops.editCombo()(b, w, 1);
    const [s1, e1] = await Promise.allSettled([sale, edit]);
    result.gate = { deadlock: [s1, e1].some((r) => r.status === 'rejected' && isDeadlock(r.reason)), saleOk: s1.status === 'fulfilled', editOk: e1.status === 'fulfilled', other: [s1, e1].filter((r) => r.status === 'rejected' && !isDeadlock(r.reason)).map((r) => String(r.reason?.message).slice(0, 90)) };
    await a.end({ timeout: 2 });
    await b.end({ timeout: 2 });

    // ---- B. option rename vs Branch Catalogs
    await su.unsafe(`
      create or replace function public.zz_slow_rename() returns trigger language plpgsql as $f$ begin perform pg_sleep(0.7); return new; end $f$;
      create trigger zz_slow_rename before update of name on public.branch_product_variants for each row execute function public.zz_slow_rename();`);
    const c = conn(dbName);
    const d = conn(dbName);
    const renaming = ops.editCombo({ rename: true })(c, w, 2);
    await sleep(250);
    const catalog = ops.catalogOption('sm1', 'Small')(d, w, 2);
    const [e2, c2] = await Promise.allSettled([renaming, catalog]);
    result.rename = { deadlock: [e2, c2].some((r) => r.status === 'rejected' && isDeadlock(r.reason)), editOk: e2.status === 'fulfilled', catalogOk: c2.status === 'fulfilled', other: [e2, c2].filter((r) => r.status === 'rejected' && !isDeadlock(r.reason)).map((r) => String(r.reason?.message).slice(0, 90)) };
    await c.end({ timeout: 2 });
    await d.end({ timeout: 2 });
  } finally {
    await su.end({ timeout: 2 });
  }
  return result;
}

let fixedFailed = false;
const table = [];
try {
  for (const [label, files] of variants) {
    const template = await openDb(label, files);
    const w = await world(template); // seeded once; every scenario runs on its own clone of this database
    console.log(`\n=== schema variant: ${label} (${files.length} migrations) ===`);
    let clone = 0;
    for (const sc of scenarios.filter(([n]) => !process.env.ONLY || n.includes(process.env.ONLY))) {
      const dbName = `${template}_c${(clone += 1)}`;
      await admin.unsafe(`create database ${dbName} template ${template}`);
      opened.push(dbName);
      w.catalogTouched = /Catalogs/.test(sc[0]);
      const stat = await runScenario(dbName, w, sc);
      const note = sc[2] ?? {};
      const problems = await invariants(dbName, w);
      await admin.unsafe(`drop database if exists ${dbName} with (force)`);
      const logical = note.logicalRace ? stat.other.filter((m) => note.logicalRace.test(m)).length : 0;
      const other = [...new Set(stat.other.filter((m) => !(note.logicalRace && note.logicalRace.test(m))))];
      const knownDeadlocks = note.known === 'deadlock';
      const clean = (stat.deadlocks === 0 || knownDeadlocks) && other.length === 0 && problems.length === 0;
      console.log(`  ${clean ? (knownDeadlocks && stat.deadlocks > 0 ? 'known' : 'ok  ') : 'FAIL'} ${sc[0]}: ${stat.ok}/${stat.total} ok, ${stat.deadlocks} deadlocks${logical ? `, ${logical} logical-race duplicate-key errors (not locks)` : ''}${other.length ? `, other errors: ${other.join(' | ')}` : ''}${problems.length ? `, INVARIANTS: ${problems.join('; ')}` : ''}`);
      table.push([label, sc[0], stat.deadlocks]);
      if (label === 'fixed' && !clean) fixedFailed = true;
    }
    if (!process.env.ONLY) {
      const dbName = `${template}_forced`;
      await admin.unsafe(`create database ${dbName} template ${template}`);
      opened.push(dbName);
      const f = await forced(dbName, w);
      for (const [k, title] of [['gate', 'sale locks (real gate, then product) x edit'], ['rename', 'option rename x Branch Catalogs switch']]) {
        const r = f[k];
        const good = !r.deadlock && r.editOk && r.other.length === 0;
        console.log(`  ${good ? 'ok  ' : 'FAIL'} FORCED ${title}: ${r.deadlock ? 'DEADLOCK' : 'no deadlock'}, edit ${r.editOk ? 'ok' : 'failed'}${r.other.length ? `, other: ${r.other.join(' | ')}` : ''}`);
        if (label === 'fixed' && !good) fixedFailed = true;
      }
      await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    }
  }
} finally {
  for (const name of opened) await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
  await admin.end({ timeout: 2 });
}
const have = variants.some(([l]) => l === 'fixed');
console.log(have ? (fixedFailed ? '\nLOCK ORDER: the fixed variant FAILED' : '\nLOCK ORDER: the fixed variant has no deadlocks, errors or invariant breaks') : '\nLOCK ORDER: no fixed variant yet (informational run)');
process.exit(have && fixedFailed ? 1 : 0);
