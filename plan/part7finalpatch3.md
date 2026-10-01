FINAL PRE-RELEASE TEST-HARNESS FIX

The Patch-2 application/source audit passes, but the true PostgreSQL
concurrency runner still has one execution blocker.

NO application architecture changes.
NO db push.
NO deployment.

==================================================
1. USE ONE SHARED MAIN BRANCH IN PG CONCURRENCY RUNNER
==================================================

tests/revision_7e_concurrency_postgres.mjs currently creates a new branch with:

is_main_branch = true

inside every seedScenario() call.

The schema enforces:

branches_one_main_branch

so Scenario 2 will fail after Scenario 1 already created a Main Branch.

Fix the runner architecture:

- Create exactly ONE runtime-unique shared Main Branch once before scenarios.
- Do not delete it between scenarios.
- Each scenario creates:
  * unique selling branch
  * unique product
  * unique cashier(s)
  * unique profile IDs
  * unique codes/SKUs/idempotency keys
- Scenario Main Managers may all point to the same shared Main Branch.
- Scenario product stock on Main remains isolated because products are unique.
- Preserve safe rerun behavior with APPLY_MIGRATIONS=0.

Do not weaken branches_one_main_branch.

==================================================
2. TIGHTEN RECEIPT VS CLOSE ASSERTION
==================================================

When concurrent receipt succeeds:

Do NOT pass merely because live stock >= expected.

Require the completed begin-close preview/baseline to reflect the received
quantity.

For the current fixture:
opening branch stock = 3
received = 2

If receipt succeeds before close:
system_balance_before_waste must be 5
(and/or received_quantity must show 2 where available).

If close wins:
receipt must reject and no receipt credit may appear after cutoff.

This prevents a post-cutoff receipt from falsely passing via live balance.

==================================================
3. TIGHTEN CONFLICTING-FIRST-FINALIZE MOVEMENT ASSERTION
==================================================

Current test uses:

shift_product_reconciliation movement count <= 3

Replace the loose upper bound with an exact expectation derived from the
winning persisted payload.

For the current keep_at_branch fixture:

Payload A:
actual=8, waste=0
→ no waste/unsold reconciliation movement expected

Payload B:
actual=6, waste=1
→ exactly one waste reconciliation movement expected
→ no unsold movement

Also verify adjustment movement count/quantity matches the winning payload
where applicable.

The losing finalize must contribute zero writes.

Retain:
- exactly one cash reconciliation
- exactly one product reconciliation
- ending usable stock equals winner
- no deadlock

==================================================
4. SMALL README CLEANUP
==================================================

Correct remaining active README authority drift:

- Product master create/edit authority = Main Branch Manager, not Owner.
- receive_stock_return authority = Main Branch Manager.
- Owner may view/report where applicable but does not perform Main operational
  receive.

Do not rewrite intentional historical migration documentation.

==================================================
5. TEST / REPORT
==================================================

Run existing PGlite/regression/typecheck.

If no disposable PostgreSQL DATABASE_URL is available, report:
TRUE POSTGRES = NOT EXECUTED.

Do not claim concurrency PASS until the real runner actually executes all six
scenarios.

Return implementation report and STOP.

NO DB PUSH.
NO DEPLOYMENT.