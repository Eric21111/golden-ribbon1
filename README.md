# Golden Ribbon — Milestones 1–4

Mobile-first catering inventory and POS system with staff authentication, employee management, branches, products, stock transfers, receiving, discrepancy history, cashier shifts, cash checkout, completed sales, and atomic inventory deduction. Returns, refunds, void approval, receipt printing, and advanced reports are not included yet.

## Stack

- Expo SDK 57, React Native, TypeScript, and Expo Router
- Supabase Auth and PostgreSQL
- TanStack Query for server state
- React Hook Form and Zod for forms
- Zustand for temporary, in-memory cashier cart state


## Run locally

Prerequisites: Node.js, npm, an Expo-compatible Android/iOS device or emulator, and a Supabase project.

1. Install packages:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and enter the project URL and public publishable/anon key:

   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-public-key
   ```

   Never use a Supabase secret/service-role key in this mobile app.

3. Apply the migrations and seed to a linked **development** Supabase project:

   ```sh
   npx supabase db push --include-seed
   npx supabase config push
   ```

   The config push disables public Auth signup so employee accounts can only be provisioned by an Owner. For a local Supabase stack, `npx supabase db reset` recreates the database from both migrations and then runs `supabase/seed.sql`. Alternatively, run the migration files in timestamp order and then `supabase/seed.sql` in the Supabase SQL editor. Seed data is for development/testing, not production.

4. Deploy the Owner-only employee administration function after the database migration succeeds:

   ```sh
   npx supabase functions deploy employee-admin --use-api
   ```

   Hosted Supabase provides the function's publishable and secret credentials. Do not copy those server credentials into `.env` or any `EXPO_PUBLIC_*` value.

5. Start Expo:

   ```sh
   npm start
   ```

   Then press `a` for Android, `i` for iOS on macOS, or scan the QR code with Expo Go.

6. Verify the project:

   ```sh
   npm run typecheck
   npm run doctor
   ```

## Bootstrap the Owner

Public registration is deliberately absent. Bootstrap the first Owner in Supabase Dashboard → Authentication → Users, copy its UUID, and add the matching profile in the SQL editor:

```sql
insert into public.profiles (id, full_name, role, branch_id)
values ('AUTH_USER_UUID', 'Test Owner', 'owner', null);
```

Sign in as that Owner and use **Employees → Create Employee** for Manager and Cashier accounts. Employee passwords are handled by Supabase Auth and never stored in application tables, migrations, or seed files. Employees can only be assigned to active selling branches.

## Database schema

- `branches`: UUID identity, unique case-insensitive code, address, Main/Selling designation, and active status. A partial unique index permits only one Main Branch.
- `profiles`: one-to-one with `auth.users`, with `owner`, `manager`, or `cashier` role and an optional/required branch enforced by constraints and triggers.
- `products`: UUID identity, unique case-insensitive SKU, description, `numeric(12,2)` selling price, and active status. Product master data does not contain inventory quantity.
- `branch_inventory`: current per-branch product balance with a non-negative constraint and unique branch/product pair.
- `inventory_movements`: immutable signed ledger for opening stock, transfer out, transfer in, and future adjustments.
- `stock_transfers`: server-numbered transfer header with strict lifecycle fields, audit users/timestamps, and duplicate-submission keys.
- `stock_transfer_items`: sent and actual received quantities, unique per product within a transfer.
- `transfer_discrepancies`: immutable missing/excess records with enforced expected-minus-received arithmetic.
- `shifts`: cashier work sessions with one open shift per cashier and enforced start/end timestamps.

Employee accounts reuse `profiles`; the Auth user UUID remains the profile primary key. No second employee table is introduced, and deactivation preserves profiles, shifts, transfers, and future historical references.

All tables maintain `created_at` and `updated_at`. Hard-delete permissions are not granted to the mobile client.

### Row-level security

- Owners can select all branches and products, and insert/update branch and product master data.
- Managers and cashiers can select their own profile and assigned branch. Managers can also resolve the names of users recorded on transfers addressed to their branch, so audit screens remain readable without exposing unrelated profiles.
- Active authenticated staff can select product master data. The manager screen additionally filters to active products.
- No role can update its own role or branch through the mobile client.
- Security-definer helper functions read role/branch claims from `profiles` without recursive RLS. Their search path and execution grants are restricted.
- Owners can read every balance, movement, transfer, item, and discrepancy. Managers can read only records for their assigned branch. Cashiers receive no inventory access in Milestone 2.
- Authenticated clients receive read-only table grants for inventory data. All balance mutations are available only through the narrowly granted transactional RPC functions.
- Cashiers can read inventory only for their assigned branch while they have an open shift. They cannot mutate inventory, transfers, products, or another cashier's shift.
- Only an active Owner can list or update employees through restricted database functions. Manager and Cashier clients cannot execute employee administration operations.
- Employee Auth creation and password reset run in the server-side `employee-admin` Edge Function. It validates the caller's Auth token and active Owner profile before using server-only credentials; unauthenticated requests are rejected in the function.
- Branch, role, or deactivation changes are rejected while the employee has an open shift **or a pending remittance** (closed shift still requiring cash/inventory reconciliation). Branch reassignment changes future access without rewriting historical branch references.

### Transactional inventory operations

- `initialize_main_branch_inventory`: Main Branch Manager opening balances plus matching movements; a product can be initialized once.
- `send_stock_transfer`: Main Branch send with deterministic row locking, transfer numbering, Main deduction, transfer items, and `transfer_out` movements in one transaction.
- Selling-branch receipt uses cashier `confirm_shipment_arrival` / `report_shipment_issue` (not manager `receive_stock_transfer`). Manager Incoming remains read-only.
- `start_cashier_shift`: cashier-only; at most one open selling session per branch (and per cashier). Idempotent for the owning cashier; rejects when another cashier already holds the branch session.
- `begin_cashier_shift_close` then `finalize_cashier_shift_reconciliation`: cashier two-phase End Shift (sales cutoff + PCS inventory/cash remittance). Close paths lock **branch → exact target shift → inventory**. `end_cashier_shift` remains a reject/compatibility guard. Legacy `close_cashier_shift` is removed.
- Leftover / stock return receive is accountability/waste only: counted leftover at Main does **not** restock Main usable inventory.
- `list_employees`: owner-only employee directory joined to Auth email and branch name.
- `owner_update_employee`: owner-only profile edits with active selling-branch and unfinished-shift/remittance enforcement.
- `create_employee_profile_from_server`: server-only profile pairing used after secure Auth user creation.

Before the first PCS selling session, review every provisional `closing_stock_behavior` mapping (see `docs/pcs-cutover-closing-behavior-review.sql` and Manager Products).

Before production migration, also run the read-only stranded-cashier preflight (`docs/pcs-pending-remittance-stranded-cashiers.sql`) and resolve any closed pending remittances whose recorded cashier can no longer finalize. Do not auto-fix those rows.

Transfers and receipts use idempotency keys. Unique movement indexes and locked status checks provide additional duplicate and concurrency protection. The database rejects negative inventory and invalid status reversals.

Frontend route guards improve navigation, but the database policies are the authority. No delete policy exists.

## Packaging a copy

When zipping or sharing the project, exclude:

- `.git/`
- `node_modules/`
- `.expo/`
- `.env`

Those paths are already ignored by Git (except `.git/` itself). Do not delete them from a working checkout just to make an archive.

## Project structure

```text
app/
  (auth)/                 login flow
  (owner)/owner/          dashboard, inventory, transfers, branches, products, employees
  (manager)/manager/      dashboard, inventory, incoming receipt, products
  (cashier)/cashier/      shift dashboard, POS, checkout placeholder, profile
src/
  components/             reusable operational UI
  constants/              visual theme
  features/               auth, inventory, transfer, branch, product, employee modules
  hooks/                  TanStack Query hooks and mutations
  lib/                    Supabase, query client, keys, error helpers
  services/               database access functions
  types/                  domain and Supabase database types
supabase/
  functions/              server-only employee Auth administration
  migrations/             reproducible schema, constraints, triggers, RLS
  seed.sql                 idempotent sample branches and products
```

Role directories have distinct `/owner`, `/manager`, and `/cashier` URL segments inside Expo Router groups. Each group is guarded against direct navigation by the wrong role.

## Milestone 2 test walkthrough

1. Log in as Main Branch Manager and open **Main Branch inventory → Set up opening stock**.
2. Enter Chicken `500`, Beef `400`, and Pork `300`; confirm.
3. Open **Stock transfers → Create transfer**, select Branch 1, and send `100`, `200`, and `50`.
4. Confirm Main Branch balances are `400`, `200`, and `250`, with negative `transfer_out` movements.
5. Log in as the Branch 1 Cashier, start a shift, and open **Incoming** pending shipments.
6. Confirm full arrival with `confirm_shipment_arrival`, or report a short count with `report_shipment_issue` (for example receive Beef as `198` of `200`). Manager Incoming remains read-only.
7. Confirm Branch 1 inventory matches the counted arrival; a short count ends as **Received With Discrepancy** with a missing discrepancy; positive `transfer_in` movements use the actual credited values.
8. Confirm the shipment is no longer pending for the cashier.

## Milestone 3 test walkthrough

1. Create or use a Cashier profile assigned to a selling branch that has received inventory.
2. Log in as the Cashier. Confirm the dashboard shows **No Active Shift** and that opening `/cashier/pos` redirects back to the dashboard.
3. Select **Start Shift**. Confirm the POS opens and shows only active products with the assigned branch's available quantities.
4. Search by product name and SKU. Use `+` and `−`; confirm zero removes an item, stock is the upper limit, and out-of-stock products cannot be added.
5. Confirm each line subtotal and the total update correctly. Verify `branch_inventory` does not change while editing the cart.
6. Select **Checkout** and confirm the order is displayed without changing inventory until **Confirm Sale** is submitted.
7. Return to POS and try to end the shift with cart items; confirm it is blocked. Remove all items, end the shift, and confirm the dashboard returns to **No Active Shift**.
8. Confirm a second simultaneous start request still produces only one open shift for the Cashier.

## Milestone 3.5 test walkthrough

1. Sign in as Owner and create an active Cashier assigned to Branch 1. Confirm the employee appears with the correct email, role, branch, and status.
2. Sign in as the Cashier, start a shift, and confirm POS shows only Branch 1 inventory.
3. While that shift remains open, try to reassign or deactivate the Cashier as Owner. Confirm the app reports that the shift must end first.
4. End the Cashier shift. Reassign the Cashier to Branch 2, sign in again, start a new shift, and confirm POS now shows Branch 2 inventory only.
5. Deactivate the Cashier and confirm the account cannot use protected app functionality or start another shift. Reactivate it and confirm access returns.
6. Reset the Cashier's password. Confirm the old password no longer signs in and the new temporary password works.
7. Create a Manager for Branch 1 and confirm inventory, read-only incoming transfers, and discrepancies are limited to Branch 1 (cashiers confirm shipment arrival).
8. Confirm direct navigation to `/owner/employees` is rejected for Manager and Cashier accounts.
9. Confirm prior shifts retain their original branch after reassignment and that no inventory changes occur from employee management.

Before applying remotely, preview pending migrations:

```sh
npx supabase db push --dry-run
```

For a disposable local database with Docker running, the strongest recreation check is:

```sh
npx supabase db reset
```

## Milestone 4 checkout

Cashiers can enter Money Given at checkout, confirm a sale, see the recorded total and change, and choose Done to clear the cart and refresh inventory. Current Shift Sales is available in Cashier navigation. An unresolved confirmation blocks order edits, logout, and ending the shift; retry uses the original request key. Failed database validations preserve the cart for correction. Checkout state is in memory; offline sales synchronization is not supported.

Apply the two new migrations in order using `npx supabase db push` after reviewing `npx supabase db push --dry-run`. The enum migration is separate because PostgreSQL must commit a new enum value before it is used by constraints. No new Edge Function is needed for checkout.

`confirm_sale` is the sole authenticated sale writer. It locks the cashier profile, branch, shift, products, and inventory; computes authoritative totals using PostgreSQL numeric; writes price snapshots and negative sale movements; and commits all changes together. Direct client inserts, updates, and deletes are denied. A cashier/key uniqueness constraint plus request comparison prevents duplicate confirmations. New submissions require an open shift; retrying an already completed request returns the original sale without another deduction.

Run `npm run test:sales` for embedded PostgreSQL tests covering migrations, exact totals, insufficient payment, rollback, stock limits, duplicate requests, frozen historical prices, unauthorized writes, and shift ownership/closure. This local test engine does not establish independent network database sessions; perform the simultaneous-cashier scenario below against a disposable Supabase database before production rollout.

Manual acceptance: sell Chicken ×2 at 80 and Beef ×1 at 100 with 500 paid; verify total 260, change 240, balances decrease by 2/1, two sale movements, one sale, and an open shift. Double-submit/retry the same key and confirm counts do not change. With stock 5, have two cashiers simultaneously request 4 and 3; only one may commit. Change a product price and verify previous sale item prices remain fixed. Close the shift and verify new confirmations fail. Test browser Back during confirmation and confirm it returns to the pending checkout.

## Milestone 5 — Unsold stock returns

Cashiers (selling branch): open Returns / leftover return while a booth session allows stock mutation. Confirm whole PCS quantities; the confirmation key survives navigation and reloads. Draft edits are local; only confirmed In Transit returns are stored.

Owners / Main Branch Manager: receive leftover returns for accountability (counted leftover does not restock Main usable inventory). Owners can view returns across branches; selling managers see their branch history. Return details keep server-recorded branch, employee, and product names.

`create_stock_return` is the authenticated selling-branch return writer (cashier). It derives the source from the active cashier branch, locks inventory in product order, validates quantities, and writes the header/items, source deduction, and negative `return_out` movements in one transaction. Main Branch stock is untouched on create. Main receive is waste/accountability only.

Run `npm run test:returns`, `npm run test:sales`, and `npm run typecheck`. The embedded database tests cover rollback after writes begin, inactive stock, validation, duplicate request/payload checks, role/branch restrictions, source-only deductions, and competing sale/return stock limits. Independent simultaneous database sessions and authenticated browser/device interaction still require testing against a disposable Supabase project.

Manual check: return Chicken 30 and Beef 18; verify source balances decrease by 30/18, Main remains unchanged, two negative movements reference one In Transit return, and Received remains Pending. Retry the same key; balances and record counts must not change. In two sessions, attempt a return of 30 and a sale of 1 against stock 30 simultaneously: only a stock-valid operation may commit. Verify the second branch cannot read that return and Owner can. Refresh during a slow confirmation and retry to confirm only one return exists.

## Future milestones

Future work includes return receiving/counting, discrepancies, refunds, void approval, receipt printing, advanced reports, and offline sale synchronization.
