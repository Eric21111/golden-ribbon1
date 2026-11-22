// Sale details: the total first (a hero with the payment method and pricing), then the items (category icon, product name, option /
// drink as tags), a breakdown only when a discount makes it worth showing, and the details last. "Void item" is a small red button under
// the item that opens a bottom sheet (quantity stepper, reason chips, Cancel | Review void). The void logic itself is untouched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const screen = read('src/features/sales/SalesScreens.tsx');

// order: hero, items, payment summary, details
const marks = ['label="Charged total"', '>ITEMS ORDERED</Text>', '>PAYMENT SUMMARY</Text>', '>SALE DETAILS</Text>'].map((m) => screen.indexOf(m));
assert.ok(marks.every((at, i) => at > 0 && (i === 0 || at > marks[i - 1])), `section order ${marks}`);
assert.match(screen, /<StatTile\s+layout="wide"\s+emphasis/, 'the total is the navy hero');
assert.match(screen, /caption=\{`\$\{paymentLabel\(sale\.payment_method\)\} · \$\{pricingProgramLabel\(sale\.pricing_program \?\? 'standard'\)\}`\}/, 'with the payment method and the pricing');
assert.match(screen, /const hasBreakdown = showCatalog \|\| showDiscount;/, 'the breakdown only when it adds something');
assert.match(screen, /\{hasBreakdown \? \(/);
assert.doesNotMatch(screen, /label: 'Date \/ time'|label: 'Payment method'|label: 'Pricing'/, 'nothing is said twice');
assert.match(screen, /label: 'Branch'[\s\S]*label: 'Cashier'[\s\S]*label: 'Shift session'/, 'the details keep who / where / which shift');
assert.match(screen, /<CategoryIcon category=\{item\.product\?\.product_category\}/, 'a category icon on every line');
assert.match(screen, /cartLineParts\(/, 'the product name and its option / drink tags');
assert.match(screen, /styles\.voidNote/, 'the voided lines are styled, not plain text');
// the full label (with the option and drink) still goes to the void form and the confirmation
assert.match(screen, /<ItemVoidForm key=\{item\.quantity\} item=\{item\} name=\{name\} cashierId=\{sale\.cashier_id\} \/>/);

const form = read('src/features/sales/ItemVoidForm.tsx');
assert.doesNotMatch(form, /AppButton/, 'no full-width brown button');
assert.match(form, /voidButton: \{ width: 36, height: 36/, 'a small red icon button, not a pill under the item');
assert.doesNotMatch(form, /Void item<\/Text>/, 'no text on the button (the screen reader reads "Void item: <name>")');
assert.match(screen, /<View style=\{styles\.receiptRight\}>[\s\S]*?<ItemVoidForm/, 'at the end of the line, under the subtotal');
assert.match(screen, /\{formatMoney\(item\.unit_price\)\} each/, 'the unit price on its own line');
assert.match(screen, /styles\.qtyTagLabel\}>\{`\$\{item\.quantity\}×`\}/, 'the quantity as a small chip next to the name');
assert.match(form, /<ManagerBottomSheet visible=\{editing\} title="Void item"/, 'the form is a bottom sheet');
assert.match(form, /accessibilityLabel="Decrease quantity to void"[\s\S]*accessibilityLabel="Increase quantity to void"/, 'a quantity stepper');
assert.match(form, /<FilterDropdown label="Reason for void" options=\{reasonOptions\}/, 'the reason is a dropdown');
assert.doesNotMatch(form, /FilterChip/, 'no chips');
assert.match(form, /variant="destructive"/, 'the red button is always solid');
assert.match(form, /setError\('Select a reason\.'\)/, 'and says what is missing when pressed');
assert.match(form, /label="Cancel"[\s\S]*label="Review void"/, 'Cancel | Review void side by side');
// the same call, the same checks and the same confirmation as before
assert.ok(form.includes("await voidCashierSaleItem(item, count, reason, reason === 'Other' ? note.trim() : '');"));
assert.ok(form.includes("count > 0 && count <= item.quantity && !!reason && (reason !== 'Other' || !!note.trim())"));
assert.ok(form.includes("'Void this item?'") && form.includes("{ confirm: 'Confirm void', tone: 'danger' }"));
assert.ok(form.includes("const reasons = ['Wrong item', 'Wrong quantity', 'Duplicate entry', 'Customer changed order', 'Order cancelled', 'Other'];"), 'the same reasons');
assert.match(form, /if \(profile\?\.role !== 'cashier' \|\| profile\.id !== cashierId\) return null;/, 'only the sale\'s own cashier');
assert.match(form, /const step = \(delta: number\) => \{[\s\S]*Math\.min\(item\.quantity, Math\.max\(1,/, 'the stepper stays between 1 and the quantity sold');
console.log('Sale details layout passed: total first, clean lines, bottom-sheet void form, void logic unchanged.');
