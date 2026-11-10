# Golden Ribbons: prepare for the client's real products

Use `docs/reset-keep-owner-and-main-branch.sql`. This is a manual, destructive data reset, not a migration. Do not use `supabase db reset`, rerun Revision 7, or push this file as a migration.

## Verified production scope

Read-only inspection on November 10, 2026 matched the app's configured Supabase project `uvxpjrzqtmaterczzvjo` (dashboard name: `inventory`). The live database has 32 public tables. Its foreign keys and relevant triggers were inspected. These are the records to keep:

| Record | Name | UUID |
| --- | --- | --- |
| Owner | Admin | `7c3e32fc-1251-4faf-bdc1-c362c53eb0ea` |
| Main Branch Manager | manager | `4b500119-924e-4743-abed-0a5a5d247064` |
| Main Branch | Main Branch | `2ca8e936-c39b-400b-b711-77a6e7799baa` |

Both profiles are active, assigned to Main Branch, and have Auth accounts. The script preserves their existing credentials and complete profile records, Main Branch, all four pricing settings, and archive settings. It does not change schema, RLS, RPCs, grants, or migration history. It does not reset transaction-number sequences.

At inspection, the deletion scope included 18 products, 21 sales, 9 shifts, 9 transfers, 1 return, their dependent rows, inventory, product variants/recipes/drink choices, summaries, archive metadata, and cutover snapshots. It also includes selling branches SM 1 and SM 2 and accounts Cashier 1 and branch2. Counts can change; the script's fresh preview is authoritative. This reset does NOT distinguish test records from real transactions: verify that everything in its deletion scope is disposable.

Storage had zero objects. The script does not delete Storage files or buckets; execution stops if any objects exist. It does not purge platform logs, backups, Auth audit history, unrelated Auth configuration, or files previously downloaded to devices. Auth dependencies follow Supabase's existing foreign-key behavior.

## Run the preview first

1. Open the correct project in Supabase SQL Editor and select the `postgres` role.
2. Paste the ENTIRE SQL file. Leave `preview_only` as `true` and the three UUIDs as `null`.
3. Run it. The result must say `PREVIEW ONLY - NO DATA DELETED`.
4. Expand `records_to_keep` and `table_summary`. Check the names, UUIDs, and planned deletion counts. Save this result for reference.

Preview only reads persistent data and creates temporary session tables; it does not rehearse deletion or prove every production permission. If any check fails, stop and review the error rather than removing safeguards.

## Execute only when ready

1. Verify a current, restorable backup covering the application tables and Auth. A product CSV alone is not a sufficient backup. Follow [Supabase backup/restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
2. Stop all device use, background jobs, employee creation, and integrations that write data. Sign out devices. Reconcile or explicitly approve deletion of any pending shifts, remittances, transfers, and returns.
3. In the SQL file's `reset_options` input, enter the three UUIDs from the fresh preview, in Owner / Manager / Main Branch order. Change `true` to `false`, and change the empty acknowledgement to `'BACKUP VERIFIED - DELETE TEST DATA'`.
4. Optional staging rehearsal: use a restored disposable database with the same schema and accounts. For a rollback rehearsal, change ONLY the final `commit;` to `rollback;`. The result grid is provisional in that case; no reset is committed.
5. Run the ENTIRE file in one execution. Keep the final `commit;` for the intended reset. Do not run selected fragments. A SQL error aborts the transaction; if the editor reports an aborted transaction, issue `rollback;` before retrying the entire corrected script. A lost connection/result is not proof of success: run preview again before deciding what to do.
6. Require `RESET COMPLETED`, zero `after` counts for all `clear` rows, exactly two profiles/Auth users, and one branch. Any verification exception rolls back the transaction.

The operation uses an explicit `TRUNCATE ... RESTRICT` list, then deletes only the unpreserved profiles, branches, and Auth users. It never disables triggers or uses `TRUNCATE CASCADE`. Unknown/missing public tables, external dependencies, partitioning, incorrect UUIDs, inactive/ambiguous preserved accounts, missing settings, and nonempty Storage stop execution. Locks prevent concurrent application table writes during execution; lock timeouts abort instead of waiting indefinitely. A maintenance window is still required, especially for Auth and external services.

## After reset

The November 11 schema check found 35 public tables, including all three notification tables. The reset clears test notifications, queued deliveries, and push registrations, including those of retained accounts. Pause push dispatch and let in-flight sends finish before execution; a reset cannot recall a notification already handed to the push provider. Re-register retained devices through the normal app notification flow afterward. Clear any pending stock-correction requests from test devices along with checkout and return requests.

Stock-correction history is stored in inventory movements; stock awaiting a leftover return is stored in branch inventory. Both tables are already cleared. Their functions, constraints, and triggers remain installed.

- Clear app storage on ALL test devices/browser profiles before signing back in, including retained users' devices, so cached carts and pending checkout/return requests cannot replay. Confirm retained credentials are available first. Deleting an Auth user alone does not immediately invalidate an already-issued JWT; keep removed users' devices out of service. See [Supabase user deletion behavior](https://supabase.com/docs/guides/auth/managing-user-data).
- Sign in as Admin and manager and verify Main Branch access and the empty catalog/inventory/history.
- Add real products as the Main Branch Manager, including prices, variants, recipes/drink options, and closing-stock behavior. Set verified opening stock using the application's inventory workflow.
- Create the intended selling branches and staff accounts, configure product availability/prices, and transfer/receive real stock using normal workflows.
- Keep any test sale or return used for acceptance testing clearly accounted for. Do not rerun the reset once real business data has been entered.

## Verification performed

`node tests/reset_data.mjs` applies the repository migrations to disposable PGlite/Postgres, exercises actual sale and return creation, checks preview non-mutation, rejects wrong/missing execution inputs, rejects schema/foreign-key/Storage drift, injects a failure after clearing data and verifies full rollback, rehearses rollback, and verifies preserved credentials/settings/branch, Auth cascades, unchanged RLS/grants/triggers, and repeat execution on empty data.

PGlite does not reproduce hosted Supabase Auth internals, network failures, or true concurrent sessions. Production was inspected with SELECT queries only; the destructive script has not been executed there. A restorable backup and the fresh preview remain required.
