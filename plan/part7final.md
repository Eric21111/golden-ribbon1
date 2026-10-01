FINAL AUDIT FIX PACK — REVISION 7 PRODUCTION HARDENING

The independent source-level audit of the committed project found several
issues that must be fixed before db push/deployment.

DO NOT edit existing 7A/7B/7C migrations.

Use a NEW forward migration after:

20260928150100_revision_7c_freeze_and_close_rpcs.sql

Suggested:

20260928150200_revision_7_final_audit_hardening.sql

No production push/deploy yet.

==================================================
1. HIGH — ENFORCE ONE OPEN SELLING SESSION PER BRANCH
==================================================

Current schema only has:

shifts_one_open_per_cashier_idx

This is insufficient because multiple cashier accounts may belong to the same
selling branch, while Revision 7 End Shift reconciliation aggregates inventory
at branch/session level.

Implement branch-level single-session enforcement.

Requirements:

- Preflight migration:
  detect selling branches with >1 currently open shift.
  If any exist, fail migration with branch IDs + shift IDs.
  Do NOT arbitrarily close them.

- Add partial unique index conceptually:

  one open shift per branch
  where status = 'open'

- Keep existing one-open-per-cashier protection.

- start_cashier_shift:
  after branch lock and before insert:
  * if this cashier already owns the branch open shift → return it idempotently
  * if ANOTHER cashier owns an open shift for this branch → reject clearly:
    "Another selling session is already active for this branch."

- Preserve one shared booth-session business model.

Add tests:
- two cashier profiles assigned to same branch
- first starts successfully
- second cannot start
- first retry returns same shift
- next business day/new completed session works normally

==================================================
2. HIGH — BLOCK EMPLOYEE CHANGES WHILE RECONCILIATION IS PENDING
==================================================

Current prevent_employee_change_during_open_shift only checks:

status = 'open'

This permits reassignment / role change / deactivation after Begin Close or
auto-close even though reconciliation is still pending.

That can strand the old branch because pending/finalize requires:
- active cashier
- same cashier ID
- current profile branch = shift branch

Forward-fix the employee protection trigger.

When branch_id, role, or active status is being changed in a way currently
protected, reject if the employee owns ANY shift that is:

A. status = 'open'

OR

B. closed but:
   reconciliation_required = true
   OR inventory_reconciliation_required = true

Use a cashier-friendly/backend-clear error such as:

"Employee has an unfinished shift or remittance. Complete reconciliation
before changing branch, role, or active status."

Do not alter historical finalized shifts.

Add tests:
- manual Begin Close pending → reassign rejected
- pending → deactivate rejected
- pending → change role rejected
- auto-closed pending → same rejects
- after successful finalize → change succeeds

Update client error copy if needed.

==================================================
3. HIGH — FIX GLOBAL LOCK ORDER
==================================================

Approved global lock order is:

1. branch FOR UPDATE
2. relevant shift FOR UPDATE
3. branch_inventory rows ORDER BY product_id
4. writes

Current source violates this in:
- begin_shift_close_core
- finalize_cashier_shift_reconciliation
- close_overdue_shifts

They lock shift first and then invoke the branch-first gate.

This creates a branch↔shift deadlock risk against receipt/sale/return paths.

Refactor all Revision-7 close paths to respect the same global order.

IMPORTANT:

begin close:
- locate/identify target shift without holding its row lock long-term
- obtain branch lock FIRST
- lock/re-read target shift SECOND
- validate ownership/state again
- lock inventory rows in deterministic product order
- perform cutoff/baseline writes

finalize:
- resolve target branch
- branch lock FIRST
- target shift lock SECOND
- inventory locks THIRD
- revalidate pending/state/payload
- finalize atomically

auto-close:
- do NOT pre-lock a shift and then request the branch lock
- candidate discovery may identify IDs without violating lock order
- each close operation must obtain branch → shift → inventory
- preserve idempotency/race-safe revalidation

Audit ALL selling-branch mutation paths for the same order.

Do not simply suppress PostgreSQL deadlock errors.

==================================================
4. FIX FINALIZE / BEGIN IDEMPOTENT RESPONSE CONSISTENCY
==================================================

finalize_cashier_shift_reconciliation:

Fresh success returns:
- cash result
- products summary

Existing idempotent retry currently omits products.

Make successful identical retry return the same semantic response shape as the
original finalization.

Build persisted product summary from shift_product_reconciliations including:
- product_id
- expected_remaining
- actual_remaining
- waste_quantity
- discrepancy
- result
- unsold_quantity
- carried_quantity

No stock mutation on retry.

Also harden begin_cashier_shift_close:

A closed shift with sales_cutoff_at that is STILL pending may return/resume the
pending preview.

A shift that is ALREADY FULLY FINALIZED must NOT be represented as
status='pending'.

Return an appropriate finalized/already-completed response or clear error that
the client can treat as completed.

Do not reopen anything.

==================================================
5. REPLACE PLACEHOLDER TRUE-POSTGRES CONCURRENCY TEST
==================================================

tests/revision_7e_concurrency_postgres.mjs currently only documents scenarios
and exits without executing them.

Replace it with an ACTUAL disposable/local PostgreSQL concurrency runner using
independent database sessions/connections.

Do not use production.

Test:

1. simultaneous sale vs sale with insufficient combined stock
2. receipt vs begin_cashier_shift_close
3. sale vs begin_cashier_shift_close
4. identical simultaneous finalize
5. conflicting simultaneous finalize
6. two cashiers trying to start a shift for the same branch

Verify:
- no deadlock
- no oversell
- cutoff wins safely or mutation completes before cutoff according to lock
  ordering
- only one branch session opens
- identical finalize is idempotent
- conflicting finalize does not duplicate inventory writes

If local Postgres is unavailable:
- runner must still be genuinely executable when DATABASE_URL is supplied
- report NOT EXECUTED
- do not claim success

==================================================
6. FIX milestone10_5_live_verification.mjs
==================================================

The final verifier still contains obsolete pre-Revision-7 workflows.

Remove/update manager receive_stock_transfer success paths.

Selling branch transfer receipt now uses:
- confirm_shipment_arrival
or
- report_shipment_issue

through the authorized cashier flow.

Update Full E2E:
- send PCS from Main
- cashier receives/confirms actual PCS
- discrepancy path uses report_shipment_issue where appropriate
- POS/end-shift continues on final Rev7 APIs

Update return assertion:

LEFTOVER RETURN RECEIVE MUST NOT RESTOCK MAIN.

For example:
Main starts 100
Main sends 60
Main usable stock = 40

Later 27 leftover units are received for accountability:
Main usable inventory MUST remain 40,
not become 67.

Preserve discrepancy/history checks without return_in.

Update concurrency setup so it no longer calls retired receive_stock_transfer.

Search the entire live verification script for every obsolete business rule.

==================================================
7. CLEANUP — TYPES + DOCS
==================================================

TypeScript:

InventoryMovement.reference_type union must include:

'shift_product_reconciliation'

because waste/unsold movements use it.

Documentation:
remove/update stale descriptions including:
- receive_stock_transfer as active manager receive
- leftover return increasing/restocking Main inventory
- obsolete manager receipt smoke checks
- any route references that no longer exist
- active KG wording that is not explicitly historical

Historical KG documentation/test fixtures may remain.

==================================================
8. CUTOVER REVIEW CHECKLIST
==================================================

Do NOT invent another schema/UI approval state unless required.

But explicitly document the mandatory production cutover step:

Before first PCS selling session:
- Owner/Main Manager reviews every provisional closing_stock_behavior mapping
- former kg_meal was provisionally mapped to record_as_unsold
- former piece_stock was provisionally mapped to keep_at_branch
- correct any product that does not match actual business handling
- only then initialize/reactivate/use PCS selling operations

Provide a SQL/read-only audit query or existing UI procedure for reviewing
these mappings.

==================================================
9. TESTS
==================================================

Add regression coverage for every fix.

Then run:

- npm run test:7a
- npm run test:7b
- npm run test:7c
- npm run test:7d
- npm run test:7e
- every package.json test/regression script
- npm run typecheck

Also run the real PostgreSQL concurrency runner if a safe disposable local
database is available.

Report PGlite and true-Postgres results separately.

==================================================
RETURN REPORT
==================================================

Return:

1. New forward migration filename
2. Branch-level one-open-shift implementation
3. Pending-remittance employee-change protection
4. Final lock order for every affected RPC
5. begin-close changes
6. finalize/idempotency changes
7. auto-close changes
8. Real PostgreSQL concurrency runner implementation
9. Whether true PostgreSQL tests were actually executed
10. milestone10_5_live_verification corrections
11. Return no-restock assertions
12. Type cleanup
13. Documentation cleanup
14. Cutover review procedure
15. Tests added/updated
16. All test results
17. Typecheck result
18. Any regression/fix
19. Any deviation from this audit
20. Remaining concerns

STOP afterward.

DO NOT db push or deploy.