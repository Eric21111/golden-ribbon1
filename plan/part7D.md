REVISION 7D — CASHIER END SHIFT / REMITTANCE UI/UX

PHASE: PLAN FIRST — DO NOT IMPLEMENT YET

Revision 7A, 7B, and 7C are already implemented LOCALLY.

DO NOT:
- db push
- deploy
- production cutover
- start Revision 7E
- modify 7C business rules
- redesign reports/history

Return a detailed Revision 7D PLAN first.

==================================================
REVISION STATUS
==================================================

7A
- PCS data model/cutover scaffolding

7B
- PCS operational inventory / transfers / POS / returns

7C
- two-phase End Shift backend
- begin_cashier_shift_close
- inventory/cash freeze
- shift_product_close_baselines
- finalize_cashier_shift_reconciliation
- pending reconciliation resume
- auto-close parity
- same-day no-reopen
- keep_at_branch / record_as_unsold backend finalization
- quantified waste
- inventory exact/shortage/excess
- cash exact/shortage/excess

7D — THIS REVISION
- cashier-facing End Shift / Remittance experience
- efficient phone/tablet workflow
- begin-close confirmation
- one-screen physical count + waste + cash
- pending reconciliation resume UX
- inline validation/status
- final confirmation
- success summary/navigation

7E later
- reports/history/final cleanup

==================================================
PRIMARY UX GOAL
==================================================

The cashier should NOT perform accounting.

The cashier should only provide physical facts:

1. actual remaining PCS
2. waste PCS, if any
3. actual cash

Everything else is calculated by the system.

The workflow must be:

FAST
CLEAR
MINIMAL
MOBILE/TABLET RESPONSIVE
DIFFICULT TO MISUSE

Avoid:
- multi-page wizard
- unnecessary toggles
- repeated confirmations
- manually calculating shortage/excess
- per-product closing-behavior choices
- KG terminology
- accountant-oriented labels
- unnecessary technical details

==================================================
A. END SHIFT ENTRY POINT
==================================================

Audit the current cashier dashboard / shift card / existing close form.

Replace the old single-shot / KG waste closing flow.

The primary action should remain easy to find:

End Shift / Remit

or whichever current terminology best matches the project.

Do not create multiple buttons such as:

End Shift
Remit
Close Day
Finalize Inventory

when one operation represents the final daily close.

Preferred single entry action:

End Shift / Remit

==================================================
B. PRE-BEGIN CONFIRMATION — CRITICAL
==================================================

7C begin close is irreversible.

Therefore BEFORE calling:

begin_cashier_shift_close

show exactly one meaningful confirmation.

Example copy:

End Shift for today?

Once you start End Shift:
- sales for this booth will stop for today
- new stock transactions will be paused
- you will need to count remaining stock and cash before finishing

You cannot reopen today's selling session after this starts.

[Cancel]
[Start End Shift]

Do NOT call the server begin-close RPC merely by opening the screen.

The irreversible server call happens only after cashier confirms.

After begin succeeds:
- no Cancel End Shift button
- no reopen
- no Back-to-Selling action

Normal navigation may leave the screen, but the pending reconciliation must
remain resumable.

==================================================
C. AFTER BEGIN — ONE SCROLLABLE CLOSING SCREEN
==================================================

After begin close succeeds, show ONE main closing screen.

Do not make separate pages for:

Inventory
Waste
Cash
Review

Use one scrollable layout.

Suggested structure:

1. Header / status
2. Inventory count section
3. Cash section
4. Finalize action

Responsive:
- phone
- tablet

Use existing Golden Ribbon design language/components.

Do not redesign unrelated app navigation.

==================================================
D. HEADER / STATUS
==================================================

Clearly communicate that selling has stopped.

Example:

End Shift
Sales closed for today

or:

Remittance in progress
Sales are now closed

Show useful contextual information only:

- branch name
- cutoff time
- shift/date if useful

Avoid technical status text such as:

inventory_reconciliation_required = true

No KG copy.

==================================================
E. PRODUCT COUNT CARD — REQUIRED INPUTS
==================================================

Each required reconciliation product comes from the 7C preview.

For every product show:

- product name
- SKU only if useful
- authoritative system stock before waste
- Actual remaining input
- Waste input
- calculated expected remaining
- calculated difference/result

Do NOT allow cashier to:
- add arbitrary products
- remove required products
- choose closing_stock_behavior
- edit expected stock
- edit sold quantity
- edit transfer totals
- edit adjustment totals

The server-defined product universe is authoritative.

==================================================
F. PRODUCT CARD COPY
==================================================

Cashiers should not need to understand the movement formula.

Preferred compact card:

Chicken Meal
System stock: 30 pcs

Actual remaining
[ 23 ]

Waste
[ 5 ]

Expected remaining: 25 pcs
Difference: 2 pcs shortage

For an exact result:

Expected remaining: 18 pcs
Difference: Exact

For excess:

Expected remaining: 18 pcs
Difference: 2 pcs excess

Use semantic:
- Exact
- Shortage
- Excess

Do NOT make the cashier interpret plus/minus signs.

==================================================
G. SYSTEM STOCK LABEL
==================================================

7C preview provides:

system_balance_before_waste

Use a cashier-friendly label.

Evaluate:

System stock before waste
or
System stock

Do NOT label it "Expected remaining" before waste is entered because expected
remaining changes based on waste.

Recommended behavior:

System stock: 30 pcs
Waste: 5 pcs
Expected remaining: 25 pcs

This avoids conceptual confusion.

==================================================
H. ACTUAL REMAINING INPUT
==================================================

Actual remaining means:

physical usable PCS still present at the booth after excluding waste.

Requirements:

- required for EVERY product in preview
- whole PCS only
- >= 0
- blank initially
- do NOT prefill with expected quantity

This is important.

Prefilling actual remaining with expected stock could encourage cashier to
submit without physically counting.

Use numeric keypad where supported.

Examples accepted:

0
1
25

Reject:
- negative
- decimal
- text
- blank on final submit

==================================================
I. WASTE INPUT — OPTIMIZE FOR SPEED
==================================================

Waste is common enough to support, but most products may have zero.

Default waste to:

0

Do not require cashier to type zero for every product.

Possible UI:

Waste
[ 0 ]

or compact:
Waste: 0   [+ Add waste]

Evaluate which results in fewer taps without hiding the feature.

Requirements:
- whole PCS
- >= 0
- defaults to 0
- no row inserted server-side when 0
- cashier may change it before final submit

Do not confuse waste with unsold.

==================================================
J. UNSOLD MUST NOT BE MANUAL INPUT
==================================================

Cashier does NOT enter:

unsold_quantity

For record_as_unsold products:

actual remaining
→ server records that quantity as unsold during finalization.

Do not add an "Unsold" textbox.

Likewise cashier does NOT enter:

carried_quantity

For keep_at_branch:
actual remaining becomes carried stock automatically.

==================================================
K. CLOSING BEHAVIOR DISPLAY
==================================================

Cashier must NEVER choose closing behavior.

Evaluate showing a small read-only hint/tag because it may help explain what
will happen after submission.

Examples:

Stays at booth
or
Recorded as unsold at close

Do NOT expose enum text:

keep_at_branch
record_as_unsold

Do NOT make it an editable toggle.

Keep the hint visually secondary.

If Cursor concludes that displaying it adds unnecessary cognitive load,
explain why and recommend hiding it.

==================================================
L. LIVE EXPECTED / DIFFERENCE CALCULATION
==================================================

For immediate UX feedback, client MAY calculate display values from
authoritative preview + cashier input:

expected_remaining
=
system_stock_before_waste - waste

display difference should use semantic business meaning:

expected - actual

Then show:

Exact
1 pc shortage
2 pcs excess

However:

SERVER REMAINS AUTHORITATIVE.

The client calculation is display-only.

After final submission:
- use server-returned final results
- never treat client calculations as persisted authority

Important:
7A database stores inventory discrepancy using actual - expected.
The UI should NOT expose that raw sign convention.

UI displays semantic exact/shortage/excess only.

==================================================
M. WASTE GREATER THAN SYSTEM STOCK
==================================================

7C intentionally supports cases such as:

System stock: 5
Waste: 10
Actual remaining: 0

This represents a physical excess/discrepancy, not necessarily invalid input.

Therefore 7D must NOT add a client rule:

waste <= system stock

That would contradict the approved reconciliation model.

Allow the input and show the calculated semantic result.

Example:

System stock: 5
Waste: 10
Expected remaining: -5
Actual remaining: 0

Result:
5 pcs excess

The UI may avoid emphasizing a negative stock number if that is confusing,
but must not reject the valid reconciliation.

If choosing alternate copy, preserve the mathematics.

==================================================
N. CASH SECTION
==================================================

At bottom of the same screen:

Cash Remittance

Expected cash
₱8,500.00

Actual cash
[ ₱________ ]

Difference
₱50 shortage / Exact / ₱50 excess

Expected cash:
- read-only
- from 7C server preview

Actual cash:
- required
- user input
- use existing money formatting/parser behavior

Cashier must NOT type expected sales.

==================================================
O. CASH DIFFERENCE DISPLAY
==================================================

7C persisted cash difference is:

expected - actual

but UI should rely on semantic result.

Examples:

Expected: ₱8,500
Actual:   ₱8,450

Display:
₱50 shortage

Expected: ₱8,500
Actual:   ₱8,550

Display:
₱50 excess

Do not display confusing:

Difference: -50

without semantic meaning.

==================================================
P. OPTIONAL MOVEMENT DETAILS
==================================================

7C preview contains:

opening
received
outgoing
sold
adjustments

The cashier normally does NOT need to see all of these.

Do not clutter every card with accounting details.

If useful, put them under optional:

View stock details

Example expandable content:

Opening: 20
Received: 15
Returned/outgoing: 2
Sold: 10
Adjustment: 0

System stock: 23

But default UI should remain compact.

Evaluate whether existing app patterns support this cleanly.

==================================================
Q. VALIDATION UX
==================================================

Before final submit:

Require:
- Actual remaining for every product
- Actual cash
- valid whole PCS
- valid money amount

Waste defaults 0.

Validation should be inline.

Examples:

Enter the physical remaining quantity.

Use whole pieces only.

Enter actual cash counted.

Avoid a single generic:
Invalid form

At top/bottom, if many products:
show concise message such as:

3 products still need a physical count.

Do not automatically fill missing values.

==================================================
R. LARGE PRODUCT LIST EFFICIENCY
==================================================

Audit realistic number of products.

If many products exist:
- keep scrolling efficient
- cards compact
- sticky final action where appropriate
- optional "Incomplete only" filter could help

Do NOT add complexity unless necessary.

Do not use pagination that makes cashier lose closing context.

==================================================
S. FINAL SUBMIT BUTTON
==================================================

Use one clear primary action:

Finish End Shift / Remit

or:

Complete Remittance

Choose wording consistent with existing app terminology.

Button disabled until required inputs are valid.

On tap:
show ONE final confirmation.

Example:

Complete End Shift?

This will finalize today's cash and inventory counts.
You will not be able to change this closing record afterward.

[Go Back]
[Complete End Shift]

Then call:

finalize_cashier_shift_reconciliation

Do not add another review page.

==================================================
T. SUBMISSION LOADING / DOUBLE TAP
==================================================

While finalization is in progress:

- disable button
- show loading state
- prevent duplicate taps

7C is idempotent, but UI should still avoid unnecessary duplicate calls.

If network times out:
- do NOT assume failure
- refresh pending/final status
- safely retry according to 7C idempotency behavior

Do not tell cashier to re-enter everything unnecessarily if server already
finalized.

==================================================
U. SUCCESS RESULT
==================================================

After successful finalize:

show concise completion state.

Example:

End Shift Complete

Cash:
₱50 shortage

Inventory:
10 exact
1 shortage
0 excess

or appropriate compact summary.

Do not overwhelm cashier with a full report.

7E handles detailed historical reporting.

Then provide one primary navigation action such as:

Back to Cashier Home

Since same-day selling cannot restart:
do NOT show:
Start New Shift

on the same business day.

==================================================
V. PENDING RECONCILIATION RESUME
==================================================

If app closes / phone restarts / cashier navigates away after begin-close:

cashier must be able to resume.

On Cashier Dashboard/app entry:

if get_my_pending_shift_reconciliation returns pending PCS close:

show strong action:

Complete Pending Remittance

Do not show normal active-selling controls as if shift were still open.

Opening pending screen:
- do NOT call begin-close again unnecessarily
- use pending preview
- restore authoritative product universe/cutoff
- cashier re-enters physical facts as needed unless already safely retained
  locally

Do not assume unsent form input survived.

==================================================
W. AUTO-CLOSED SHIFT UX
==================================================

If 9 PM auto-close occurred:

cashier later sees:

Pending Remittance

or:

Complete Previous Shift

The same reconciliation screen is used.

Do NOT imply:
- waste was automatically calculated
- cash was automatically counted
- remaining inventory is known

Cashier still enters:
- actual remaining
- waste
- actual cash

Use the same finalization RPC.

==================================================
X. LEGACY CASH-ONLY PENDING SHIFT
==================================================

Pre-Revision-7 legacy shifts may be:

mode = legacy_cash_only

They must NOT show product physical-count fields.

For legacy pending reconciliation:

show only:
- expected cash
- actual cash
- cash difference
- finalize

Do not invent PCS counts for historical shifts.

This path exists for backward compatibility only.

==================================================
Y. SAME-DAY CLOSED STATE
==================================================

After successful final close on current Manila business date:

Cashier Dashboard should clearly indicate:

Today's shift is closed

Do not show:
Start Shift

if server would reject it anyway.

The server remains authoritative.

Next Manila business day:
normal Start Shift UI returns.

Do not implement scheduling/timers based solely on device clock.

Use server-returned shift/pending state wherever possible.

==================================================
Z. ERROR STATES
==================================================

Handle gracefully:

- close already begun
- already finalized
- conflicting finalize payload
- product universe changed/rejected
- inventory state conflict
- session authorization error
- network failure
- server validation failure

Prefer specific cashier-friendly messages.

Do not expose raw Postgres errors.

For inventory state conflict:
do not silently recompute or override physical input.

Refresh from server and explain that the close needs to be reviewed/retried.

==================================================
AA. NO KG UI
==================================================

Audit all End Shift-related UI for residual:

kg
kg_meal
Not tracked
Unmeasured
meal waste occurrence checkbox/toggle
MAX meal quantity logic
old KG waste selection

Current PCS close UI must not use them.

Historical screens are 7E concern.

==================================================
AB. RESPONSIVE DESIGN
==================================================

The client uses:
- phones
- tablets

Design responsive layout.

Phone:
- single-column cards
- large touch targets
- numeric inputs easy to reach

Tablet:
- may use wider product rows / two-column field layout inside cards
- do not create a totally different workflow

Keep consistent information hierarchy.

Do not assume landscape only.

==================================================
AC. ACCESSIBILITY / INPUT QUALITY
==================================================

Use:
- clear labels
- sufficient touch sizes
- visible focus/error states
- numeric keyboard
- currency keyboard where supported
- readable contrast

Do not rely on color alone for:
Exact / Shortage / Excess

Use text + icon/status where appropriate.

==================================================
AD. CLIENT STATE
==================================================

Audit current form state architecture.

Avoid global state unless necessary.

Closing form needs:
- preview snapshot
- per-product actual remaining
- per-product waste
- actual cash
- submitting state
- validation state

Do not let stale POS/cart state affect closing.

Clear/disable selling state after begin-close where appropriate.

==================================================
AE. 7C BACKEND IS AUTHORITATIVE
==================================================

Do not duplicate backend rules into permanent client business logic.

Client display calculations are allowed for responsiveness.

Final:
- expected values
- results
- carried/unsold
- cash result
- completion

must use server response.

If client preview differs from finalized server response:
server wins.

==================================================
AF. NO DATABASE MIGRATION EXPECTED
==================================================

7D should primarily be client/service/UI work.

No SQL migration should be necessary unless a genuine 7C backend defect is
discovered.

If a backend/schema defect is discovered:

STOP and report it.

Do NOT silently edit:
- 7A
- 7B
- 7C migrations

Do not create a new SQL migration merely to make UI easier without review.

==================================================
AG. 7E BOUNDARY
==================================================

Do NOT redesign:

- Shift History
- Daily Remittance reports
- Waste History
- Inventory History
- Unsold reports
- Branch Performance reports

7E handles report/history presentation.

7D only needs the immediate completion summary.

==================================================
AH. TEST REQUIREMENTS
==================================================

Plan tests covering at least:

1. End Shift button does not begin close merely by opening screen.
2. Confirmation required before irreversible begin.
3. Cancel confirmation leaves shift open.
4. Confirm calls begin_cashier_shift_close.
5. After begin, UI says sales closed.
6. No cancel/reopen button after begin.
7. Product list comes from authoritative preview.
8. Actual remaining initially blank.
9. Waste defaults 0.
10. Whole PCS validation.
11. Negative input rejected.
12. Decimal PCS rejected.
13. Every product actual count required.
14. Missing product count prevents submit.
15. Client expected remaining updates when waste changes.
16. Exact display correct.
17. Shortage display correct.
18. Excess display correct.
19. Waste > system-stock case is allowed.
20. No manual unsold field.
21. No manual carried field.
22. Closing behavior cannot be edited.
23. keep_at_branch copy does not imply waste/return.
24. record_as_unsold is read-only informational behavior.
25. Expected cash read-only.
26. Actual cash required.
27. Cash exact display.
28. Cash shortage display.
29. Cash excess display.
30. Final button disabled while invalid.
31. Final confirmation required.
32. No separate review page.
33. Double-submit prevented.
34. Successful finalization uses server result.
35. Network timeout checks authoritative pending/final state.
36. Finalized retry handled safely.
37. Success summary shown.
38. Same-day success does not show Start New Shift.
39. Pending reconciliation resumes after navigation/app restart.
40. Auto-closed pending shift uses same PCS form.
41. Auto-close does not prefill physical facts.
42. Legacy cash-only pending shift shows no product counts.
43. KG closing UI removed.
44. Phone responsive layout.
45. Tablet responsive layout.
46. Existing 7A/7B/7C tests remain green.
47. Existing regressions remain green.
48. npm run typecheck passes.

Use existing component/unit test patterns where available.

==================================================
AI. PLAN OUTPUT REQUIRED
==================================================

Return a structured Revision 7D PLAN containing:

1. Current Cashier End Shift UI found
2. Files/components/services affected
3. Entry-point changes
4. Pre-begin confirmation UX
5. After-begin screen structure
6. Product card design
7. Actual remaining input behavior
8. Waste input behavior
9. Closing-behavior read-only presentation decision
10. Live exact/shortage/excess display logic
11. Cash section design
12. Validation strategy
13. Final submit + confirmation flow
14. Loading/retry/idempotency UX
15. Success state
16. Pending reconciliation resume UX
17. Auto-close pending UX
18. Legacy cash-only UX
19. Same-day closed dashboard behavior
20. Error-state mapping
21. Responsive phone/tablet behavior
22. Accessibility/input behavior
23. Client state design
24. KG UI removal
25. Service/type changes
26. Any backend change unexpectedly required
27. Exact 7D/7E boundary
28. Tests to add/update
29. Risks/regression areas
30. Any unresolved business decision

IMPORTANT:

If a genuine business decision is missing:
STOP and identify it.

Do not invent one.

If a genuine 7C backend defect is found:
STOP and report it.

Do not silently modify 7C migrations.

Do not implement yet.

Return the Revision 7D PLAN for review.