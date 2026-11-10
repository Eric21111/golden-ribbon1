# Cashier stock corrections

## Behavior

During an active selling-branch shift, a cashier can open **Correct stock count** on the POS, or **Check actual stock** when an item is out of stock. Enter the physically remaining quantity before serving the next order, choose a reason, review the old/new count and the cart requirement, then confirm. Both increases and decreases are supported, including zero. No manager approval is required. Correct one stock item at a time; repeat for other shortages. The existing cart stays intact and checkout still validates every ingredient.

Counts use the product's existing whole stock units, including half-eggs and half/quarter-serving units. No automatic conversion or negative inventory is introduced. If the corrected amount remains insufficient, reduce the order or verify other shortages; correction does not override checkout validation.

The catalog contains active PCS stock items already belonging to the assigned branch's inventory. Cashiers cannot create a new branch stock item through this flow, change Main inventory, or modify another branch. End-shift and pending/final reconciliation restrictions still apply.

## Audit and reconciliation

`correct_cashier_stock_count` updates the balance and inserts one adjustment movement in a single transaction under the existing branch inventory lock. A nullable `stock_count_correction` JSON field on inventory movements records the request, shift, old/new quantity and reason; existing movement columns identify branch, product, cashier and timestamp. Historical rows remain unchanged. Human-readable movement notes also show the correction.

The existing shift ledger includes the signed adjustment in expected stock, so the remittance calculation is unchanged. The detail label makes clear that adjustments include count corrections. Cashiers can view their branch's correction history, Owners and Main Managers all branches, and other managers their assigned branch. Main Manager dashboard and Owner Reports contain history links, with pages of 50 entries.

A row-version and quantity comparison rejects stale counts after another sale, receipt, return or correction. Refresh and recount rather than applying an outdated count. The cashier's submitted request is stored locally before sending; an uncertain response is retried with the same key and payload, including after app restart or shift close. A unique per-cashier key prevents duplicate correction records. Clearing app data during an unresolved request must be avoided.

## Release order

1. Back up production and retain the current APK. Confirm the earlier stock-portions and remittance migrations are already applied; do not rerun them.
2. Apply **only** `supabase/migrations/20261110151546_cashier_stock_corrections.sql` once in the SQL editor. This adds one nullable column, one index and three restricted RPCs; it does not change existing quantities or historical sales/returns.
3. Test the updated app on a non-production database first, then build the preview APK and perform the Android checks below before distributing it.
4. Do not run the reset script as part of deploying this feature. This feature adds no new table, but the reset regression currently fails safely because the repository's notification tables (`notifications`, `push_deliveries`, `push_devices`) are absent from its reviewed allowlist. Review that separate reset compatibility issue before using the reset script.

No production migration or APK build was executed during implementation. The two earlier migrations the user already ran are separate from this new migration.

## Automated verification

- `node tests/stock_corrections.mjs`: local database with all repository migrations; higher/lower counts, whole-number validation, roles, branch isolation, stale row versions, unchanged counts, idempotency/payload mismatch, subsequent sales, forced ledger failure rollback, history permissions, remittance totals and freeze/retry behavior.
- `node tests/stock_corrections_ui.mjs`: form interactions, unit labels, preview arithmetic, local persistence before submission, retry after remount, and cart preservation.
- `npm run typecheck`, plus existing stock portions, cashier POS, sales/checkout, remittance and reset regression suites.

## Android and staging checks

Use isolated test stock and an active test cashier shift. Verify Rice 0 → 10, sell two recipe portions, then correct the current remaining count downward and upward. Verify the branch only changes, the Main balance is unchanged, all movement reasons appear in history, and remittance includes the signed adjustments. Test search, large text, keyboard visibility, back navigation, multiple shortages and a small phone screen. Test both tablet and phone POS layouts.

Disconnect the network after sending a correction and reopen the screen/app; confirm the same request returns one receipt with one adjustment. Simultaneously sell or receive a delivery on another device while the correction review is open; submission must reject the stale count and ask for a recount. Start shift close while a correction is open; a new correction must be blocked. A retry of an already committed correction may return its original receipt without changing stock.

The local database tests are sequential PGlite tests, not proof of real multi-session Postgres scheduling or physical Android layout. Complete those device and concurrent-session checks before client release. Roll back the app if needed; retain the additive database objects and audit records rather than undoing historical corrections.
