Patch 3 plan is APPROVED.

Proceed exactly as written.

One small implementation note:

In ensureSharedMain(), if an existing is_main_branch=true row is reused,
verify that it is active.

If the existing Main Branch is unexpectedly inactive, fail the runner clearly.
Do not create a second Main Branch and do not weaken branches_one_main_branch.

Everything else in the Patch 3 plan is approved.

Constraints remain:

- test-harness + README only
- no application architecture changes
- no new migration
- no db push
- no deployment

Run all regression test:* scripts and typecheck.

Report separately:

PGlite = PASS / FAIL
Typecheck = PASS / FAIL
True PostgreSQL = EXECUTED PASS / EXECUTED FAIL / NOT EXECUTED

Do not claim true concurrency PASS unless all six real PostgreSQL scenarios
actually run.

Return the Patch-3 implementation report and STOP.