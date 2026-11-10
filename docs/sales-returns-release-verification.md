# Sales, checkout recovery, and return history verification

## Changes

- Sale details explicitly join `sale_items_product_id_fkey`, avoiding the ambiguity introduced by the drink-product foreign key.
- Invalid sale IDs are rejected before a request. Failed reads identify their stage/code in device logs without logging credentials or order payloads.
- Checkout sends only the current five-argument RPC. Missing server support fails closed rather than silently using older inventory rules.
- Checkout journals the original request per signed-in user before sending it. Android restart, empty cart, closed shift, and price-refresh failure cannot replace that request/key. Confirmed orders offer View sale and Done.
- An uncertain attempt cannot be discarded automatically after a later rejection. Support must reconcile the original key before any replacement sale/return is made.
- Manager return history defaults to All and filters/searches/sorts on the server before ten-row pagination. Shared history panes retrieve all server pages. Current-shift sales no longer truncate after 100 rows.
- Physical returns remain branch-to-Main accountability: source `return_out`, no sellable Main restock. End-shift `unsold` is a separate reconciliation movement, not a customer refund.

No production migrations, RLS changes, historical data edits, APK builds, or deployment are part of these changes.

## Automated checks

Run `npm run typecheck` and `npm run test:sales-returns-client`.

Relevant isolated database suites:

- `tests/sales.mjs`: successful sale/items/movements, rollback, idempotency, stock limits, ownership.
- `tests/returns.mjs`: return header/items, duplicate request, source deduction, branch isolation, rollback.
- `tests/return_inventory_integrity.mjs`: Main-only receiving, exact/short/excess/zero counts, no Main restock.
- `tests/revision_7final_hardening.mjs`: shift freezes, lifecycle, pending remittance, idempotency.
- `tests/shared_inventory_confirm_sale.mjs`, `tests/drink_choice_sale.mjs`, `tests/phase2_pos_pricing.mjs`: current checkout inventory/pricing contracts.
- `tests/milestone11_roles.mjs`: Owner/Manager reporting and operation permissions, including current Owner-only branch administration.

Client tests use the real Supabase query builder with a simulated HTTP transport and component rendering with controlled hooks. They do not prove authenticated production access or native Android storage behavior. PGlite tests do not prove multi-session PostgreSQL concurrency.

## Before releasing an APK

1. Record the client APK version/build ID, its source commit and embedded Supabase project. Match the new build to the intended project. Do not infer APK contents from this working tree.
2. Compare production migration history, function definitions, RLS, grants, foreign keys and triggers with the expected schema. Revision 7 alone is insufficient for later pricing, recipe and drink functionality. Do not rerun Revision 7.
3. Confirm `confirm_sale(uuid,jsonb,numeric,text,text)` returns `public.sales`; `create_stock_return(jsonb,text,text)` returns UUID; and receipt remains Main-Manager-only with no Main sellable restock.
4. Use an authorized cashier session to load an existing own sale and its exact item embed; attempt another cashier/branch's sale and confirm denial/absence. Repeat Owner/Manager reporting checks with their own sessions. Do not use an administrative key to certify cashier access.
5. In a disposable staging database and Android device, complete a sale, tap View sale, reopen Sales on phone/tablet and confirm list/detail results. Exercise more than 100 sales.
6. In staging, interrupt the response after a committed checkout, terminate/relaunch Android, and retry. Assert same request key and sale ID, one header, correct items, one movement per stock product, and no second deduction. Repeat after shift close and with another account. Never clear app storage to resolve an unknown outcome.
7. Repeat response-loss/restart/double-tap cases for a physical return. Assert the same return ID and no repeated source deduction. Verify received and in-transit filters, an older return beyond the first 50, Manila date boundaries, search punctuation and branch isolation.
8. Confirm receipt changes counts/discrepancies only, not Main sellable stock. Confirm end-shift unsold accountability appears in reconciliation, not stock-return history.
9. Run true concurrency tests on disposable PostgreSQL only (`tests/revision_7e_concurrency_postgres.mjs`), including concurrent sale/return and shift close. Never point these fixture-writing tests at production.

## Read-only incident evidence

Record the original UTC timestamp plus Manila business date, cashier, branch, shift, original idempotency key and sale/return ID. Capture HTTP status and Supabase `code`, `message`, `details`, `hint`; redact tokens. A failed receipt read does not mean checkout failed.

Check the original attempt without replaying a new write:

```sql
-- Bind parameters using the approved database client; these are SELECT-only templates.
select id, sale_number, branch_id, shift_id, cashier_id, status, total_amount, sold_at
from public.sales
where cashier_id = :cashier_id and idempotency_key = :request_key;

select * from public.sale_items where sale_id = :sale_id;
select * from public.inventory_movements
where reference_type = 'sale' and reference_id = :sale_id;

select id, return_number, from_branch_id, to_branch_id, status, returned_at, received_at
from public.stock_returns
where created_by = :cashier_id and idempotency_key = :request_key;

select * from public.stock_return_items where stock_return_id = :return_id;
select * from public.inventory_movements
where reference_type = 'stock_return' and reference_id = :return_id;
```

For schema inspection, read `supabase_migrations.schema_migrations`, `pg_proc`/`pg_get_functiondef`, `pg_policies`, `pg_constraint`/`pg_get_constraintdef`, and `pg_trigger`/`pg_get_triggerdef` using authorized read access. Capture current definitions, not just migration names.

After an approved release, observe a legitimate cashier transaction and reconcile its resulting rows and movement quantities. Do not create production test transactions, delete fixtures, rewrite history, weaken RLS or grant anonymous access.
