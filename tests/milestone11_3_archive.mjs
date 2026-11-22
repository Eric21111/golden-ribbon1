import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';

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
const pendingShift = id(33);
const oldSale = id(40);
const voidSale = id(41);
const recentSale = id(42);
const todaySale = id(43);
const pendingCashSale = id(44);
const pendingGcashSale = id(45);
const voidEventId = id(50);

await db.exec(`
  insert into public.shifts(id,branch_id,cashier_id,status,started_at,ended_at,reconciliation_required) values
    ('${oldShift}','${branch1}','${cashier1}','closed',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila'),
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '8 hours', false),
    ('${pendingShift}','${branch1}','${cashier2}','closed',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '9 hours',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '12 hours', true),
    ('${recentShift}','${branch1}','${cashier1}','closed',
      ('${dates.recent_date}'::date::timestamp at time zone 'Asia/Manila'),
      ('${dates.recent_date}'::date::timestamp at time zone 'Asia/Manila') + interval '8 hours', false),
    ('${openShift}','${branch1}','${cashier2}','open',
      now() - interval '1 hour', null, false);

  insert into public.sales(
    id,sale_number,branch_id,shift_id,cashier_id,subtotal,total_amount,amount_paid,change_amount,
    status,sold_at,idempotency_key,request_items,payment_method
  )
  values
    ('${oldSale}','SALE-ARCH-OLD','${branch1}','${oldShift}','${cashier1}',400,400,400,0,'completed',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '2 hours',
      'archive-old-sale-key01','[]','cash'),
    ('${voidSale}','SALE-ARCH-VOID','${branch1}','${oldShift}','${cashier1}',0,0,0,0,'voided',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '3 hours',
      'archive-void-sale-key01','[]',null),
    ('${pendingCashSale}','SALE-ARCH-PCASH','${branch1}','${pendingShift}','${cashier2}',160,160,160,0,'completed',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '10 hours',
      'archive-pending-cash-k01','[]','cash'),
    ('${pendingGcashSale}','SALE-ARCH-PGCASH','${branch1}','${pendingShift}','${cashier2}',80,80,80,0,'completed',
      ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '11 hours',
      'archive-pending-gcash-k1','[]','gcash'),
    ('${recentSale}','SALE-ARCH-REC','${branch1}','${recentShift}','${cashier1}',160,160,160,0,'completed',
      ('${dates.recent_date}'::date::timestamp at time zone 'Asia/Manila') + interval '2 hours',
      'archive-recent-sale-k01','[]','cash'),
    ('${todaySale}','SALE-ARCH-TOD','${branch1}','${recentShift}','${cashier1}',240,240,240,0,'completed',
      (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila' + interval '2 hours',
      'archive-today-sale-k01','[]','cash');

  insert into public.sale_items(sale_id,product_id,quantity,unit_price,subtotal,void_history) values
    ('${oldSale}','${chicken}',5,80,400,'[]'::jsonb),
    ('${voidSale}','${chicken}',0,80,0,
      jsonb_build_array(jsonb_build_object(
        'id', '${voidEventId}',
        'quantity', 1,
        'amount', 80,
        'reason', 'Customer changed mind',
        'note', 'Wanted different size',
        'cashier_id', '${cashier1}',
        'at', (('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') + interval '3 hours 5 minutes')
      ))),
    ('${pendingCashSale}','${chicken}',2,80,160,'[]'::jsonb),
    ('${pendingGcashSale}','${chicken}',1,80,80,'[]'::jsonb),
    ('${recentSale}','${chicken}',2,80,160,'[]'::jsonb),
    ('${todaySale}','${chicken}',3,80,240,'[]'::jsonb);

  insert into public.branch_inventory(branch_id,product_id,quantity_on_hand)
  values ('${branch1}','${chicken}',87);

  insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by)
  values
    ('${branch1}','${chicken}','opening_stock',100,'opening_stock',null,'${mainMgr}'),
    ('${branch1}','${chicken}','sale',-5,'sale','${oldSale}','${cashier1}'),
    ('${branch1}','${chicken}','sale',-2,'sale','${pendingCashSale}','${cashier2}'),
    ('${branch1}','${chicken}','sale',-1,'sale','${pendingGcashSale}','${cashier2}'),
    ('${branch1}','${chicken}','sale',-2,'sale','${recentSale}','${cashier1}'),
    ('${branch1}','${chicken}','sale',-3,'sale','${todaySale}','${cashier1}');

  -- Reconciled old shift keeps remittance/waste after sales cleanup.
  insert into public.shift_reconciliations(
    shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by
  ) values ('${oldShift}', '${branch1}', 400, 400, 0, 'exact', '${cashier1}');
  insert into public.shift_waste_occurrences(shift_id, branch_id, product_id, recorded_by, note)
  values ('${oldShift}', '${branch1}', '${chicken}', '${cashier1}', 'archive retain waste');
`);

assert.match(readFileSync('src/types/models.ts', 'utf8'), /DELETE ARCHIVED DATA/);
assert.match(readFileSync('src/types/models.ts', 'utf8'), /ARCHIVE_EXPORT_FORMAT_VERSION = 2/);
const archiveSource = ['DataArchiveScreen', 'OldSalesDetailsScreen', 'ReadNoticesScreen'].map((name) => readFileSync(`src/features/archive/${name}.tsx`, 'utf8')).join('\n');
assert.match(archiveSource, /Export → Save Copy → Verify → Confirm Cleanup/);
assert.match(archiveSource, /Related shifts \(kept\)/);
assert.match(archiveSource, /Delete archived sales details/);
assert.match(archiveSource, /Read notifications/);
assert.match(archiveSource, /backupSavedAcknowledged/);
assert.match(archiveSource, /I saved the backup files/);
assert.doesNotMatch(archiveSource, /Saved \$\{pack\.manifest\.package_name\}/);
// the hub opens the two tools; the steps are one at a time
assert.match(readFileSync('src/features/archive/DataArchiveScreen.tsx', 'utf8'), /data-archive\/notifications[\s\S]*data-archive\/sales/);
assert.match(readFileSync('src/features/archive/OldSalesDetailsScreen.tsx', 'utf8'), /canCleanup =\s+archive\?\.status === 'verified' && confirmation === ARCHIVE_CLEANUP_CONFIRMATION && !busy/, 'deleting still needs a verified archive and the typed phrase');
assert.match(readFileSync('supabase/migrations/20260913140000_milestone_11_3_data_archive.sql', 'utf8'), /DELETE ARCHIVED DATA/);
assert.match(
  readFileSync('supabase/migrations/20261117090000_archive_cleanup_sales_only.sql', 'utf8'),
  /Keeps shifts, remittances, waste/,
);
assert.match(
  readFileSync('supabase/migrations/20261117103000_archive_void_history_remittance_guard.sql', 'utf8'),
  /void_history/,
);
assert.match(
  readFileSync('supabase/migrations/20261117103000_archive_void_history_remittance_guard.sql', 'utf8'),
  /archive_assert_remittance_safe/,
);
assert.match(
  readFileSync('supabase/migrations/20261117120000_archive_fresh_export_required.sql', 'utf8'),
  /export_format_version/,
);
assert.match(
  readFileSync('supabase/migrations/20261117120000_archive_fresh_export_required.sql', 'utf8'),
  /status in \('exported', 'verified'\)/,
);
assert.doesNotMatch(
  readFileSync('supabase/migrations/20261117120000_archive_fresh_export_required.sql', 'utf8'),
  /status in \('exported', 'verified', 'failed'\)/,
);
assert.match(readFileSync('src/lib/archiveExport.ts', 'utf8'), /void_events\.csv/);
assert.match(readFileSync('src/lib/archiveExport.ts', 'utf8'), /browser_download_started/);
assert.match(readFileSync('src/lib/archiveExport.ts', 'utf8'), /share_sheet_opened/);
assert.doesNotMatch(readFileSync('src/lib/archiveExport.ts', 'utf8'), /files were successfully saved/);
assert.doesNotMatch(readFileSync('src/components/RoleNavigation.tsx', 'utf8'), /data-archive/);
// ManagerSidebar.tsx renders both the Manager and Owner drawers from one file — only the
// Manager-only route table (getGroups) must stay free of Data Archive; Owner's own table
// (getOwnerGroups) legitimately links to it since Data Archive is Owner-exclusive.
const sidebarSource = readFileSync('src/components/dashboard/ManagerSidebar.tsx', 'utf8');
const managerGroupsSource = sidebarSource.slice(
  sidebarSource.indexOf('function getGroups('),
  sidebarSource.indexOf('function getOwnerGroups('),
);
assert.ok(managerGroupsSource.length > 0, 'getGroups function should be found in ManagerSidebar.tsx');
assert.doesNotMatch(managerGroupsSource, /data-archive|cleanup_archived_sales/);

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
  assert.equal(Number(status.eligible_sales_count), 4);
  assert.equal(Number(status.eligible_sale_items_count), 4);
  assert.equal(Number(status.eligible_shift_count), 2);
  assert.equal(Number(status.estimated_records), 8, 'preview counts sales+items only, not kept shifts');
  assert.equal(status.archive_due, true);

  const pendingRemit = (
    await db.query(`select public.report_branch_shift_remittances(null, 'all_time', null, null) result`)
  ).rows[0].result;
  const pendingRow = (pendingRemit.days ?? [])
    .flatMap((day) => day.shifts ?? [])
    .find((row) => row.shift_id === pendingShift);
  assert.ok(pendingRow, 'pending shift appears in remittance report');
  assert.equal(pendingRow.status, 'pending');
  assert.equal(Number(pendingRow.expected_cash), 160);
  assert.equal(Number(pendingRow.expected_gcash), 80);
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
  assert.equal(Number(prepared.sales_count), 4);
  assert.equal(Number(prepared.sale_items_count), 4);
  assert.equal(Number(prepared.shift_count), 2);
  assert.equal(Number(prepared.revenue_total), 640);
  assert.equal(Number(prepared.units_sold), 8);

  const summaries = (await db.query(`
    select quantity_sold, revenue, transaction_count
    from public.daily_branch_sales_summary
    where business_date = '${dates.old_date}'::date
  `)).rows[0];
  assert.equal(Number(summaries.quantity_sold), 8);
  assert.equal(Number(summaries.revenue), 640);
  assert.equal(Number(summaries.transaction_count), 3);

  const productSummary = (await db.query(`
    select quantity_sold, revenue
    from public.daily_product_sales_summary
    where business_date = '${dates.old_date}'::date and product_id = '${chicken}'
  `)).rows[0];
  assert.equal(Number(productSummary.quantity_sold), 8);
  assert.equal(Number(productSummary.revenue), 640);

  await assert.rejects(
    db.query(`select public.verify_sales_archive('${prepared.id}')`),
    /Export the archive|save a copy/,
  );
  await assert.rejects(
    db.query(`select public.cleanup_archived_sales('${prepared.id}','DELETE ARCHIVED DATA')`),
    /exported and verified/,
  );

  const exported = (await db.query(`select public.get_archive_export('${prepared.id}') pack`)).rows[0].pack;
  assert.equal(exported.sales.length, 4);
  assert.equal(exported.sale_items.length, 4);
  assert.equal(exported.shifts.length, 2);
  assert.ok(exported.sales.some((row) => row.status === 'voided'));
  assert.ok(exported.sales.some((row) => row.id === oldSale));
  assert.ok(!exported.sales.some((row) => row.id === recentSale));
  assert.equal(exported.manifest.sales_row_count, 4);
  assert.equal(Number(exported.manifest.revenue_total), 640);
  assert.equal(Number(exported.manifest.export_format_version), 2);
  assert.equal(Number(exported.archive.export_format_version), 2);
  assert.match(exported.manifest.package_name, /^golden-ribbon-archive-/);

  const voidItem = exported.sale_items.find((row) => row.sale_id === voidSale);
  assert.ok(voidItem?.void_history?.length >= 1, 'export preserves sale_items.void_history');
  assert.equal(Number(voidItem.void_history[0].quantity), 1);
  assert.equal(Number(voidItem.void_history[0].amount), 80);
  assert.equal(voidItem.void_history[0].reason, 'Customer changed mind');
  assert.equal(voidItem.void_history[0].note, 'Wanted different size');
  assert.equal(voidItem.void_history[0].cashier_id, cashier1);
  assert.ok(voidItem.void_history[0].at);

  assert.equal(exported.void_events?.length, 1);
  assert.equal(exported.void_events[0].void_event_id, voidEventId);
  assert.equal(exported.void_events[0].actor_id, cashier1);
  assert.equal(exported.void_events[0].actor_name, 'Cashier 1');
  assert.equal(Number(exported.manifest.void_event_row_count), 1);

  const { buildArchiveFiles, saveArchivePackage } = loadTs('src/lib/archiveExport.ts', {
    'react-native': { Platform: { OS: 'ios' }, Share: { share: async () => ({ action: 'sharedAction' }) } },
  });
  const files = buildArchiveFiles(exported);
  assert.ok(files.some((file) => file.name === 'void_events.csv' && file.content.includes(voidEventId)));
  assert.ok(files.some((file) => file.name === 'sale_items.csv' && file.content.includes('void_history')));
  assert.ok(files.some((file) => file.name === 'sale_items.csv' && file.content.includes('Customer changed mind')));

  const offer = await saveArchivePackage(exported);
  assert.equal(offer.delivery, 'share_sheet_opened');
  assert.match(offer.message, /share sheet was opened/i);
  assert.doesNotMatch(offer.message, /^Saved /);
  assert.ok(offer.fileNames.includes('void_events.csv'));

  // Stale pre-void-history export format cannot verify or clean.
  await db.exec('reset role');
  await db.exec(`
    update public.data_archives
    set export_format_version = 1, status = 'exported', verified_at = null
    where id = '${prepared.id}'
  `);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await assert.rejects(
    db.query(`select public.verify_sales_archive('${prepared.id}')`),
    /fresh archive backup that includes void history/,
  );
  await db.exec('reset role');
  await db.exec(`
    update public.data_archives
    set export_format_version = 1, status = 'verified', verified_at = now()
    where id = '${prepared.id}'
  `);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await assert.rejects(
    db.query(`select public.cleanup_archived_sales('${prepared.id}','DELETE ARCHIVED DATA')`),
    /fresh archive backup that includes void history/,
  );
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${oldSale}'`)).rows[0].n, 1);

  // Restore current void-history export stamp for the remainder of the flow.
  await db.exec('reset role');
  await db.exec(`
    update public.data_archives
    set export_format_version = 2, status = 'exported', verified_at = null
    where id = '${prepared.id}'
  `);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);

  await db.exec('reset role');
  await db.exec(`update public.data_archives set sales_count = sales_count + 1 where id = '${prepared.id}'`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await assert.rejects(
    db.query(`select public.verify_sales_archive('${prepared.id}')`),
    /verification failed/,
  );
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${oldSale}'`)).rows[0].n, 1);

  await db.exec('reset role');
  await db.exec(`update public.data_archives set sales_count = 4, status = 'exported' where id = '${prepared.id}'`);
  await db.exec(`update public.daily_branch_sales_summary set revenue = revenue + 1 where business_date = '${dates.old_date}'::date`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await assert.rejects(
    db.query(`select public.verify_sales_archive('${prepared.id}')`),
    /verification failed/,
  );
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${oldSale}'`)).rows[0].n, 1);

  await db.exec('reset role');
  await db.exec(`update public.daily_branch_sales_summary set revenue = 640 where business_date = '${dates.old_date}'::date`);
  await db.exec(`update public.data_archives set status = 'exported' where id = '${prepared.id}'`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);

  // Fail closed: unresolved pending Cash/GCash remittance still depends on live sales.
  await assert.rejects(
    db.query(`select public.verify_sales_archive('${prepared.id}')`),
    /still need remittance|Expected Cash\/GCash/,
  );
  await db.exec('reset role');
  await db.exec(`
    update public.data_archives
    set status = 'verified', verified_at = now()
    where id = '${prepared.id}'
  `);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  await assert.rejects(
    db.query(`select public.cleanup_archived_sales('${prepared.id}','DELETE ARCHIVED DATA')`),
    /still need remittance|Expected Cash\/GCash/,
  );
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${pendingCashSale}'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${pendingGcashSale}'`)).rows[0].n, 1);
  await db.exec('reset role');
  await db.exec(`
    update public.data_archives
    set status = 'exported', verified_at = null
    where id = '${prepared.id}'
  `);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);

  await db.exec('reset role');
  await db.exec(`
    insert into public.shift_reconciliations(
      shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by, expected_gcash, actual_gcash
    ) values ('${pendingShift}', '${branch1}', 160, 160, 0, 'exact', '${cashier2}', 80, 80);
  `);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);

  const remittedPending = (
    await db.query(`select public.report_branch_shift_remittances(null, 'all_time', null, null) result`)
  ).rows[0].result;
  const remittedRow = (remittedPending.days ?? [])
    .flatMap((day) => day.shifts ?? [])
    .find((row) => row.shift_id === pendingShift);
  assert.equal(remittedRow.status, 'reconciled');
  assert.equal(Number(remittedRow.expected_cash), 160);
  assert.equal(Number(remittedRow.expected_gcash), 80);

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
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${pendingCashSale}'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${pendingGcashSale}'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${recentSale}'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.sales where id = '${todaySale}'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.shifts where id = '${oldShift}'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.shifts where id = '${pendingShift}'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.shifts where id = '${recentShift}'`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int as n from public.shifts where id = '${openShift}'`)).rows[0].n, 1);
  assert.equal(
    (await db.query(`select count(*)::int as n from public.shift_reconciliations where shift_id = '${oldShift}'`)).rows[0].n,
    1,
    'remittance retained after sales cleanup',
  );
  assert.equal(
    (await db.query(`select count(*)::int as n from public.shift_reconciliations where shift_id = '${pendingShift}'`)).rows[0].n,
    1,
    'pending remittance retained after sales cleanup',
  );
  assert.equal(
    (await db.query(`select count(*)::int as n from public.shift_waste_occurrences where shift_id = '${oldShift}'`)).rows[0].n,
    1,
    'waste retained after sales cleanup',
  );

  const afterCleanupRemit = (
    await db.query(`select public.report_branch_shift_remittances(null, 'all_time', null, null) result`)
  ).rows[0].result;
  const afterPending = (afterCleanupRemit.days ?? [])
    .flatMap((day) => day.shifts ?? [])
    .find((row) => row.shift_id === pendingShift);
  assert.equal(Number(afterPending.expected_cash), 160, 'reconciled expected cash stays without live sales');
  assert.equal(Number(afterPending.expected_gcash), 80, 'reconciled expected gcash stays without live sales');

  assert.equal((await db.query('select count(*)::int as n from public.inventory_movements')).rows[0].n, beforeMovements);
  assert.equal((await db.query('select count(*)::int as n from public.stock_transfers')).rows[0].n, beforeTransfers);
  assert.equal((await db.query('select count(*)::int as n from public.products')).rows[0].n, 1);
  assert.equal(Number((await db.query(`select quantity_on_hand from public.branch_inventory where product_id='${chicken}'`)).rows[0].quantity_on_hand), 87);

  const recon = (await db.query('select public.report_inventory_reconciliation(null) result')).rows[0].result;
  const chickenRow = recon.find((row) => row.product_id === chicken && row.branch_id === branch1);
  assert.equal(Number(chickenRow.variance), 0);

  const oldRange = (await db.query(
    `select public.report_sales_by_branch('custom', $1::timestamptz, $2::timestamptz) result`,
    [`${dates.old_date}T00:00:00+08:00`, `${dates.old_next}T00:00:00+08:00`],
  )).rows[0].result;
  const oldBranch = oldRange.find((row) => row.branch_id === branch1);
  assert.equal(Number(oldBranch.transaction_count), 3);
  assert.equal(Number(oldBranch.total_sales), 640);

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
  assert.equal(Number(crossBranch.transaction_count), 5);
  assert.equal(Number(crossBranch.total_sales), 1040);

  const products = (await db.query(
    `select public.report_product_sales('custom', null, $1::timestamptz, $2::timestamptz) result`,
    [`${dates.old_date}T00:00:00+08:00`, `${dates.tomorrow}T00:00:00+08:00`],
  )).rows[0].result;
  const productRow = products.find((row) => row.product_id === chicken);
  assert.equal(Number(productRow.quantity_sold), 13);
  assert.equal(Number(productRow.total_revenue), 1040);

  const performance = (await db.query(
    `select public.report_branch_performance('custom', $1::timestamptz, $2::timestamptz) result`,
    [`${dates.old_date}T00:00:00+08:00`, `${dates.tomorrow}T00:00:00+08:00`],
  )).rows[0].result;
  const perfRow = performance.find((row) => row.branch_id === branch1);
  assert.equal(Number(perfRow.transaction_count), 5);
  assert.equal(Number(perfRow.quantity_sold), 13);
  assert.equal(Number(perfRow.total_sales), 1040);

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

  const cleanedHistory = (
    await db.query(
      `select status, export_format_version, cleaned_at is not null as has_cleaned_at
       from public.data_archives where id = $1`,
      [prepared.id],
    )
  ).rows[0];
  assert.equal(cleanedHistory.status, 'cleaned');
  assert.equal(Number(cleanedHistory.export_format_version), 2);
  assert.equal(cleanedHistory.has_cleaned_at, true);

  // Migration-style invalidation must not rewrite cleaned archive history.
  await db.exec('reset role');
  await db.exec(`
    update public.data_archives
    set status = 'prepared', export_generated_at = null, verified_at = null, export_format_version = 1
    where status in ('exported', 'verified')
  `);
  const cleanedAfterInvalidate = (
    await db.query(`select status, export_format_version from public.data_archives where id = $1`, [prepared.id])
  ).rows[0];
  assert.equal(cleanedAfterInvalidate.status, 'cleaned');
  assert.equal(Number(cleanedAfterInvalidate.export_format_version), 2);
});

// Multiple historical failed rows + one open archive: reset only the open exported/verified row.
{
  const failedA = id(91);
  const failedB = id(92);
  const openArchive = id(93);
  await db.exec(`
    insert into public.data_archives(
      id, period_start, period_end, status,
      sales_count, sale_items_count, shift_count, revenue_total, units_sold,
      export_generated_at, verified_at, export_format_version
    ) values
      (
        '${failedA}',
        ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') - interval '40 days',
        ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') - interval '30 days',
        'failed', 1, 1, 0, 80, 1, now() - interval '20 days', null, 1
      ),
      (
        '${failedB}',
        ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') - interval '29 days',
        ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') - interval '20 days',
        'failed', 2, 2, 0, 160, 2, now() - interval '15 days', null, 1
      ),
      (
        '${openArchive}',
        ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') - interval '19 days',
        ('${dates.old_date}'::date::timestamp at time zone 'Asia/Manila') - interval '10 days',
        'verified', 3, 3, 1, 240, 3, now() - interval '5 days', now() - interval '4 days', 1
      );
  `);

  await db.exec(`
    update public.data_archives
    set status = 'prepared', export_generated_at = null, verified_at = null, export_format_version = 1
    where status in ('exported', 'verified')
  `);

  const afterReset = (
    await db.query(`
      select id, status, export_generated_at, verified_at, export_format_version
      from public.data_archives
      where id in ('${failedA}', '${failedB}', '${openArchive}')
      order by id
    `)
  ).rows;
  const byId = Object.fromEntries(afterReset.map((row) => [row.id, row]));
  assert.equal(byId[failedA].status, 'failed');
  assert.equal(byId[failedB].status, 'failed');
  assert.ok(byId[failedA].export_generated_at);
  assert.ok(byId[failedB].export_generated_at);
  assert.equal(byId[openArchive].status, 'prepared');
  assert.equal(byId[openArchive].export_generated_at, null);
  assert.equal(byId[openArchive].verified_at, null);
  assert.equal(Number(byId[openArchive].export_format_version), 1);

  const openCount = (
    await db.query(`
      select count(*)::int as n from public.data_archives
      where status in ('prepared', 'exported', 'verified')
    `)
  ).rows[0].n;
  assert.equal(openCount, 1, 'only one open archive after reset with multiple failed rows present');

  // Document why failed must stay failed: promoting multiple failed rows to prepared violates the open-archive unique index.
  await assert.rejects(
    db.exec(`
      update public.data_archives
      set status = 'prepared'
      where status = 'failed'
    `),
    /data_archives_one_open_idx|unique/i,
  );
  assert.equal(
    (await db.query(`select count(*)::int as n from public.data_archives where id in ('${failedA}','${failedB}') and status = 'failed'`))
      .rows[0].n,
    2,
  );
}

await asUser(owner, async () => {
  await assert.rejects(db.query('select public.prepare_sales_archive()'), /older than 90 days/);
});

console.log('milestone 11.3 archive tests passed');
