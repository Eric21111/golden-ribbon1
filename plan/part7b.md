REVISION 7B — PCS INVENTORY, TRANSFERS, RETURNS & POS

PHASE: PLAN FIRST — DO NOT IMPLEMENT YET

Revision 7A has already been implemented LOCALLY.

DO NOT:
- db push
- deploy
- perform production cutover
- edit deployed historical migrations
- start Revision 7C
- implement the final End Shift/remittance reconciliation engine

Return a detailed 7B PLAN first.

==================================================
REVISION 7 CONTEXT
==================================================

Revision 7 is split into:

7A — Database/model + PCS cutover scaffolding
7B — Inventory / Transfers / Returns / POS PCS conversion
7C — End Shift / Remittance reconciliation engine
7D — Cashier closing UX
7E — Reports / history / regression cleanup

7A local implementation already added:

- closing_stock_behavior
- sales_cutoff_at
- inventory_reconciliation_required
- quantified waste schema
- pcs_cutover_product_snapshots
- kg_meal_cutover_balance_snapshots
- shift_product_opening_stock
- shift_product_reconciliations
- waste / unsold movement types
- whole-PCS DB constraints
- active kg_meal rejection
- exact Product create/edit forward RPC signatures
- lock_branch_inventory_gate(uuid)
- start_cashier_shift opening-stock snapshot
- confirm_shipment_arrival using common lock gate

7A has NOT been pushed/deployed.

==================================================
FINAL BUSINESS MODEL — LOCKED
==================================================

ALL CURRENT/FUTURE OPERATIONAL INVENTORY IS PCS.

No active KG inventory.

No KG-to-meal conversion.

No recipe/BOM conversion.

No decimal PCS.

Examples:

25       valid
25.000   equivalent to 25 PCS where numeric compatibility remains
25.500   invalid

Historical KG records remain truthful and untouched.

==================================================
7B PRIMARY GOAL
==================================================

Convert all NORMAL operational stock flows to one consistent PCS model:

MAIN
→ PCS inventory

TRANSFER
→ PCS quantity sent

SELLING BRANCH RECEIPT
→ actual PCS counted

SELLING BRANCH INVENTORY
→ PCS tracked for every product

POS
→ PCS sold and deducted

RETURNS
→ PCS counted and moved

ADJUSTMENTS / INITIALIZATION
→ PCS only

PRODUCT MANAGEMENT
→ no active inventory-mode choice
→ closing-stock behavior configurable by authorized management

Do NOT implement End Shift reconciliation in 7B.

==================================================
A. ACTIVE INVENTORY MODE MUST DISAPPEAR FROM APP UX
==================================================

There must no longer be a user-selectable:

piece_stock
vs
kg_meal

Remove active inventory-mode selection from:

- product create
- product edit
- validation
- service DTOs/types where appropriate
- UI labels
- forms
- help text
- active inventory views

The app should behave as PCS-only.

If DB RPC compatibility still temporarily accepts:

p_inventory_mode

the app should either:

- pass 'piece_stock' internally, or
- omit it where safe

but users must not see or choose it.

Do NOT remove historical snapshot support required for old KG records.

==================================================
B. PRODUCT CLOSING BEHAVIOR UI
==================================================

7A added:

products.closing_stock_behavior

Allowed:

keep_at_branch
record_as_unsold

Add Product Create/Edit configuration for Owner/Main Manager using current
product-management authorization.

Recommended user-facing wording:

Closing stock behavior

○ Keep remaining stock at branch
  Remaining usable stock stays at the selling branch for the next day.

○ Record remaining stock as unsold
  Remaining usable stock is recorded as unsold when the final daily close
  is completed.

Do NOT expose enum jargon unnecessarily.

Cashiers never choose this.

Persist through the atomic Product Create/Edit RPCs already changed in 7A.

No second follow-up mutation.

==================================================
C. PRODUCT INITIALIZATION AFTER PCS CUTOVER
==================================================

Former kg_meal products are inactive after 7A cutover until fresh PCS stock
is established at Main.

Audit the current:

initialize_main_branch_inventory

or equivalent opening-stock workflow.

7B must define how Main Manager:

1. physically counts PCS
2. enters whole PCS quantity
3. creates auditable opening/current inventory
4. reactivates the former KG product safely

Do NOT convert an old KG quantity.

Do NOT use old kg balance as PCS.

Determine whether reactivation should occur:

- automatically after successful PCS initialization

or
- explicitly through product edit after stock initialization

Use the current business/product activation architecture where possible.

Do not invent duplicate initialization paths unnecessarily.

==================================================
D. MAIN INVENTORY
==================================================

Main inventory becomes PCS-only for active products.

Current inventory screens should show:

Example:
Chicken Meal — 125 pcs
Coke — 80 pcs

Never:

10.500 kg

for CURRENT post-cutover operational stock.

Remove active KG formatting and active kg-specific quantity parsing.

Whole PCS only.

Preserve historical KG formatting only where a legacy historical record is
being displayed.

==================================================
E. STOCK TRANSFER CREATION
==================================================

All new transfers are PCS.

Transfer quantity:

- whole positive PCS
- no decimal entry
- no KG mode selection
- no KG labels
- no kg-specific instructions

Example:

Chicken Meal
Send: 30 pcs

Coke
Send: 24 pcs

Server must reject fractional PCS even if UI validation is bypassed.

Preserve all existing:

- authorization
- stock sufficiency
- atomicity
- transfer status rules
- deterministic locking
- audit movements

==================================================
F. SELLING-BRANCH RECEIPT
==================================================

Remove the old KG behavior:

quantity_received = NULL
Unmeasured
selling stock not credited

All NEW transfers:

quantity_sent = PCS
quantity_received = actual counted PCS

Example:

Sent:     30 pcs
Received: 29 pcs
Difference: 1 pc shortage

or whatever current shipment discrepancy convention already uses.

Do not fabricate equality between sent and received.

Cashier/authorized receiver must enter actual received count where the
existing receiving workflow requires it.

Whole PCS only.

Receiving valid PCS must update selling-branch inventory.

No active "Unmeasured" concept.

==================================================
G. SHIPMENT ISSUE / DISCREPANCY
==================================================

Audit:

confirm_shipment_arrival
report_shipment_issue

and all related shipment/discrepancy RPCs.

All new activity must be PCS.

Remove active kg-specific branches.

Preserve:

- shipment discrepancy reporting
- transfer issue workflow
- inventory integrity
- audit history
- Part 4A concurrency guarantees

7A already moved confirm_shipment_arrival under:

lock_branch_inventory_gate(uuid)

Plan alignment of:

report_shipment_issue

and any other selling-branch receipt mutation with the SAME global lock
order.

==================================================
H. GLOBAL INVENTORY LOCK ORDER
==================================================

7A established the design:

1. affected branch row FOR UPDATE
2. open shift row FOR UPDATE if applicable
3. branch_inventory rows FOR UPDATE ORDER BY product_id
4. business writes

7B must audit EVERY normal selling-branch inventory mutator and align it
where appropriate.

At minimum inspect:

- confirm_sale
- confirm_shipment_arrival
- report_shipment_issue
- create_stock_return
- return_leftover_stock / equivalent
- initialize_main_branch_inventory
- manual inventory adjustment RPCs
- any direct branch stock mutation RPC
- any receiving RPC not listed above

Return a COMPLETE inventory-mutator matrix:

RPC/function
→ affected branch
→ movement type
→ current lock behavior
→ required 7B lock change
→ whether 7C cutoff check will later be needed

Do not leave an unidentified stock-mutating RPC.

==================================================
I. POS INVENTORY LIST
==================================================

Current legacy behavior:

kg_meal stock may be returned as NULL / Not tracked.

That active behavior must disappear.

For every active product available at a selling branch:

POS inventory should expose actual PCS stock.

Example:

Chicken Meal
Available: 17 pcs

Coke
Available: 8 pcs

No current product should show:

Not tracked
Unmeasured
KG available
N/A because kg_meal

Preserve existing availability/product-assignment rules.

==================================================
J. POS SALE STOCK DEDUCTION
==================================================

This is critical.

For EVERY active product sold after Revision 7:

- validate requested quantity is whole PCS
- validate sufficient branch stock
- deduct sold PCS atomically
- write sale inventory movement
- preserve sale transaction consistency

Example:

Current stock: 20 pcs

Sale:
3 Chicken Meals

After sale:
17 pcs

If requested:

21 pcs

reject for insufficient stock.

No product may skip inventory deduction because it used to be kg_meal.

Audit:

confirm_sale

Remove active:

if kg_meal then skip stock validation/decrement

logic.

All new sales use the same PCS stock engine.

==================================================
K. POS CONCURRENCY
==================================================

Preserve atomic stock behavior.

Two simultaneous sales must not oversell.

Example:

Stock = 5

Sale A requests 4
Sale B requests 4

At most one can succeed if both would exceed actual inventory.

Use the agreed locking model.

Do not rely on client-side stock values.

==================================================
L. SALES CUTOFF — 7B VS 7C BOUNDARY
==================================================

7A added:

shifts.sales_cutoff_at

The COMPLETE End Shift sales-cutoff workflow belongs to 7C.

For 7B:

- align confirm_sale locking so 7C can safely enforce cutoff
- identify exact check insertion point
- do not implement Start End Shift / final closing behavior yet unless a
  minimal compatibility check is technically required

PLAN must state clearly what remains for 7C.

Do not blur the boundary.

==================================================
M. STOCK RETURNS
==================================================

All NEW stock returns are PCS.

Retire active rule:

kg-delivered meals cannot be returned by quantity

because there are no active kg products anymore.

New return:

Coke: 6 pcs
Chicken Meal: 4 pcs

if business workflow permits return for that product/session.

Preserve:

- authorization
- return statuses
- source/destination stock effects
- audit movements
- transfer/history references

Whole PCS only.

Historical KG returns remain untouched and still display truthfully.

==================================================
N. LEFTOVER / RETURN-TO-MAIN BEHAVIOR
==================================================

IMPORTANT:

Return to Main remains a SEPARATE manual operation.

Do NOT confuse:

keep_at_branch
record_as_unsold
return_to_main

Closing behavior does NOT automatically create a return to Main.

If current code contains a leftover-return workflow based on old KG behavior,
audit it carefully.

Any normal manual return workflow that remains valid:

→ convert to PCS.

Any old workflow that existed specifically because kg_meal was untracked:

→ identify whether it is now obsolete.

Do not delete blindly.

Explain each affected workflow.

==================================================
O. INVENTORY ADJUSTMENTS
==================================================

Audit every manual/system adjustment path.

All active adjustments must use whole PCS.

If selling-branch adjustments may occur during an active shift:

- use lock_branch_inventory_gate
- write auditable inventory_movements adjustment
- this movement will be included in 7C adjustment_quantity

No silent direct branch_inventory mutation.

If an existing adjustment path directly edits quantity without movement,
flag and fix it.

==================================================
P. INVENTORY MOVEMENT SNAPSHOTS
==================================================

7A preserved historical:

inventory_mode = kg_meal

New movements must snapshot:

piece_stock

Do not rewrite historical rows.

All new:

transfer_in
transfer_out
sale
return_in
return_out
adjustment

must be whole PCS.

Do not add waste / unsold operational writes yet unless specifically required
for a non-closing 7B workflow; their final usage is 7C.

==================================================
Q. CURRENT VS HISTORICAL UI
==================================================

This distinction is mandatory.

CURRENT operational UI:
→ PCS only

HISTORICAL legacy records:
→ retain truthful historical unit

Examples:

Historical transfer from before Revision 7:
10.500 kg
Received: Unmeasured

must remain understandable.

New transfer:
25 pcs
Received: 24 pcs

Do not globally replace every "kg" string if it is required to render
historical records truthfully.

Identify shared formatters that need:

snapshot-aware historical formatting

versus:

PCS-only current formatting.

==================================================
R. REMOVE DEAD KG CLIENT LOGIC
==================================================

Audit and plan removal/retirement of:

- InventoryModeField
- kg_meal active constants/options
- kg-specific product form validation
- kg quantity input behavior
- KG decimal formatter for CURRENT inventory
- "Not tracked" selling-stock logic
- "Unmeasured" logic for NEW receipts
- POS branches that treat kg stock as null
- kg-specific return restrictions
- kg-specific transfer construction
- mode-specific badges/help text
- mode-conversion UI/actions

BUT:

Keep legacy formatters/helpers if still required by historical screens.

Do not destroy historical display capability.

==================================================
S. TYPES / SERVICES
==================================================

Audit TypeScript definitions and service payloads.

Remove active app dependence on inventory_mode where safe.

Where DB compatibility temporarily keeps:

inventory_mode

do not spread it throughout new app architecture unnecessarily.

Prefer PCS as the implicit current model.

Update:

- product service
- inventory service
- transfer service
- sales/POS service
- return service
- relevant hooks/types/components

Do not introduce duplicate PCS-only types if existing types can be simplified.

==================================================
T. CLOSING-BEHAVIOR REVIEW SUPPORT
==================================================

The coordinated production release requires Owner/Main Manager to review
the provisional mapping before first PCS selling session.

7B must provide a usable Product Create/Edit UI for correcting:

closing_stock_behavior

The migration audit table itself does not necessarily need an end-user UI.

Do NOT build a special cutover admin dashboard unless the current app needs
one.

The required operational capability is:

Owner/Main Manager can inspect/edit each product's closing behavior through
normal Product Management.

==================================================
U. SECURITY
==================================================

Preserve all existing authorization.

Any replaced/new mutation RPC:

SECURITY DEFINER where appropriate
SET search_path = ''

REVOKE:
public
anon

GRANT only required roles.

Do not widen Cashier permissions.

Do not let client directly mutate:

branch_inventory
inventory_movements

==================================================
V. 7A CUTOVER COMPATIBILITY
==================================================

Remember:

7A migrations exist LOCALLY but are not deployed.

7B development must build on the post-7A local schema.

Do not create alternate logic intended to support production old KG and new
PCS simultaneously.

This is a coordinated Revision 7 release.

However:

historical KG DATA must still be readable.

==================================================
W. DATABASE MIGRATIONS
==================================================

Do not edit:

20260928130000_revision_7a_movement_enums.sql
20260928130100_revision_7a_pcs_cutover.sql
20260928130200_revision_7a_pcs_rpcs.sql

unless a genuine 7A defect is discovered.

If 7B needs SQL changes:

create NEW forward migration(s) after 20260928130200.

If you discover a true 7A bug:

STOP and report it instead of silently rewriting the 7A migration.

No db push.

==================================================
X. 7C BOUNDARY — DO NOT IMPLEMENT YET
==================================================

7B must NOT implement:

- final End Shift/Remit submission
- physical actual-remaining input
- quantified waste closing workflow
- expected-vs-actual inventory reconciliation
- shortage/excess finalization
- unsold finalization
- keep_at_branch final close behavior
- cash + inventory atomic reconciliation
- final sales_cutoff_at transition workflow
- auto-close inventory reconciliation path

Those are 7C.

7B may prepare normal inventory data/locks needed by 7C.

==================================================
Y. TEST REQUIREMENTS
==================================================

Plan new/updated tests covering at least:

1. New product UI/service never creates kg_meal.
2. Product create persists closing behavior.
3. Product update changes closing behavior atomically.
4. Whole PCS current inventory.
5. Main PCS initialization.
6. Former KG product can be initialized safely in PCS.
7. New transfer only accepts whole PCS.
8. Selling receipt requires/records actual PCS.
9. Selling inventory increments by received PCS.
10. Transfer discrepancy remains correct.
11. report_shipment_issue PCS behavior.
12. POS list exposes stock for former meal products.
13. POS sale deducts PCS for all products.
14. Insufficient stock rejection.
15. Concurrent sale cannot oversell.
16. New return supports PCS former-meal product.
17. Fractional return rejected.
18. Manual adjustment whole PCS + movement audit.
19. All required mutators follow global lock order.
20. Historical kg transfer/movement/return display remains truthful.
21. No new active "Not tracked"/"Unmeasured" KG flow.
22. Existing regression suite remains green.
23. npm run typecheck passes.

Do not weaken tests merely because kg_meal active behavior is retired.

Replace obsolete tests with PCS-equivalent assertions where appropriate.

==================================================
PLAN OUTPUT REQUIRED
==================================================

Return a structured Revision 7B PLAN containing:

1. Current active KG client/server paths found
2. Files/components/services affected
3. SQL RPC/functions affected
4. Complete selling-branch inventory mutator matrix
5. Product Create/Edit UI changes
6. closing_stock_behavior UI design
7. Main PCS initialization/reactivation flow
8. Current inventory PCS changes
9. Transfer creation PCS changes
10. Transfer receipt PCS changes
11. Shipment discrepancy PCS changes
12. POS inventory-list changes
13. POS deduction/concurrency changes
14. Return flow changes
15. Leftover/return-to-main decisions
16. Adjustment flow changes
17. Lock-order alignment
18. Current-vs-historical formatting strategy
19. Type/service cleanup
20. Security/RLS/RPC implications
21. New migration(s) expected
22. Exact 7B/7C boundary
23. Tests to add/update
24. Risks/regression areas
25. Any business decision still required

IMPORTANT:

If a real business decision is missing:
STOP and identify it.

Do not invent one.

Do not implement yet.

Return the PLAN for review.