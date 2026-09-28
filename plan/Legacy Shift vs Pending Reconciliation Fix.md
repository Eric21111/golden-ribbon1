PART 1 MILESTONE:
Legacy Shift vs Pending Reconciliation Fix

IMPORTANT CONTEXT

The migration:

supabase/migrations/20260927180000_kg_meal_shift_reconciliation.sql

HAS ALREADY BEEN DEPLOYED.

DO NOT EDIT OR REWRITE THAT MIGRATION.

Create a NEW corrective migration.

This Part 1 is ONLY for the historical-shift / pending-reconciliation bug.

Do not implement:
- waste reporting
- daily remittance grouping
- KG UI fixes
- product edit atomicity
- unrelated test cleanup
- other report redesigns

Those will be handled in later parts.

==================================================
BUG
==================================================

The current implementation determines a pending reconciliation using roughly:

shift.status = 'closed'
AND no shift_reconciliations row exists

This is insufficient.

All shifts that were closed BEFORE the cash-remittance feature existed also
have no shift_reconciliations row.

Therefore an old historical shift can incorrectly appear as:

Pending reconciliation

and the cashier may be allowed to reconcile a shift that was never supposed
to use the new remittance feature.

Owner/Main Manager remittance reports can also incorrectly classify those old
shifts as pending.

==================================================
SOURCE CONFIRMED
==================================================

Current source behavior:

get_my_pending_shift_reconciliation()
selects closed cashier shifts that have no shift_reconciliations row.

report_branch_shift_remittances()
uses:

no reconciliation row -> pending
reconciliation row -> reconciled

reconcile_closed_shift(...)
accepts a closed shift with no reconciliation row.

close_overdue_shifts()
closes forgotten shifts at 9 PM but intentionally creates no reconciliation,
so NEW auto-closed shifts should legitimately become pending.

close_cashier_shift(...)
creates reconciliation first and then closes the shift.

The shift lifecycle trigger prevents arbitrary modification of already closed
shift identity/lifecycle fields.

==================================================
REQUIRED DESIGN
==================================================

Add an explicit way to distinguish:

LEGACY CLOSED SHIFT
- created/closed before reconciliation was required
- must NOT be considered pending
- must NOT be reconcilable

from:

NEW RECONCILIATION-AWARE SHIFT
- reconciliation is required
- if manually closed, reconciliation is completed during close
- if 9 PM auto-closed, reconciliation remains pending
- original cashier may reconcile it later

Preferred minimal schema:

public.shifts.reconciliation_required boolean

But inspect the source first and confirm this is the smallest safe solution.

Do NOT infer pending eligibility merely from:

- absence of shift_reconciliations
- status = closed
- sales existing
- waste existing

Pending eligibility must be explicit.

==================================================
SAFE COLUMN MIGRATION
==================================================

Preferred migration behavior:

1. Add:

reconciliation_required boolean NOT NULL DEFAULT false

This intentionally causes ALREADY EXISTING shift rows to start as false.

Meaning:

existing historical shifts are not automatically considered pending.

2. After adding the column, change the DEFAULT FOR FUTURE INSERTS to true.

Conceptually:

existing rows:
false

future shifts:
true

Do this without rewriting old deployed migrations.

3. start_cashier_shift()

Newly inserted shifts must explicitly/default to:

reconciliation_required = true

Do not change the current flexible shift model.

4. EXISTING OPEN SHIFTS AT THE TIME OF THIS FIX

An open shift may already exist when this corrective migration is applied.

Do NOT lose reconciliation for it just because its newly added column began
as false.

When either:

close_cashier_shift()

or:

close_overdue_shifts()

closes an OPEN shift, set:

reconciliation_required = true

as part of that legitimate open -> closed transition.

This is important because shifts opened before the corrective migration still
need the new reconciliation rules once they close afterward.

Do not perform an unrelated standalone UPDATE on the open shift that conflicts
with shifts_protect_lifecycle.

==================================================
MANUAL CLOSE
==================================================

close_cashier_shift(...)

must continue to:

1. lock the open shift
2. derive expected cash
3. write reconciliation
4. write waste
5. close the shift

When it performs the allowed open -> closed UPDATE, also guarantee:

reconciliation_required = true

This preserves the existing atomic behavior.

Do not change cash math or waste behavior in this milestone.

==================================================
9 PM AUTO CLOSE
==================================================

close_overdue_shifts()

must close an eligible open shift with:

reconciliation_required = true

It must still NOT fabricate:

- actual cash
- waste
- shortage/excess
- reconciliation row

Therefore:

new auto-closed shift
+
reconciliation_required = true
+
no reconciliation row

= legitimate Pending reconciliation

Keep all existing 9 PM rules.

==================================================
PENDING CASHIER QUERY
==================================================

Update:

get_my_pending_shift_reconciliation()

A shift is pending ONLY when:

- cashier_id = authenticated cashier
- branch matches
- status = closed
- reconciliation_required = true
- no shift_reconciliations row exists

Legacy shift:

reconciliation_required = false

must never be returned.

==================================================
CLOSED-SHIFT RECONCILIATION
==================================================

Update:

reconcile_closed_shift(...)

It must explicitly require:

reconciliation_required = true

in addition to the existing rules:

- authenticated active Cashier
- original cashier owns shift
- branch matches
- shift status = closed
- no reconciliation exists

If:

reconciliation_required = false

reject with a clear domain error such as:

"This historical shift does not require reconciliation."

Do not allow a legacy closed shift to become a new reconciliation record.

==================================================
OWNER / MANAGER REMITTANCE REPORT
==================================================

Update:

report_branch_shift_remittances(...)

Legacy shifts that never required reconciliation must NOT appear as:

Pending reconciliation.

For this Part 1, do NOT redesign the report or add daily grouping.

Minimal safe behavior:

Include a shift in the remittance dataset when:

- a reconciliation row exists

OR

- reconciliation_required = true

Then:

reconciliation row exists
→ reconciled

reconciliation_required = true
AND no reconciliation row
→ pending

Legacy:
reconciliation_required = false
AND no reconciliation row
→ not part of the remittance feature/report

Do not fabricate a reconciliation for legacy rows.

==================================================
IMPORTANT DEPLOYMENT-GAP CASE
==================================================

The reconciliation feature was already deployed BEFORE this corrective
migration.

Therefore there may theoretically be shifts in this small interval:

original KG/remittance migration deployed
        ↓
a shift was opened
        ↓
9 PM auto-close occurred
        ↓
no reconciliation yet
        ↓
corrective migration not applied yet

Such a shift is a REAL pending shift, not legacy.

DO NOT silently misclassify such rows as legacy.

Before finalizing the migration, provide a READ-ONLY diagnostic query that
lists all CURRENT:

status = closed
AND no shift_reconciliations row

with at least:

- shift_id
- branch_id / branch name
- cashier_id / cashier name if available
- started_at
- ended_at
- completed sales total

The diagnostic must make it possible to distinguish old historical shifts
from any genuine post-feature pending shift.

Do not mutate remote data during this inspection.

Do not guess a deployment timestamp from the migration filename.

Do not use:

20260927180000

as though it proves the exact real-world deployment time.

If there are NO genuine pending shifts in the deployment gap:

the migration may safely leave all pre-existing closed/no-reconciliation
rows as reconciliation_required = false.

If there ARE genuine pending shifts in that gap:

the corrective migration must explicitly preserve only those verified shift
IDs as:

reconciliation_required = true

Do NOT mass-mark all closed/no-reconciliation shifts true.

If Cursor cannot safely identify those specific live shift IDs from available
data, STOP and report the diagnostic query/results needed instead of guessing.

==================================================
EXISTING COMPLETED RECONCILIATIONS
==================================================

Some shifts may already have:

shift_reconciliations

from the currently deployed feature.

Those rows remain valid.

Do not delete or recreate their reconciliation records.

The report must continue to show them as reconciled even if the newly added
reconciliation_required column initially defaults false on pre-existing rows.

It is acceptable for report inclusion to use:

reconciliation exists
OR reconciliation_required = true

There is no need to rewrite closed shift rows solely to set the boolean true
if doing so conflicts with the closed-shift lifecycle trigger.

==================================================
SHIFT LIFECYCLE PROTECTION
==================================================

Do NOT weaken shifts_protect_lifecycle just to backfill this feature.

Closed shift identity/lifecycle immutability should remain intact.

Prefer schema/default/query logic that avoids updating historical closed
shifts.

Do not disable lifecycle protection unless absolutely necessary.

If Cursor believes changing the lifecycle trigger is required, STOP and
explain why before implementation.

==================================================
APP BEHAVIOR
==================================================

Keep the current app flow.

Cashier:

Legacy closed shift:
→ no "Complete remittance"
→ no pending reconciliation prompt

New 9 PM auto-closed shift:
→ "Pending reconciliation"
→ original cashier may complete it

New manually closed shift:
→ already reconciled
→ no pending prompt

Owner/Main Manager:

Legacy historical shift:
→ must not appear as Pending reconciliation

Do not redesign the remittance screen in Part 1.

==================================================
TYPES
==================================================

Update only relevant TypeScript/database types if required for:

reconciliation_required

Do not perform broad generated-type cleanup in this part.

==================================================
TESTS
==================================================

Add focused regression coverage.

Required cases:

A. Legacy closed shift

Create a shift representing pre-feature history:

status = closed
reconciliation_required = false
no shift_reconciliations row

Verify:

get_my_pending_shift_reconciliation()
→ does NOT return it

reconcile_closed_shift(...)
→ rejects it

report_branch_shift_remittances()
→ does NOT call it pending

==================================================

B. New manual shift close

reconciliation_required = true/open

close_cashier_shift(...)

Verify:

reconciliation stored
shift closed
reconciliation_required = true
not pending afterward

==================================================

C. New 9 PM auto-close

open shift

close_overdue_shifts()

Verify:

shift closed
reconciliation_required = true
no reconciliation row
pending query returns it

==================================================

D. Existing open shift from before corrective migration

Simulate:

open shift
reconciliation_required = false

Then manual close:

close_cashier_shift(...)

Verify:

reconciliation_required becomes true
reconciliation stored
closed successfully

Then repeat with automatic 9 PM close:

Verify:
reconciliation_required becomes true
no reconciliation stored
pending afterward

==================================================

E. Existing already-reconciled shift

Closed shift
reconciliation_required may initially be false
existing shift_reconciliations row

Verify:

report still shows reconciled
not pending
no duplicate reconciliation created

==================================================

F. Security regression

Owner cannot reconcile.

Main Branch Manager cannot reconcile.

Another cashier cannot reconcile another cashier's shift.

Legacy cashier cannot reconcile legacy shift.

Original cashier can reconcile only a required pending shift.

==================================================
RUN
==================================================

Run:

npm run typecheck

tests/kg_meal_shift_reconciliation.mjs

the new focused legacy reconciliation test

affected shift/remittance tests only

Do not run GUI/browser/mobile automation.

Do not modify unrelated test expectations.

==================================================
MIGRATION
==================================================

Create a NEW migration.

Suggested naming style:

supabase/migrations/<new_timestamp>_fix_legacy_shift_reconciliation.sql

DO NOT modify:

20260927180000_kg_meal_shift_reconciliation.sql

It is already deployed.

==================================================
DEPLOYMENT
==================================================

DO NOT run:

npx supabase db push

Do not mutate the remote project.

Part 1 implementation must remain local until reviewed.

==================================================
FINAL REPORT
==================================================

Return:

1. Inspection findings
2. Exact root cause
3. New migration filename
4. Schema change
5. How legacy shifts are identified
6. How deployment-gap pending shifts are protected
7. Functions changed
8. App/type files changed
9. Tests run + PASS/FAIL
10. Any unresolved data ambiguity
11. Required deployment command

If there is ANY uncertainty about which existing closed/no-reconciliation
rows are genuine post-feature pending shifts, do not guess.

Report the diagnostic rows/query first.

Do not begin Part 2.