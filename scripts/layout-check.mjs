// Browser layout check of the shared cards. Run from the project root:   node scripts/layout-check.mjs
//
// It renders each card with react-native-web and the app's Inter fonts at 320 / 360dp and system font scales 1 / 1.3 / 2, opens the
// page in headless Edge (or Chrome) and measures what the browser laid out:
//   - text cut off by a line limit, a long word wider than its box, an amount that wraps across lines,
//   - a figure that would have to shrink below 60% (what adjustsFontSizeToFit does on Android) - the worst shrink is printed per case,
//   - anything that sticks out of the card on the right.
// It is NOT a device test: Android uses Yoga, the browser uses CSS flexbox. They agree on these layouts, but a real phone is still the
// last word. Exits 1 when a case that is not marked "informational" has an issue; exits 0 with a note when no browser is found.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const { loadTs } = await import(pathToFileURL(path.join(root, 'tests/_load_ts.mjs')).href);
const require = createRequire(path.join(root, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const h = React.createElement;

let dims = { width: 360, height: 800, fontScale: 1, scale: 2 };
const CapContext = React.createContext(undefined);

// react-native-web has no system font scale: this Text applies it (and maxFontSizeMultiplier, inherited by nested Text)
function ScaledText(props) {
  const parentCap = React.useContext(CapContext);
  const cap = props.maxFontSizeMultiplier ?? parentCap;
  const flat = rnw.StyleSheet.flatten(props.style) || {};
  const scale = Math.min(dims.fontScale, cap ?? Infinity);
  const style = { ...flat, fontSize: (flat.fontSize ?? 14) * scale };
  if (flat.lineHeight != null) style.lineHeight = flat.lineHeight * scale;
  if (flat.minHeight != null) style.minHeight = flat.minHeight * scale;
  const dataSet = { ...(props.dataSet || {}) };
  if (props.adjustsFontSizeToFit) dataSet.fit = String(props.minimumFontScale ?? 0);
  if (props.numberOfLines) dataSet.lines = String(props.numberOfLines);
  return h(
    CapContext.Provider,
    { value: cap },
    h(rnw.Text, { ...props, style, dataSet, adjustsFontSizeToFit: undefined, minimumFontScale: undefined, maxFontSizeMultiplier: undefined }),
  );
}
// there is no onLayout while rendering to a string: the measured-width state (useState(0)) is seeded with the card width
const seededReact = {
  ...React,
  useState: (initial) => [initial === 0 ? dims.width - 40 : typeof initial === 'function' ? initial() : initial, () => {}],
};
const stubs = {
  react: seededReact,
  'react-native': { ...rnw, Text: ScaledText, useWindowDimensions: () => dims },
  '@react-native-vector-icons/ionicons': {
    __esModule: true,
    default: (p) => h('i', { style: { display: 'inline-block', width: p.size ?? 16, height: p.size ?? 16, background: '#cbd5e1', borderRadius: 4 } }),
  },
  'expo-linear-gradient': {
    LinearGradient: (p) => h(rnw.View, { style: [p.style, { backgroundImage: 'linear-gradient(135deg,#0A1224,#1E3A8A)' }] }, p.children),
  },
};
const mod = (file) => loadTs(file, stubs);
const { StatTilePair } = mod('src/components/dashboard/StatTilePair.tsx');
const { StatTile } = mod('src/components/dashboard/StatTile.tsx');
const { SummaryCard } = mod('src/components/dashboard/SummaryCard.tsx');
const { RecentSaleRow } = mod('src/components/dashboard/RecentSaleRow.tsx');
const { NavTile } = mod('src/components/dashboard/NavTile.tsx');
const { ManagerActionButton } = mod('src/components/dashboard/ManagerActionButton.tsx');
const { ListRowCard } = mod('src/components/dashboard/ListRowCard.tsx');
const { RouteBanner } = mod('src/components/dashboard/RouteBanner.tsx');
const { TodayLogList } = mod('src/features/reports/TodayLogList.tsx');
const { TransferListItem } = mod('src/features/transfers/TransferListItem.tsx');

const act = (id, action, name, role, branch, detail) => ({
  id, action, occurred_at: '2026-11-22T08:51:00Z', actor_id: id, actor_name: name, actor_role: role, branch_id: id, branch_name: branch, detail,
});
const pair = (compact, left, right) => () => h(StatTilePair, { compact, left, right });

// [name, page padding on each side, render, informational]  (informational: reported, but does not fail the run)
const cases = [
  ["Manager: Today's Sales ₱350.00 + Products in stock", 24, pair(false, { emphasis: true, icon: 'cash-outline', label: "Today's Sales", value: '₱350.00' }, { icon: 'cube-outline', label: 'Products in stock', value: 48 })],
  ["Manager: Today's Sales ₱1,802.50 + Products in stock", 24, pair(false, { emphasis: true, icon: 'cash-outline', label: "Today's Sales", value: '₱1,802.50' }, { icon: 'cube-outline', label: 'Products in stock', value: 48 })],
  ["Manager: Today's Sales ₱1,234,567.89", 24, pair(false, { emphasis: true, icon: 'cash-outline', label: "Today's Sales", value: '₱1,234,567.89' }, { icon: 'cube-outline', label: 'Products in stock', value: 1812 })],
  ['Manager: Pending incoming + Returns in transit', 24, pair(false, { icon: 'download-outline', label: 'Pending incoming', value: 3 }, { icon: 'return-up-back-outline', label: 'Returns in transit', value: 1 })],
  ['Cashier: Total sales ₱2,450.00 + Orders', 24, pair(false, { emphasis: true, icon: 'cash-outline', label: 'Total sales', value: '₱2,450.00' }, { icon: 'receipt-outline', label: 'Orders', value: 37 })],
  ['Owner Quickview: SM1 ₱9,420.00 + SM2 ₱2,382.50', 24, pair(true, { icon: 'storefront-outline', label: 'SM1', value: '₱9,420.00' }, { icon: 'storefront-outline', label: 'SM2', value: '₱2,382.50' })],
  ['Owner Quickview: ₱1,234,567.89 + ₱0.00', 24, pair(true, { icon: 'storefront-outline', label: 'SM1', value: '₱1,234,567.89' }, { icon: 'storefront-outline', label: 'Inactive · A very long branch name', value: '₱0.00' })],
  ['Report: Pending / Reconciled shifts', 20, pair(true, { icon: 'hourglass-outline', label: 'Pending shifts', value: 4 }, { icon: 'checkmark-circle-outline', label: 'Reconciled shifts', value: 12 })],
  ['Report: Cash / GCash remitted ₱123,456.00', 20, pair(true, { icon: 'cash-outline', label: 'Cash remitted', value: '₱123,456.00', valueNumberOfLines: 2 }, { icon: 'phone-portrait-outline', label: 'GCash remitted', value: '₱8,000.00', valueNumberOfLines: 2 })],
  ['Hero: Total remitted ₱10,000,000.00', 20, () => h(StatTile, { layout: 'wide', emphasis: true, icon: 'wallet-outline', label: 'Total remitted collections', value: '₱10,000,000.00', valueNumberOfLines: 2 })],
  ['SummaryCard: long label + ₱1,234,567.89', 20, () => h(SummaryCard, { title: 'PRICING PROGRAM', rows: [{ label: 'Employee meal · 12 orders (discounted)', value: '₱1,234,567.89' }, { label: 'Standard', value: '₱350.00', emphasis: true }] })],
  ['RecentSaleRow: long cashier + big amount', 20, () => h(RecentSaleRow, { saleNumber: 'SM1-000123', amount: '₱1,234,567.89', cashierName: 'Maria Cristina Dela Cruz-Santos', date: 'Nov 22, 2026, 4:51 PM' })],
  ['NavTile: long title + count', 20, () => h(NavTile, { title: 'Transfer & Return Issues awaiting review', description: 'Missing or excess quantities that need a decision', icon: 'alert-circle-outline', value: 1250, onPress() {} })],
  ['ManagerActionButton: long label', 20, () => h(ManagerActionButton, { label: 'Confirm shipment arrival and report differences', onPress() {} })],
  ['ListRowCard: 55-character product name (2-line limit is intended)', 20, () => h(ListRowCard, { icon: 'cube-outline', title: 'Chicken Barbecue Sandwich with Extra Sauce and Rice Meal', subtitle: 'SKU CBS-0012 · 1,200 pcs on hand', trailing: h(rnw.Text, null, '₱1,234,567.89') }), true],
  ['RouteBanner: long branch names', 20, () => h(RouteBanner, { from: { label: 'Main Branch Commissary Kitchen', isMain: true }, to: { label: 'SM City North EDSA Annex', isMain: false }, connectorIcon: 'arrow-forward' })],
  ['TransferListItem: long branch names', 20, () => h(TransferListItem, { transfer: { id: 't', transfer_number: 'TR-000089', status: 'in_transit', sent_at: '2026-11-22T08:51:00Z', created_at: '2026-11-22T08:00:00Z', from_branch: { name: 'Main Branch Commissary Kitchen' }, to_branch: { name: 'SM City North EDSA Annex' }, items: new Array(1250).fill({}) }, onPress() {} })],
  ['TodayLogList: long names', 20, () => h(TodayLogList, { activities: [act('1', 'transfer_received', 'BRANCH-1 Cashier SHIELA AND LEXI', 'cashier', 'SM1', { reference: 'TR-000088', counterpart_branch_name: 'Main Branch', item_count: 1250, with_issue: true }), act('2', 'shift_ended', 'Ana', 'cashier', 'SM2', { possibly_automatic: true })] })],
];
const phones = [320, 360];
const scales = [1, 1.3, 2];

const blocks = [];
const meta = [];
for (const [name, pad, render, informational] of cases) {
  for (const phone of phones) {
    for (const fontScale of scales) {
      const col = phone - pad * 2;
      dims = { width: col + 40, height: 800, fontScale, scale: 2 };
      const id = `c${meta.length}`;
      meta.push({ id, name, phone, fontScale, col, informational: Boolean(informational) });
      blocks.push(`<div class="case" id="${id}" style="width:${col}px">${renderToStaticMarkup(render())}</div>`);
    }
  }
}
const css = rnw.StyleSheet.getSheet().textContent;
const fontDir = pathToFileURL(path.join(root, 'node_modules/@expo-google-fonts/inter') + path.sep).href;
const faces = [['Inter_400Regular', '400Regular'], ['Inter_500Medium', '500Medium'], ['Inter_600SemiBold', '600SemiBold'], ['Inter_700Bold', '700Bold']]
  .map(([family, dir]) => `@font-face{font-family:${family};src:url("${fontDir}${dir}/${family}.ttf")}`)
  .join('');
const script = `
const META = ${JSON.stringify(meta)};
function run() {
  const out = [];
  for (const m of META) {
    const box = document.getElementById(m.id);
    const issues = [];
    let worstShrink = 1;
    for (const el of box.querySelectorAll('div[dir="auto"], span[dir="auto"]')) {
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
      const isAmount = /^[₱\\d,.\\s-]+$/.test(text);
      const r = el.getBoundingClientRect();
      if (el.dataset.fit !== undefined) {
        const need = Math.min(1, el.clientWidth / Math.max(el.scrollWidth, 1));
        worstShrink = Math.min(worstShrink, need);
        if (need < 0.6) issues.push('figure "' + text + '" needs ' + Math.round(need * 100) + '% (below the 60% floor: it would be clipped)');
      } else if (el.dataset.lines) {
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) issues.push('cut by numberOfLines=' + el.dataset.lines + ': "' + text.slice(0, 40) + '"');
      } else if (isAmount && r.height > lh * 1.6) {
        issues.push('amount wraps over lines: "' + text + '"');
      } else if (el.scrollWidth > el.clientWidth + 1) {
        issues.push('text wider than its box: "' + text.slice(0, 40) + '"');
      }
    }
    const boxRect = box.getBoundingClientRect();
    for (const el of box.querySelectorAll('*')) {
      if (el.closest('[data-fit]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > boxRect.right + 1.5) { issues.push('sticks out of the card on the right by ' + Math.round(r.right - boxRect.right) + 'px: "' + (el.textContent || '').trim().slice(0, 30) + '"'); break; }
    }
    out.push({ ...m, height: Math.round(boxRect.height), worstShrink: Math.round(worstShrink * 100), issues });
  }
  document.getElementById('out').textContent = JSON.stringify(out);
}
document.fonts.ready.then(() => setTimeout(run, 300));
`;
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}body{margin:0;padding:8px;background:#fff}.case{margin:0 0 16px 0;background:#fafafa;outline:1px dashed #ccc;position:relative}${css}</style></head><body>${blocks.join('')}<pre id="out"></pre><script>${script}</script></body></html>`;
const file = path.join(mkdtempSync(path.join(tmpdir(), 'gr-layout-')), 'layout-check.html');
writeFileSync(file, page);

const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => existsSync(candidate));
if (!browser) {
  console.log('layout-check: no Edge or Chrome found; skipped. The page is at', file);
  process.exit(0);
}
const run = spawnSync(browser, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run', '--virtual-time-budget=15000', '--dump-dom', pathToFileURL(file).href], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  timeout: 120000,
});
const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout ?? '');
if (!match || !match[1].trim()) {
  console.log('layout-check: the browser gave no result (status', run.status, ')', (run.stderr ?? '').slice(0, 300));
  process.exit(1);
}
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const results = JSON.parse(decode(match[1]));
let lastName = '';
for (const r of results) {
  if (r.name !== lastName) { console.log(`\n${r.name}`); lastName = r.name; }
  const flag = r.issues.length ? (r.informational ? 'info ' : 'ISSUE') : 'ok   ';
  console.log(`  ${flag} ${r.phone}dp x${r.fontScale}  card ${r.col}dp wide, ${r.height}dp tall, worst figure shrink ${r.worstShrink}%` + (r.issues.length ? '\n        - ' + [...new Set(r.issues)].join('\n        - ') : ''));
}
const failing = results.filter((r) => r.issues.length && !r.informational);
const worst = Math.min(...results.map((r) => r.worstShrink));
console.log(`\n${results.length} layouts, ${failing.length} with issues, ${results.filter((r) => r.issues.length && r.informational).length} informational. Worst figure shrink needed: ${worst}%.`);
process.exit(failing.length ? 1 : 0);
