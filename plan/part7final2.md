REVISION 7 FINAL HARDENING — PATCH 2

Independent re-audit of commit
c7c0e11ad8ed9d2a072a27ab49302a009d8c7698 found the core application
hardening fixes are correct.

Do NOT redesign Revision 7.

Fix ONLY the remaining release blockers below.

No db push.
No deployment.

==================================================
1. AUTO-CLOSE MUST NOT SWALLOW UNEXPECTED ERRORS
==================================================

Current final migration still has in close_overdue_shifts():

EXCEPTION WHEN OTHERS THEN
  NULL;

This violates the approved requirement not to swallow deadlocks and can make
the safety auto-close silently fail.

Use a NEW forward migration after:

20260928150200_revision_7_final_audit_hardening.sql

Suggested:

20260928150300_revision_7_final_hardening_patch2.sql

Rewrite close_overdue_shifts.

Requirements:

- Candidate discovery remains WITHOUT shift FOR UPDATE.
- begin_shift_close_core remains the canonical owner of:
    branch
    → exact target shift
    → inventory
    → writes.
- Do not silently swallow SQLSTATE 40P01 deadlock_detected.
- Do not silently swallow serialization failures.
- Do not silently swallow unexpected integrity/programming errors.
- Prefer propagating unexpected failures so the scheduler/operator knows
  auto-close did not complete.
- Candidate races that are already safely handled by the idempotent
  begin_shift_close_core do not need generic exception suppression.

Add regression/static coverage ensuring there is no:
  EXCEPTION WHEN OTHERS THEN NULL
in the final close_overdue_shifts definition.

==================================================
2. FIX TRUE POSTGRES RUNNER FIXTURE RESET
==================================================

tests/revision_7e_concurrency_postgres.mjs currently deletes rows from:

- sale_items
- sales
- inventory_movements

inside resetBranchState().

Those tables have immutable DELETE triggers.

The true PostgreSQL runner will therefore fail when moving from a scenario that
created a sale/movement into the next reset.

Do NOT weaken or disable production immutability just for this test.

Preferred fix:

- Give each concurrency scenario its own isolated fixture IDs:
  branch/product/cashier/shift/transfer as needed.
- Do not delete immutable business history between scenarios.
- Use unique runtime IDs so the disposable runner can be re-run safely.
- Since DATABASE_URL must be disposable/local, leftover test rows are fine.

Alternatively use another isolation strategy that does not alter production
triggers.

==================================================
3. TEST A REAL CONFLICTING FINALIZE RACE
==================================================

Current runner performs identical simultaneous finalize first, completing the
shift, and only afterward submits two different actual-cash amounts.

That tests conflicting RETRIES, not conflicting simultaneous FIRST finalize.

Add a separate fresh pending shift.

Run concurrently:

Finalize A:
  pending shift + payload A

Finalize B:
  same pending shift + conflicting cash and/or inventory payload B

Expected:

- exactly ONE finalize commits
- exactly ONE conflicts/rejects
- no deadlock
- exactly one shift_reconciliations row
- exactly one reconciliation row per product
- no duplicated adjustment/waste/unsold movements
- ending branch stock matches the winning payload only

Retain the identical simultaneous-finalize test separately.

==================================================
4. STRENGTHEN SALE/CLOSE AND RECEIPT/CLOSE ASSERTIONS
==================================================

For real PostgreSQL tests, do more than "at least one succeeds".

Because branch locking serializes the operations:

sale vs begin-close:
- begin-close must eventually produce a valid cutoff
- if sale committed before cutoff, preview/reconciliation must include it
- if close obtained the lock first, sale must be rejected after cutoff
- no deadlock / no post-cutoff sale

receipt vs begin-close:
- if receipt committed first, close baseline/system balance must include it
- if close won first, receipt must be rejected/frozen
- no deadlock / no post-cutoff stock mutation

==================================================
5. FIX milestone10_5 CLOSED-SHIFT BACKDATE
==================================================

Do NOT backdate a finalized production shift using:

admin.from('shifts').update({
  started_at,
  ended_at,
  sales_cutoff_at
})

The lifecycle trigger correctly rejects that mutation.

Do NOT disable the lifecycle trigger in production for the test.

Restructure the live verifier instead.

Preferred:
- use another dedicated selling branch/cashier for the later sale concurrency
  scenario

OR:
- run that concurrency scenario before the first branch is finalized and make
  the expected cash calculation account for it.

Preserve the same-day final-close rule. Do not bypass it.

Every Supabase admin update used by this test must check its returned error.

==================================================
6. ADD DEPLOYMENT READ-ONLY PREFLIGHT
==================================================

Document a read-only SQL query for closed pending reconciliations where the
recorded cashier can no longer finalize because:

- profile is missing
- profile is inactive
- role is not cashier
- current profile.branch_id differs from shift.branch_id

Do not auto-fix anything.

If rows exist, report them for manual resolution before production migration.

==================================================
7. DOC CLEANUP
==================================================

README still contains old walkthrough wording such as a Branch Manager entering
selling-branch receipt counts.

Update remaining active walkthroughs to cashier:
confirm_shipment_arrival / report_shipment_issue.

Also correct any remaining statement that initialize_main_branch_inventory is
Owner-only if the final authority is Main Branch Manager.

Do not rewrite historical migration documentation where historical wording is
intentional.

==================================================
8. TESTS
==================================================

Run all existing tests plus the Patch-2 regression.

Run typecheck.

If a disposable/local real PostgreSQL DATABASE_URL is available, run the true
concurrency runner.

Report separately:

PGlite = PASS/FAIL
Typecheck = PASS/FAIL
True PostgreSQL = EXECUTED PASS / EXECUTED FAIL / NOT EXECUTED

Do not report true concurrency as passing if it was not actually executed.

STOP after implementation report.

NO DB PUSH.
NO DEPLOYMENT.