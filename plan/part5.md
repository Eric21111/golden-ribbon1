PART 5 OF 5:
FINAL REGRESSION CLEANUP + FULL-SYSTEM VERIFICATION

This is the final milestone.

Parts 1–4 are already implemented, and Parts 1/2/4 database migrations are
deployed.

Part 5 must NOT redesign business rules.

Primary goals:

1. Find and remove only proven stale/dead leftovers.
2. Fix stale tests that no longer reflect the approved architecture.
3. Run a complete regression sweep.
4. Verify database/RPC security and migration state.
5. Verify no old architecture path can still be accidentally used.
6. Produce a final system health report.

Do not add features.

==================================================
1. PRODUCTFORM — REINSPECT, DO NOT AUTOMATICALLY KEEP
==================================================

Reinspect ProductForm and every test assertion that references it.

For each assertion, classify it as:

A. current architectural invariant
B. obsolete UI copy
C. test-only legacy behavior

If it protects a current invariant:
retarget the assertion to the CURRENT Create/Edit wizard or active product UI
that owns the behavior.

Then re-check ProductForm.

If ProductForm is:

- unrouted
- unimported
- unused by active production code
- no longer needed by a legitimate current test

remove it.

If there is a genuine runtime/compatibility reason to keep it:
document that concrete reason.

Do not keep dead production code solely because a stale test references it.

==================================================
2. SELLING BRANCH MANAGER ROLE — VERIFY ACTUAL CURRENT USAGE
==================================================

Do not treat account_management selling-manager asserts as valid solely
because roles.ts contains "Selling Branch Manager".

Inspect:

- role type/schema
- employee/account-management UI
- route guards
- Selling Branch Manager routes
- RPC authorization
- any branch-role restrictions
- tests that use the role

Then classify the role as:

A. active current role
B. compatibility/account-record role with limited current behavior
C. stale role architecture

If A:
keep tests, but make sure they assert CURRENT permissions.

If B:
keep only the compatibility behavior that is actually required.

If C:
update stale source/tests.

Do not change production role rules if the intended behavior is ambiguous;
report the ambiguity first.

==================================================
3. DO NOT ADD A SEMICOLON-BASED NPM REGRESSION SCRIPT
==================================================

Do not add a package.json test:regression command that relies on:

command1 ; command2 ; command3

Do not rely on shell-specific command separators in package.json.

Preferred options:

A. Do not add test:regression at all; run the suites from the audit.

OR

B. Add a small Node-based regression runner that:
- sequentially executes the approved ACTIVE tests
- excludes destructive/live tests
- records PASS/FAIL
- exits non-zero if an active test fails
- works cross-platform

This runner is optional.

==================================================
4. LOCAL VS REMOTE DATABASE AUDIT MUST BE EXPLICIT
==================================================

See the dedicated LOCAL / RECONSTRUCTED vs REMOTE / LINKED sections below.

==================================================
CURRENT APPROVED ARCHITECTURE
==================================================

Treat these as fixed requirements.

PRODUCTS

- create_complete_product is the trusted atomic creation path.
- update_complete_product is the trusted atomic Product Edit path.
- Product Edit sends inventory_mode in the same RPC transaction.
- raw inventory_mode UPDATE remains protected.
- standalone set_product_inventory_mode SQL RPC may remain for intentional
  mode-only admin/test use.
- old direct product INSERT app paths have been removed.
- piece_stock and kg_meal are product-level inventory modes.

KG_MEAL

- Main Branch tracks KG.
- Selling branches do NOT track KG on-hand.
- kg_meal POS quantity is meal count, not KG.
- no KG-to-meal conversion.
- no BOM/recipe conversion.
- no fake branch KG balance.
- transfer KG receipt is confirmed but unmeasured.
- NULL KG received != zero.
- selling branch KG inventory = Not tracked.
- Main KG uses 3 decimal places.
- piece quantities remain whole-number counts.

TRANSFERS

- transfer item inventory_mode is snapshotted.
- mixed piece/KG transfers are supported.
- confirm_shipment_arrival and report_shipment_issue now lock relevant
  products FOR SHARE before inventory mutation.
- any snapshot/live inventory_mode mismatch rejects receipt.
- matching piece receipt is counted.
- matching kg receipt is unmeasured.
- no quantity conversion.

RETURNS

- current leftover/return behavior remains as already implemented.
- kg_meal waste does not restore KG inventory.
- piece-stock return behavior remains according to current approved RPCs.
- do not redesign returns in Part 5.

WASTE

- waste is occurrence-only.
- no KG / pcs / serving quantity.
- no restock.
- no discrepancy created from waste.
- reconciled zero-occurrence shift = No waste recorded.
- unreconciled shift = Waste pending/unknown.

SHIFTS / REMITTANCE

- expected cash comes from completed POS sales.
- actual cash entered during reconciliation.
- positive expected-actual = shortage.
- negative expected-actual = excess.
- 9 PM Asia/Manila auto-close is safety close.
- auto-close leaves reconciliation pending.
- legacy historical shifts do not become fake pending shifts.
- business date derives from shift ended_at in Asia/Manila.
- pending actual cash is NULL / unknown, not zero.

AUTHORIZATION

Preserve current approved Owner / Main Branch Manager / Cashier behavior.

Do not widen permissions.

==================================================
PART 5 — INSPECT FIRST
==================================================

Before editing anything, perform a repository-wide inspection.

Inspect:

- package.json scripts
- tests/
- app/
- src/
- supabase/migrations/
- src/types/database.ts
- src/types/models.ts
- service files
- hooks
- routes/layouts
- docs only when needed to determine whether something is stale

Search globally for:

createProduct
updateProduct
setProductInventoryMode
from('products').insert
end_cashier_shift
close_cashier_shift
CreateReturnScreen
createReturn
ProductForm
Math.min
"units"
"0 in stock"
"Pending"
quantity_received
inventory_mode
reconciliation_required
shift_reconciliations
shift_waste_occurrences
report_branch_shift_remittances
report_branch_shift_waste
update_complete_product
set_product_inventory_mode
confirm_shipment_arrival
report_shipment_issue

Also search for:

TODO
FIXME
deprecated
legacy
archive
unused

Do not delete things merely because their names look old.

==================================================
KNOWN CLEANUP CANDIDATES FROM EARLIER REVIEWS
==================================================

These were previously identified and should be re-checked against the CURRENT
source before changing them.

--------------------------------------------------
1. STALE milestone11_3_archive TEST
--------------------------------------------------

Earlier source review found an expectation mismatch involving numeric values
such as:

"90.000"

vs:

90

Re-inspect the current test.

If it still assumes old integer/string behavior that is no longer valid after
numeric(14,3):

update the TEST expectation to reflect the actual approved schema.

Do NOT change production code just to satisfy an obsolete assertion.

If the test is truly obsolete and fully superseded, document why before
removing it.

Prefer updating useful regression coverage over deleting it.

--------------------------------------------------
2. SELLING BRANCH MANAGER / account_management
--------------------------------------------------

See section 2 above. Classify as A / B / C from actual current usage before
editing tests. Do not treat roles.ts as sufficient proof that the role is
active.

--------------------------------------------------
3. CreateReturnScreen / createReturn
--------------------------------------------------

These were intentionally deferred from Part 4.

Re-check whether:

src/features/returns/CreateReturnScreen.tsx

and the old:

createReturn

wrapper are still:

- unrouted
- unimported
- unused by tests
- superseded by the current return flow

If ALL are true:

remove them cleanly.

If there is any legitimate current caller:
keep them and explain.

Do not remove:

create_stock_return SQL RPC

if it is part of the valid current architecture.

--------------------------------------------------
4. ProductForm
--------------------------------------------------

See section 1 above. Reinspect. Classify each assertion as A / B / C.
Retarget current invariants. Then remove ProductForm if unused. Do not keep
it automatically because a test pins copy in it.

--------------------------------------------------
5. end_cashier_shift
--------------------------------------------------

Current architecture intentionally keeps the DB RPC as a rejection/compatibility
guard.

Therefore:

- active app code must NOT call it
- close_cashier_shift remains the valid close path
- the reject RPC/type may remain intentionally

Do not remove the DB rejection guard merely because it is old.

--------------------------------------------------
6. old Product mutation paths
--------------------------------------------------

Part 4 should already have removed:

createProduct
updateProduct
setProductInventoryMode TypeScript wrapper
useCreateProduct
useUpdateProduct

Verify they are actually gone from active app code.

Do not remove:

set_product_inventory_mode SQL RPC

because it remains an intentional protected server operation.

==================================================
TEST / SOURCE CONSISTENCY
==================================================

A stale test is not automatically a production defect.

When a test fails:

1. identify what assumption it is asserting
2. compare that assumption to the CURRENT approved architecture
3. if production violates current rules:
   fix production
4. if test asserts retired behavior:
   update/remove the stale assertion

Never change production to restore behavior we intentionally removed.

Document every stale test that is changed.

==================================================
LOCAL / RECONSTRUCTED VERIFICATION
==================================================

These checks reconstruct expected catalog state from the repository.
They do NOT prove the linked/deployed database matches.

Examples:

- migration order in repository
- PGlite schema reconstruction
- function definitions reconstructed from migrations
- source-level grants/search_path assertions

Inspect migration history locally.

Verify the expected final sequence includes, in order:

20260928090000_fix_legacy_shift_reconciliation.sql
20260928100000_waste_daily_remittance_reports.sql
20260928110000_shipment_inventory_mode_concurrency.sql
20260928120000_atomic_product_edit.sql

Do not edit deployed migrations.

Part 5 should require NO migration unless a genuine unresolved database defect
is discovered.

If a new DB migration appears necessary:

STOP.

Report:

- exact defect
- affected RPC/table
- why app-only cleanup cannot solve it
- proposed forward migration

Do not create it without review.

==================================================
REMOTE / LINKED SUPABASE VERIFICATION
==================================================

Examples, if safely available:

- applied migration history
- actual deployed pg_proc signatures
- actual deployed SECURITY DEFINER/search_path
- current grants

Do NOT run destructive live tests.

If remote read-only catalog inspection is not available or not performed,
state this explicitly in the final report.

Do not claim the deployed database catalog was verified based only on PGlite
or migration source.

No db push.

==================================================
RPC SIGNATURE AUDIT (LOCAL / RECONSTRUCTED)
==================================================

This audit reconstructs signatures from migration source and PGlite.
Record remote/deployed signatures separately under REMOTE / LINKED.

Verify current intended callable signatures.

At minimum:

update_complete_product

Must have exactly ONE callable function signature.

Expected behavior:

- 10 formal parameters
- final p_inventory_mode has DEFAULT NULL
- old 9-argument calls resolve through the default
- no obsolete 9-arg overload exists

Verify:

report_branch_shift_remittances

has only the intended current signature.

Verify no old overload was accidentally left behind.

Do the same for any RPC where recent migrations changed a signature.

==================================================
SECURITY DEFINER AUDIT (LOCAL / RECONSTRUCTED)
==================================================

Reconstruct from migration source and PGlite. Record deployed
SECURITY DEFINER/search_path/grants separately under REMOTE / LINKED.

For recently modified SECURITY DEFINER functions, verify:

- SECURITY DEFINER is still present where intended
- hardened search_path is still present
- PUBLIC / anon execute is not accidentally granted
- authenticated execute matches intended roles
- authorization is still enforced inside the RPC

At minimum inspect:

create_complete_product
update_complete_product
set_product_inventory_mode
confirm_shipment_arrival
report_shipment_issue
close_cashier_shift
reconcile_closed_shift
report_branch_shift_remittances
report_branch_shift_waste

Do not alter security unless inspection finds a concrete regression.

==================================================
DIRECT TABLE MUTATION AUDIT
==================================================

Search active client code for dangerous direct writes that bypass trusted RPCs.

PRODUCTS

No active:

.from('products').insert(...)

for creation.

No direct inventory_mode update.

--------------------------------------------------

INVENTORY

Review direct writes to:

branch_inventory
inventory_movements
stock_transfers
stock_transfer_items
stock_returns
stock_return_items
shifts
shift_reconciliations
shift_waste_occurrences

If current architecture intentionally requires RPC-only mutation, verify app
code is following it.

Do not broadly rewrite valid direct read queries.

==================================================
INVENTORY MODE SNAPSHOT AUDIT
==================================================

Verify historical displays/operations use snapshotted inventory_mode where
required.

At minimum:

- transfer items
- return items
- inventory movements/history

Current live inventory/product screens use live product mode.

Historical transactions must not reinterpret old rows using today's mode.

==================================================
UNIT AUDIT
==================================================

Search active user-facing source for remaining problematic generic unit
phrases.

Do NOT blindly replace every occurrence of "units".

Classify each occurrence.

Examples:

LIVE STOCK
should be:
kg / pcs / Not tracked

SALES COUNT
"units sold" may legitimately mean number of meals/items sold, but consider
whether the wording is confusing.

If the UI knows it represents sales quantity across mixed products, a more
neutral label such as:

Items sold

may be clearer than:

Units sold

Only change wording if semantics improve without changing calculations.

Never label meal sales as kg.

==================================================
PENDING / NULL / ZERO AUDIT
==================================================

Verify no relevant active UI still conflates:

0
NULL
Pending
Unmeasured
Not tracked

Expected:

0
= actual numeric zero

NULL KG receipt after confirmed receipt
= Unmeasured

transfer genuinely waiting receipt
= Pending

selling-branch kg_meal live stock
= Not tracked

pending remittance actual cash
= unknown / —

Do not alter already-correct paths.

==================================================
REPORTING AUDIT
==================================================

Verify current reporting still follows:

REMittance:
- business date from ended_at Asia/Manila
- expected includes eligible shifts
- actual reconciled only
- zero reconciled → actual NULL
- genuine reconciled ₱0 remains 0
- shortage/excess separate
- pending expected separate
- legacy false/no-remittance omitted
- reconciled legacy/pre-flag rows still visible if applicable

WASTE:
- source built from eligible shifts, not occurrences alone
- pending shift appears even with zero occurrences
- reconciled zero occurrence = No waste recorded
- pending != No waste
- occurrence only, no quantity

Branch Performance:
- selling KG stock Not tracked
- no pcs + kg arithmetic

==================================================
PRODUCT EDIT FINAL AUDIT
==================================================

Verify active Product Edit save path performs exactly:

UI
→ one updateCompleteProduct mutation
→ one update_complete_product RPC

It must NOT call:

setProductInventoryMode

from the UI/service path.

Verify:

- inventoryMode required in current UpdateCompleteProductInput
- current UI always sends it
- failure leaves form open
- no client-side rollback
- query invalidation still works
- success behavior still works

==================================================
PRODUCT CREATE FINAL AUDIT
==================================================

Verify Create Product still uses:

create_complete_product

and remains:

- atomic
- explicit default variant/base price behavior
- correct default sort_order
- server-derived base/default values
- correct inventory_mode support
- correct auth

Do not modify unless regression is found.

==================================================
FULL TEST INVENTORY
==================================================

Inspect:

package.json
tests/

Build a list of EVERY meaningful non-GUI regression suite in the repository.

Do not rely only on the tests we remembered manually.

Classify tests as:

ACTIVE
STALE-BUT-UPDATED
INTENTIONALLY-ARCHIVED
UNSAFE/ENVIRONMENT-SPECIFIC

For every test not run, document why.

Do not silently skip failing suites.

==================================================
MINIMUM REQUIRED REGRESSION SUITES
==================================================

At minimum run current equivalents of:

TYPECHECK

npm run typecheck

--------------------------------------------------

PRODUCT

create_product_integrity
update_complete_product_integrity
atomic_product_edit
product_active_after_opening
repeat_opening_stock
pos_and_sku

--------------------------------------------------

KG / INVENTORY

kg_meal_shift_reconciliation
kg_ui_formatting
shipment_inventory_mode_concurrency

--------------------------------------------------

TRANSFERS

milestone12_2_variants_and_transfer_catalog
milestone12_3_cashier_shipment_arrival

plus any additional transfer suites discovered.

--------------------------------------------------

POS

cashier_pos_stock

plus any other POS regression suites discovered.

--------------------------------------------------

RETURNS

return_inventory_integrity
leftover / waste-related return suites
any current return discrepancy tests

--------------------------------------------------

SHIFTS / REMITTANCE / WASTE

legacy_shift_reconciliation
waste_daily_remittance_reports
kg_meal_shift_reconciliation

plus any shift close / auto-close tests discovered.

--------------------------------------------------

REPORTS

branch_performance_return_badge
inventory reconciliation/report suites
remittance report suites
waste report suites

--------------------------------------------------

AUTH / ACCOUNTS

account_management after A/B/C selling-manager classification
role/branch authorization suites

--------------------------------------------------

DISCREPANCIES

transfer discrepancy
return discrepancy
resolution lifecycle tests

if present.

==================================================
FULL TEST EXECUTION RULE
==================================================

Prefer running all meaningful test files discovered under tests/.

If there are many, use option A or B from section 3. Do not add a
semicolon-based npm script.

Do not create new production architecture merely to run tests.

For each test:

PASS
FAIL
UPDATED STALE TEST
SKIPPED WITH REASON

If a failure occurs:

do not immediately patch.

Classify first:

1. real regression
2. stale test expectation
3. environment/test harness problem
4. intentionally retired behavior

Then fix only the correct layer.

==================================================
OPTIONAL FINAL TEST COMMAND
==================================================

See section 3 above.

Preferred options:

A. Do not add test:regression at all; run the suites from the audit.

OR

B. Add a small Node-based regression runner that:
- sequentially executes the approved ACTIVE tests
- excludes destructive/live tests
- records PASS/FAIL
- exits non-zero if an active test fails
- works cross-platform

This runner is optional.

Do not rely on shell-specific command separators in package.json.
Do not add GUI/mobile automation.

==================================================
FINAL SOURCE CLEANUP
==================================================

After all regressions are green:

remove:

- unused imports introduced by previous milestones
- orphaned types from removed product helpers
- proven-dead Product architecture code (ProductForm only after A/B/C retarget)
- proven-dead return screen/wrapper only if inspection confirms it
- stale comments describing removed behavior
- stale UI copy such as "saved separately" if any remains

Do not do stylistic refactors.

Do not reformat unrelated files.

==================================================
FINAL DOCUMENTATION CONSISTENCY
==================================================

Inspect only relevant project docs if they describe the architecture we just
changed.

Update obviously stale technical statements such as:

- Product Edit mode saved separately
- all leftovers automatically returned
- selling branches track KG
- fixed KG-to-meal conversion
- old end_cashier_shift behavior
- Products uses ProductForm (docs/employees-tab.md)
- Selling Branch Manager described as a live ops login, if classification
  is B or C

Do not spend Part 5 rewriting all documentation.

Only update docs that would mislead future development.

==================================================
NO DATABASE PUSH
==================================================

Part 5 should normally create no migration.

Do not run:

npx supabase db push

If no migration is created, there is nothing to deploy at DB level.

App/test/source cleanup remains local until normal app deployment.

==================================================
ACCEPTANCE CRITERIA
==================================================

Part 5 is complete only when:

[ ] TypeScript typecheck passes.

[ ] All meaningful active regression suites pass.

[ ] Every failing stale test was explicitly reviewed, not blindly changed.

[ ] No active unauthorized direct product INSERT path exists.

[ ] Product Edit uses one atomic mutation.

[ ] Exactly one update_complete_product signature exists.

[ ] Old 9-arg calls still resolve via default parameter.

[ ] Product creation remains atomic.

[ ] Mode conversion remains concurrency-safe with shipment receipt.

[ ] Snapshot/live transfer mismatch is rejected.

[ ] Raw inventory_mode updates remain protected.

[ ] Main KG stock is formatted correctly.

[ ] Selling KG stock is Not tracked.

[ ] POS kg_meal quantities remain meal counts.

[ ] No KG-to-meal conversion exists.

[ ] Waste remains occurrence-only.

[ ] Pending remittance actual cash remains unknown/null, not zero.

[ ] Legacy shifts do not appear as fake pending reconciliation.

[ ] Historical transaction units use snapshots.

[ ] Piece and KG quantities are never numerically summed together.

[ ] Current receipt UI distinguishes Pending / Unmeasured / zero.

[ ] No active client path uses end_cashier_shift as the valid close operation.

[ ] SECURITY DEFINER/search_path/grants remain hardened.

[ ] Proven dead code identified for this milestone is cleaned safely.

[ ] No unexplained failing/skipped regression test remains.

==================================================
IF A REAL NEW BUG IS FOUND
==================================================

Do not hide it in cleanup.

Report:

- severity
- affected feature
- reproduction
- root cause
- whether DB migration is needed
- recommended fix

If it requires a DB migration or meaningful business-rule change:

STOP and request review before implementing.

Small source/test cleanup bugs that clearly preserve approved behavior may be
fixed within Part 5.

==================================================
FINAL REPORT
==================================================

Return a structured report with:

1. Repository inspection summary
2. Stale/dead code findings
3. Files removed
4. Files changed
5. Stale tests updated and why
6. Database/RPC signature audit — LOCAL / RECONSTRUCTED vs
   REMOTE / LINKED, as separate findings. If remote catalog/migration
   history was not inspected, say so. Do not claim the deployed catalog
   was verified based only on PGlite or migration source.
7. SECURITY DEFINER / grants audit — same local vs remote split.
8. Direct mutation audit
9. Unit/snapshot/null-state audit
10. Product Create/Edit final audit
11. Transfer concurrency final audit
12. Shift/remittance/waste final audit
13. Full regression suite table
14. Any skipped tests + exact reason
15. Remaining known risks
16. Whether any migration was created
17. Whether any db push is required
18. Final recommendation: READY FOR CLIENT TESTING or BLOCKED, with reasons

IMPORTANT:

Do not mark READY merely because selected tests passed.

READY means:

- no known correctness blocker
- no unexplained failing active test
- architecture matches the approved rules
- no pending required DB migration
- typecheck passes

Do not start another milestone automatically.