// Create return and Local purchase: one list (search, category pills, category headings, a card per product with the stepper, a
// pinned summary + "Review" button), then a REVIEW screen (the notes live there; Back to edit | Confirm), then a done page.
// Nothing is sent before Confirm. Pure logic and real renders of the shared screens; the two screens are checked as wiring (they
// need a router, the query client and the auth provider to mount).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadTs } from './_load_ts.mjs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');

const stubs = {
  'react-native': rnw,
  '@react-native-vector-icons/ionicons': { __esModule: true, default: (p) => React.createElement('i', { 'data-icon': p.name }) },
  '@/components/FormField': { FormField: (p) => React.createElement('label', null, p.label, React.createElement('textarea', { value: p.value, readOnly: true, 'data-editable': String(p.editable !== false) })) },
  '@/components/Pagination': { Pagination: () => null },
  '@/components/Screen': { Screen: (p) => React.createElement('main', null, p.children) },
  '@/components/dashboard/ManagerActionButton': { ManagerActionButton: (p) => React.createElement('button', { disabled: p.disabled, 'data-variant': p.variant ?? 'primary', 'data-loading': String(p.loading) }, p.label) },
  '@/components/dashboard/ManagerFeedback': {
    EmptyState: (p) => React.createElement('div', null, `EMPTY:${p.title}:${p.message}`),
    ErrorState: (p) => React.createElement('div', null, `ERROR:${p.message}`),
    LoadingState: () => React.createElement('div', null, 'LOADING'),
  },
  '@/components/dashboard/ManagerScreenHeader': { ManagerScreenHeader: (p) => React.createElement('header', null, p.title, ' / ', p.subtitle) },
  '@/features/products/CategoryIcon': { CategoryIcon: (p) => React.createElement('i', { 'data-category': String(p.category) }) },
};
const list = loadTs('src/features/stock/QuantityListScreen.tsx', stubs);
const review = loadTs('src/features/stock/QuantityReviewScreens.tsx', stubs);
const flat = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

const R = (id, name, category, onHand, sku = name.toUpperCase().replace(/ /g, '-')) => ({ id, name, sku, category, onHand });
const rows = [R('1', 'Egg', 'supplies', 50), R('2', 'Coke Mismo', 'drinks', 50), R('3', 'Beef Curry', 'meals', 25), R('4', 'Bottled Water', 'drinks', 50), R('5', 'Mystery', null, 5)];

// ---------------------------------------------------------------- 1. which rows, in what order
{
  const names = (filtered) => filtered.map((r) => r.name);
  assert.deepEqual(names(list.filterQuantityRows(rows, '', 'all')), ['Beef Curry', 'Bottled Water', 'Coke Mismo', 'Egg', 'Mystery'], 'category groups in the usual order, A-Z inside each; no category last');
  assert.deepEqual(names(list.filterQuantityRows(rows, '', 'drinks')), ['Bottled Water', 'Coke Mismo'], 'a category pill');
  assert.deepEqual(names(list.filterQuantityRows(rows, 'coke', 'all')), ['Coke Mismo'], 'search by name');
  assert.deepEqual(names(list.filterQuantityRows(rows, 'BEEF-CURRY', 'all')), ['Beef Curry'], 'search by SKU');
  assert.deepEqual(names(list.filterQuantityRows(rows, 'drinks', 'all')), ['Bottled Water', 'Coke Mismo'], 'search by category name');
  assert.deepEqual(names(list.filterQuantityRows(rows, 'coke', 'meals')), [], 'pill and search combine');
  assert.equal(rows[0].name, 'Egg', 'the rows passed in are not reordered');
  console.log('1. rows: ok');
}

// ---------------------------------------------------------------- 2. the rendered list
{
  const base = {
    title: 'Create return', subtitle: 'SM 1 → Main Branch', rows, loading: false, loadError: null, onRetry() {}, quantities: {}, onQuantityChange() {},
    emptyTitle: 'No leftover stock', emptyMessage: 'Nothing here.', actionLabel: 'Review return', actionDisabled: true, actionLoading: false, onAction() {},
  };
  const render = (props) => renderToStaticMarkup(React.createElement(list.QuantityListScreen, { ...base, ...props }));

  const html = render({});
  const text = flat(html);
  assert.match(text, /Create return \/ SM 1 → Main Branch/);
  assert.match(text, /Meals &amp; Viands\|1\|Beef Curry\|BEEF-CURRY\|25 pcs\| on hand\|Qty\|/, 'category heading, then a card: name, SKU, on hand, Qty');
  assert.ok(text.indexOf('Meals') < text.indexOf('Drinks') && text.indexOf('Drinks') < text.indexOf('Inventory Supplies'), 'headings in the usual order');
  assert.match(html, /placeholder="Search name or SKU"/);
  assert.match(text, /All\|Meals\|Snacks\|Drinks\|Extras\|Supplies/, 'category pills');
  assert.equal((html.match(/data-category=/g) ?? []).length >= 5, true, 'a category icon on every card');
  assert.match(text, /Review return/, 'the button only goes on to the review');
  assert.doesNotMatch(text, /Notes|System stock|Enter how many|Quantity\|/, 'no notes here (they are on the review), no intro paragraph');
  assert.doesNotMatch(text, /total pcs/, 'no summary until something is entered');
  assert.equal((html.match(/aria-label="Decrease quantity for /g) ?? []).length, 5, 'a stepper per product');
  assert.doesNotMatch(html, /aria-label="All \d+ on hand/, 'no Max button unless asked for');
  assert.equal((render({ showMax: true }).match(/aria-label="All \d+ on hand for /g) ?? []).length, 5);

  // a ceiling (Create return): at what is on hand "+" is off; below it, and with no ceiling at all, "+" works
  const plusOff = (markup, name) => new RegExp(`disabled=""[^>]*aria-label="Increase quantity for ${name}"|aria-label="Increase quantity for ${name}"[^>]*disabled=""`).test(markup);
  assert.equal(plusOff(render({ capAtOnHand: true, quantities: { 3: '25' } }), 'Beef Curry'), true, 'at the on-hand amount (25) + is off');
  assert.equal(plusOff(render({ capAtOnHand: true, quantities: { 3: '24' } }), 'Beef Curry'), false, 'one below: + still works');
  assert.equal(plusOff(render({ capAtOnHand: true, quantities: { 3: '25' } }), 'Egg'), false, 'the ceiling is per product');
  assert.equal(plusOff(render({ quantities: { 3: '25' } }), 'Beef Curry'), false, 'no ceiling (Local purchase): + never stops');
  assert.equal(plusOff(render({ quantities: { 3: '500' } }), 'Beef Curry'), false);

  const entered = flat(render({ quantities: { 1: '10', 3: '2', 2: '0' }, actionDisabled: false }));
  assert.match(entered, /\|2\|products\|12 pcs\|total pcs\|/, 'products and total pieces (a 0 does not count)');
  assert.equal(flat(render({ quantities: { 1: '1' } })).includes('|1|product|'), true, 'singular');

  assert.match(flat(render({ rows: [], emptyTitle: 'Nothing to purchase', emptyMessage: 'Ask Main.' })), /EMPTY:Nothing to purchase:Ask Main\./);
  assert.doesNotMatch(render({ rows: [] }), /placeholder="Search name or SKU"|Review return/, 'nothing to search or review on an empty list');
  assert.match(flat(render({ rows: [], loading: true })), /LOADING/);
  assert.match(flat(render({ rows: [], loadError: 'Boom' })), /ERROR:Boom/);
  console.log('2. rendered list: ok');
}

// ---------------------------------------------------------------- 3. the review and the done page
{
  const lines = [
    { id: '3', name: 'Beef Curry', sku: 'BEEF-CURRY', category: 'meals', quantity: 5, caption: 'System 25', flag: { label: '20 short', tone: 'warning' } },
    { id: '1', name: 'Egg', sku: 'EGG', category: 'supplies', quantity: 50, caption: 'System 50', flag: { label: 'Matches system', tone: 'success' } },
  ];
  const props = {
    title: 'Review return', subtitle: 'SM 1 → Main Branch', lines, quantityCaption: 'returning', notes: 'hello', onNotesChange() {}, notesMaxLength: 2000,
    onBack() {}, confirming: false, onConfirm() {},
  };
  const html = renderToStaticMarkup(React.createElement(review.QuantityReviewScreen, props));
  const text = flat(html);
  assert.match(text, /Review return \/ SM 1 → Main Branch/);
  assert.match(text, /Beef Curry\|BEEF-CURRY · System 25\|20 short\|5 pcs\|returning\|/, 'name, SKU and what the system says, the difference, then the quantity');
  assert.match(text, /Egg\|EGG · System 50\|Matches system\|50 pcs\|returning\|/);
  assert.match(text, /Notes \(optional\)/, 'the notes are on the review');
  assert.match(text, /Back to edit\|Confirm\|$/, 'two buttons side by side: Back to edit, Confirm');
  assert.match(html, /data-variant="secondary"[^>]*>Back to edit/, 'Back to edit is the light one');
  assert.doesNotMatch(text, /Submit|Retry/, 'no "Submit" and no retry on a normal review');
  // a saved request waiting to be retried: nothing to edit, one button
  const locked = renderToStaticMarkup(React.createElement(review.QuantityReviewScreen, { ...props, canEdit: false, notesLocked: true, confirmLabel: 'Retry', lockedNote: 'Saved. Retry to check the result.' }));
  assert.doesNotMatch(locked, /Back to edit/);
  assert.match(flat(locked), /Saved\. Retry to check the result\.\|Retry\|$/);
  assert.match(locked, /data-editable="false"/);
  assert.match(flat(renderToStaticMarkup(React.createElement(review.QuantityReviewScreen, { ...props, formError: 'Could not save.' }))), /Could not save\./);
  assert.match(renderToStaticMarkup(React.createElement(review.QuantityReviewScreen, { ...props, lines: [] })), /disabled=""[^>]*>Confirm/, 'nothing to confirm without lines');
  assert.match(renderToStaticMarkup(React.createElement(review.QuantityReviewScreen, { ...props, confirming: true })), /data-loading="true"/);

  const done = renderToStaticMarkup(React.createElement(review.QuantityDoneScreen, { title: 'Return submitted', subtitle: 'SM 1 → Main Branch', heading: 'In transit to Main Branch', lines, quantityCaption: 'returned', doneLabel: 'Back to home', onDone() {} }));
  assert.match(flat(done), /Return submitted \/ SM 1 → Main Branch\|In transit to Main Branch\|Beef Curry\|BEEF-CURRY · System 25\|20 short\|5 pcs\|returned\|/, 'a check, one line, then what was sent');
  assert.match(done, /data-icon="checkmark"/);
  assert.match(flat(done), /Back to home\|$/);
  assert.doesNotMatch(flat(done), /Expected remaining|These figures are from|Difference/, 'the old wording is gone');
  // no lines (a retried request): just the check and the line
  assert.doesNotMatch(flat(renderToStaticMarkup(React.createElement(review.QuantityDoneScreen, { title: 't', subtitle: 's', heading: 'H', lines: [], quantityCaption: 'x', doneLabel: 'D', onDone() {} }))), /pcs/);
  console.log('3. review and done: ok');
}

// ---------------------------------------------------------------- 4. the two screens: nothing is sent before Confirm
{
  const ret = read('app/(cashier)/cashier/returns/create.tsx');
  assert.equal(ret.split('createStockReturn(').length - 1, 1, 'the request is created in one place only');
  const confirmFn = ret.slice(ret.indexOf('async function confirm() {'), ret.indexOf('const branchLine'));
  assert.ok(confirmFn.includes('await createStockReturn(request);'), '...inside confirm()');
  assert.equal(ret.split('void confirm()').length - 1, 1, 'confirm() is called from one place');
  assert.match(ret, /<QuantityReviewScreen[\s\S]*?onConfirm=\{\(\) => void confirm\(\)\}/, '...the review screen\'s Confirm button');
  // the list's button only opens the review
  const listCall = ret.slice(ret.indexOf('<QuantityListScreen'));
  assert.ok(listCall.includes('actionLabel="Review return"'));
  assert.match(listCall, /onAction=\{\(\) => \{\n\s+setError\(''\);\n\s+setReviewing\(true\);\n\s+\}\}/, 'it only switches to the review');
  assert.ok(listCall.includes('showMax'), 'Create return: Max fills in everything on hand');
  assert.ok(listCall.includes('capAtOnHand'), 'Create return: never more than is on hand (the database refuses it)');
  assert.doesNotMatch(ret, /over`|\$\{difference\} over/, 'no "over" tag');
  const listSrc = read('src/features/stock/QuantityListScreen.tsx');
  assert.ok(listSrc.includes('capAtOnHand && Number(value) > row.onHand ? String(row.onHand) : value'), 'typing 999 settles at what is on hand, like Send stock');
  assert.ok(listSrc.includes('Math.min(capAtOnHand ? row.onHand : 999999, current + 1)'), '+ stops at the ceiling');
  assert.ok(ret.includes("subtitle={branchLine}") && ret.includes("const branchLine = `${profile?.branch?.name ?? 'Assigned branch'} → Main Branch`;"));
  // what is sent is exactly as before
  assert.ok(ret.includes("if (!raw || !Number.isInteger(quantity) || quantity <= 0) return [];"), 'whole pieces above zero only');
  assert.ok(ret.includes("p_items: lines.map(({ product_id, quantity }) => ({ product_id, quantity_returned: quantity })),"));
  assert.ok(ret.includes("p_notes: notes.trim() || null,") && ret.includes("p_idempotency_key: makeIdempotencyKey('return'),"));
  assert.ok(ret.includes('useReturnStore.getState().save(user, { request });') && ret.includes('useReturnStore.getState().save(user, { request, id });'), 'the saved request / retry protection is unchanged');
  assert.ok(ret.includes("['22023', '42501', '23514', 'P0001', '40P01', '40001']"), 'same terminal error codes');
  // a saved, unconfirmed request is shown as saved and can only be retried unchanged
  assert.ok(ret.includes('canEdit={!savedRequest}') && ret.includes('notesLocked={Boolean(savedRequest)}') && ret.includes("confirmLabel={savedRequest ? 'Retry' : 'Confirm'}"));
  assert.ok(ret.includes('Stock is never deducted twice.'));
  assert.ok(ret.includes('<QuantityDoneScreen') && ret.includes('doneLabel="Back to home"') && ret.includes("router.replace('/cashier/dashboard');"), 'the done page and where it leads are unchanged');
  assert.ok(ret.includes('function returnLine(entry: Entered): ReviewLine {') && ret.includes('const difference = entry.quantity - entry.system;'));
  assert.ok(ret.includes('listCashierProductCategories()'), 'the category comes from the same read-only lookup the POS uses (no backend change)');
  assert.doesNotMatch(ret, /FormField|Enter how many pieces|Expected remaining/);

  const lp = read('app/(cashier)/cashier/local-purchase.tsx');
  assert.equal(lp.split('mutation.mutate()').length - 1, 1, 'the purchase is recorded in one place only');
  assert.match(lp, /<QuantityReviewScreen[\s\S]*?onConfirm=\{\(\) => \{\n\s+if \(lines\.length === 0 \|\| mutation\.isPending\) return;\n\s+setError\(''\);\n\s+mutation\.mutate\(\);/, '...the review screen\'s Confirm button');
  const lpList = lp.slice(lp.indexOf('<QuantityListScreen'));
  assert.ok(lpList.includes('actionLabel="Review purchase"'));
  assert.match(lpList, /onAction=\{\(\) => \{\n\s+setError\(''\);\n\s+setReviewing\(true\);\n\s+\}\}/, 'it only switches to the review');
  assert.doesNotMatch(lp, /showMax/, 'no Max: a purchase adds stock, it has no ceiling');
  assert.doesNotMatch(lp, /confirmAction|alertNotice/, 'no pop-up: the review is the confirmation, the done page is the result');
  assert.ok(lp.includes("heading={`Added to ${branchName} stock. Main stock is unchanged.`}"), 'the done page still says Main stock is untouched');
  assert.ok(lp.includes("if (!raw || raw === '0') return [];"), 'same lines as before');
  assert.ok(lp.includes("recordBranchLocalPurchase(\n        lines.map(({ product_id, quantity }) => ({ product_id, quantity })),\n        notes.trim() || null,\n        keyRef.current,"), 'same request');
  assert.ok(lp.includes("router.replace('/cashier/dashboard')"));
  assert.doesNotMatch(lp, /does not change Main stock|Only enabled products set to|KG meals are Main-tracked|Cancel/);
  console.log('4. screens: ok');
}

console.log('quantity_list_screens: ALL PASS');
