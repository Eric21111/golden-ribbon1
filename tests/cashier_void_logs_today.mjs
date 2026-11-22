// Cashier Void logs: only the cashier's OWN voids (the server limits the rows to the sales they rang up; tests/cashier_item_voids.mjs
// proves another cashier gets none) and only TODAY's (Manila day). Before, a cashier opened Void logs on "All Time" and saw 11/16 and
// 11/17. The day limit is applied on the screen; the Owner and Main Manager keep every range.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ---- the rows a cashier gets: the Manila day, nothing older
const { voidLogTimeBounds, voidLogsInRange } = loadTs('src/features/reports/voidLogs.ts');
const { getTodayRangeManila } = loadTs('src/lib/format.ts');
const today = getTodayRangeManila();
const startMs = Date.parse(today.start);
const row = (id, at) => ({ event_id: id, recorded_at: new Date(at).toISOString(), sale_number: 'S', product_name: 'P', branch_name: 'B', cashier_name: 'C', quantity: 1, amount: 10, reason: 'Wrong item' });
const rows = [
  row('today-late', startMs + 20 * 3600 * 1000),
  row('today-first-minute', startMs + 60 * 1000),
  row('yesterday-last-minute', startMs - 60 * 1000),
  row('last-week', startMs - 6 * 24 * 3600 * 1000),
];
assert.deepEqual(voidLogsInRange(rows, voidLogTimeBounds(today)).map((r) => r.event_id), ['today-late', 'today-first-minute'], 'only the Manila day');

// ---- the screen
const screen = read('src/features/reports/VoidLogsScreen.tsx');
assert.match(screen, /const isCashier = profile\?\.role === 'cashier';/);
assert.match(screen, /const scopedData = useMemo\(\(\) => \(isCashier \? voidLogsInRange\(scoped\.rows, todayBounds\) : scoped\.rows\)/, 'a cashier\'s list is cut to today before anything else uses it');
assert.match(screen, /const bounds = isCashier \? todayBounds : rangeBounds\(/, 'whatever range state there is, a cashier gets today');
assert.match(screen, /\{isCashier \? null : \(\s*<DateRangeFilter/, 'no date range pills for a cashier');
assert.match(screen, /isCashier \? \[reasonRow\] : \[cashierRow, reasonRow\]/, 'no Cashier filter row (it is always themselves)');
assert.match(screen, /isCashier \? 'Today' :/, 'the header says Today');
assert.match(screen, /'No voids today'/);
// the Owner and the Main Manager are unchanged: every range, every cashier
assert.match(screen, /isCashier \? todayBounds : rangeBounds\(rangeType, customStart, customEnd\)/);
assert.match(read('app/(cashier)/cashier/stock-corrections.tsx'), /VoidLogsScreen/, 'the cashier route shows this screen');

// ---- the server rule the screen relies on (not changed here)
const migration = read('supabase/migrations/20261117210000_void_logs_product_category_variant.sql');
assert.match(migration, /viewer\.role = 'cashier' and viewer\.branch_id = s\.branch_id and viewer\.id = s\.cashier_id/, 'a cashier: their own sales, in their own branch');
assert.match(read('tests/cashier_item_voids.mjs'), /\[\[cashier,1\],\[otherCashier,0\],\[manager,1\],\[owner,1\]\]/, 'proved in the database test: another cashier sees none');
console.log('Cashier void logs passed: own voids only (server), today only (screen), no date range or cashier filter for a cashier.');

// ---- the date is the VOID's own time, not the sale's: a sale rung up last week and voided today is in "Today"
{
  const migration = readFileSync('supabase/migrations/20261117210000_void_logs_product_category_variant.sql', 'utf8').replace(/\r\n/g, '\n');
  assert.match(migration, /\(v->>'at'\)::timestamptz,/, 'recorded_at is the time inside the void event (void_history.at)');
  assert.doesNotMatch(migration, /recorded_at[^\n]*sold_at|s\.sold_at|s\.created_at/, 'never the sale date');
  for (const file of ['src/features/reports/voidLogs.ts', 'src/features/reports/VoidLogsScreen.tsx', 'src/features/reports/VoidLogsOverviewScreen.tsx', 'src/features/reports/voidLogData.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /sold_at/, `${file}: no sale date is used to filter voids`);
  }
}

// ---- Manila midnight, with the app left open: "today" moves with the clock (UTC+8, no daylight saving)
{
  const realNow = Date.now;
  const manila = (iso) => Date.parse(`${iso}+08:00`);
  const bounds = (nowIso) => {
    Date.now = () => manila(nowIso);
    try { return voidLogTimeBounds(getTodayRangeManila()); } finally { Date.now = realNow; }
  };
  const lateEvening = bounds('2026-11-22T23:59:30');
  const justAfter = bounds('2026-11-23T00:00:30');
  assert.equal(lateEvening.start, manila('2026-11-22T00:00:00'));
  assert.equal(lateEvening.end, manila('2026-11-23T00:00:00'));
  assert.equal(justAfter.start, manila('2026-11-23T00:00:00'), 'after midnight "today" is the new day');
  const voidAt = (iso) => row(iso, manila(iso));
  const voids = [voidAt('2026-11-22T23:59:00'), voidAt('2026-11-23T00:00:00'), voidAt('2026-11-23T00:00:30')];
  assert.deepEqual(voidLogsInRange(voids, lateEvening).map((r) => r.event_id), ['2026-11-22T23:59:00'], 'a void at 23:59 belongs to the old day');
  assert.deepEqual(voidLogsInRange(voids, justAfter).map((r) => r.event_id), ['2026-11-23T00:00:00', '2026-11-23T00:00:30'], 'a void at exactly 00:00 belongs to the new day; the old day\'s drops out');
}

// ---- the screens follow the clock while they stay open
{
  const list = readFileSync('src/features/reports/VoidLogsScreen.tsx', 'utf8').replace(/\r\n/g, '\n');
  const overview = readFileSync('src/features/reports/VoidLogsOverviewScreen.tsx', 'utf8').replace(/\r\n/g, '\n');
  for (const [name, source] of [['list', list], ['overview', overview]]) {
    assert.match(source, /useManilaDayRefresh\(\(\) => \{\s*setDayKey\(manilaBusinessDate\(\)\);/, `${name}: the Manila date is refreshed at midnight and on returning to the app`);
    assert.match(source, /refetch\(\)/);
  }
  assert.match(list, /useMemo\(\(\) => voidLogTimeBounds\(getTodayRangeManila\(\)\), \[dayKey\]\)/, 'a cashier\'s "today" is re-cut when the day changes');
  assert.match(list, /isCashier, todayBounds, dayKey\]\);/, 'and so is the filtered list (Today / this week / this month for the others)');
  assert.match(overview, /\[rangeType, startIso, endIso, dayKey\]/, 'the Overview\'s range too');
  const hook = readFileSync('src/hooks/useManilaDayRefresh.ts', 'utf8');
  assert.match(hook, /AppState\.addEventListener\('change'/, 'including when the app comes back to the foreground after midnight');
}

// ---- who sees what (the rows come from the server rule; the screen only narrows a cashier)
{
  const list = readFileSync('src/features/reports/VoidLogsScreen.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.match(list, /isCashier \? \[reasonRow\] : \[cashierRow, reasonRow\]/, 'Owner and Main Manager keep the Cashier filter; a cashier does not');
  assert.match(list, /isCashier \? null : \(\s*<DateRangeFilter/, 'Owner and Main Manager keep the date range; a cashier does not');
  const sql = readFileSync('supabase/migrations/20261117210000_void_logs_product_category_variant.sql', 'utf8');
  assert.match(sql, /viewer\.role = 'owner'/, 'Owner: every branch');
  assert.match(sql, /viewer\.role = 'manager' and \(public\.is_main_branch_manager\(\) or viewer\.branch_id = s\.branch_id\)/, 'Main Manager: every branch; any other manager: their own branch');
  for (const file of ['app/(owner)/owner/reports/void-logs/index.tsx', 'app/(manager)/manager/reports/void-logs/index.tsx', 'app/(owner)/owner/reports/void-logs/[branchId].tsx', 'app/(manager)/manager/reports/void-logs/[branchId].tsx', 'app/(cashier)/cashier/stock-corrections.tsx']) {
    assert.ok(readFileSync(file, 'utf8').length > 0, file);
  }
}

// ---- after a sales archive: the archive deletes the sales and their items, and void_history lives on the items
{
  const cleanup = readFileSync('supabase/migrations/20261117120000_archive_fresh_export_required.sql', 'utf8');
  assert.match(cleanup, /delete from public\.sale_items si\s+using public\.sales s[\s\S]*?delete from public\.sales s/, 'cleanup deletes sale_items and sales of the archived period');
  const logs = readFileSync('supabase/migrations/20261117210000_void_logs_product_category_variant.sql', 'utf8');
  assert.match(logs, /join public\.sale_items i on i\.sale_id = s\.id and i\.void_history <> '\[\]'::jsonb/, 'Void logs are read from sale_items.void_history');
  console.log('LIMITATION (documented, not changed): once old sales are archived and cleaned, their voids leave Void logs; they stay in the exported archive package (void_events).');
}
console.log('Void logs access and dates passed for Cashier, Main Manager and Owner.');
