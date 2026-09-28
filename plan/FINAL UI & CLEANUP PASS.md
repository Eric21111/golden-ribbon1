REVISION 6 — FINAL UI & CLEANUP PASS

This is a small app-level cleanup pass after Parts 1–5.

IMPORTANT:
- Do NOT redesign business rules.
- Do NOT create a Supabase migration.
- Do NOT run db push.
- Do NOT change approved inventory / transfer / POS / reconciliation behavior.
- Keep scope limited to the five remaining cleanup items below.
- After changes, run the relevant regression tests plus full typecheck.

==================================================
1. SELLING-BRANCH KG WORDING
==================================================

Current issue:

Some selling-branch kg_meal inventory UI still uses:

"Not set"

The approved wording is:

"Not tracked"

Search active UI for:
- Not set
- not_set
- selling-branch kg_meal status labels
- owner inventory-by-branch filters
- inventory status helpers

Expected behavior:

Main Branch kg_meal:
- quantity shown in kg
- 3 decimal places
- normal in-stock / out-of-stock semantics

Selling Branch kg_meal:
- quantity = Not tracked
- status/filter wording should also be Not tracked
- never show Not set for this case

You may keep an internal enum/key such as `not_set` if changing it would create unnecessary churn,
but all user-facing text must say:

Not tracked

Do not change calculations.

==================================================
2. BRANCH PERFORMANCE KG LOADING STATE
==================================================

Current issue:

Branch Performance derives inventory_mode from the products query.

If report data renders before product-mode data is ready, a kg_meal row can temporarily fall through
to the piece-stock/default formatter and appear like:

0 pcs

This must never happen.

Fix the rendering so inventory quantities that depend on product inventory_mode are not formatted
until the mode lookup is known.

Preferred behavior:

- while product mode data is loading:
  render a neutral loading placeholder such as `—`
  OR hold that stock field until mode data is ready

- if product lookup fails:
  do not silently format unknown mode as piece stock
  show a neutral fallback and preserve the report error state

- once mode is known:
  piece_stock -> `X pcs`
  Main kg_meal -> `X.XXX kg`
  selling-branch kg_meal -> `Not tracked`

Do NOT change the report calculations or SQL.

==================================================
3. "UNITS SOLD" WORDING
==================================================

Search active user-facing UI for:

Units sold
Total units sold
units sold

Where the value represents mixed:
- meal counts
- piece item counts
- general POS sale quantity

change wording to:

Items sold

Examples:
- Units sold -> Items sold
- Total units sold -> Total items sold

Do NOT change calculations.

Do NOT rename a label if it is genuinely a technical quantity with a specific unit.
Only change mixed/general sales-count wording.

Never label meal counts as kg.

==================================================
4. DEAD / STALE APP CODE CLEANUP
==================================================

Reinspect before deleting.

A. productSchema / ProductFormValues

Check:
- src/features/products/productSchema.ts
- imports throughout app/src/tests

If current wizards only use PRICE_PATTERN and:

- productSchema is unused
- ProductFormValues is unused

remove those dead exports/types and any now-unused dependencies/imports.

Keep PRICE_PATTERN if it is still used.

Do not rewrite current wizard validation unless a real bug is found.

--------------------------------------------------

B. stale Manager Incoming / retired receive path

Reinspect:
- manager incoming routes/screens
- transfer service wrappers
- receive_stock_transfer references
- navigation links
- tests

Current approved receiving flow is:

selling-branch Cashier
→ confirm_shipment_arrival / report_shipment_issue

Do not keep an active Manager UI that points to a retired/stubbed receive_stock_transfer path.

Classify the old Manager Incoming path as:

A. still legitimately used
B. compatibility-only/unreachable
C. dead/stale

If C:
remove the dead screen/route/service wrapper/navigation references.

If B:
keep only what is intentionally required and make it clearly non-active.

Do NOT remove SQL compatibility/reject guards merely because the UI no longer uses them.

If there is ambiguity about whether a manager should still receive transfers,
STOP and report it instead of changing business rules.

==================================================
5. DISTRIBUTION ZIP HYGIENE
==================================================

Do NOT modify runtime behavior for this.

Ensure project ignore/distribution guidance excludes:

.git/
node_modules/
.expo/
.env

Check:
- .gitignore
- any archive/build scripts
- README packaging instructions if applicable

If `.gitignore` does not already cover these, update it appropriately.

Do NOT delete the developer's local .env file from the working project.

Do NOT delete node_modules from the working project merely for this revision.

This item is about clean distribution/archive practice.

==================================================
REGRESSION / VERIFICATION
==================================================

After implementation:

Run:

npm run typecheck

Then run at minimum:

node tests/kg_ui_formatting.mjs
node tests/branch_performance_return_badge.mjs
node tests/kg_meal_shift_reconciliation.mjs
node tests/product_active_after_opening.mjs
node tests/atomic_product_edit.mjs
node tests/milestone12_3_cashier_shipment_arrival.mjs

Also run any tests directly affected by removal of manager incoming/service code.

If practical, rerun all ACTIVE local suites from Part 5.

Do NOT run:
- milestone10_5_live_verification.mjs
- cleanup_m105_fixtures.mjs

Do NOT run destructive linked-production tests.

==================================================
ACCEPTANCE CRITERIA
==================================================

Revision 6 is complete only if:

[ ] Selling-branch kg_meal UI consistently says Not tracked.

[ ] No active KG row can transiently render as `0 pcs` because inventory_mode is not loaded yet.

[ ] Mixed/general sales labels use Items sold instead of Units sold.

[ ] No KG-to-meal logic or calculation changed.

[ ] Dead product schema/types are removed only if truly unused.

[ ] Stale Manager Incoming path is removed or clearly classified.

[ ] No active UI calls a retired transfer receiving RPC.

[ ] Distribution guidance excludes .git, node_modules, .expo, and .env.

[ ] No database migration was created.

[ ] No db push is required.

[ ] Typecheck passes.

[ ] Relevant regressions pass.

==================================================
FINAL REPORT
==================================================

Return:

1. Files changed
2. Files removed
3. UI wording changes
4. Branch Performance loading-state fix
5. productSchema/ProductFormValues result
6. Manager Incoming classification and action
7. Packaging/.gitignore result
8. Tests run and results
9. Typecheck result
10. Whether any migration was created
11. Whether db push is required
12. Final status:
   READY FOR FORMAL CLIENT UAT
   or
   BLOCKED, with reason

Do not start a new milestone after this.