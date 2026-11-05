# Edit Product lock order

Migration: `supabase/migrations/20261028100000_update_complete_product_lock_order.sql` (NOT applied anywhere yet).
Apply after `20261027100000_edit_product_keeps_branch_availability.sql` (it replaces the function that migration defines).
Independent of `20261026100000_pos_require_active_branch_variant.sql`.

## Problem (reproduced on real PostgreSQL 17, not PGlite)

An edit and a sale of the same product could deadlock. PostgreSQL aborts one of the two requests.

| function | lock order |
|---|---|
| `confirm_sale` | branch row (`lock_branch_inventory_gate`, FOR UPDATE) -> shift -> inventory rows -> product row (FOR SHARE) -> branch_products (SHARE) -> branch_product_variants (SHARE) |
| `update_complete_product` (before) | product row (FOR UPDATE) -> selling branch rows (FOR SHARE) -> option rows -> branch_products row |
| `configure_branch_product_variants` | branches (SHARE) -> branch_products (SHARE) -> option rows |
| `update_branch_product_variant_price` (before) | option row (FOR UPDATE) -> branches (SHARE) -> branch_products row |

Three inversions: edit vs sale (product/branch), edit vs Branch Catalogs (option rows/branch_products row), edit vs the single-option price RPC.

## Fix (two functions, nothing else)

One order everywhere: **selling branches -> product -> branch_products rows -> option rows**.

* `update_complete_product`: lock the sent selling branches (FOR SHARE, id order) before the product row; lock the product's `branch_products` rows (FOR NO KEY UPDATE, branch id order) before any option row. Bad input is skipped by the early lock and rejected later with the same messages as before.
* `update_branch_product_variant_price`: lock its branch, then its `branch_products` row, before the option row.

The rest of both bodies is byte-identical (tests compare them with the previous definitions with the new blocks removed). Same signatures, grants and comments; no data touched.

## Audit of the other functions

Branch first, product second (already consistent, unchanged): `confirm_sale`, `send_stock_transfer`, `confirm_shipment_arrival`, `initialize_main_branch_inventory`, `configure_branch_products`, `configure_branch_product_variants`. `create_complete_product` locks branches only after inserting a product nobody can reference yet.

Known and NOT changed:

1. **Same cashier, sale and delivery confirmation at the same moment** (`confirm_sale` + `confirm_shipment_arrival`). `confirm_sale` locks the cashier's profile row before the branch gate; the arrival takes the gate first and then writes rows that reference the same profile (probable cause, from the code and the lock log). Seen 3 times in early runs of a three-way race (sale + sale + delivery by the same cashier, about 1 in 90 rounds, on the deployed and the fixed schema alike) and not in later runs, so the rate is low and the cause is inferred, not proven. Independent of these migrations; fixing it means changing `confirm_sale` or `confirm_shipment_arrival`.
2. **Two product edits whose recipes use each other** (A uses B, B uses A) could lock each other's rows (`apply_product_stock_uses` takes ingredients FOR KEY SHARE after the product FOR UPDATE). Not reproduced: edits sharing one ingredient did not deadlock in any run. Circular recipes were not tested.
3. **Renaming an option while Branch Catalogs switches it by its old name** can leave a stray duplicate option row ("duplicate key ... name_key" on the next rename). A logical race, not a lock problem; it is reported separately by the test and not changed.

## Results (real PostgreSQL 17, 2 to 3 sessions per round, random start offsets)

`tests/lock_order_concurrency_postgres.mjs`, 40 rounds per scenario, three schemas:

| scenario | deployed | pending (POS + edit-keeps-availability) | + lock-order |
|---|---|---|---|
| edit x sale, same branch | 3 deadlocks / 80 ops | 6 / 80 | 0 / 80 |
| edit x sale x sale | 8 / 120 | 3 / 120 | 0 / 120 |
| edit (rename option) x sale | 5 / 80 | 7 / 80 | 0 / 80 |
| edit x edit x sale | 5 / 120 | 3 / 120 | 0 / 120 |
| edit x update_branch_product_variant_price | 0 / 80 (rare) | 1 / 80 | 0 / 80 |
| forced: real gate then product vs edit | deadlock | deadlock | no deadlock |
| forced: option rename vs Branch Catalogs | deadlock | deadlock | no deadlock |
| edit x transfer, edit x edit, edit x product status, edit x branch settings, edit x Branch Catalogs switches, sale x sale x transfer (other cashier) | 0 | 0 | 0 |

An earlier 60-round run of the fixed schema alone (before `update_branch_product_variant_price` was aligned) also had 0 deadlocks in every other scenario. Invariants checked after every scenario: product price equals the default option, branch price equals the first branch option, the recipe is complete, Large stays off at SM1, no orphan options, no negative stock, no sale line without a sale. They hold on the fixed schema.

## Risks

* **Behaviour under load changes from "one request is aborted" to "one request waits".** An edit now waits for a sale in progress at a branch it writes (and the reverse). Both are short transactions.
* The edit locks the product's `branch_products` rows at **all** branches (it renames and deletes option rows at all branches anyway). A Branch Catalogs switch for that product waits for the edit to finish.
* Function replacement: if another migration redefines either function before this one is applied, the later file wins. `edit_product_atomic_availability.mjs` pins both bodies against the previous definitions.
* Rollback: re-run the previous function bodies (generated and verified by `pending_migrations_real_postgres.mjs`, `ROLLBACK_OUT=<file>`); no data to undo.

## Frontend

None. The app does not need to change for this migration. (After `20261027100000` is applied the "switch it off again" step in the products screen can be removed; that is separate.)

## Limitations

* Contention was produced with two or three database sessions on one machine, not with a production-sized load.
* Deadlocks depend on timing; zero in about 1,500 operations is strong evidence, not proof. The two forced races are deterministic.
* Not tested: other Supabase services, connection pooling (PgBouncer), `lock_timeout` settings, anything on a device.
