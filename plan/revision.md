PLAN APPROVED WITH ONE REQUIRED CORRECTION.

Do NOT implement sales_cutoff_at in the cashier hint.

Reason:

Current production does NOT have shifts.sales_cutoff_at yet.
That column is introduced by Revision 7A, which has not been pushed.

This fix must work BOTH:
- against current pre-Revision-7 production
- after Revision 7 is eventually deployed

Therefore hasMyFinalizedCloseToday must NOT SELECT or reference
sales_cutoff_at.

==================================================
REVISED IMPLEMENTATION
==================================================

Keep the app-only authorized-read approach.

Use getTodayRangeManila():

const { start, end } = getTodayRangeManila();

Query cashier-authorized shifts using ended_at directly:

shifts
- select id only
- cashier_id = cashierId
- branch_id = branchId
- status = closed
- ended_at >= Manila today start
- ended_at < Manila tomorrow start

Do NOT fetch a generic recent list + client-filter if the database can apply
the exact range.

If there are no matching shift IDs:
return false.

Then query shift_reconciliations for those shift IDs using existing RLS.

If at least one reconciliation is visible:
return true.

On either query failure:
return false.

This is UI HINT ONLY.

start_cashier_shift / assert_branch_may_start_shift remains authoritative.

Do NOT:
- reference sales_cutoff_at
- call listShiftRemittances
- call report_branch_shift_remittances from cashier hint
- widen report permissions
- add an RPC
- add a migration
- change RLS

Owner/Main Manager reporting remains unchanged.

Preserve the plan's note that another cashier's branch-wide finalized close may
not be visible to this cashier hint; the server will still reject Start Shift.

TESTS:

Add explicit static/regression coverage proving:

1. hasMyFinalizedCloseToday does NOT reference:
   - listShiftRemittances
   - report_branch_shift_remittances
   - sales_cutoff_at

2. It uses:
   - shifts
   - ended_at
   - getTodayRangeManila
   - shift_reconciliations

3. Owner/Main Manager reporting still uses report_branch_shift_remittances.

4. start_cashier_shift remains authoritative.

5. No migration/grant/RLS changes.

Run:
- npm run typecheck
- test:7d
- test:7e
- test:7final
- test:kg-meal
- relevant remaining suites

Return implementation report and STOP.

NO DB PUSH.
NO DEPLOY.