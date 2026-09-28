PART 3 MILESTONE:
KG UI / Display Consistency

SCOPE

Part 3 fixes only presentation/input inconsistencies introduced or exposed by
the KG-delivered meal revision.

The database/business logic is already implemented.

This milestone must NOT change:

- piece_stock vs kg_meal architecture
- KG-to-meal behavior
- transfer receiving logic
- POS stock logic
- remittance
- waste
- shift closing
- 9 PM closing
- Product Edit atomicity
- historical reconciliation logic
- report calculations
- database authorization

Do NOT create a migration unless inspection proves one is absolutely required.

Expected result:
mostly TypeScript / React Native UI formatting fixes.

Do NOT start Part 4.

==================================================
KNOWN ISSUES FROM SOURCE REVIEW
==================================================

The previous source review found these inconsistencies:

1. KG-capable quantity inputs use a small maxLength such as:

maxLength={6}

This prevents valid values such as:

125.750

even though the database supports numeric(14,3).

Known affected areas included:

src/features/inventory/InventorySetupScreen.tsx
src/features/transfers/CreateTransferScreen.tsx

Inspect for every other quantity input too.

--------------------------------------------------

2. Main inventory has screens that still display generic wording such as:

10.5 in stock
On hand: 10.5 units

For kg_meal this should be:

10.500 kg

Piece products should display:

24 pcs

Known area:

app/(manager)/manager/inventory/index.tsx

--------------------------------------------------

3. Manager transfer details still have old quantity wording such as:

Sent 10.5 · Received Pending

For a RECEIVED kg_meal line with:

quantity_sent = 10.500
quantity_received = NULL

the correct display is:

Sent: 10.500 kg
Received: Unmeasured

NULL for a kg_meal receipt means:

confirmed but not weighed

It does NOT mean:

pending
0 kg

Known route:

app/(manager)/manager/transfers/[id].tsx

--------------------------------------------------

4. Selling-branch kg_meal products can appear as:

0 in stock

because selling branches intentionally have no kg quantity_on_hand.

This is incorrect UI semantics.

For selling-branch kg_meal:

Inventory:
Not tracked

or equivalent existing approved wording.

Known area:

src/features/reports/BranchPerformanceScreens.tsx

--------------------------------------------------

5. pcs / kg formatting is inconsistent between screens.

Some screens already use the correct shared formatting helpers while others
still concatenate raw numbers and words manually.

Part 3 should centralize/reuse existing helpers rather than creating new
screen-specific formatting rules.

==================================================
CONFIRMED DISPLAY RULES
==================================================

PIECE_STOCK

Example:

quantity = 24

Display:

24 pcs

Piece quantities remain whole numbers.

Normal stock status behavior stays:

In stock
Low stock
Out of stock

according to the existing piece-stock rules.

--------------------------------------------------

KG_MEAL — MAIN BRANCH

Main Branch tracks actual KG quantity.

Examples:

10
→ 10.000 kg

10.5
→ 10.500 kg

10.125
→ 10.125 kg

0
→ 0.000 kg

For current live Main stock:

quantity > 0
→ In stock

quantity = 0
→ Out of stock / existing neutral zero-stock wording

Do NOT apply the old piece-stock low threshold of 5 to kg_meal.

Do NOT invent a KG low-stock threshold.

--------------------------------------------------

KG_MEAL — SELLING BRANCH

Selling branch does NOT track KG on-hand.

Do NOT display:

0 kg
0 units
0 in stock
Out of stock

merely because there is no branch_inventory KG row.

Correct semantic display:

Not tracked

or:

Inventory not tracked

according to the existing design language.

This does NOT mean the product cannot be sold.

POS availability for kg_meal remains independent of KG balance.

==================================================
QUANTITY FORMATTING
==================================================

Use one shared formatting path wherever practical.

Inspect existing helpers in:

src/lib/format.ts

and any inventory formatting utilities already introduced in the KG milestone.

Preferred conceptual helper behavior:

formatInventoryQuantity(value, inventoryMode)

piece_stock:
24
→ "24 pcs"

kg_meal:
10.5
→ "10.500 kg"

Historical rows:

use the SNAPSHOTTED inventory_mode.

Live product/current inventory:

use the current product inventory_mode.

Do not derive historical units from the product's current mode.

--------------------------------------------------
KG DECIMAL DISPLAY
--------------------------------------------------

For inventory / transfer quantities:

kg_meal should display exactly 3 decimal places where precise stock or transfer
weight is shown.

Examples:

10
→ 10.000 kg

10.5
→ 10.500 kg

10.125
→ 10.125 kg

Do not display:

10.5 units

when the value represents KG.

--------------------------------------------------
PIECE DISPLAY
--------------------------------------------------

Piece quantities must never display decimals.

Example DB numeric value:

24.000

Display:

24 pcs

not:

24.000 pcs

==================================================
QUANTITY INPUTS
==================================================

KG input:

- decimal allowed
- maximum 3 decimal places
- explicit 0 allowed where the existing operation permits zero
- negative invalid
- blank invalid where quantity is required
- trim whitespace
- do not convert blank to zero

Examples valid:

0.125
0.500
1
1.250
10.500
125.750

Do NOT impose an arbitrary low character limit such as:

maxLength={6}

The DB uses numeric(14,3).

The UI must not reject a value solely because its textual representation is
longer than 6 characters.

Prefer validation over a tiny maxLength.

If a maxLength is retained for defensive UI reasons, it must support the full
safe DB numeric representation and must not contradict server validation.

Do not introduce a smaller UI range than the backend accepts.

--------------------------------------------------
PIECE INPUT
--------------------------------------------------

Piece-stock quantity input remains integer-only.

Do not accidentally allow decimal piece stock merely because quantity DB
columns were widened to numeric.

==================================================
TRANSFER DISPLAY RULES
==================================================

Each transfer line must display according to its snapshotted inventory_mode.

--------------------------------------------------
PIECE LINE
--------------------------------------------------

Example:

Sent:
24 pcs

Received:
22 pcs

Difference:
2 pcs shortage

Keep existing behavior.

--------------------------------------------------
KG LINE — BEFORE CONFIRMATION
--------------------------------------------------

If the shipment itself is genuinely still pending receipt:

Sent:
10.500 kg

Received:
Pending

This is acceptable only while receipt has NOT been confirmed.

--------------------------------------------------
KG LINE — AFTER CONFIRMATION
--------------------------------------------------

Transfer status:
received

quantity_sent:
10.500

quantity_received:
NULL

Display:

Sent:
10.500 kg

Received:
Unmeasured

Do NOT display:

Pending
0 kg
10.500 kg received

because the branch did not weigh it.

--------------------------------------------------
MIXED TRANSFER
--------------------------------------------------

Example:

Buttered Chicken
Sent: 10.500 kg
Received: Unmeasured

Coke
Sent: 24 pcs
Received: 22 pcs
Shortage: 2 pcs

Do not apply one unit label to the entire transfer.

Every line uses its own snapshotted inventory_mode.

==================================================
TRANSFER STATUS VS QUANTITY STATUS
==================================================

Do not confuse:

transfer.status

with:

quantity_received measurement state.

Example:

transfer.status = received

kg quantity_received = NULL

means:

Shipment received
Weight unmeasured

NOT:

Shipment pending

This distinction should be reflected everywhere the transfer is rendered.

==================================================
MAIN INVENTORY UI
==================================================

Audit all Main inventory displays.

Known affected route:

app/(manager)/manager/inventory/index.tsx

For kg_meal:

show:

Product Name
10.500 kg
In stock

not:

10.5 units

For piece_stock:

show:

24 pcs

Preserve existing actions/navigation.

Do not redesign the inventory screen.

==================================================
INVENTORY PRODUCT DETAILS
==================================================

Inspect:

src/features/inventory/InventoryProductDetails.tsx
src/features/inventory/InventoryListItem.tsx
src/features/inventory/InventorySetupScreen.tsx
src/features/inventory/inventoryStatus.ts

Ensure the existing correct KG rules are consistently reused.

Do not duplicate status logic inside routes if a shared helper already exists.

==================================================
BRANCH PERFORMANCE
==================================================

Inspect:

src/features/reports/BranchPerformanceScreens.tsx

Selling-branch kg_meal must not appear as:

0 in stock

Use:

Not tracked

for KG inventory status at selling branches.

Piece products keep their normal quantity/status.

--------------------------------------------------
IMPORTANT: DO NOT SUM DIFFERENT UNITS
--------------------------------------------------

If Branch Performance or another UI aggregates stock quantities across
products, do not calculate something like:

24 pcs + 10.500 kg = 34.5 inventory

That has no valid meaning.

If current code does such aggregation:

- keep piece totals separate
- do not include untracked selling-branch kg_meal in a quantity total
- use counts of products only where the metric is a product count

Do not create new cross-unit arithmetic.

==================================================
POS DISPLAY
==================================================

Inspect the touched POS components only to confirm consistency:

src/features/pos/posInventory.ts
src/features/pos/PosProductRow.tsx
src/features/pos/PosProductCard.tsx
src/features/pos/PosItemSheet.tsx
src/stores/cartStore.ts

The existing business rule remains:

kg_meal POS quantity = MEAL COUNT

Example:

Buttered Chicken w/ Rice
Qty: 3

Do NOT display:

3 kg

Do NOT show:

Remaining KG

Do NOT derive meal availability from KG.

The existing generic meal cart safety cap remains unchanged.

Part 3 is not a POS business-logic milestone.

==================================================
RETURN HISTORY
==================================================

Historical return quantities must continue using the snapshotted unit.

Example:

Old return before product conversion:

5 pcs

Product later becomes:

kg_meal

History must still show:

5 pcs

Inspect presentation only if Part 3 touches shared formatting helpers.

Do not change return behavior.

==================================================
INCOMING SHIPMENT UI
==================================================

Audit:

app/(cashier)/cashier/incoming.tsx
src/features/transfers/TransferDetailsView.tsx
app/(manager)/manager/transfers/[id].tsx

All three must agree on:

piece:
counted received quantity

kg:
unmeasured after confirmed receipt

Do not leave one screen showing:

Unmeasured

while another screen for the same transfer shows:

Pending

==================================================
CONSISTENT EMPTY / UNKNOWN SEMANTICS
==================================================

Use these distinctions consistently:

0
= actual numeric zero

NULL kg received
= Unmeasured

Selling-branch kg stock absent
= Not tracked

Transfer not yet received
= Pending

Do not interchange these labels.

==================================================
INSPECTION BEFORE EDITING
==================================================

Before implementation, inspect only relevant UI/helper files.

Search for:

"units"
"in stock"
"Pending"
"quantity_received"
"quantity_on_hand"
"maxLength"
"pcs"
"kg"
"inventory_mode"

Specifically inspect known affected files:

src/lib/format.ts
src/features/inventory/InventorySetupScreen.tsx
src/features/inventory/InventoryListItem.tsx
src/features/inventory/InventoryProductDetails.tsx
src/features/inventory/inventoryStatus.ts
app/(manager)/manager/inventory/index.tsx
src/features/transfers/CreateTransferScreen.tsx
src/features/transfers/TransferDetailsView.tsx
app/(manager)/manager/transfers/[id].tsx
app/(cashier)/cashier/incoming.tsx
src/features/reports/BranchPerformanceScreens.tsx
relevant POS display files

Report briefly before editing:

1. Every KG-capable input still using a restrictive maxLength.
2. Every active UI path still using generic "units".
3. Every active transfer UI that maps NULL kg receipt to "Pending".
4. Every selling-branch KG display showing zero/out-of-stock instead of
   Not tracked.
5. Existing shared helpers that should become the single formatting source.
6. Any aggregate UI that mixes pcs and kg numerically.

Do not speculate.

==================================================
IMPLEMENTATION RULES
==================================================

Prefer fixing shared helpers first.

Then update screens to use those helpers.

Avoid:

screen A:
custom KG formatting

screen B:
different custom KG formatting

Centralize where the project architecture reasonably allows it.

Do not perform a large UI redesign.

Keep existing spacing/layout/navigation.

Only correct:

- labels
- quantity formatting
- unknown/unmeasured semantics
- stock-state wording
- quantity input restrictions

==================================================
TESTING
==================================================

No GUI/browser/mobile automation.

Run:

npm run typecheck

Existing relevant tests for:

inventory
transfers
KG meal
POS

Add a focused helper/source test if practical, for example:

tests/kg_ui_formatting.mjs

Required assertions:

A. KG formatting

10
→ 10.000 kg

10.5
→ 10.500 kg

10.125
→ 10.125 kg

--------------------------------------------------

B. Piece formatting

24
or DB "24.000"

→ 24 pcs

--------------------------------------------------

C. KG input precision

Valid:
125.750

Not blocked by old 6-character limit.

More than 3 decimal places:
rejected by existing validation.

--------------------------------------------------

D. Selling branch KG

No quantity_on_hand

→ Not tracked

NOT:

0
Out of stock

--------------------------------------------------

E. Main KG

10.500

→ 10.500 kg
→ In stock
→ no LOW threshold inherited from pieces

--------------------------------------------------

F. Confirmed KG receipt

status = received
quantity_received = NULL

→ Unmeasured

NOT:
Pending
0 kg

--------------------------------------------------

G. Pending KG shipment

status = pending_receipt
quantity_received = NULL

→ Pending

This verifies Pending and Unmeasured are not conflated.

--------------------------------------------------

H. Piece receipt

Sent 24
Received 22

→ 24 pcs / 22 pcs
→ existing discrepancy display intact

--------------------------------------------------

I. Mixed transfer

KG and piece line each retain their own unit/receipt semantics.

--------------------------------------------------

J. POS

kg_meal cart quantity:

3

→ meal quantity 3

No "3 kg"
No remaining KG display

--------------------------------------------------

K. Historical snapshot

Historical piece transfer/return remains pcs after live product becomes
kg_meal.

==================================================
REGRESSION
==================================================

Re-run at minimum:

tests/kg_meal_shift_reconciliation.mjs
relevant transfer tests
relevant inventory tests
relevant POS tests

Do not modify unrelated expectations unless the expectation is specifically
the incorrect display behavior being fixed.

==================================================
ACCEPTANCE CRITERIA
==================================================

Complete Part 3 only when:

[ ] Valid KG input such as 125.750 is not blocked by a tiny maxLength.

[ ] KG inputs still allow maximum 3 decimal places only.

[ ] Piece inputs remain whole-number only.

[ ] Main KG stock displays with "kg".

[ ] Piece stock displays with "pcs".

[ ] No active relevant screen displays generic "units" for a known mode.

[ ] Confirmed unmeasured KG receipt displays "Unmeasured".

[ ] Truly pending KG receipt displays "Pending".

[ ] NULL kg receipt is never displayed as 0 kg.

[ ] Selling-branch kg_meal inventory displays "Not tracked".

[ ] Selling-branch kg_meal is not shown as Out of stock merely because KG is
    not tracked.

[ ] Main kg_meal does not inherit the piece low-stock threshold.

[ ] Mixed transfers display each line in its own unit.

[ ] Historical displays continue using snapshots.

[ ] No screen numerically combines pcs and kg.

[ ] POS meal quantities remain whole-number meal counts.

[ ] Typecheck passes.

[ ] Relevant regression tests pass.

==================================================
OUT OF SCOPE
==================================================

Do NOT fix:

- Product Edit atomicity
- stale/dead services/types
- historical regression test cleanup unrelated to display
- remittance
- waste reports
- shift flags
- database migrations already deployed
- inventory reconciliation logic
- product authorization
- KG-to-meal conversion
- availability toggles
- recipe/BOM
- new low-stock thresholds
- waste quantity
- cash discrepancy resolution

These belong to other parts or future work.

==================================================
DEPLOYMENT
==================================================

Part 3 should ideally require NO database migration.

Do NOT run:

npx supabase db push

If Cursor believes a DB migration is required:

STOP and explain why before creating one.

Do not deploy an app build.

==================================================
FINAL REPORT
==================================================

Return:

1. Inspection findings
2. Files changed
3. Shared formatting/helper changes
4. KG input changes
5. Main inventory display changes
6. Selling-branch KG display changes
7. Transfer display changes
8. Branch Performance changes
9. POS confirmation
10. Tests run + PASS/FAIL
11. Any remaining Part 3 issues

Do not begin Part 4.