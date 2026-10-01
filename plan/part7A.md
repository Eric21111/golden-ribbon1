REVISION 7A — PCS INVENTORY DATA MODEL & DATABASE CUTOVER

PHASE: PLAN FIRST — DO NOT IMPLEMENT YET

This is the first sub-part of Revision 7.

The client has changed the business model:

OLD:
- some products delivered in KG
- kg_meal POS sold as meals
- selling branches did not track KG
- kg_meal POS sales did not deduct branch stock
- waste was occurrence-only

NEW:
- ALL operational inventory is PCS
- deliveries are PCS
- branch receiving is PCS
- POS sales are PCS
- POS sales deduct branch inventory
- waste is PCS
- remaining/unsold stock is physically counted in PCS
- no KG-to-meal model remains for current operations

Revision 7 will eventually be:

7A — Database/model + safe PCS cutover
7B — Inventory/transfers/POS
7C — End Shift/remittance engine
7D — Cashier closing UX
7E — Reports + regression cleanup

For THIS step:
INSPECT THE CURRENT REPOSITORY AND RETURN A DETAILED 7A PLAN.

Do NOT create/edit migration files yet.
Do NOT modify app code yet.
Do NOT run supabase db push.

==================================================
CURRENT SOURCE — IMPORTANT FACTS TO VERIFY
==================================================

The current repository already has:

public.inventory_mode:
- piece_stock
- kg_meal

products.inventory_mode

branch_inventory.quantity_on_hand:
numeric(14,3)

inventory_movements.quantity:
numeric(14,3)

inventory_movements.inventory_mode:
historical snapshot

stock_transfer_items:
- quantity_sent numeric(14,3)
- quantity_received numeric(14,3)
- inventory_mode snapshot

stock_return_items.inventory_mode snapshot

kg-specific behavior currently includes:

- selling-branch KG stock guard
- KG transfer receipt quantity_received = NULL / unmeasured
- KG transfer confirmation does not add selling-branch inventory
- confirm_sale skips stock validation/deduction for kg_meal
- kg_meal cannot be quantity-returned
- list_cashier_pos_inventory returns NULL stock for kg_meal
- parse_inventory_quantity allows decimals for kg_meal
- set_product_inventory_mode supports piece_stock <-> kg_meal
- create_complete_product accepts inventory_mode
- update_complete_product accepts inventory_mode
- historical transaction rows snapshot inventory_mode

Current shift architecture includes:

shift_reconciliations
- cash only
- expected_cash
- actual_cash
- difference
- result

shift_waste_occurrences
- product occurrence
- note
- NO quantity

shifts
- open / closed
- reconciliation_required
- no stock reconciliation
- no sales-closing cutoff timestamp

Current close flow:

close_cashier_shift(
  shift_id,
  actual_cash,
  waste
)

and reconcile_closed_shift(...)

Current waste records only kg_meal product occurrence,
not PCS quantity.

Confirm all of this against the CURRENT ZIP before planning.

==================================================
FINAL BUSINESS RULES — FIXED
==================================================

Treat these as approved requirements.

--------------------------------------------------
A. ALL NEW OPERATIONAL INVENTORY = PCS
--------------------------------------------------

Main stock = PCS.

Transfer quantity = PCS.

Selling branch receipt = PCS.

Selling branch inventory = PCS.

POS quantity = PCS.

Waste = PCS.

Actual remaining stock = PCS.

Unsold = PCS.

No current-operation KG inventory.

No KG-to-meal conversion.

No recipe/BOM conversion.

No decimal PCS.

Examples:

25       valid
25.000   may be accepted internally as 25 if needed for compatibility
25.500   invalid for new PCS operations

--------------------------------------------------
B. HISTORICAL KG DATA MUST NOT BE REWRITTEN
--------------------------------------------------

Historical records may legitimately contain:

inventory_mode = kg_meal
quantity = 10.500

Do NOT rewrite that as:

10 pcs

That would corrupt history.

Historical snapshot fields may remain even after active KG behavior is retired.

Examples:

inventory_movements.inventory_mode
stock_transfer_items.inventory_mode
stock_return_items.inventory_mode

may remain for historical interpretation.

Do not delete historical KG rows.

--------------------------------------------------
C. NO AUTOMATIC KG -> PCS CONVERSION
--------------------------------------------------

This is critical.

There is NO valid formula such as:

10.500 kg = X pcs

Therefore an existing kg_meal live balance cannot simply be converted.

The plan must define a safe cutover for EXISTING kg_meal products.

Preferred strategy to evaluate:

1. Preserve/snapshot the old live KG balance for audit.
2. Do NOT reinterpret it as PCS.
3. Clear the ACTIVE operational balance for former kg_meal products.
4. Former kg_meal products require a fresh physical PCS count.
5. Main Manager enters the new PCS stock after cutover.
6. Product cannot resume normal selling/transfer behavior until the PCS stock
   has been initialized.

If there is a safer alternative, explain it.

Do not silently delete balances.

Do not invent piece counts.

--------------------------------------------------
D. OPEN KG TRANSACTIONS CANNOT BE CONVERTED
--------------------------------------------------

A transfer like:

10.500 kg pending receipt

cannot become:

10 pcs

The plan must inspect and define handling for:

stock_transfers:
- draft
- pending_receipt

stock_returns:
- draft
- in_transit

for products currently using kg_meal.

Preferred rule:

Deployment must refuse/stop if an unresolved KG transaction exists.

Those transactions must be:
- completed under the old model, or
- cancelled

before PCS cutover.

Do not mutate an open KG transaction into PCS.

--------------------------------------------------
E. PRODUCT CLOSING STOCK BEHAVIOR
--------------------------------------------------

Add a persistent product-level closing rule.

Approved concepts:

KEEP_AT_BRANCH
- remaining stock stays physically at selling branch
- becomes available next business day
- example: Coke, bottled water, canned drinks

RECORD_AS_UNSOLD
- remaining usable stock is counted
- recorded as unsold
- removed from usable inventory after final daily close
- example: prepared food

Suggested database naming:

public.closing_stock_behavior enum:
- keep_at_branch
- record_as_unsold

products.closing_stock_behavior

The cashier must NEVER choose this per product during End Shift.

It is configured once through product management.

Use CURRENT product-management authorization.
Do not widen roles during this revision.

Historical closing reconciliation must snapshot the behavior used at the time
so later product edits do not rewrite history.

Migration strategy for EXISTING products must be considered.

Potential sensible mapping to evaluate:

old piece_stock -> keep_at_branch
old kg_meal    -> record_as_unsold

because old kg_meal represented prepared/meal products.

But VERIFY current project semantics first.

Do not infer behavior from product names.

If that mapping is not safe, propose an explicit configuration requirement.

--------------------------------------------------
F. QUANTIFIED WASTE
--------------------------------------------------

Waste is no longer occurrence-only.

New rule:

Waste quantity = whole PCS.

Examples:

Chicken waste: 3 pcs
Coke waste: 1 pc

Waste means:

damaged
spoiled
dropped
broken
otherwise unusable

Unsold is NOT the same thing as waste.

Existing historical shift_waste_occurrences rows may not have quantity.

The migration must preserve them.

Preferred compatibility model to evaluate:

add:

quantity bigint NULL

with constraint:

quantity IS NULL OR quantity > 0

Meaning:

NULL quantity
= historical occurrence-only record

positive quantity
= new PCS waste record

Do not fabricate quantity for old rows.

==================================================
G. PRODUCT-LEVEL SHIFT INVENTORY RECONCILIATION
==================================================

Cash reconciliation alone is no longer enough.

We need a product-level reconciliation record for each closing session.

Plan a dedicated table, suggested concept:

shift_product_reconciliations

The exact name may differ if Cursor finds a better fit.

It should be able to snapshot, at minimum:

- shift_id
- branch_id
- product_id
- closing_stock_behavior used
- opening quantity / or authoritative equivalent
- quantity received during session
- valid outgoing quantity during session
- POS sold quantity
- waste quantity
- expected remaining
- actual physical remaining
- discrepancy
- result:
  exact
  shortage
  excess
- unsold quantity
- carried quantity
- reconciled_at
- recorded_by

All operational quantities are whole PCS.

Historical reconciliation must not change if:
- product name changes
- closing behavior changes
- pricing changes

Use FKs where appropriate but snapshot critical semantics.

==================================================
H. INVENTORY FORMULA
==================================================

Approved conceptual formula:

Available Stock
=
Opening Stock
+ Received During Session
- Other Valid Outgoing Stock

Expected Remaining
=
Available Stock
- POS Sold
- Waste

Inventory Difference
=
Expected Remaining
- Actual Physical Count

Interpretation:

0
= exact

positive
= shortage

negative
= excess

The cashier never calculates this manually.

The database/server calculates it.

Determine which values should be:
- persisted snapshots
versus
- derived from immutable inventory movements.

Prefer auditability and deterministic historical reports.

==================================================
I. CLOSING STOCK RESULT
==================================================

After physical reconciliation:

KEEP_AT_BRANCH:

Actual remaining
→ becomes branch inventory after reconciliation
→ remains available next day

RECORD_AS_UNSOLD:

Actual remaining
→ recorded as unsold
→ removed from usable stock
→ ending usable branch stock = 0

Return to Main is NOT either of these.

Return to Main remains a separate manual stock-return process.

==================================================
J. END SHIFT / REMIT = FINAL SALES CUTOFF
==================================================

The confirmed business rule is:

Once the cashier begins End Shift / Remittance,
the booth is no longer accepting sales for that business day.

Even if:
- the mall remains open
- customers still exist
- unsold food remains

the POS session is finished.

This must eventually be protected server-side, not only UI-side.

Current shifts only have:

open
closed

Evaluate adding a cutoff marker such as:

closing_started_at
or
sales_cutoff_at

Preferred semantics:

NULL
= sales still open

timestamp set
= End Shift/Remittance has begun
= no additional sale may be confirmed for this shift

Do NOT necessarily add a new shift enum status unless needed.

Explain the safest design.

==================================================
K. CLOSING MUST ALSO FREEZE STOCK MUTATIONS
==================================================

This is an important concurrency requirement.

The cashier may spend several minutes:

- counting food
- counting drinks
- counting waste
- counting cash

During that time, inventory must not change underneath the reconciliation.

Once final closing begins, the plan must consider blocking/rejecting branch
inventory-changing operations such as:

- POS sale
- transfer receipt
- shipment issue receipt
- stock return creation
- any other selling-branch mutation

until reconciliation completes.

Do not solve this only in the UI.

Identify every RPC that can mutate selling-branch stock.

Plan deterministic row-locking / cutoff checks.

==================================================
L. AUTO-CLOSE / PENDING RECONCILIATION
==================================================

Current safety auto-close remains conceptually valid.

If auto-close happens:

DO NOT fabricate:

- waste
- actual remaining stock
- actual cash

Those remain pending.

However, with physical inventory reconciliation there is an additional
integrity issue:

A new selling session must NOT start and mutate stock before the previous
auto-closed session's physical inventory reconciliation is completed.

Otherwise the previous closing stock can no longer be reliably counted.

Therefore evaluate this rule:

If a branch/cashier has a closed shift with reconciliation_required=true
and no completed inventory/cash reconciliation:

start_cashier_shift must reject starting a new session until the pending
reconciliation is completed.

This should reuse the existing pending reconciliation UX where possible.

Explain any operational consequence.

==================================================
M. CASH RECONCILIATION REMAINS
==================================================

Do not remove the existing cash reconciliation behavior.

Expected Cash
=
sum of completed POS sales for the shift

Cash Difference
=
Expected Cash - Actual Cash

0 = exact
positive = shortage
negative = excess

Inventory reconciliation and cash reconciliation should complete atomically
when the cashier finalizes the close.

==================================================
N. INVENTORY MOVEMENT AUDIT
==================================================

The plan must decide how new stock loss/carry behavior appears in:

inventory_movements

Consider explicit audit movements for:

waste
unsold

and an inventory reconciliation adjustment for:

shortage
excess

Do not silently overwrite branch_inventory.

Every change to physical usable stock should have an auditable reason.

A likely design is:

waste:
negative movement

shortage/excess:
adjustment tied to shift reconciliation

unsold:
negative movement

keep_at_branch:
no removal movement after actual inventory is reconciled

Use reference_type / reference_id tied to the shift reconciliation.

Inspect existing movement-type enum and sign constraints before deciding.

==================================================
O. ACTIVE CURRENT INVENTORY COLUMN
==================================================

Current branch_inventory.quantity_on_hand is numeric(14,3).

Because new active stock is PCS-only, evaluate whether:

OPTION A:
convert branch_inventory.quantity_on_hand back to bigint

or

OPTION B:
keep numeric(14,3) for compatibility but add whole-number enforcement.

Historical inventory_movements must retain numeric(14,3), because historical
KG quantities may contain decimals.

Do not cast historical KG movements to integer.

My preference:

- branch_inventory = whole-number current operational stock
- historical movement/transfer snapshot quantities may remain numeric

But confirm migration safety.

==================================================
P. RETIRING products.inventory_mode
==================================================

Final active architecture should NOT offer inventory mode selection.

There should no longer be an active business choice between:

piece_stock
kg_meal

Evaluate safe retirement of:

products.inventory_mode
set_product_inventory_mode
products_protect_inventory_mode
guard_selling_branch_kg_stock
KG-specific parser behavior

However:

historical transaction snapshot columns may retain the old inventory_mode
enum to preserve truthful history.

Preferred final state:

products
→ no active inventory_mode business field

historical transaction tables
→ may retain inventory_mode snapshot for legacy rows
→ all future rows snapshot piece_stock if the column remains

If a staged retirement is safer, document exactly when the active column is
removed during Revision 7.

Do not leave kg_meal selectable after Revision 7.

==================================================
Q. PRODUCT CREATE / EDIT COMPATIBILITY
==================================================

Current:

create_complete_product(..., p_inventory_mode)

update_complete_product(..., p_inventory_mode default null)

Depend on the active inventory mode architecture.

Plan how these signatures will transition safely.

Possible compatibility approach:

- temporarily preserve parameter position/signature
- only accept NULL / piece_stock
- reject kg_meal as retired

or replace signatures cleanly if the app will be updated atomically.

Do not accidentally leave multiple conflicting overloads.

Do not weaken the existing atomic create/edit guarantees.

==================================================
R. TRANSFER HISTORY
==================================================

Historical transfer items may show:

quantity_sent = 10.500
inventory_mode = kg_meal
quantity_received = NULL

Those historical rows must remain understandable.

NEW transfers after Revision 7:

- PCS only
- quantity_sent whole number
- cashier confirms actual received PCS
- quantity_received is a real counted quantity
- discrepancy possible
- no Unmeasured KG concept

Do not rewrite old transfer history.

==================================================
S. RETURN HISTORY
==================================================

Historical stock-return data remains untouched.

New returns remain PCS.

The old rule:

KG-delivered meals cannot be returned by quantity

will become obsolete because active products are PCS.

Plan removal/retirement of that active restriction while preserving
historical snapshots.

==================================================
T. REPORT HISTORY
==================================================

Reports must eventually be able to distinguish:

legacy KG history
versus
new PCS activity

Do not delete snapshot columns that existing historical reports need without
a replacement.

Revision 7E will update report UI, but 7A must preserve enough source data.

==================================================
CUTOVER SAFETY — REQUIRED PLAN
==================================================

Before writing the migration, produce an explicit cutover procedure.

At minimum include:

1. Detect existing kg_meal products.
2. Detect their current branch_inventory balances.
3. Detect open KG transfers.
4. Detect open KG returns.
5. Detect unreconciled shifts.
6. Define what blocks deployment.
7. Define what data is snapshotted.
8. Define what active balances are reset.
9. Define which products become temporarily inactive.
10. Define how Main Manager establishes fresh PCS opening/current stock.
11. Define how selling branches receive their first PCS stock.
12. Define rollback/recovery strategy if migration fails.

Strong recommendation to evaluate:

For former kg_meal products:

- snapshot old live KG balance for audit
- do NOT convert it
- reset operational balance to 0
- mark product temporarily inactive
- preserve historical movements/transfers as KG
- require Main Manager to physically recount and enter PCS stock
- reactivation occurs only after valid PCS stock initialization

Do not implement this recommendation blindly.
First confirm it fits the existing architecture.

==================================================
SECURITY REQUIREMENTS
==================================================

Any new mutation RPC later introduced must follow existing hardening:

SECURITY DEFINER
SET search_path = ''

REVOKE from:
public
anon

GRANT only as required.

Authorization must remain inside the RPC.

Do not widen existing product/inventory permissions.

==================================================
CONCURRENCY REQUIREMENTS
==================================================

The plan must explicitly analyze races between:

- starting close vs confirm_sale
- starting close vs transfer receipt
- close reconciliation vs stock return
- close reconciliation vs auto-close
- previous pending reconciliation vs starting next shift
- closing stock adjustment vs product/branch inventory mutation

Identify the lock order required.

Preserve the current deterministic product-id locking pattern where relevant.

==================================================
MIGRATION RULES
==================================================

Do NOT edit deployed migrations.

The current deployed/latest sequence ends with:

20260928090000_fix_legacy_shift_reconciliation.sql
20260928100000_waste_daily_remittance_reports.sql
20260928110000_shipment_inventory_mode_concurrency.sql
20260928120000_atomic_product_edit.sql

Revision 7 must use NEW forward migration(s).

Do NOT create them yet during this planning step.

Do NOT run db push.

==================================================
PLAN OUTPUT REQUIRED
==================================================

Return a structured Revision 7A plan containing:

1. Current schema findings
2. Every table affected
3. Every enum affected
4. Every trigger affected
5. Every RPC/function affected
6. Historical KG preservation strategy
7. Existing kg_meal live-balance cutover strategy
8. Open transaction deployment blockers
9. Proposed new product closing behavior schema
10. Proposed quantified waste schema
11. Proposed shift product reconciliation schema
12. Proposed closing/sales cutoff model
13. Auto-close + pending reconciliation model
14. Proposed inventory movement audit model
15. products.inventory_mode retirement strategy
16. branch_inventory numeric/bigint decision
17. Product Create/Edit compatibility strategy
18. Transfer/return history compatibility
19. RLS / SECURITY DEFINER impact
20. Concurrency and lock-order analysis
21. Migration ordering
22. Backfill/data transformation rules
23. Tests required for 7A
24. Deployment/preflight checklist
25. Risks / unresolved questions

IMPORTANT:

If the plan discovers a point that requires a business decision rather than
a technical decision, STOP and identify it clearly.

Do not invent a business rule.

Do not start Revision 7B.

Do not implement the migration yet.

Return the PLAN for review first.