# Egg and Bihon portions: audit and implementation plan

Date: November 10, 2026. This is the original audit/design. The recommended integer-portion release has now been implemented and tested locally following separate user authorization; see [release instructions](stock-portions-release.md). No production migration or reset has been executed. Findings below describe the pre-change audit unless explicitly stated otherwise.

## 1. Decision

The business requirement is correct: a standalone order and a meal can consume different amounts of the SAME ingredient stock. The proposed implementation needs revision: allowing decimals in the recipe input alone is unsafe in this application.

**Recommend whole base portions for the first release.** Define one Egg stock unit as half an egg, and (if the client confirms it) one Bihon stock unit as half a standard solo serving. Configure recipes as whole counts of these units. This preserves the existing piece-stock ledger, checkout transaction, opening stock, transfers, returns, and reconciliation arithmetic. It does not require switching to kilograms or introducing fractional ledger balances.

For reliable daily use, make the meaning of a stock unit explicit and consistent throughout the app. The current Egg-name convention is insufficient. Add a small, immutable stock-unit definition for NEW stock products, plus unit labels in every quantity workflow. Do not implement unrestricted decimal inputs as the first release.

If displaying `Egg ×0.5` in the editor is mandatory, it can be a later presentation/conversion layer: `0.5 whole egg = 1 half-egg stock unit`. The server must validate exact conversion; the ledger and submitted stock quantities remain whole base units. This is different from supporting arbitrary decimal inventory.

## 2. Verified current behavior

### Live database inspection (read-only)

Project: `uvxpjrzqtmaterczzvjo`, dashboard name `inventory`.

- `product_stock_uses.quantity` is an integer.
- Deployed `normalize_product_stock_uses(jsonb)` accepts whole numbers 1–99 and rejects decimals, zero, negative values, duplicate ingredient lines, and missing ingredients. Only Main Branch Managers may use this configuration flow.
- `branch_inventory.quantity_on_hand` and `inventory_movements.quantity` are numeric with three decimal places, but deployed `guard_branch_inventory_quantity_mode()` explicitly rejects fractional balances for `piece_stock`. Numeric column types do not imply decimal support for these products.
- One matching stock product exists: `Egg`, ID `f0137490-8b51-49ce-9c57-f04e60aa2910`, `piece_stock`, hidden from POS. No product name containing Bihon was returned.
- Saved Egg recipes: Beef Curry / Meal consumes 1; Beef Tapa / With Rice & Egg consumes 1.
- Egg balance at inspection: Main Branch 100, SM 1 zero, SM 2 zero.
- These values do NOT establish whether staff originally counted 100 whole eggs or 100 halves. Do not halve, double, or relabel that historical balance without a physical count and explicit approval.
- The live inspection verified the recipe validator, inventory guard, relevant column types, matching product records, recipes, and balances. The wider flow below was traced in repository code; this was not a production checkout/transfer/return test or a full deployed-function diff.

### Source evidence and implications

Paths are relative to the repository root.

| Area | Exact source / function | Finding |
| --- | --- | --- |
| Recipe editor | `src/features/products/VariantRecipePreview.tsx`, quantity input around line 199 | Removes non-digits and uses `parseInt`. Typing `0.5` can become `5`; this is not a decimal-safe input. |
| Recipe payload | `src/features/products/stockUseMapping.ts`, `validLine`, `buildStockUsePayload` | Requires integer 1–99; invalid lines are skipped. A future decimal UI must never silently lose recipe lines and trigger fallback deductions. |
| Egg convention | `src/features/products/recipePreviewData.ts`, `isEggProduct`, `unitForIngredient` | Names matching exactly Egg/Eggs get half-egg labels. Product records have no dedicated stock-unit definition here. Renaming/localizing a product can change the label without changing the ledger. |
| Product save | `src/services/productService.ts`, `createCompleteProduct`, `updateCompleteProduct` and stock-use loading | Sends `p_stock_uses` through transactional RPCs; keep this route. Create/update service arguments are already wired to the wizards. |
| Recipe schema/validation | `supabase/migrations/20261023090000_product_stock_uses.sql`; `20261023110000_save_product_stock_uses.sql`, `normalize_product_stock_uses`, `apply_product_stock_uses` | Integer quantities, real ingredient IDs, scoped variants, server authorization. The first migration's comment saying recipes are not used by checkout is historical, not current behavior. |
| Latest product update | `supabase/migrations/20261028100000_update_complete_product_lock_order.sql`, `update_complete_product` | Keep the established lock order and complete-product transaction. Do not replace it with client table writes. |
| Latest create in repository | `supabase/migrations/20261024100000_save_product_drink_choices.sql`, `create_complete_product`; `20261024160000_inventory_only_products.sql`, `create_inventory_product` | Before implementation, resolve the exact current signature rather than copying an older migration. Product-save updates must preserve branch availability and unchanged recipes. |
| POS availability | `src/features/pos/posAvailability.ts`; `20261023130000_pos_shared_inventory_availability.sql`, `pos_effective_stock_lines`, `pos_lines_sellable`; latest catalog in `20261026100000_pos_require_active_branch_variant.sql` | Whole sellable orders are the floor of available ingredient stock divided by recipe usage. Shared ingredients compete across all cart lines; retain this behavior. |
| Checkout | `src/services/saleService.ts`; `20261026100000_pos_require_active_branch_variant.sql`, `confirm_sale` | Maps branch variants to master variants, resolves recipes, aggregates ingredient requirements, checks/locks stock, saves sale/items, writes deductions atomically. Deductions are cast to bigint. Changing recipe columns alone can round or otherwise invalidate fractional consumption. |
| Opening stock | `src/hooks/useStockSetup.ts`, `src/features/inventory/InventorySetupScreen.tsx`, `sharedStock.ts`; `20261019140000_phase3_inventory_operations.sql`, `initialize_main_branch_inventory` | Real ingredient pools receive stock. Products supplied entirely by other ingredients do not need separate opening stock. Piece quantities are validated as whole numbers. |
| Inventory display | `src/lib/format.ts`, `formatLiveStock`, `formatSnapshottedQuantity`; `src/features/inventory/stockDetails.ts` | Live piece balances are formatted as whole quantities; fractional live stock can be shown as unavailable. Labels must distinguish pieces from base portions. |
| Transfers/receiving | `src/services/transferService.ts`, `src/features/transfers/CreateTransferScreen.tsx`, `TransferDetailsView.tsx`; `20261019140000_phase3_inventory_operations.sql`, `send_stock_transfer`, `parse_inventory_quantity` | Use the same units at Main and selling branches. Sending, confirming arrival, discrepancy quantities, and inventory movements must agree. |
| Physical returns | `src/services/returnService.ts`, `src/features/returns/ReturnScreens.tsx`, `ReceiveReturnScreen.tsx`; `20261019140000_phase3_inventory_operations.sql`, `create_stock_return` | Existing return is branch-to-Main stock accountability, not a customer sale refund. Preserve source deduction and existing Main receipt behavior; do not automatically restock sellable Main stock. |
| Local purchases / leftover rules | `20261019140000_phase3_inventory_operations.sql`, `record_branch_local_purchase`, `apply_leftover_return` | Quantity labels and count units must match the same ingredient definition. Preserve closing-stock behavior, non-returnable rules, and accountability. |
| Remittance | `src/features/shifts/CashierShiftCloseForm.tsx`, `closeCountList.ts`; `20260928150100_revision_7c_freeze_and_close_rpcs.sql`, `aggregate_shift_product_movements`; `20261019140000_phase3_inventory_operations.sql`, `finalize_cashier_shift_reconciliation` | Opening, received, outgoing, consumed, remaining, waste, and discrepancy quantities use whole-unit accounting. Aggregation uses bigint. Keep branch freeze, atomic finalization, and retry behavior. |
| Reports | `src/features/reports/ShiftRemittanceDetailScreen.tsx`, `InventoryReconciliationScreen.tsx`, `WasteHistoryScreen.tsx`, `ReportsScreens.tsx`, `reportDisplay.ts`; `20260928100000_waste_daily_remittance_reports.sql` | Sales quantities describe orders sold; ingredient movements describe stock consumed. These cannot be presented as interchangeable totals. Historical quantities must not be recalculated from today's recipe. |

## 3. Configuration for the requested examples

Use one underlying stock product for Egg and one for Bihon. Separate customer-facing products/variants reference those same ingredient IDs.

| Sold product/option | Physical amount | Stored recipe quantity |
| --- | --- | --- |
| Extra Egg | 1 whole egg | Egg ×2 half-egg units |
| Meal with Egg | 0.5 whole egg | Egg ×1 half-egg unit |
| Bihon Solo | 1 standard solo serving | Bihon ×2 half-serving units |
| Meal with Bihon | 0.5 standard solo serving, subject to client confirmation | Bihon ×1 half-serving unit |

Opening 30 whole eggs means entering 60 half-egg units. Transferring 10 whole eggs means sending and receiving 20 units. Selling 1 Extra Egg and 1 meal with half an egg consumes 3 units total, leaving 57 units (28.5 whole-egg equivalents) if there were 60 before the sale. Cash is calculated from the customer-facing order quantities and prices as usual, not from ingredient-unit quantities.

For Bihon, a “serving” must have a consistent physical definition, such as a particular scoop. The manager can edit recipe counts. If the meal really uses 0.25 or 0.4 of a solo serving, halves are insufficient: choose an appropriate smaller base portion for a NEW stock product (quarters or fifths), with corresponding integer recipes. Do not guess ratios or continually change the unit definition of an existing stock pool. No generic kg-to-portion conversion is proposed.

Preserve recipe precedence: a variant's recipe replaces the product recipe; it does not add to it. If a variant has no recipe, use the product recipe; if neither exists, use its own stock ×1. When adding Egg or Bihon to a meal, retain all intended Rice/viand/other lines. Do not accidentally replace a full meal recipe with only Egg.

Do not rely on recursive recipes. If a meal needs Bihon stock, reference the Bihon stock ingredient directly, not a sellable Bihon Solo product whose recipe happens to reference Bihon.

## 4. Alternatives and why the scope differs

| Approach | Benefit | Risk / decision |
| --- | --- | --- |
| Configure 2-versus-1 base units in current recipes | No arithmetic/schema redesign; works with existing transaction machinery | Requires a clear count-unit agreement. Useful immediate setup, but ambiguous unit labels must be fixed before broad staff use. |
| Whole base units plus explicit immutable unit metadata and consistent labels | Smallest reliable product improvement; whole-number ledger remains compatible | Recommended release. Includes app changes, additive metadata/RPC changes, tests, and an APK rebuild. |
| Decimal display converted exactly to base units | Lets manager enter 1 / 0.5 while preserving integer accounting | Optional second phase; requires server validation, input parsing, default-recipe handling, and clear conversion in every affected entry screen. |
| True fractional inventory everywhere | Arbitrary configured consumption within an agreed precision | Broad redesign across recipe schema, validators, sale aggregation/casts, transfers, returns, remittance baselines, reports, and UI. Not the simplest safe solution. |

Do not use `kg_meal` just to bypass whole-piece validation. That mode has different inventory/receipt semantics and does not represent half an egg.

## 5. Recommended implementation design

### 5.1 Stock-unit metadata (proposed, not existing columns)

- Add a small approved unit definition to stock products: a stable unit code, label for the base unit, and optional integer count of base units per named display unit. Example: `half_egg`, “half-egg unit”, 2 per “whole egg”; `half_bihon_serving`, “half-serving”, 2 per “solo serving”. Ordinary products retain a one-piece default.
- Avoid a full unit-of-measure framework for this task. Restrict the initial options to client-approved units and integer factors. Keep `inventory_mode = piece_stock` and `product_stock_uses.quantity` integer.
- Metadata is selected by the Main Branch Manager during creation of a NEW stock pool. Enforce immutability in the database once recorded stock/history or recipe use exists. Prefer creation-only selection to a complex conversion workflow.
- Do not infer new metadata from names. Existing records receive no physical conversion automatically. Legacy records with unknown units keep an explicit legacy interpretation until reviewed; never apply a global `quantity / 2` display rule to all historical Egg records.
- Extend the actual latest complete-product RPC signatures with backward-compatible defaults if arguments are needed. Preserve callers, RLS and execute grants, SKU uniqueness, branch availability, and existing lock order. Default missing metadata must preserve existing behavior.
- Include unit metadata in stock, recipe picker, transfer, return, and report queries/types. A metadata field that only reaches the recipe editor is incomplete.
- Preserve historical meaning either by immutable product-unit metadata with legacy values unchanged, or by unit snapshots on newly created movement/document lines. Pick and document one policy before coding. If units ever become editable, snapshots/versioning become mandatory.

### 5.2 Product editor and POS

- Show “Stock used per order” with the stock item's explicit unit, plus an explanation such as “2 half-egg units = 1 whole egg.” Keep the first release's quantity entry integer-only and reject invalid input visibly; do not strip a decimal point into a different quantity.
- Separate sellable Extra Egg/Bihon Solo from inventory-only stock ingredients, or deliberately configure a self-recipe. A stock-only ingredient is simpler for staff and avoids accidentally selling one half as one whole item.
- Keep cashier order quantities whole. Cashier chooses the sellable item/meal/variant; the server resolves usage. Cashiers do not choose ingredient deductions.
- Preserve drink selection, discounts/pricing programs, variants, fallback behavior, shared cart availability, idempotent checkout recovery, and stock lock order. This release changes labels/configuration rather than deduction arithmetic.
- If optional decimal display is later approved, keep draft strings until validation; multiply by the ingredient's exact integer factor; reject non-integral results and overflow. Never round consumption down/up. Example: `0.5 × 2 = 1` accepted; `0.3 × 2 = 0.6` rejected. Existing recipe limit remains 1–99 BASE units unless separately reviewed.
- Decimal display defaults must be unit-aware: “1 whole egg” maps to 2 base units and must not be omitted as the existing default self ×1 recipe.

### 5.3 Opening stock, transfers, returns, waste, and remittance

- Use the same base-unit label in quantity input, review, confirmation, details, discrepancies, export, and history screens. Example: “Egg — half-egg units”, not “Egg — pcs”.
- First release: staff enter base-unit counts, with a visible example/conversion hint. Do not implement convenience conversion in only one screen.
- Count physical ingredient stock, not separate sale-product stock, where a recipe fully shares another pool. Preserve `buildStockSetup` behavior for products that use both own stock and other ingredients.
- Transfer both sent and received quantities in identical units. A difference of 1 for Egg means half an egg; report that clearly. Retain arrival-confirmation and pending-reconciliation guards.
- Returns count physical base portions. Preserve branch isolation, source deduction, existing Main accountability, non-returnable restrictions, and duplicate-submit prevention. Do not create a customer refund feature as part of this change.
- Waste and remaining stock are whole base units. Reconciliation must retain products with sales/activity even if ending stock is zero. Coordinate with the separate idle-remittance-product fix already prepared.
- Closing behavior (`keep_at_branch` or the existing alternative), cash reconciliation, and inventory freeze remain unchanged.

### 5.4 Reports and historical data

- Sales report: “Extra Egg orders sold: 1.” Ingredient usage report: “Egg consumed: 2 half-egg units.” Do not sum unlike stock units across products into a misleading total.
- Ingredient usage comes from saved inventory movements, not recomputing old sales with current recipes. Existing aggregated movements support per-sale/per-ingredient consumption, but not necessarily allocation to each sale line; detailed line-level ingredient allocation would require a separate snapshot design.
- Keep existing financial totals and historical sales immutable. Unit-label additions must not update historical quantities, costs, receipts, or totals.
- Do not label existing stock as a known number of physical eggs unless its original unit has been verified. The observed balance of 100 is specifically unresolved.

## 6. Migration, reset, and rollout order

1. Confirm the portion definitions with the client: whole versus half Egg, standard Bihon scoop, meal ratio, smallest countable portion, and waste/return handling.
2. Finish the design for explicit unit labels and legacy behavior; implement/test locally or on a disposable restored database. Do not alter production recipes while staff are selling.
3. Review the live RPC signatures again before making an additive migration. Do not rerun Revision 7 or change existing migration files. Preserve integer stock behavior and permissions.
4. Apply the new metadata/API migration only after approval and backup, then distribute a tested APK. Older APKs may ignore new metadata but can show misleading “pcs” labels; they must be retired for portion-stock workflows. Do not claim semantic compatibility merely because old requests still succeed.
5. If the user still wants the separate test-data reset, review the reset plan against any NEW tables first. Its schema guard deliberately stops on unknown tables. A product-column-only extension should preserve the existing reset scope, but still rerun reset regression tests.
6. After the separately approved reset, create real stock products with the agreed units BEFORE opening stock, recipes, or transfers. Add customer-facing items and complete recipes. Do not import real quantities using the old ambiguous convention.
7. Count physical stock and enter matching base-unit opening quantities. Validate one complete branch workflow with the client before live trading.
8. Without reset, preserve existing IDs/history; create a new correctly defined stock pool when a physical unit changes. Use a separately reviewed reconciliation/cutover process, never an in-place multiply of old balances and movements.

Rollback: before any new-unit transactions, revert UI/configuration deployment with the migration's additive compatibility understood. After stock or sales use new units, freeze affected operations and investigate; an old APK or relabeling is not a valid data rollback. Restore data only through the separately approved backup/recovery process.

## 7. Regression and acceptance tests

Reuse existing tests where relevant:

- `tests/product_stock_uses_save.mjs`: recipe save authorization, validation, unrelated-edit preservation, atomicity, and checkout integration.
- `tests/cashier_pos_stock.mjs`: shared cart stock availability.
- `tests/extras_stock_modes.mjs`, `tests/product_level_stock_meals_snacks.mjs`, `tests/extra_rice_shared_stock.mjs`: own/shared stock and product/variant precedence.
- `tests/opening_stock_shared.mjs`, `tests/stock_setup_real_db.mjs`, `tests/repeat_opening_stock.mjs`: real ingredient stock and initialization.
- `tests/returns.mjs`, `tests/revision_7c_end_shift.mjs`, `tests/remittance_idle_products.mjs`: returns, freeze/reconciliation, and sold-out activity retention.
- `tests/reset_data.mjs`: compatibility of any new schema with the separate reset procedure.

Add focused cases:

1. Egg pool 10 base units: one Extra Egg consumes 2; one half-egg meal consumes 1; final balance 7 and one aggregated movement of -3 for the combined sale.
2. Bihon pool 10: one Solo consumes 2, one Meal consumes 1; final 7, using the same ingredient ID.
3. Egg/Bihon available 1 base unit: half-portion meal allowed, whole/solo product rejected. Mixed cart competition agrees between POS and server.
4. A recipe using its own viand plus Rice/Egg/Bihon deducts every intended ingredient exactly once; variant override and drink consumption remain correct.
5. Failed/insufficient-stock sale leaves no sale/items/movements; retry with the same idempotency key does not deduct twice. Two concurrent sales cannot oversell (real PostgreSQL sessions required).
6. Invalid `0.5` in first-release integer inputs shows a validation message, never saves `5` or drops the line. Optional conversion-phase tests cover exact 0.5, rejected 0.3, limits, empty values, scientific notation, and trailing decimal input.
7. Opening, transfer sent/received, discrepancy, local purchase, return, waste, and remittance all display and submit the same base units; cross-branch access remains blocked.
8. Return of 3 half-egg units decreases source stock by 3 and preserves the existing Main-accountability rule. Duplicate return creates no second movement.
9. Remaining 3 units displays as 3 half-egg units (optionally 1.5 whole equivalents), without changing ledger values. Sold-out ingredients remain in shift accountability.
10. Recipe edit affects future sales only. Old sale revenue, saved movements, closing balances, and reports remain unchanged.
11. Renaming Egg or Bihon does not change units; an unauthorized or post-history unit change is rejected server-side.
12. Existing ordinary-piece products, legacy records, Manager/Owner reporting, cashier permissions, and disabled/stock-only products keep their behavior.

Acceptance gate: client can explain and correctly enter the same physical amount in opening stock, transfer, return, and remittance without calculating from an ambiguous “pcs” label. Both standalone and meal sales deduct the verified portion ratio from one shared stock pool. No historical record changes.

## 8. Checks actually run during this audit

- `node tests/product_stock_uses_save.mjs`: reported ALL PASS, including end-to-end `confirm_sale` coverage.
- `node tests/cashier_pos_stock.mjs`: reported passed.
- `node tests/product_stock_uses.mjs`: FAILED at its initial static assertion “confirm_sale is not touched.” The assertion matches `confirm_sale` in a SQL `COMMENT ON TABLE` string, before database tests run. This is a test-scanning defect, not evidence that decimals work or fail at checkout. Repair that assertion in a later implementation task; no test source was changed during this audit.
- No new portion implementation was built or tested. Production reads were SELECT queries only. No reset, migration, stock change, sale, or return was executed against production.

## 9. Client decisions required before implementation

- Is a meal always exactly half an egg, and is Extra Egg always one whole egg?
- What physically defines one Bihon solo serving, and what fraction does a meal use? The proposed 0.5 remains an estimate until confirmed.
- Is counting labeled base portions acceptable, or must staff enter whole-item equivalents such as 0.5? The latter adds a validated conversion layer.
- Are all current records disposable test data, or must existing quantities/history remain live? Reset approval is separate from this plan.

The recommended first release does not require answers about arbitrary decimal precision: it uses the smallest confirmed countable portions and preserves the current transactional stock model.
