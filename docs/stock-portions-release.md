# Stock portions: implementation and release

This release implements integer base portions, not decimal inventory. No existing quantities or unit definitions are converted. No production migration or data reset has been executed by this implementation.

## Setup

1. Apply the new `20261110120916_explicit_stock_portions.sql` migration after review/backup. Do not rerun Revision 7. The previously prepared remittance migration remains a separate pending change.
2. Rebuild/distribute the APK. Retire old APKs before staff use portion stock: older apps can show an incorrect `pcs` label even when the quantity is correct. The new read paths require the metadata RPC; deploy the migration before the APK.
3. Main Branch Manager creates a **stock-only** product and explicitly chooses its fixed counting unit: pieces, half-egg units, half-serving units, or quarter-serving units. Existing products cannot have their unit changed; their records retain the original values.
4. For Egg, choose half-egg units. Configure Extra Egg to consume Egg ×2 and a half-egg meal to consume Egg ×1. Keep every other ingredient required by that meal.
5. For Bihon, confirm the physical serving and meal ratio first. Half-serving units support Solo ×2 and Meal ×1. Quarter-serving units support Solo ×4 and a half-serving meal ×2 (or a confirmed quarter-serving meal ×1). The app does not choose or estimate this ratio automatically.
6. Enter opening stock in the chosen units: 30 whole eggs = 60 half-egg units. Transfer, receive, count remaining, return, and record waste in that same unit. Prices/order quantities refer to the sellable product, not to the ingredient-unit count.

Portion pools stay stock-only; sell them through separate products/recipes. This avoids an accidental fallback that sells one half as one whole item. Unit selection is creation-only and enforced by the database. Renaming a product never changes its unit. New half/quarter pools remain piece-based and cannot be changed to kilogram mode.

## Preservation and compatibility

- Legacy product metadata is NULL, not inferred from `Egg` in its name. Existing balances, movements, recipes, totals, and historical records are unchanged. The recipe picker calls these legacy stock units; historical quantity formatting remains unchanged.
- The current production Egg balance of 100 still has an unverified physical interpretation. Use a separately approved reset/new stock pool or a reviewed cutover; do not multiply its quantity by two automatically.
- Unit metadata is immutable. Authorized read results are enriched in batches by product ID, so new-unit labels remain correct on later history screens. Metadata lookup failure shows the normal load error instead of assuming the quantity means pieces.
- Checkout, pricing, stock locks, recipe precedence, idempotency, RLS, and physical-return/accountability arithmetic are unchanged. No client-side inventory writes replace the existing RPCs.
- Existing creation RPC signatures are retained. The new app uses a dedicated transactional creation RPC for explicit-unit stock-only products. Old products and ordinary sellable products keep their existing creation flow.
- The reset script still covers the same tables: this migration adds a column/functions/constraint/trigger, not a new data table. Reset regression tests pass. Reset approval/execution is separate; load the client's real products only after agreeing their units.
- Historical per-sale ingredient totals continue to come from saved movements. This feature does not add per-sale-line recipe snapshots, arbitrary fractions, or customer refunds.

## Validation

Run `node tests/stock_portions.mjs` and `node tests/stock_portions_ui.mjs`, plus the existing recipe, POS, returns, remittance, and reset regressions. The database test covers actual opening, send/arrival, mixed whole/half sales, rollback, retries, return accountability, and final remittance using disposable PGlite. It also checks access restrictions, immutable units, and no legacy conversion.

Before client rollout, verify on Android: new stock-unit selection; recipe input rejects decimal paste instead of turning `0.5` into `5`; unit hints fit small screens; each transfer/return/remittance screen uses the same units; Owner/Manager reports agree with the ledger. Run a simultaneous-sale test in a disposable real PostgreSQL environment before making claims about real concurrent sessions. PGlite does not provide that proof.

The earlier `product_stock_uses.mjs` scanner failure was repaired to handle Windows CRLF when stripping SQL documentation comments; its original assertions remain intact.
