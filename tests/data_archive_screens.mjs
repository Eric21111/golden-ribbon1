// Data Archive: a short hub (two rows) -> Read notifications (a checklist) and Old sales details (three steps, one at a time).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const Pass = (p) => React.createElement('div', null, p.children);
const common = {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  '@/components/ConstrainedWidth': { ConstrainedWidth: Pass },
  '@/components/Screen': { Screen: Pass },
  '@/components/dashboard/ManagerBottomSheet': { ManagerBottomSheet: (p) => (p.visible ? React.createElement('aside', null, p.children) : null) },
  '@/components/dashboard/ManagerFeedback': {
    ErrorState: (p) => React.createElement('p', { 'data-error': p.message }),
    LoadingState: (p) => React.createElement('p', { 'data-loading': p.label }),
    EmptyState: (p) => React.createElement('p', { 'data-empty': p.title }, p.message),
  },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: (p) => React.createElement('h1', null, p.title) },
  '@/components/dashboard/theme': { managerColors: new Proxy({}, { get: () => '#000' }) },
  '@/lib/errors': { getArchiveErrorMessage: (e) => e.message, getErrorMessage: (e) => e.message },
  '@/lib/format': { formatDate: (v) => `D:${v}`, formatMoney: (v) => `P${v}` },
};

// ---- hub
let statusState;
let noticeState;
const pushed = [];
const Hub = loadTs('src/features/archive/DataArchiveScreen.tsx', {
  ...common,
  'expo-router': { router: { push: (h) => pushed.push(h) } },
  '@/components/dashboard/ListRowCard': { ListRowCard: (p) => React.createElement('section', { 'data-row': p.title, onClick: p.onPress }, p.title, '|', p.subtitle, '|', p.meta, '|', p.trailing) },
  '@/components/dashboard/ManagerBadge': { ManagerBadge: (p) => React.createElement('em', null, p.label) },
  '@/hooks/useArchive': { useArchiveStatus: () => statusState },
  './readNotices': { READ_NOTICE_PAGE: 50, useReadNoticePreview: () => noticeState },
  './ArchiveInfoButton': { ArchiveInfoButton: (p) => React.createElement('button', { 'aria-label': p.label }) },
}).DataArchiveScreen;
statusState = { data: { estimated_records: 1200, retention_days: 90, archive_due: true, last_successful_archive_at: null }, isRefetching: false, refetch() {} };
noticeState = { data: new Array(50).fill({}), isPending: false, isError: false, isRefetching: false, refetch() {} };
let text = flat(renderToStaticMarkup(React.createElement(Hub)));
assert.match(text, /Data Archive\|CLEANUP OPTIONS/);
assert.match(text, /Read notifications\|50\+ can be removed/, 'a count, not a button');
assert.match(text, /Old sales details\|1,200 to remove\|Retention 90 days · Last archive never\|Cleanup due/);
assert.doesNotMatch(text, /Export → Save Copy|Generate export|Delete archived/, 'none of the controls are on the hub');
statusState = { ...statusState, data: { ...statusState.data, archive_due: false, estimated_records: 0 } };
noticeState = { ...noticeState, data: [] };
text = flat(renderToStaticMarkup(React.createElement(Hub)));
assert.match(text, /None to remove/);
assert.match(text, /Current/);

// ---- the three steps
let archiveState;
let flags;
const Sales = loadTs('src/features/archive/OldSalesDetailsScreen.tsx', {
  ...common,
  '@/components/FormField': { FormField: (p) => React.createElement('label', null, p.label, React.createElement('input', { defaultValue: p.value })) },
  '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => React.createElement('button', { 'data-label': p.label, 'data-disabled': String(Boolean(p.disabled)) }) },
  '@/components/dashboard/StatTile': { StatTile: (p) => React.createElement('div', { 'data-tile': p.label }, String(p.value)) },
  '@/components/dashboard/SummaryCard': { SummaryCard: (p) => React.createElement('div', { 'data-card': p.title ?? 'plain' }, p.rows.map((r) => `${r.label}=${r.value}`).join(';')) },
  '@/features/reports/OwnerSummaryKpiPair': { OwnerSummaryKpiPair: (p) => React.createElement('div', null, `${p.left.label}=${p.left.value}`, '|', `${p.right.label}=${p.right.value}`) },
  '@/hooks/useArchive': {
    useArchiveStatus: () => ({ data: archiveState, isRefetching: false, refetch() {} }),
    usePrepareSalesArchive: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    useArchiveExport: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    useVerifySalesArchive: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    useCleanupArchivedSales: () => ({ isPending: false, mutateAsync: async () => ({}) }),
  },
  '@/lib/archiveExport': { saveArchivePackage: async () => ({ message: 'saved' }) },
  '@/types/models': { ARCHIVE_CLEANUP_CONFIRMATION: 'DELETE ARCHIVED DATA' },
  './ArchiveInfoButton': { ArchiveInfoButton: (p) => React.createElement('button', { 'aria-label': p.label }) },
}).OldSalesDetailsScreen;
const base = { retention_days: 90, archive_due: true, estimated_records: 12, eligible_sales_count: 5, eligible_sale_items_count: 9, eligible_shift_count: 2, oldest_detailed_sale_at: null, last_successful_archive_at: null, next_archive_recommended_at: 'n', database_size_bytes: 1024, active_archive: null };
const render = (over) => { archiveState = { ...base, ...over }; return renderToStaticMarkup(React.createElement(Sales)); };

let html = render({});
text = flat(html);
assert.match(text, /^\|Old sales details\|Old sales cleanup recommended\|[^|]*\|OVERVIEW\|/, 'the warning (when due), then the overview');
assert.match(html, /data-tile="Sales details to remove">12/);
assert.match(text, /Sales eligible=5\|Items eligible=9/);
assert.match(text, /Detailed sales retention=90 days;Oldest sale=None;Last archive=Never/);
assert.doesNotMatch(text, /Database size|Related shifts/, 'those live behind the (i) now');
assert.match(html, /aria-label="Step 1, Export, up next"/);
assert.match(html, /aria-label="Step 2, Verify, locked"/);
assert.match(html, /aria-label="Step 3, Confirm cleanup, locked"/);
assert.match(html, /data-label="Generate export" data-disabled="false"/, 'only the step that is up shows its button');
assert.doesNotMatch(html, /data-label="Verify export"|data-label="Delete archived sales details"/);
assert.match(text, /Export first/);
assert.match(text, /Verify first/);

html = render({ archive_due: false });
assert.match(html, /data-label="Generate export" data-disabled="true"/, 'nothing old enough to archive: the button is off, and the step says why');
assert.match(flat(html), /No detailed sales are older than 90 days yet/);

html = render({ active_archive: { id: 'a', status: 'prepared', export_generated_at: 'x', export_format_version: 2 } });
assert.match(html, /aria-label="Step 1, Export, done"/);
assert.match(html, /aria-label="Step 2, Verify, up next"/);
assert.match(html, /data-label="Verify export" data-disabled="true"/, 'verify needs the "I saved the backup" tick');
assert.match(html, /aria-label="I saved and checked the archive backup files"/);
assert.match(html, /aria-label="Generate the export again"/);
assert.match(html, /aria-label="Step 3, Confirm cleanup, locked"/);

html = render({ active_archive: { id: 'a', status: 'verified', export_generated_at: 'x', export_format_version: 2 } });
assert.match(html, /aria-label="Step 2, Verify, done"/);
assert.match(html, /aria-label="Step 3, Confirm cleanup, up next"/);
assert.match(html, /data-label="Delete archived sales details" data-disabled="true"/, 'still needs the typed phrase');
assert.match(flat(html), /Type DELETE ARCHIVED DATA/);

// ---- Read notifications (source: the checklist and the one footer button)
const notices = read('src/features/archive/ReadNoticesScreen.tsx');
assert.match(notices, /\{selected\.length > 0 \? \(\s*<View style=\{styles\.footer\}>/, 'the delete button only appears once something is ticked');
assert.match(notices, /Delete selected \(\$\{selected\.length\}\)/);
assert.doesNotMatch(notices, /label="Close"/, 'no Close button: the header has Back');
assert.match(notices, /No eligible read notifications/);
assert.match(notices, /rpc\('owner_cleanup_read_notices', \{ p_ids: ids \}\)/, 'the same RPC removes only the ticked ids');
assert.match(notices, /confirmAction\(/, 'still asks before deleting');
assert.match(read('src/features/archive/readNotices.ts'), /rpc\('owner_cleanup_read_notices', \{\}\)/, 'the preview deletes nothing');
for (const route of ['index', 'notifications', 'sales']) assert.ok(readFileSync(`app/(owner)/owner/data-archive/${route}.tsx`, 'utf8'));
console.log('Data archive screens passed.');
