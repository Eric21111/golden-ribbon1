import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

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

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const mainMgr = id(2);
const mgr1 = id(3);
const cashier1 = id(5);
const cashier2 = id(6);
const main = id(10);
const branch1 = id(11);
const chicken = id(20);

await db.exec(`
  insert into auth.users values
    ('${owner}','owner@test'),('${mainMgr}','mainmgr@test'),
    ('${mgr1}','mgr1@test'),('${cashier1}','c1@test'),('${cashier2}','c2@test');
  insert into public.branches(id,name,code,is_main_branch,is_active) values
    ('${main}','Main Branch','MAIN',true,true),
    ('${branch1}','Branch 1','BR-01',false,true);
  insert into public.profiles(id,full_name,role,branch_id) values
    ('${owner}','Owner','owner',null),
    ('${mainMgr}','Main Manager','manager','${main}'),
    ('${mgr1}','Selling Manager','manager','${branch1}'),
    ('${cashier1}','Cashier 1','cashier','${branch1}'),
    ('${cashier2}','Cashier 2','cashier','${branch1}');
  insert into public.products(id,name,sku,selling_price,is_active) values
    ('${chicken}','Chicken Butter','CB',80,true);
`);

const asUser = async (userId, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

const dates = (await db.query(`
  select
    ((timezone('Asia/Manila', now()))::date - 120)::text as old_date,
    ((timezone('Asia/Manila', now()))::date - 119)::text as old_next,
    ((timezone('Asia/Manila', now()))::date - 30)::text as recent_date,
    ((timezone('Asia/Manila', now()))::date - 29)::text as recent_next,
    (timezone('Asia/Manila', now()))::date::text as today,
    ((timezone('Asia/Manila', now()))::date + 1)::text as tomorrow
`)).rows[0];

const oldShift = id(30);
const recentShift = id(31);
const openShift = id(32);
const oldSale = id(40);
const voidSale = id(41);
const recentSale = id(42);
const todaySale = id(43);

await db.exec(`
  insert into public.shifts(id,branch_id,cashier_id,status,started_at,ended_at) values
    ('${oldShift}','${branch1}','${cashier1}','closed',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila'),
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '8 hours'),
    ('${recentShift}','${branch1}','${cashier1}','closed',
      ('${dates.recent_date}'::date::timestamp at time zone 'Asia/Manila'),
      ('${dates.recent_date}'::date::timestamp at time zone 'Asia/Manila') + interval '8 hours'),
    ('${openShift}','${branch1}','${cashier2}','open',
      now() - interval '1 hour', null);

  insert into public.sales(id,sale_number,branch_id,shift_id,cashier_id,subtotal,total_amount,amount_paid,change_amount,status,sold_at,idempotency_key,request_items)
  values
    ('${oldSale}','SALE-ARCH-OLD','${branch1}','${oldShift}','${cashier1}',400,400,400,0,'completed',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '2 hours',
      'archive-old-sale-key01','[]'),
    ('${voidSale}','SALE-ARCH-VOID','${branch1}','${oldShift}','${cashier1}',80,80,80,0,'voided',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '3 hours',
      'archive-void-sale-key01','[]'),
    ('${recentSale}','SALE-ARCH-REC','${branch1}','${recentShift}','${cashier1}',160,160,160,0,'completed',
      ('${dates.recent_date}'::date::timestamp at time zone 'Asia/Manila') + interval '2 hours',
      'archive-recent-sale-k01','[]'),
    ('${todaySale}','SALE-ARCH-TOD','${branch1}','${recentShift}','${cashier1}',240,240,240,0,'completed',
      (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila' + interval '2 hours',
      'archive-today-sale-k01','[]');

  insert into public.sale_items(sale_id,product_id,quantity,unit_price,subtotal) values
    ('${oldSale}','${chicken}',5,80,400),
    ('${voidSale}','${chicken}',1,80,80),
    ('${recentSale}','${chicken}',2,80,160),
    ('${todaySale}','${chicken}',3,80,240);

  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand)
  values ('${branch1}','${chicken}',90);

  insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by)
  values
    ('${branch1}','${chicken}','opening_stock',100,'opening_stock',null,'${mainMgr}'),
    ('${branch1}','${chicken}','sale',-5,'sale','${oldSale}','${cashier1}'),
    ('${branch1}','${chicken}','sale',-2,'sale','${recentSale}','${cashier1}'),
    ('${branch1}','${chicken}','sale',-3,'sale','${todaySale}','${cashier1}');
`);

assert.match(readFileSync('src/types/models.ts', 'utf8'), /DELETE ARCHIVED DATA/);
assert.match(readFileSync('src/features/archive/DataArchiveScreen.tsx', 'utf8'), /Export → Save Copy → Verify → Confirm Cleanup/);
assert.match(readFileSync('supabase/migrations/20260913140000_milestone_11_3_data_archive.sql', 'utf8'), /DELETE ARCHIVED DATA/);
assert.doesNotMatch(readFileSync('src/components/RoleNavigation.tsx', 'utf8'), /data-archive/);
assert.doesNotMatch(readFileSync('src/components/dashboard/ManagerSidebar.tsx', 'utf8'), /data-archive|cleanup_archived_sales/);

await asUser(mgr1, async () => {
  await assert.rejects(db.query('select public.get_archive_status()'), /Owner access/);
  await assert.rejects(db.query('select public.prepare_sales_archive()'), /Owner access/);
  await assert.rejects(
    db.query(`select public.cleanup_archived_sales('${id(99)}','DELETE ARCHIVED DATA')`),
    /Owner access/,
  );
});

await asUser(cashier1, async () => {
  await assert.rejects(db.query('select public.get_archive_status()'), /Owner access/);
});

await asUser(mainMgr, async () => {
  await assert.rejects(db.query('select public.prepare_sales_archive()'), /Owner access/);
});

const beforeMovements = (await db.query('select count(*)::int as n from public.inventory_movements')).rows[0].n;
const beforeTransfers = (await db.query('select count(*)::int as n from public.stock_transfers')).rows[0].n;

await asUser(owner, async () => {
  const status = (await db.query('select public.get_archive_status() status')).rows[0].status;
  assert.equal(status.retention_days, 90);
  assert.equal(Number(status.eligible_sales_count), 2);
  assert.equal(Number(status.eligible_sale_items_count), 2);
  assert.equal(Number(status.eligible_shift_count), 1);
  assert.equal(status.archive_due, true);
  assert.equal(status.reminder_visible, true);

  const dismissed = (await db.query('select public.dismiss_archive_reminder() status')).rows[0].status;
  assert.equal(dismissed.reminder_visible, false);

  await db.exec('reset role');
  await db.exec(`update public.archive_settings set remind_after = now() - interval '1 minute' where id = 1`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);

  const reminded = (await db.query('select public.get_archive_status() status')).rows[0].status;
  assert.equal(reminded.reminder_visible, true);

  await assert.rejects(
    db.query(`select public.cleanup_archived_sales('${id(99)}','DELETE ARCHIVED DATA')`),
    /not found|Archive record/,
  );

  const prepared = (await db.query('select public.prepare_sales_archive() archive')).rows[0].archive;
  assert.equal(prepared.status, 'prepared');
  assert.equal(Number(prepared.sales_count), 2);
  assert.equal(Number(prepared.sale_items_count), 2);
  assert.equal(Number(prepared.shift_count), 1);
  assert.equal(Number(prepared.revenue_total), 400);
  assert.equal(Number(prepared.units_sold), 5);

  const summaries = (await db.query(`
    select quantity_sold, revenue, transaction_count
    from public.daily_branch_sales_summary
    where business_date = '${dates.old_date}'::date
  `)).rows[0];
  assert.equal(Number(summaries.quantity_sold), 5);
  assert.equal(Number(summaries.revenue), 400);
  assert.equal(Number(summaries.transaction_count), 1);

  const productSummary = (await db.query(`
    select quantity_sold, revenue
    from public.daily_product_sales_summary
    where business_date = '${dates.old_date}'::date and product_id = '${chicken}'
  `)).rows[0];
  assert.equal(Number(productSummary.quantity_sold), 5);
  assert.equal(Number(productSummary.revenue), 400);

  await assert.rejects(
    db.query(`select public.verify_sales_archive('${prepared.id}')`),
    /Export the archive|save a copy/,
  );
  await assert.rejects(
    db.query(`select public.cleanup_archived_sales('${prepared.id}','DELETE ARCHIVED DATA')`),
    /exported and verified/,
  );

  const exported = (await db.query(`select public.get_archive_export('${prepared.id}') pack`)).rows[0].pack;
  assert.equal(exported.sales.length, 2);
  assert.equal(exported.sale_items.length, 2);
  assert.equal(exported.shifts.length, 1);
  assert.ok(exported.sales.some((row) => row.status === 'voided'));
  assert.ok(exported.sales.some((row) => row.id === oldSale));
  assert.ok(!exported.sales.some((row) => row.id === recentSale));
  assert.equal(exported.manifest.sales_row_count, 2);
  assert.equal(Number(exported.manifest.revenue_total), 400);
  assert.match(exported.manifest.package_name, /^golden-ribbon-archive-/);

  await db.exec('reset role');
  await db.exec(`update public.data_archives set sales_count = sales_count + 1 where id = '${prepared.id}'`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await assert.rejects(
    db.query(`select public.verify_sales_archive('${prepared.id}')`),
    /verification failed/,
  );
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${oldSale}'`)).rows[0].n, 1);

  await db.exec('reset role');
  await db.exec(`update public.data_archives set sales_count = 2, status = 'exported' where id = '${prepared.id}'`);
  await db.exec(`update public.daily_branch_sales_summary set revenue = revenue + 1 where business_date = '${dates.old_date}'::date`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await assert.rejects(
    db.query(`select public.verify_sales_archive('${prepared.id}')`),
    /verification failed/,
  );
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${oldSale}'`)).rows[0].n, 1);

  await db.exec('reset role');
  await db.exec(`update public.daily_branch_sales_summary set revenue = 400 where business_date = '${dates.old_date}'::date`);
  await db.exec(`update public.data_archives set status = 'exported' where id = '${prepared.id}'`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);

  const verified = (await db.query(`select public.verify_sales_archive('${prepared.id}') archive`)).rows[0].archive;
  assert.equal(verified.status, 'verified');

  await assert.rejects(
    db.query(`select public.cleanup_archived_sales('${prepared.id}','please delete')`),
    /DELETE ARCHIVED DATA/,
  );
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${oldSale}'`)).rows[0].n, 1);

  const cleaned = (await db.query(
    `select public.cleanup_archived_sales('${prepared.id}','DELETE ARCHIVED DATA') archive`,
  )).rows[0].archive;
  assert.equal(cleaned.status, 'cleaned');

  const cleanedAgain = (await db.query(
    `select public.cleanup_archived_sales('${prepared.id}','DELETE ARCHIVED DATA') archive`,
  )).rows[0].archive;
  assert.equal(cleanedAgain.status, 'cleaned');

  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${oldSale}'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${voidSale}'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${recentSale}'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${todaySale}'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.shifts where id = '${oldShift}'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int as n from public.shifts where id = '${recentShift}'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.shifts where id = '${openShift}'`)).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from public.inventory_movements')).rows[0].n, beforeMovements);
  assert.equal((await db.query('select count(*)::int as n from public.stock_transfers')).rows[0].n, beforeTransfers);
  assert.equal((await db.query('select count(*)::int as n from public.products')).rows[0].n, 1);
  assert.equal((await db.query(`select quantity_on_hand from public.branch_inventory where product_id='${chicken}'`)).rows[0].quantity_on_hand, 90);

  const recon = (await db.query('select public.report_inventory_reconciliation(null) result')).rows[0].result;
  const chickenRow = recon.find((row) => row.product_id === chicken && row.branch_id === branch1);
  assert.equal(Number(chickenRow.variance), 0);

  const oldRange = (await db.query(
    `select public.report_sales_by_branch('custom', $1::timestamptz, $2::timestamptz) result`,
    [`${dates.old_date}T00:00:00+08:00`, `${dates.old_next}T00:00:00+08:00`],
  )).rows[0].result;
  const oldBranch = oldRange.find((row) => row.branch_id === branch1);
  assert.equal(Number(oldBranch.transaction_count), 1);
  assert.equal(Number(oldBranch.total_sales), 400);

  const recentRange = (await db.query(
    `select public.report_sales_by_branch('custom', $1::timestamptz, $2::timestamptz) result`,
    [`${dates.recent_date}T00:00:00+08:00`, `${dates.recent_next}T00:00:00+08:00`],
  )).rows[0].result;
  const recentBranch = recentRange.find((row) => row.branch_id === branch1);
  assert.equal(Number(recentBranch.transaction_count), 1);
  assert.equal(Number(recentBranch.total_sales), 160);

  const cross = (await db.query(
    `select public.report_sales_by_branch('custom', $1::timestamptz, $2::timestamptz) result`,
    [`${dates.old_date}T00:00:00+08:00`, `${dates.tomorrow}T00:00:00+08:00`],
  )).rows[0].result;
  const crossBranch = cross.find((row) => row.branch_id === branch1);
  assert.equal(Number(crossBranch.transaction_count), 3);
  assert.equal(Number(crossBranch.total_sales), 800);

  const products = (await db.query(
    `select public.report_product_sales('custom', null, $1::timestamptz, $2::timestamptz) result`,
    [`${dates.old_date}T00:00:00+08:00`, `${dates.tomorrow}T00:00:00+08:00`],
  )).rows[0].result;
  const productRow = products.find((row) => row.product_id === chicken);
  assert.equal(Number(productRow.quantity_sold), 10);
  assert.equal(Number(productRow.total_revenue), 800);

  const performance = (await db.query(
    `select public.report_branch_performance('custom', $1::timestamptz, $2::timestamptz) result`,
    [`${dates.old_date}T00:00:00+08:00`, `${dates.tomorrow}T00:00:00+08:00`],
  )).rows[0].result;
  const perfRow = performance.find((row) => row.branch_id === branch1);
  assert.equal(Number(perfRow.transaction_count), 3);
  assert.equal(Number(perfRow.quantity_sold), 10);
  assert.equal(Number(perfRow.total_sales), 800);

  const todayMetrics = (await db.query('select public.get_owner_dashboard_metrics() metrics')).rows[0].metrics;
  assert.equal(Number(todayMetrics.today_transactions), 1);
  assert.equal(Number(todayMetrics.today_units_sold), 3);
  assert.equal(Number(todayMetrics.today_sales), 240);

  const daily = (await db.query('select * from public.get_owner_daily_product_summary()')).rows;
  const dailyRow = daily.find((row) => row.product_id === chicken);
  assert.equal(Number(dailyRow.quantity_sold), 3);
  assert.equal(Number(dailyRow.revenue), 240);

  const after = (await db.query('select public.get_archive_status() status')).rows[0].status;
  assert.equal(after.archive_due, false);
  assert.equal(Number(after.eligible_sales_count), 0);
});

await asUser(owner, async () => {
  await assert.rejects(db.query('select public.prepare_sales_archive()'), /older than 90 days/);
});

console.log('milestone 11.3 archive tests passed');
