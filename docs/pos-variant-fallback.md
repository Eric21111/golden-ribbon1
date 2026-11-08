# POS: products with options must be sold through an active branch option

Migration: `supabase/migrations/20261026100000_pos_require_active_branch_variant.sql` (NOT applied anywhere yet).
Regression test: `tests/pos_variant_fallback.mjs`. Read-only audit: `docs/pos-variant-fallback-audit.sql`.

## The bug
`confirm_sale` decided "this product has options" from ACTIVE branch options only. With every branch option switched off, or
no option rows at the branch, the product looked like a single-price product, so:

- `list_cashier_pos_inventory` listed it with `variants: []`;
- a sale without an option succeeded at `branch_products.selling_price` (the first option's price when the product was
  created; nothing updates it afterwards);
- stock deducted only the product itself (no option recipe such as Rice, and no drink choice).

## The rule (new)
A product **has configured options** when it has ANY master option row (`product_variants`, active or not). A retired
option still means the product was set up with options, so a product whose master options are all inactive can never fall back
to single price. (`configure_product_variants` already refuses to retire the last active option, so that state is not reachable
through the app's own tools; the rule covers direct SQL and old data.) Then:

| Situation at the branch | Cashier menu | `confirm_sale` | `get_cashier_line_prices` |
|---|---|---|---|
| has an active branch option | listed (active options only) | an option is required | row only for an active option |
| all options off, or no option rows | **not listed** | **refused**: `No option of "X" is available at this branch.` | no row (client: "no longer available") |
| no master options (genuine single price) | unchanged | unchanged | unchanged |

Nothing falls back to the base price for a product with configured options.

## What the migration changes
Two internal helpers (`pos_options_unavailable`, `pos_option_required`, not callable by app roles) and `create or replace` of
the three functions with the same signatures, return types and grants. Against the previous definitions the only differences
are: one guard in `confirm_sale`, one condition in `list_cashier_pos_inventory`, one condition in `get_cashier_line_prices`.
No data statements: nothing is updated, deleted or backfilled. Existing sales, `sale_items`, prices, recipes, branch rows and
inventory are untouched, and an idempotent replay of an earlier (fallback) sale still returns that sale.

## Before deploying
1. Run `docs/pos-variant-fallback-audit.sql` against the live database, one query at a time (all read-only). Query 1 says how
   many product/branch pairs are affected and how many are on the cashier menu today; query 2 lists them.
2. For each affected pair decide: re-enable an option for that branch, or convert the product to single price in the wizard
   (removing all its options). Both are done with existing tools; the migration changes neither.
3. Queries 3 and 4 size past fallback sales and base-price drift. They are informational: history is not modified.

## Deployment risks
- **Products disappear from the cashier menu** when affected (exactly the audit's "on_cashier_menu_today" count). Intended, but
  do the audit first so nobody is surprised mid-shift.
- **Open shifts:** a cart already holding an affected product is refused at checkout with the message above. The cashier
  removes the line. The price refresh already treats a missing price row as "no longer available".
- **Retries:** an identical retry of a sale made before the migration still returns that sale (tested).
- **Error text:** the new message is not mapped in `src/lib/errors.ts` yet, so until the frontend follow-up it reads as the
  generic "Review the order and try again" text.
- **Rollback:** the migration only replaces function bodies. To roll back, re-apply the three previous definitions
  (`20261024120000` confirm_sale, `20261024160000` list_cashier_pos_inventory, `20260922110000` get_cashier_line_prices) and drop
  the two helpers.
- **Apply order:** database first, then the app update. An older app against the new database behaves correctly at the
  register (the server is the authority); only the Branch Catalogs wording below lags.

## Frontend updates (prepared in the working tree; ship AFTER the migration)
1. **Checkout error** (`src/lib/errors.ts`): `No option of "X" is available at this branch.` now reads "An item in this order has no
   available option at this branch. Remove it from the order." (mapped in `getInventoryErrorMessage`, which `getCheckoutFailure` uses).
2. **Branch Catalogs** (`branchCatalogRows.ts`, `catalog.tsx`): a product with configured options and no active option at the branch is
   **Not in POS**, with a reason in its details, a badge ("All options off" or "No options here"), "No active option" instead of the
   stored base price, and it sorts last by price. It uses the same rule as the database. "No options set up here" needs the list of
   products with options, read once by `useProductIdsWithOptions` (`product_variants.product_id`, readable by staff, refreshed by the
   existing product-save invalidation). The false "listed as a single item at its base price" sentence is gone.
3. Nothing needed in the cashier POS screens: the menu stops listing these products, and a stale cart is handled by the price
   refresh (a missing price row reads as "no longer available") and the checkout error above.

Deploy order: database first, then the app. An older app against the new database is protected at the register (the server decides);
only its Branch Catalogs wording lags. A new app against the OLD database would show these products as "Not in POS" while the
POS still lists them, so do not ship the app first.

## Live-audit decisions needed before applying
- Run `docs/pos-variant-fallback-audit.sql` and decide, per affected product and branch, to re-enable an option or convert the product
  to single price in the wizard. The count of "on_cashier_menu_today" is how many items will leave the menu.
- Decide whether any product should deliberately sell without an option. Nothing in this change allows it; it would need an explicit
  flag and an owner decision.
- Decide how to tell cashiers on open shifts (a refused line must be removed from the cart).

## Inactive master option with an active branch option (checked, not changed)
Today a branch option that is switched on is listed and sold even if its MASTER option (`product_variants.is_active = false`) was
retired. The master option is a template: it is read only when a branch first receives the product through a transfer (only active
masters are copied). The menu, `confirm_sale`, the price lookup, recipes and drink choices all use the branch option alone.
`configure_product_variants` does not cascade to branches, no screen retires a master option, and the Edit wizard re-activates
branch options when it saves a product (it never reads or changes the master flag). The pending migration does not change any of
this (`tests/master_option_inactive_rules.mjs` runs the same scenario before and after it and gets identical results).
Audit query 7 lists any retired master option that is still active at a branch. If the business wants "retired" to mean "stops
selling everywhere", that needs an explicit rule (for example cascading in `configure_product_variants`), not this fix.
