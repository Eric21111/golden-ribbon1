The Part 5 MD still contains the four items that were supposed to be revised.
Do not start implementation yet.

Please update the MD with these corrections exactly.

==================================================
1. PRODUCTFORM — REINSPECT, DO NOT AUTOMATICALLY KEEP
==================================================

Current MD still says:

Keep ProductForm because product_active_after_opening.mjs pins copy in it.

That is not enough.

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

Current MD still says the account_management selling-manager asserts are valid
because roles.ts contains "Selling Branch Manager".

That is insufficient.

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

Remove the current proposal:

PowerShell-safe `;`, not `&&`

from the MD.

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

Add a separate section:

LOCAL / RECONSTRUCTED VERIFICATION

Examples:
- migration order in repository
- PGlite schema reconstruction
- function definitions reconstructed from migrations
- source-level grants/search_path assertions

REMOTE / LINKED SUPABASE VERIFICATION

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

==================================================
KEEP THE REST
==================================================

Keep the existing:

- dead CreateReturnScreen/createReturn inspection
- milestone11_3 numeric test fix
- end_cashier_shift reject guard
- RPC/security audit
- direct-write audit
- snapshot/unit/null-state audit
- docs cleanup
- classification of all tests
- destructive live test exclusions
- typecheck
- 18-point final report
- no migration without review
- no db push

Update the Part 5 MD first.

Do not begin cleanup/testing until these four changes are reflected in the
plan.