REVISION 7E — REPORTS, HISTORY, FINAL PCS CLEANUP & PRE-RELEASE VERIFICATION

PHASE: PLAN FIRST — DO NOT IMPLEMENT YET

Revisions 7A, 7B, 7C, and 7D are already implemented LOCALLY.

Do NOT:
- db push
- deploy
- perform production cutover
- edit existing 7A/7B/7C migrations
- introduce new business rules
- redesign unrelated screens

Return a detailed Revision 7E PLAN first.

==================================================
REVISION STATUS
==================================================

7A
- PCS schema/cutover
- closing_stock_behavior
- PCS reconciliation scaffolding
- historical KG preservation

7B
- PCS inventory/transfers/returns/POS
- real selling-branch stock
- leftover-return remains accountability/waste only
- historical KG formatting preserved

7C
- two-phase End Shift backend
- final sales cutoff
- inventory/cash reconciliation
- waste/unsold/carried
- freeze/no-reopen
- auto-close/pending reconciliation
- same-day final close protection

7D
- cashier End Shift / Remittance UX
- physical counts + waste + cash
- pending resume
- semantic exact/shortage/excess
- no active KG close UI

7E — THIS REVISION
- reports
- histories
- presentation cleanup
- remove stale active KG paths/copy
- update verification scripts
- final regression verification
- prepare codebase for final ZIP audit

==================================================
PRIMARY GOAL
==================================================

Revision 7E must make all reporting/history surfaces accurately reflect the
final PCS architecture while preserving truthful historical KG records.

CURRENT / NEW DATA:
→ PCS

HISTORICAL PRE-REVISION-7 KG DATA:
→ keep original KG / Unmeasured semantics where historically accurate

Never fake-convert historical KG to PCS.

Never rewrite historical meaning just to make all screens visually uniform.

==================================================
A. AUDIT ALL REPORT / HISTORY SURFACES
==================================================

Identify every relevant screen/component/service/RPC used for:

- Shift History
- Daily Remittance
- Cash Reconciliation History
- Inventory History
- Inventory Reconciliation History
- Waste History
- Unsold quantities/history
- Branch Performance
- Product Sales Summary
- Sales History
- Shift History
- Inventory by Branch
- Inventory Reconciliation
- Stock Returns / Return History
- Transfer History
- discrepancy/history screens
- Owner dashboard report cards
- Manager report/status views
- any downloadable/printable summaries if they already exist

Return the exact files/RPCs involved.

Do not invent new report modules that the project does not currently have.

==================================================
B. LIVE PCS FORMATTING
==================================================

All CURRENT/live operational quantities must display as whole PCS.

Examples:

25 pcs
1 pc
0 pcs

Do not display:

25.000 pcs
25 kg
Not tracked
Unmeasured

for current Revision-7 PCS operations.

Use existing centralized formatter helpers where possible.

Avoid duplicated PCS formatting logic across report screens.

==================================================
C. HISTORICAL KG TRUTHFULNESS
==================================================

Old historical rows whose snapshot inventory_mode = kg_meal must remain
truthful.

Examples may include:

10.500 kg
Unmeasured

depending on what the historical row actually recorded.

Do NOT globally replace historical KG text with PCS.

Do NOT use the current product.inventory_mode to reinterpret old rows.

Use row/snapshot metadata.

Audit:

- transfers
- returns
- inventory movements
- old shift reconciliation data
- old waste records
- old report rows

Historical records must remain historically correct even though the current
product is now PCS-only.

==================================================
D. SHIFT HISTORY
==================================================

Modern PCS shift history should clearly show useful close information.

At summary level consider:

- business date
- branch
- start time
- sales cutoff/end time
- expected cash
- actual cash
- cash result:
  Exact / Shortage / Excess
- reconciliation status:
  complete / pending where applicable

Do not expose raw internal flags unless necessary.

Legacy cash-only shifts must still render correctly.

Do not require old shifts to have PCS inventory reconciliation rows.

==================================================
E. SHIFT / INVENTORY RECONCILIATION DETAIL
==================================================

For a finalized PCS shift, detailed inventory reconciliation should be able to
show per product:

- product name snapshot
- SKU snapshot if useful
- opening stock
- received
- outgoing
- sold
- signed adjustments where useful
- waste
- expected remaining
- actual remaining
- semantic inventory result
- unsold quantity
- carried quantity

The UI should communicate semantic:

Exact
Shortage
Excess

Do not make users interpret the raw stored discrepancy sign.

Remember:

inventory persisted discrepancy:
actual - expected

Cash persisted difference:
expected - actual

Report/UI must not accidentally reverse shortage/excess.

==================================================
F. WASTE REPORTING
==================================================

New PCS waste is quantified.

Current waste reports/history must show quantity in PCS.

Example:

Chicken Meal — 5 pcs waste

Not merely:
Waste occurred

Preserve legacy occurrence-only / KG history where historical schema did not
contain PCS quantity.

Do not fabricate historical quantities.

==================================================
G. UNSOLD REPORTING
==================================================

Revision 7C now creates explicit `unsold` inventory movements for:

record_as_unsold

products.

Audit whether current reports expose this meaning.

Where appropriate, reports/history should distinguish:

Sold
Waste
Unsold
Carried

Do not label unsold as waste.

Do not label keep_at_branch carried stock as unsold.

Do not treat unsold as a return-to-Main.

==================================================
H. CARRIED STOCK
==================================================

For keep_at_branch products:

actual remaining becomes carried usable stock.

Where a reconciliation report shows close disposition, use understandable
copy such as:

Carried to next day: 18 pcs

Do not expose:

keep_at_branch

unless an admin-facing technical context truly needs the enum.

==================================================
I. BRANCH PERFORMANCE
==================================================

Audit Branch Performance completely.

Current/live PCS behavior:

- Items sold or Units sold — use the terminology already settled in the app
- current branch stock shown as PCS
- no KG-specific "Not tracked"
- unknown/unavailable values remain `—`, not fake `0 pcs`

Do not infer zero when data is unavailable.

Ensure former kg_meal products now participate normally in PCS sales and stock
performance.

==================================================
J. PRODUCT SALES SUMMARY
==================================================

Sales quantities are item/PCS counts.

Do not use KG language.

Revenue remains money.

Clearly separate:

quantity sold
revenue

Avoid labels implying weight.

==================================================
K. DAILY REMITTANCE / CASH REPORTING
==================================================

Use server reconciliation values.

Display:

Expected Cash
Actual Cash
Difference
Result

Semantic mapping:

expected - actual = 0
→ Exact

positive
→ Shortage

negative
→ Excess

Prefer displaying:

₱50 shortage

instead of:

Difference: +50

Do not recalculate historical authoritative values from current product data.

==================================================
L. INVENTORY HISTORY / MOVEMENT TYPES
==================================================

Audit movement-history rendering for final Revision-7 movement types.

Current PCS movement types may include:

- opening_stock
- adjustment
- transfer_in
- transfer_out
- sale
- return_out
- waste
- unsold

and any other existing legitimate movement type.

Each should have user-friendly labels.

Examples:

Opening stock
Adjustment
Received transfer
Sent transfer
Sale
Returned leftover
Waste
Unsold at close

Do not call `return_out` a reusable Main restock.

Returned leftovers remain accountability/waste-return behavior.

==================================================
M. RETURN HISTORY
==================================================

Preserve the final locked return semantics.

Selling branch:
- return quantity in PCS
- usable stock deducted

Main:
- actual received quantity
- discrepancy exact/shortage/excess
- NO usable Main inventory increase
- NO sellable return_in

History/report copy must not imply:

"Restocked to Main"

Prefer language such as:

Leftover return received
Accountability return
Received quantity

depending on existing project terminology.

Historical KG returns stay historical KG.

==================================================
N. TRANSFER HISTORY
==================================================

New transfers:
→ PCS

Historical KG transfers:
→ historical snapshot formatting

Preserve:

sent
received
actual received
discrepancy
status

Do not show historical KG transfer as PCS merely because product is now PCS.

==================================================
O. REPORT DATE / BUSINESS DATE
==================================================

Audit report grouping/date labels against the system's Manila business-date
semantics.

End Shift is a daily branch close.

Ensure reports do not accidentally group a late-night shift under the wrong
day because of device/local UTC conversions.

Reuse established server timestamps/business-date helpers where available.

Do not add new business-date rules.

==================================================
P. HISTORICAL PRODUCT EDIT SAFETY
==================================================

Reports must use historical snapshots where available.

A later Product edit must not rewrite old report meaning.

Especially:

- product name snapshot
- SKU snapshot
- inventory mode snapshot
- closing behavior snapshot

where the corresponding historical table stores it.

Do not unnecessarily replace snapshot data with the live products table.

==================================================
Q. PENDING RECONCILIATION PRESENTATION
==================================================

Reports/history should not present a pending shift as fully finalized.

If a shift is closed but pending reconciliation:

show an appropriate pending state.

Do not fabricate:

- actual cash
- physical remaining
- waste
- unsold
- exact/shortage/excess

if they have not been submitted.

==================================================
R. LEGACY CASH-ONLY SHIFTS
==================================================

Pre-Revision-7 shifts may have:

inventory_reconciliation_required = false

and no product reconciliation rows.

Reports must handle them gracefully.

Show their historical cash reconciliation.

Do not show:

"No inventory reconciliation = error"

when it is a valid legacy shift.

==================================================
S. ACTIVE KG CLEANUP AUDIT
==================================================

Search the ACTIVE application/source for remaining:

kg_meal
KG
kilogram
Not tracked
Unmeasured
MAX_POS_MEAL_QUANTITY
InventoryModeField
meal-specific active stock logic
old End Shift KG waste toggles
old kg skip branches
old create/edit inventory-mode selection
old active kg receipt logic

Classify every remaining occurrence as:

1. REQUIRED HISTORICAL COMPATIBILITY
2. MIGRATION / LEGACY TEST FIXTURE
3. DEAD / STALE ACTIVE LOGIC TO REMOVE

Do NOT blindly delete every `kg_meal` string.

Historical snapshots, old migrations, and compatibility tests are expected to
retain KG terminology where necessary.

Remove only stale ACTIVE behavior/copy.

==================================================
T. DEAD CODE / TYPE CLEANUP
==================================================

Audit for dead artifacts left by 7A–7D, such as:

- unused inventory mode form types
- old KG close form interfaces
- obsolete hooks/services
- old close_cashier_shift client references
- dead meal quantity constants
- dead formatters used only by removed active flows
- stale comments describing KG active behavior
- unused imports/components

Be conservative.

Do not remove helpers still required for historical KG rendering/tests.

==================================================
U. LIVE VERIFICATION SCRIPT — REQUIRED
==================================================

Known issue:

milestone10_5_live_verification.mjs

still references the removed:

close_cashier_shift

Update the live verification script to use the Revision-7 close flow:

begin_cashier_shift_close
→ finalize_cashier_shift_reconciliation

If the script verifies legacy behavior too, preserve that separately as
appropriate.

Audit all verification/manual scripts for obsolete RPC names.

No live remote execution unless explicitly requested.

This revision only updates them so they are ready.

==================================================
V. FINAL RPC / SERVICE REFERENCE AUDIT
==================================================

Search for stale references to replaced/deprecated RPCs, including:

close_cashier_shift
old KG close APIs
old receive/skip KG paths

Determine whether each remaining reference is:

- historical migration definition
- intentional compatibility test
- dead active caller

No active client caller should depend on a removed RPC.

==================================================
W. TRUE POSTGRES CONCURRENCY VERIFICATION
==================================================

PGlite has not proven true parallel-session locking.

Plan a real PostgreSQL verification script/test if the project's test tooling
supports it without touching production.

At minimum verify design/scenario coverage for:

1. two simultaneous POS sales competing for the same limited stock
2. sale vs begin_cashier_shift_close
3. shipment receipt vs begin_cashier_shift_close
4. two simultaneous finalize attempts with identical payload
5. conflicting finalize attempts

If a local/ephemeral real PostgreSQL integration environment is available:
plan to run it.

If unavailable:
prepare the test/script and report that true concurrency remains unexecuted.

Do NOT use production for concurrency testing.

==================================================
X. FINAL SECURITY / CLIENT WRITE AUDIT
==================================================

Audit that the mobile/client app has no direct mutation of:

- branch_inventory
- inventory_movements
- shift_product_reconciliations
- shift_product_close_baselines
- shift_reconciliations
- shifts lifecycle fields

All authoritative mutations should go through approved RPCs.

Also audit:
- service role key absent from app source
- internal helpers not granted to authenticated users
- public/anon execute revoked where required
- no permission widening introduced by 7A–7D

If a genuine security defect is discovered:
report it explicitly.

==================================================
Y. FINAL DATA SEMANTICS AUDIT
==================================================

Verify the completed architecture still satisfies:

DELIVERY
= PCS

MAIN INVENTORY
= PCS

TRANSFER
= PCS

SELLING RECEIPT
= actual counted PCS

SELLING INVENTORY
= tracked PCS

POS
= PCS and deducts stock

WASTE
= quantified PCS

UNSOLD
= quantified PCS

KEEP_AT_BRANCH
= actual usable remaining stays

RECORD_AS_UNSOLD
= actual usable remaining becomes unsold and usable stock becomes 0

LEFTOVER RETURN TO MAIN
= accountability/waste only, no reusable Main restock

EXPECTED CASH
= server-completed POS total

ACTUAL CASH
= cashier entered

END SHIFT
= final daily sales cutoff

No KG-to-meal conversion.
No recipe/BOM conversion.
No decimal PCS for new operations.

==================================================
Z. NO SILENT SCHEMA/BUSINESS CHANGES
==================================================

7E should mainly be:

- reports
- history
- formatting
- cleanup
- tests
- verification scripts

No SQL migration is expected.

If a genuine backend/schema defect is discovered:

STOP and report it.

Do not silently add migration/business behavior.

==================================================
AA. FINAL TEST / VERIFICATION PASS
==================================================

Plan to run:

- test:7a
- test:7b
- test:7c
- test:7d
- new test:7e
- every package.json regression script
- legacy KG compatibility suites
- report/history suites
- return/discrepancy suites
- transfer suites
- inventory suites
- POS suites
- closing/remittance suites
- npm run typecheck

Also audit test files that use direct SQL shortcuts.

Direct fixture manipulation is acceptable only inside tests.

Confirm there is no equivalent shortcut in application/services.

==================================================
AB. FINAL ZIP PREPARATION CHECKLIST
==================================================

Do NOT create a ZIP in this planning step.

But 7E should leave the repository ready for the final independent audit.

At implementation completion, report:

- git/worktree-equivalent changed file list if available
- all new migrations 7A–7C in exact order
- no 7D/7E migration unless explicitly approved
- tests all green
- typecheck green
- stale RPC search results
- active KG search classification
- security audit result
- concurrency verification status
- known remaining concerns

After 7E implementation, STOP.

The user will then provide the COMPLETE FINAL PROJECT ZIP for independent
source-level audit.

==================================================
AC. 7E TEST REQUIREMENTS
==================================================

Plan tests for at least:

1. Live inventory reports show whole PCS.
2. Current reports do not show KG/Not tracked/Unmeasured.
3. Historical KG transfer still shows KG.
4. Historical KG return remains truthful.
5. Historical KG movement remains truthful.
6. Modern shift history supports PCS reconciliation.
7. Legacy cash-only shift history remains valid.
8. Pending shift does not fabricate finalized values.
9. Cash Exact display.
10. Cash Shortage display.
11. Cash Excess display.
12. Inventory Exact display.
13. Inventory Shortage display.
14. Inventory Excess display.
15. Waste quantity shown in PCS.
16. Unsold shown separately from waste.
17. Carried stock shown separately from unsold.
18. record_as_unsold not shown as return.
19. keep_at_branch not shown as waste.
20. Branch Performance live stock = PCS.
21. Unknown Branch Performance quantity = `—`, not 0.
22. Product Sales Summary uses items/units, not KG.
23. Return history does not imply Main restock.
24. New transfer history PCS.
25. Historical transfer history uses snapshot KG.
26. Historical product rename does not rewrite snapshot name where snapshot exists.
27. Same for SKU/closing metadata where applicable.
28. Business-date grouping consistent with Manila semantics.
29. Old close_cashier_shift has no active client caller.
30. milestone10_5_live_verification uses Revision-7 close APIs.
31. Active kg_meal paths classified; stale active logic removed.
32. No direct client branch_inventory mutation.
33. No direct client reconciliation-table mutation.
34. Service-role secret absent from app source.
35. Internal helpers remain non-client.
36. 7A tests pass.
37. 7B tests pass.
38. 7C tests pass.
39. 7D tests pass.
40. Full regression passes.
41. npm run typecheck passes.

If a real local PostgreSQL concurrency test is possible, additionally test:

42. concurrent sale vs sale
43. sale vs begin-close
44. receipt vs begin-close
45. duplicate simultaneous finalize
46. conflicting simultaneous finalize

Do not claim true-concurrency verification if only PGlite was used.

==================================================
AD. PLAN OUTPUT REQUIRED
==================================================

Return a structured Revision 7E PLAN containing:

1. Report/history screens discovered
2. Services/RPCs used by each
3. Live PCS formatting changes
4. Historical KG preservation strategy
5. Shift History changes
6. Inventory reconciliation detail changes
7. Waste reporting changes
8. Unsold/carried reporting changes
9. Branch Performance changes
10. Product Sales Summary changes
11. Daily remittance/cash changes
12. Inventory movement-history changes
13. Return-history changes
14. Transfer-history changes
15. Manila business-date handling
16. Historical snapshot safety
17. Pending/legacy shift handling
18. Active KG occurrence audit/classification
19. Dead-code/type cleanup
20. Deprecated RPC/reference cleanup
21. milestone10_5_live_verification update plan
22. Security/client-write audit
23. Final data-semantics audit
24. Real PostgreSQL concurrency verification approach/status
25. Files expected to change
26. Whether any backend/schema defect was discovered
27. Tests to add/update
28. Final regression procedure
29. Final ZIP readiness checklist
30. Remaining risks/concerns
31. Any unresolved business decision

If a genuine business decision is missing:
STOP and identify it.

If a genuine 7A/7B/7C backend defect is found:
STOP and report it.

Do not implement yet.

Return the Revision 7E PLAN for final review.