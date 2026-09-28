PART 2 MILESTONE:
Waste History + Daily Shift Remittance Reporting

SCOPE

Part 2 fixes ONLY the reporting gaps discovered after the KG/remittance
milestone:

1. There is currently no proper Owner/Main Manager waste-history report.
2. Shift remittance reporting exists, but the summary is not truly grouped
   by business day.

Do NOT work on:

- KG input maxLength / KG display inconsistencies
- Branch Performance KG display
- Product Edit atomicity
- dead/stale helpers
- unrelated regression cleanup
- inventory architecture
- cash calculation logic
- waste recording logic
- shift closing behavior
- 9 PM closing behavior

Those belong to later parts.

==================================================
IMPORTANT MIGRATION RULE
==================================================

The KG/remittance migration:

20260927180000_kg_meal_shift_reconciliation.sql

has already been deployed.

Part 1 added:

20260928090000_fix_legacy_shift_reconciliation.sql

Do NOT edit either migration.

Create a NEW forward migration for Part 2 if database/RPC changes are needed.

If Part 1 has not yet been pushed on the current machine/project for any
reason, do not rewrite it.

Part 2 must be ordered AFTER Part 1 and assume the final Part 1 schema:

shifts.reconciliation_required

Do NOT run:

npx supabase db push

Keep Part 2 local until review.

==================================================
CONFIRMED BUSINESS RULES
==================================================

REMITTANCE

Remittance belongs to an individual Cashier shift.

Expected cash:
server-derived from completed POS sales on that shift.

Actual cash:
entered by Cashier.

Difference:

expected - actual

0:
exact

positive:
shortage

negative:
excess

Daily reporting aggregates individual shifts.

It does NOT create or merge shifts into a daily shift.

--------------------------------------------------
WASTE
--------------------------------------------------

Waste is occurrence-only.

For kg_meal products:

Cashier marks which products had unsold waste when closing/reconciling the
selling shift.

Waste has:

- shift
- branch
- product
- cashier / recorded_by
- timestamp
- optional note

Waste has NO:

- kg quantity
- pcs quantity
- serving estimate
- monetary valuation
- inventory movement
- inventory discrepancy
- return quantity

A count of waste OCCURRENCES is allowed.

Example:

Buttered Chicken had waste recorded on 4 shifts

does NOT mean:

4 kg
4 pcs
4 servings

==================================================
BUSINESS DATE
==================================================

Reports must use the selling SHIFT'S business date.

Business timezone:

Asia/Manila

Preferred business date:

(shifts.ended_at AT TIME ZONE 'Asia/Manila')::date

For an open shift, reporting should generally not include it because
remittance/waste reporting concerns closed selling sessions.

Do NOT group a shift by:

- reconciliation.created_at
- reconciled_at
- waste occurrence created_at

Those actions can happen later than the actual selling day.

Example:

Shift auto-closes:

September 28, 9:00 PM

Cashier reconciles:

September 29, 8:00 AM

Report belongs to:

September 28

NOT September 29.

Waste recorded during that later reconciliation also belongs to the
September 28 shift/business date.

==================================================
PART 1 / LEGACY SEMANTICS
==================================================

Part 2 must honor reconciliation_required.

LEGACY CLOSED SHIFT:

reconciliation_required = false
no reconciliation row

→ not pending
→ not part of the new remittance/waste reporting feature
→ do not show "No waste"
→ do not show ₱0 actual
→ do not show shortage

NEW REQUIRED SHIFT:

reconciliation_required = true

OR

a shift already has a valid shift_reconciliations row

→ belongs to the remittance reporting feature.

An already-reconciled shift may have reconciliation_required = false if it
was reconciled before the Part 1 flag existed.

It must still remain visible as reconciled.

Use the same inclusion principle as Part 1:

reconciliation exists
OR reconciliation_required = true

==================================================
PENDING SHIFT SEMANTICS
==================================================

A 9 PM auto-closed shift may have:

reconciliation_required = true
no shift_reconciliations row
no shift_waste_occurrences yet

That means:

Remittance:
PENDING

Waste:
NOT YET REPORTED / PENDING RECONCILIATION

Do NOT interpret missing waste rows on a pending shift as:

"No waste"

The cashier has not completed reconciliation yet.

--------------------------------------------------
RECONCILED SHIFT WITH NO WASTE
--------------------------------------------------

If:

shift has a completed shift_reconciliations row

AND

zero shift_waste_occurrences rows

then it is valid to display:

No waste recorded

because the Cashier completed the closing/reconciliation flow with no waste
products selected.

So:

pending + zero waste rows
→ Waste pending / unknown

reconciled + zero waste rows
→ No waste recorded

reconciled + waste rows
→ list actual waste occurrences

==================================================
PART A — DAILY REMITTANCE REPORT
==================================================

Inspect the current:

report_branch_shift_remittances

ShiftRemittanceScreen

Owner/Manager report routes

before editing.

Do not rebuild cash math client-side.

The database remains authoritative.

The report must support business-date filtering/grouping.

Preferred report detail row:

- business_date
- shift_id
- branch_id
- branch_name
- cashier_id
- cashier_name
- started_at
- ended_at
- reconciliation status:
    reconciled
    pending
- expected_cash
- actual_cash nullable
- difference nullable
- result nullable:
    exact
    shortage
    excess
- reconciled_at nullable

Legacy false/no-remittance shifts:
omit.

==================================================
DAILY REMITTANCE SUMMARY
==================================================

For each business date, calculate/display:

Expected Cash
Actual Remitted
Total Shortage
Total Excess
Pending Shift Count
Pending Expected Cash

Definitions:

EXPECTED CASH

Sum expected cash from ALL reconciliation-aware closed shifts for that
business date:

- reconciled shifts
- pending shifts

--------------------------------------------------
ACTUAL REMITTED

Sum actual_cash ONLY from reconciled shifts.

Pending actual cash is UNKNOWN.

Never substitute 0.

--------------------------------------------------
TOTAL SHORTAGE

For reconciled shifts where:

difference > 0

sum the positive difference.

--------------------------------------------------
TOTAL EXCESS

For reconciled shifts where:

difference < 0

sum ABS(difference).

Do not display excess as a negative currency amount in the summary.

--------------------------------------------------
DO NOT SILENTLY NET SHORTAGE AND EXCESS
--------------------------------------------------

Example:

Shift A:
₱200 shortage

Shift B:
₱150 excess

Daily report should show:

Total Shortage: ₱200
Total Excess:   ₱150

Do NOT reduce this to:

Net shortage: ₱50

as the only result.

If an existing UI already shows a net field, it may remain as secondary
information, but separate shortage and excess totals are required.

==================================================
PENDING EXAMPLE
==================================================

September 28:

Shift A
Expected: ₱7,500
Actual:   ₱7,300
Shortage: ₱200

Shift B
Expected: ₱1,800
Pending reconciliation

Daily:

Expected Cash:
₱9,300

Actual Remitted:
₱7,300

Total Shortage:
₱200

Total Excess:
₱0

Pending Shifts:
1

Pending Expected:
₱1,800

Do NOT calculate:

Actual = ₱7,300 + ₱0

and present the second shift as a full ₱1,800 shortage.

==================================================
DATE FILTERING
==================================================

Reuse the project's existing report date-range conventions where possible.

Do not invent an unrelated date picker architecture.

Database filtering must use Asia/Manila BUSINESS DATE.

Avoid:

ended_at::date

if that evaluates in UTC.

Use an explicit Asia/Manila conversion.

Support at least:

start business date
end business date

End date should be inclusive from the user's perspective.

Validate:

start <= end

Use safe bounded ranges consistent with existing report conventions.

Do not pull the entire report history to the app and then perform all date
filtering client-side.

==================================================
BRANCH FILTER / AUTHORIZATION
==================================================

Preserve the existing report authorization model.

Inspect current Owner/Main Manager report permissions before modifying them.

Do not expand permissions.

Owner:
retain current authorized report visibility.

Main Branch Manager:
retain current authorized operational report visibility.

Cashier:
must NOT gain Owner/Manager reporting privileges.

If existing report RPC supports a branch filter, preserve it.

If not, add the minimum safe branch filter required by the current report UI.

Authorization must be enforced server-side.

==================================================
PART B — WASTE HISTORY REPORT
==================================================

Create a read-only Owner/Main Manager waste-history report.

Preferred conceptual RPC:

report_branch_shift_waste(...)

or naming consistent with the current project.

Do not expose raw table access if the project normally uses report RPCs.

Each occurrence row should provide:

- business_date
- shift_id
- branch_id
- branch_name
- cashier_id / cashier_name
- product_id
- product_name
- occurred_at / recorded_at
- recorded_by
- optional note
- shift reconciliation status

No quantity field.

No KG.

No pcs.

No waste value/cost.

==================================================
WASTE DAILY VIEW
==================================================

Group/display waste by the shift's BUSINESS DATE.

Example:

September 28
SM Mindpro
Cashier A

Buttered Chicken
Waste recorded

Buffalo Chicken
Waste recorded

Optional note...

Useful summary values are allowed:

Waste occurrences: 2
Distinct products with waste: 2

These are event counts only.

Never label them:

Waste quantity
Waste units
Waste servings

==================================================
WASTE STATUS FOR EACH SHIFT
==================================================

For reconciliation-aware shifts:

RECONCILED + waste rows:
→ Waste recorded
→ display products

RECONCILED + zero waste rows:
→ No waste recorded

PENDING RECONCILIATION:
→ Waste pending
→ do NOT display "No waste"

LEGACY SHIFT:
→ omit from the new waste report

This distinction must be maintained in both DB result semantics and UI.

==================================================
WASTE REPORT DESIGN
==================================================

Add a minimal report screen consistent with the current Golden Ribbon report
UI.

Preferred label:

Waste History

or:

Waste Report

Avoid wording such as:

Waste Inventory

because no waste quantity is tracked.

Add the report entry to the existing Owner and Main Manager report navigation
where appropriate.

Do not redesign unrelated report hubs.

==================================================
SHIFT-LEVEL DETAILS
==================================================

The daily report must preserve individual shift visibility.

Example:

September 28

SM1 — Cashier A
1:00 PM – 8:20 PM
Expected ₱7,500
Actual ₱7,300
Shortage ₱200

SM2 — Cashier B
1:00 PM – 8:30 PM
Expected ₱6,000
Actual ₱6,100
Excess ₱100

Do not merge those into one synthetic daily shift.

Daily totals sit ABOVE or alongside the individual shift records.

==================================================
REPORT DATABASE DESIGN
==================================================

Prefer database-side report calculations.

Do not make the mobile app responsible for reconstructing authoritative cash
totals.

For remittance:

expected cash must remain based on the stored/server-derived reconciliation
snapshot for reconciled shifts.

For pending shifts:

derive/display expected cash consistently with the current report function's
server logic.

Do not accept expected totals from the client.

For waste:

report actual shift_waste_occurrences rows only.

Do not estimate missing waste.

==================================================
MONEY PRECISION
==================================================

Continue using exact numeric money.

Do not introduce JS floating-point as the authoritative source.

DB/report:

numeric(12,2) or the project's current safe money type.

Client may format returned exact values for display.

==================================================
TIMEZONE
==================================================

All business-date grouping:

Asia/Manila

All timestamps may still be stored in UTC/timestamptz.

Do not rewrite timestamps.

Convert only for:

business-date filtering/grouping
display according to existing app conventions.

==================================================
SECURITY
==================================================

Any new/replaced report RPC follows Golden Ribbon hardened style:

SECURITY DEFINER
SET search_path = ''

Fully qualified names.

REVOKE ALL FROM PUBLIC, anon

Grant only intended authenticated entry points.

Authorize role/branch inside the function.

Do not weaken RLS/table grants.

Report functions are READ ONLY from the business perspective.

They must not mutate:

- shifts
- reconciliations
- waste
- sales
- inventory

==================================================
INSPECTION BEFORE EDITING
==================================================

Before implementation inspect only relevant files:

DATABASE

- report_branch_shift_remittances
- shift_reconciliations
- shift_waste_occurrences
- shifts.reconciliation_required from Part 1
- sales / shift relation
- current report date helpers/RPCs
- report authorization helpers

APP

- ShiftRemittanceScreen.tsx
- Owner remittance route
- Manager remittance route
- Owner report hub
- Manager report navigation/dashboard
- existing date-range/filter components
- existing report formatting utilities

Then report briefly:

1. Current remittance RPC signature.
2. Whether it already accepts date filters.
3. How it currently computes expected/pending values.
4. Current Owner/Main Manager authorization.
5. Existing report date-range pattern to reuse.
6. Best minimal RPC shape for waste history.
7. Whether shift_reconciliations already snapshots everything needed.
8. Any legacy/pending behavior that Part 2 must preserve.

Do not speculate.

==================================================
DATABASE / MIGRATION
==================================================

Create a NEW migration only if report RPCs need replacement/addition.

Suggested naming style:

supabase/migrations/<new_timestamp>_waste_daily_remittance_reports.sql

Do NOT modify:

20260927180000_kg_meal_shift_reconciliation.sql

Do NOT modify:

20260928090000_fix_legacy_shift_reconciliation.sql

Keep migrations forward-only.

==================================================
TESTS
==================================================

Add one focused report test file if practical:

tests/waste_daily_remittance_reports.mjs

Required cases:

--------------------------------------------------
A. One reconciled shift

Business date:
Sept 28

Expected:
₱7,500

Actual:
₱7,300

Verify daily:

expected = 7500
actual = 7300
shortage = 200
excess = 0
pending count = 0

--------------------------------------------------
B. Shortage + excess same day

Shift A:
shortage 200

Shift B:
excess 150

Verify:

shortage total = 200
excess total = 150

Do not collapse into only net 50.

--------------------------------------------------
C. Pending shift

Expected:
₱1,800

No reconciliation.

Verify:

expected includes 1800
actual does not include 0
shortage does not include 1800
pending_count += 1
pending_expected += 1800

--------------------------------------------------
D. Legacy closed shift

reconciliation_required = false
no reconciliation

Verify:

excluded from remittance report
excluded from waste report
not pending

--------------------------------------------------
E. Already-reconciled pre-Part1 row

reconciliation_required = false
reconciliation exists

Verify:

included as reconciled
correct daily totals

--------------------------------------------------
F. Waste occurrence

Reconciled shift:

Buttered Chicken
Buffalo Chicken

Verify:

2 occurrence rows
no quantity
correct product names
correct branch/cashier
correct business date

--------------------------------------------------
G. Reconciled with no waste

Reconciliation exists.
Zero waste rows.

Verify:

waste status = no_waste / equivalent explicit semantic
NOT pending

--------------------------------------------------
H. Pending with zero waste rows

Required closed shift.
No reconciliation.
No waste.

Verify:

waste status = pending
NOT "no waste"

--------------------------------------------------
I. Reconciled next day

Shift ends:
September 28, 9 PM Asia/Manila

Reconciled:
September 29

Verify:

remittance belongs to September 28

waste belongs to September 28

--------------------------------------------------
J. Timezone boundary

Create shifts around an Asia/Manila date boundary.

Verify grouping/filtering uses Manila business date, not UTC date.

--------------------------------------------------
K. Date filtering

Request:
Sept 28 through Sept 30

Verify:
inclusive business-date results
no outside rows

--------------------------------------------------
L. Branch separation

SM1 and SM2 have separate shifts.

Verify:
branch filter does not leak another branch's rows.

Owner aggregate behaves according to existing Owner permissions.

--------------------------------------------------
M. Authorization

Cashier cannot call Owner/Main Manager report RPCs.

Unauthorized role cannot expand branch scope.

--------------------------------------------------
N. No mutation

Calling report RPCs does not change:

shift
reconciliation
waste
sales
inventory

==================================================
REGRESSION TESTS
==================================================

Run:

npm run typecheck

tests/legacy_shift_reconciliation.mjs

tests/kg_meal_shift_reconciliation.mjs

new waste/remittance report tests

existing affected report/date-range tests

Do NOT run GUI/browser/mobile automation.

Do not modify unrelated test expectations merely to pass.

==================================================
ACCEPTANCE CRITERIA
==================================================

Complete Part 2 only when:

[ ] Remittance report is grouped by Asia/Manila business date.

[ ] Date filters use business date, not UTC date.

[ ] Daily report retains individual shift rows.

[ ] Daily expected cash includes reconciled + legitimate pending shifts.

[ ] Daily actual cash includes reconciled shifts only.

[ ] Pending actual cash remains unknown/null.

[ ] Pending shift is not converted into a full shortage.

[ ] Shortage and excess totals are separate.

[ ] Legacy false/no-remittance shifts remain excluded.

[ ] Existing reconciled rows remain included even if flag false.

[ ] Waste History/Report exists for authorized Owner/Main Manager users.

[ ] Waste report uses occurrence-only data.

[ ] No KG/pcs/serving waste amount appears.

[ ] Waste is grouped by shift business date.

[ ] Reconciled zero-waste shift is distinguishable from pending waste.

[ ] Pending reconciliation never displays "No waste".

[ ] Legacy shifts are not labeled "No waste".

[ ] Branch authorization remains intact.

[ ] No reporting RPC mutates operational data.

[ ] Typecheck passes.

[ ] Targeted tests pass.

==================================================
OUT OF SCOPE
==================================================

Do NOT fix in Part 2:

- KG text input maxLength
- Manager inventory "units" wording
- Transfer details "Pending" vs "Unmeasured"
- Branch Performance KG stock display
- Product Edit atomicity
- POS cap changes
- inventory reconciliation changes
- direct product insert protections
- shift closing logic
- waste entry logic
- KG delivery logic
- low-stock rules
- CSV/PDF export
- waste cost/value
- waste quantity
- cash discrepancy resolution
- employee penalties
- new branch-day closing workflow

==================================================
DEPLOYMENT
==================================================

DO NOT run:

npx supabase db push

Do not modify the live database.

At completion report:

1. Inspection findings
2. New migration filename if any
3. Remittance RPC changes
4. Waste report RPC
5. Business-date/timezone behavior
6. Pending vs reconciled vs legacy behavior
7. Owner/Main Manager UI changes
8. Files changed
9. Tests and PASS/FAIL
10. Any remaining risks
11. Required deployment command

Do not deploy.

Do not begin Part 3.