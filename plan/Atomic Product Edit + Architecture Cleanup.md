PART 4 MILESTONE:
Atomic Product Edit + Architecture Cleanup

SCOPE

Part 4 is split.

PART 4A (implement after this MD update; do not start 4B):

Close the arrival/issue vs mode-conversion race. Recreate
confirm_shipment_arrival and report_shipment_issue only: lock products
FOR SHARE after the transfer lock (PL/pgSQL PERFORM/loop so the lock
actually executes), then reject any snapshot vs live inventory_mode
mismatch. Matching piece+piece and kg+kg receipt behavior stays the same.

PART 4B (blocked until 4A is implemented, tested, reviewed, and deployed):

1. Product Edit can partially save when inventory_mode and normal product
   details are updated through separate RPC transactions.

2. Remove or retire stale/dead app/service/type paths that conflict with the
   current approved architecture.

Do NOT work on (except the 4A arrival/issue lock + mismatch checks):

- KG UI/display
- waste/remittance reports
- shift reconciliation
- transfer business logic except 4A lock + mismatch reject
- POS business logic
- inventory reconciliation
- new product features
- role redesign
- Part 5 broad regression cleanup

Part 4 must preserve all already-approved behavior.

==================================================
APPROVED CORRECTIONS
==================================================

1. The new Product Edit UI/service must ALWAYS send p_inventory_mode
   explicitly as piece_stock or kg_meal, even when the mode did not change.
   p_inventory_mode text DEFAULT NULL stays only for old 9-argument callers.
   Do not let an undefined/missing inventoryMode in the updated service
   silently omit the form mode.

2. Before DROP, search the whole repo for update_complete_product.
   After migration, exactly one callable signature may remain.
   Add a 9-argument compatibility regression: omit mode, edit succeeds,
   inventory_mode unchanged, non-zero stock does not trigger mode validation.

3. Do NOT delete CreateReturnScreen.tsx or the createReturn wrapper in Part 4.
   Leave them for Part 5. Product-helper cleanup stays in scope.

4. When DROP/recreating update_complete_product, keep SECURITY DEFINER,
   SET search_path = '', fully qualified public.* refs, existing auth,
   PUBLIC/anon revoke, authenticated grant. Assert the recreated function
   stays SECURITY DEFINER with hardened search_path.

5. CONCURRENCY — Part 4A is APPROVED for implementation after this MD
   update. Do not start Part 4B.

   Migration (4A only — arrival/issue lock + mismatch checks):
   20260928110000_shipment_inventory_mode_concurrency.sql

   Reserved (4B — do not create yet):
   20260928120000_atomic_product_edit.sql

   Recreate confirm_shipment_arrival and report_shipment_issue with the
   SAME signatures, SECURITY DEFINER, SET search_path = '', auth checks,
   and grants. Do not weaken security.

   After transfer FOR UPDATE and status/idempotency checks, lock products
   FOR SHARE. The set-based SELECT ... FOR SHARE in this MD is conceptual
   only. Inside PL/pgSQL do not leave a bare SELECT that returns rows
   without INTO / PERFORM / loop consumption. Do NOT use SELECT DISTINCT
   ... FOR SHARE.

   Robust form: collect distinct transfer product IDs in product_id order,
   then for each ID PERFORM a single-row FOR SHARE on public.products:

   FOR v_product_id IN
     SELECT DISTINCT sti.product_id
     FROM public.stock_transfer_items sti
     WHERE sti.stock_transfer_id = v_transfer.id
     ORDER BY sti.product_id
   LOOP
     PERFORM 1
     FROM public.products p
     WHERE p.id = v_product_id
     FOR SHARE;
   END LOOP;

   Equivalent safe PL/pgSQL is acceptable. Transfer is already FOR UPDATE
   and items cannot be modified at this stage, so the ID list is stable.

   Required: each product locked once; deterministic product_id order;
   transfer locked first; product locks before mismatch validation;
   mismatch validation before any inventory mutation; no DISTINCT FOR
   SHARE; no result-returning bare SELECT in PL/pgSQL.

   Reject ANY snapshot vs live inventory_mode mismatch with a domain
   error such as: Product inventory type changed while this shipment
   was in transit.

   Matching piece+piece and kg+kg keep existing receipt behavior.

   Tests: sequential A/B mismatch for BOTH RPCs; C piece receipt; D kg
   unmeasured; E arrival-wins two-session (mode waits then rejects);
   F lock order. Do NOT test uncommitted set_product_inventory_mode
   succeeding while pending_receipt still exists (that RPC cannot pass
   the open-transfer check). Optional test-only harness SQL may hold
   product FOR UPDATE to prove arrival waits; it must not ship as app
   logic and must not be a fake production RPC.

   Part 4B remains blocked until 4A is implemented, tested, reviewed,
   and deployed.

==================================================
CURRENT KNOWN PRODUCT EDIT RISK
==================================================

Current flow was previously observed as approximately:

Edit Product
    ↓
setProductInventoryMode(...)
    ↓
updateCompleteProduct(...)

These are separate transactions.

Example:

Existing:
Buttered Chicken
piece_stock

Manager edits:

Name:
Buttered Chicken Special

Inventory Type:
kg_meal

Suppose:

setProductInventoryMode()
→ SUCCESS

then:

updateCompleteProduct()
→ FAIL because of duplicate name / variant / price / another validation

Result may become:

inventory_mode = kg_meal

but:

name / variant / price changes not saved

The UI reports failure even though part of the edit already committed.

That must not happen.

==================================================
ATOMICITY REQUIREMENT
==================================================

A single Product Edit Save operation must be:

ALL SUCCESS

or

NO CHANGE

For an edit involving:

- product name
- description
- SKU where currently supported
- active state where currently supported
- default/base price
- variants
- variant prices
- branch prices where already part of update_complete_product
- inventory_mode

all edits submitted as ONE logical Save operation must commit atomically.

If any validation or write fails:

ROLL BACK:

- inventory_mode change
- product metadata changes
- variant changes
- price changes
- branch-price changes performed by that same edit RPC

Do not leave a partially edited product.

==================================================
IMPORTANT: DO NOT CHANGE PRODUCT BUSINESS RULES
==================================================

Inventory mode rules stay exactly as already approved.

piece_stock → kg_meal only when:

- every current branch_inventory balance = 0
- including Main Branch
- no draft/pending_receipt transfer using the product
- no draft/in_transit stock return using the product
- no active in-flight inventory operation depending on old mode

kg_meal → piece_stock:
same safe zero-balance boundary.

Do NOT:

- convert quantities
- rewrite history
- infer mode from product name
- weaken the raw inventory_mode UPDATE guard
- bypass historical inventory_mode snapshots

==================================================
FORWARD MIGRATION ONLY
==================================================

Relevant prior migrations are already deployed.

DO NOT edit:

20260927180000_kg_meal_shift_reconciliation.sql

or any earlier deployed Product Creation / Product Edit migration.

If database/RPC work is required, create a NEW migration after the latest
deployed migration.

Part 4A (implement now — arrival/issue concurrency ONLY):

supabase/migrations/20260928110000_shipment_inventory_mode_concurrency.sql

This file must NOT drop or recreate update_complete_product.

PART 4B — RESERVED / DO NOT IMPLEMENT YET

supabase/migrations/20260928120000_atomic_product_edit.sql

That later file is where DROP/recreate update_complete_product belongs.

Do not give Part 4A and Part 4B the same migration version.

Do NOT run:

npx supabase db push

==================================================
PART 4A IMPLEMENTATION (ARRIVAL / ISSUE ONLY)
==================================================

Implement this section only. Do not implement PREFERRED ATOMIC DESIGN,
PRODUCT EDIT UI, PART 4 CLEANUP, or PART 4B tests yet.

--------------------------------------------------
4A.1 WHAT TO CHANGE
--------------------------------------------------

CREATE OR REPLACE (or equivalent recreate) only:

- public.confirm_shipment_arrival(...)
- public.report_shipment_issue(...)

in:

supabase/migrations/20260928110000_shipment_inventory_mode_concurrency.sql

Preserve current:

- function signatures
- SECURITY DEFINER
- SET search_path = ''
- authorization checks
- REVOKE/GRANT
- existing behavior outside the new locking and mismatch checks

Do not weaken function security.

Do not drop or recreate update_complete_product.
Do not edit Product Edit UI.
Do not remove product helpers.
Do not change send_stock_transfer, confirm_sale, create_stock_return,
apply_leftover_return, receive_stock_return, set_product_inventory_mode,
or create_complete_product.

--------------------------------------------------
4A.2 LOCK ORDER
--------------------------------------------------

Do not invert to product-then-transfer (that deadlocks with send, which
locks products then inserts the transfer).

Required order:

1. existing auth + destination branch FOR SHARE
2. transfer FOR UPDATE
3. existing status / idempotency checks
4. lock each distinct product FOR SHARE, once, ORDER BY product_id
5. then compare each item snapshot inventory_mode to live products.inventory_mode
6. matching modes: existing piece counted receipt or existing KG unmeasured confirm

Lock products AFTER the transfer lock and AFTER status/idempotency.
Mismatch validation AFTER product locks and BEFORE any inventory mutation.

The set-based SELECT p.id ... FOR SHARE sketch is conceptual only.
Inside PL/pgSQL, a bare SELECT that returns rows without INTO / PERFORM /
loop consumption does not lock (or errors). Do not ship that.

Do NOT use a top-level:

SELECT DISTINCT ...
FOR SHARE

Robust approach: obtain distinct transfer product IDs in deterministic
product_id order, then lock each product FOR SHARE in that order:

FOR v_product_id IN
    SELECT DISTINCT sti.product_id
    FROM public.stock_transfer_items sti
    WHERE sti.stock_transfer_id = v_transfer.id
    ORDER BY sti.product_id
LOOP
    PERFORM 1
    FROM public.products p
    WHERE p.id = v_product_id
    FOR SHARE;
END LOOP;

Equivalent safe PL/pgSQL is acceptable.

Because the transfer is already FOR UPDATE and transfer items cannot be
modified at this stage, collecting/iterating its product IDs is stable
for the transaction.

Required properties:

- each product locked once
- deterministic product_id order
- FOR SHARE on public.products (via PERFORM / INTO / loop consumption)
- lock occurs after transfer FOR UPDATE
- product locks occur before mismatch validation
- mismatch validation occurs before any inventory mutation
- no SELECT DISTINCT ... FOR SHARE combination
- no result-returning bare SELECT inside PL/pgSQL

--------------------------------------------------
4A.3 MISMATCH RULE
--------------------------------------------------

Reject ANY snapshot vs live inventory_mode mismatch:

- piece_stock snapshot + live kg_meal → reject
- kg_meal snapshot + live piece_stock → reject

Domain error such as:

Product inventory type changed while this shipment was in transit.

On reject the whole transaction rolls back:

- transfer remains pending_receipt
- no destination inventory mutation
- no snapshot rewrite
- no quantity conversion

Matching modes keep existing receipt behavior:

- piece + piece → counted piece receipt
- kg + kg → confirmed / unmeasured KG

--------------------------------------------------
4A.4 WHY THE "MODE CONVERSION WINS" TEST IS UNREACHABLE
--------------------------------------------------

Do NOT write a test that starts from a pending_receipt transfer and expects:

Session A: set_product_inventory_mode(..., 'kg_meal')

to succeed, even uncommitted, while that transfer still exists.

That RPC cannot pass its open-transfer check, so it never holds an
uncommitted successful mode change against a live pending_receipt row.

The real race is BETWEEN internal statements of set_product_inventory_mode:

A: product FOR UPDATE
A: balance check = zero
B: arrival clears pending_receipt and adds piece inventory
A: open-transfer check sees none
A: mode changes

After Part 4A, B cannot enter that window: arrival must wait on product
FOR SHARE held by A's FOR UPDATE (or A must wait on arrival's FOR SHARE).

--------------------------------------------------
4A.5 TESTS
--------------------------------------------------

Preferred if practical: a test-harness-only transaction that locks the
product FOR UPDATE, performs the zero-balance precondition, then pauses
before the transfer check while another session calls
confirm_shipment_arrival (must block on FOR SHARE). That helper lives
only in test setup. Do not ship it as application business logic. Do not
create a fake production RPC solely for testing.

If that hook is not practical, keep the real arrival-wins two-session
test plus the static and sequential checks below.

For BOTH confirm_shipment_arrival and report_shipment_issue unless noted:

A. snapshot piece_stock + live kg_meal
   → reject; transfer remains pending_receipt; no dest inventory mutate

B. snapshot kg_meal + live piece_stock
   → reject; transfer remains pending_receipt; no inventory mutate

C. piece + piece → existing counted receipt still works

D. kg + kg → existing confirmed/unmeasured behavior still works

E. arrival-wins real two-session test (valid production RPCs):

   Session B:
   BEGIN
   confirm_shipment_arrival(...)
   keep the transaction open after the RPC returns
   (arrival now holds product FOR SHARE until COMMIT)

   Session A:
   set_product_inventory_mode(..., 'kg_meal')
   → waits on product FOR UPDATE

   Session B COMMIT

   Session A resumes
   → sees newly committed piece quantity
   → rejects conversion

   Verify:
   - product remains piece_stock
   - destination piece inventory remains valid
   - transfer remains received
   - no deadlock
   - bounded timeout prevents hanging

   Run the equivalent functional/mismatch assertions for
   report_shipment_issue.

F. product locks are acquired in deterministic product_id order via
   consumed PL/pgSQL (FOR loop + PERFORM ... FOR SHARE or equivalent),
   not a bare SELECT and not DISTINCT FOR SHARE (source/SQL)

Also verify:

- real set_product_inventory_mode still fails while pending_receipt exists
- after committed arrival, mode conversion still fails on non-zero dest qty
- source assertion: arrival and issue acquire product FOR SHARE before
  inventory mutation

Run existing milestone12_3_cashier_shipment_arrival and relevant
KG/transfer regressions. Typecheck if TS/error mapping is touched.

No db push.

==================================================
INSPECTION BEFORE EDITING (PART 4B CONTEXT; ALREADY DONE)
==================================================

Inspect the exact current Product Edit path first.

At minimum inspect:

DATABASE / RPC

- update_complete_product
- set_product_inventory_mode
- create_complete_product
- inventory_mode protection trigger
- transaction-local flag used by set_product_inventory_mode
- zero-balance / in-flight validation
- variant update logic
- branch price update logic
- relevant grants/RLS

APP

- src/features/products/EditProductWizard.tsx
- src/features/products/CreateProductWizard.tsx
- src/services/productService.ts
- app/(manager)/manager/products/index.tsx
- product hooks/query invalidation
- src/types/database.ts
- src/types/models.ts

CLEANUP CANDIDATES

Search for:

- direct insert into products
- old createProduct helpers
- setProductInventoryMode call sites
- updateCompleteProduct call sites
- end_cashier_shift
- old direct shift-close service wrappers
- stale RPC typings
- unused product CRUD helpers
- unused CreateReturnScreen or similar legacy screens ONLY if relevant and
  provably dead

Before implementation report:

1. Exact current Product Edit save sequence.
2. Exact update_complete_product signature.
3. Exact set_product_inventory_mode validation path.
4. Which product/variant/price writes update_complete_product currently owns.
5. Whether any app caller still edits inventory_mode separately.
6. Every direct products INSERT helper/call site.
7. Every stale end_cashier_shift client/type reference.
8. Which cleanup candidates are truly unused vs still active.
9. Recommended minimal atomic RPC design.

Do not speculate.

==================================================
PREFERRED ATOMIC DESIGN (PART 4B — DO NOT IMPLEMENT YET)
==================================================

Prefer ONE server-side transactional Product Edit entry point.

The exact implementation may depend on inspection.

Acceptable designs include:

A. Extend/replace update_complete_product so it accepts the desired
   inventory_mode and validates/applies it inside the SAME transaction.

OR

B. Create a new clearly named atomic Product Edit RPC that owns:

   product metadata
   +
   inventory mode
   +
   variants/prices currently owned by update_complete_product

and retire the old multi-RPC UI save flow.

Do NOT simply reverse the current order:

updateCompleteProduct()
then
setProductInventoryMode()

That is still non-atomic.

Do NOT attempt client-side rollback.

Atomicity must exist at the database transaction level.

==================================================
FUNCTION SIGNATURE / OVERLOAD SAFETY (PART 4B)
==================================================

Be careful with PostgreSQL function signatures.

If changing the argument list of:

update_complete_product(...)

CREATE OR REPLACE will NOT replace the old signature.

It may create an overload.

Inspect the exact existing signature.

If replacing it:

- explicitly DROP the obsolete signature when safe
- create exactly the intended callable signature
- update all app/test callers
- reapply hardened grants

Do not leave ambiguous overloads.

If preserving the old RPC for compatibility:

make its behavior intentional and document why.

Do not accidentally leave two Product Edit entry points where one bypasses
the atomic mode update.

==================================================
SERVER-SIDE MODE VALIDATION
==================================================

The atomic Product Edit RPC must perform mode validation itself inside the
same transaction.

Do not call a separate externally committed RPC.

Preferred conceptual sequence:

BEGIN RPC transaction

1. authenticate Main Branch Manager
2. lock product row FOR UPDATE
3. validate complete Product Edit payload
4. determine:

   current inventory_mode
   requested inventory_mode

5. if mode changes:

   enforce existing safe conversion boundary:
   - all balances zero
   - no draft/pending receipt transfer
   - no draft/in-transit return
   - no active incompatible operation

6. update product metadata
7. update variants
8. update prices
9. update inventory_mode using the existing protected mechanism
10. commit

Any failure:
ROLL BACK ALL

Actual ordering may differ if FK/trigger requirements demand it.

Preserve the existing database integrity protections.

==================================================
INVENTORY_MODE TRIGGER
==================================================

Current direct inventory_mode changes are protected by a BEFORE UPDATE trigger
and a transaction-local authorization flag.

Do NOT remove that protection.

If the new atomic Product Edit RPC needs to change inventory_mode:

reuse the same trusted mechanism.

For example:

- factor the protected mode validation into an internal helper
- or allow the atomic Product Edit RPC to set the same local transaction flag
  only after it passes all required validation

Do not create a second weaker path.

Raw authenticated:

UPDATE products SET inventory_mode = ...

must still fail.

==================================================
SET_PRODUCT_INVENTORY_MODE
==================================================

Inspect whether the standalone:

set_product_inventory_mode(...)

still has a valid intentional use after Product Edit becomes atomic.

Possible outcomes:

1. Keep it intentionally as an explicit mode-only administrative operation.

OR

2. Retire app usage and keep only compatibility/internal use.

OR

3. Safely remove public app usage if nothing requires it.

Do NOT remove it automatically just because Product Edit no longer needs it.

If kept:

it must retain exactly the same authorization and safety validation.

There must be no inconsistent validation between:

atomic Product Edit
and
standalone mode-only change.

Prefer shared server-side validation to duplicated business logic.

==================================================
PRODUCT EDIT UI (PART 4B — DO NOT IMPLEMENT YET)
==================================================

The user should press ONE Save action.

The UI must NOT:

1. call setProductInventoryMode
2. wait for success
3. call updateCompleteProduct

Instead:

Save
→ one atomic update_complete_product RPC
→ success or failure

The updated Product Edit service must always include the form's
inventory_mode (piece_stock or kg_meal) in that one RPC, even when the
mode did not change.

p_inventory_mode DEFAULT NULL is only for older 9-argument callers.
Do not treat a missing inventoryMode in the new service as "leave unchanged".

On success:

- update query/cache
- show success
- return/close according to existing UI

On failure:

- product remains unchanged
- show mapped domain error
- keep form values available for correction

Do not redesign the Product Edit wizard.

==================================================
NORMAL EDIT WITHOUT MODE CHANGE
==================================================

A normal edit such as:

Name:
Buttered Chicken
→ Buttered Chicken Classic

with:

inventory_mode unchanged

must still use the same atomic path and retain current behavior.

Do not require zero stock merely because the Product Edit RPC includes an
inventory_mode parameter.

Zero-balance validation should run ONLY when:

requested_mode != current_mode

Normal name/price/variant edits must continue working according to existing
business rules.

==================================================
MODE-ONLY EDIT
==================================================

Changing only:

piece_stock
→ kg_meal

through Product Edit must work when the safe boundary is satisfied.

It must not require another subsequent metadata write.

==================================================
ROLLBACK CASES
==================================================

Required behavior:

CASE 1

Mode change valid
but new product name is duplicate

→ entire edit fails
→ old name remains
→ old mode remains

--------------------------------------------------

CASE 2

Product metadata valid
but mode change blocked because Main balance > 0

→ entire edit fails
→ no metadata changes saved
→ mode unchanged

--------------------------------------------------

CASE 3

Mode validation succeeds
but variant update fails

→ mode unchanged
→ product metadata unchanged
→ variant changes unchanged

--------------------------------------------------

CASE 4

Mode validation succeeds
but branch/default price update fails

→ entire edit rolls back

No partial save.

==================================================
CONCURRENCY
==================================================

Lock the product row before evaluating/editing mode-sensitive product state.

Preserve existing lock ordering where possible.

Do not introduce a new deadlock pattern.

The genuine arrival/issue vs mode-conversion race is documented in
PART 4A IMPLEMENTATION. Part 4A is the approved fix: product FOR SHARE
on arrival/issue after transfer FOR UPDATE; any snapshot/live mismatch
rejects. Do not invert arrival to product-then-transfer.

Part 4B Product Edit still locks the product FOR UPDATE (existing
update_complete_product / set_product_inventory_mode). Do not implement
4B until 4A is done.

==================================================
ERROR HANDLING
==================================================

Preserve current domain error mapping.

Examples:

- duplicate product name
- invalid variant
- non-zero inventory prevents mode change
- open transfer prevents mode change
- open return prevents mode change
- unauthorized
- product not found
- Product inventory type changed while this shipment was in transit
  (Part 4A arrival/issue mismatch)

Do not expose raw SQL errors.

One failed Save should result in one clear user-facing error.

==================================================
PART 4 CLEANUP (PART 4B — DO NOT IMPLEMENT YET)
==================================================

Cleanup is allowed ONLY for code proven stale/dead and related to architecture
we have already replaced.

Priority candidates from prior source review:

--------------------------------------------------
A. OLD DIRECT PRODUCT INSERT PATHS
--------------------------------------------------

Direct authenticated product INSERT is now intentionally denied.

Search for service/helper code that still performs:

supabase
  .from('products')
  .insert(...)

or equivalent client-side direct creation.

Current trusted creation path:

create_complete_product(...)

If an old helper has:

- no legitimate caller
- conflicts with current authorization
- would fail if called

remove/deprecate it and update its types/tests.

Do NOT alter create_complete_product.

--------------------------------------------------
B. OLD END_CASHIER_SHIFT CLIENT PATH
--------------------------------------------------

The old RPC:

end_cashier_shift

now intentionally rejects:

Use close cashier shift.

Current valid close path:

close_cashier_shift

Search:

- services
- hooks
- types/database.ts
- screens
- tests/source helpers

If stale app/service/type references remain and have no valid intentional use,
remove/deprecate them.

Do NOT change the database end_cashier_shift rejection in Part 4.

Do NOT change shift logic.

--------------------------------------------------
C. UNUSED LEGACY PRODUCT HELPERS
--------------------------------------------------

Remove only when:

- no active import
- no route
- no test intentionally depends on it
- replacement path is already established

Do not perform broad "cleanup everything" deletion.

--------------------------------------------------
D. UNUSED LEGACY SCREENS
--------------------------------------------------

Inspection found src/features/returns/CreateReturnScreen.tsx unrouted.

Do NOT delete it in Part 4.
Do NOT remove the createReturn wrapper solely because that screen is unrouted.

They are unrelated to Product Edit atomicity. Reconsider in Part 5.

This milestone is NOT a dead-code purge. Keep cleanup on PRODUCT architecture.

==================================================
DO NOT CLEAN UP VALID COMPATIBILITY CODE
==================================================

Something old-looking is not automatically dead.

Examples:

- historical snapshot fields
- compatibility RPC wrappers intentionally retained
- migration references
- legacy display support
- tests for historical rows

Do not delete these merely because newer paths exist.

==================================================
TESTS
==================================================

PART 4A tests (implement now): see PART 4A IMPLEMENTATION 4A.5.

For BOTH confirm_shipment_arrival and report_shipment_issue unless noted:

A. snapshot piece_stock + live kg_meal → reject; pending_receipt; no dest inventory mutate
B. snapshot kg_meal + live piece_stock → reject; pending_receipt; no inventory mutate
C. piece + piece → existing counted receipt
D. kg + kg → existing confirmed/unmeasured
E. arrival-wins two-session (valid): B BEGIN confirm_shipment_arrival leave uncommitted; A set_product_inventory_mode waits; B COMMIT; A rejects; product stays piece_stock; dest piece qty kept; transfer received; bounded timeout; no deadlock. Issue-report: same functional/mismatch asserts.
F. product locks in deterministic product_id order via PERFORM/loop (source/SQL; no bare SELECT, no DISTINCT FOR SHARE)

Do NOT expect set_product_inventory_mode to succeed uncommitted while a
pending_receipt transfer still exists.

Also: pending transfer still blocks real set_product_inventory_mode;
arrival stock afterward still blocks mode conversion; source assert
PERFORM/loop FOR SHARE before inventory mutate.

Optional: test-harness-only SQL that locks product FOR UPDATE then
signals, to prove arrival blocks on FOR SHARE. Do not ship that as an
application RPC. Do not create a fake production RPC solely for testing.

Run milestone12_3_cashier_shipment_arrival and relevant KG/transfer
regressions. Typecheck if TS/error mapping is touched.

--------------------------------------------------

PART 4B tests (do not run/create yet):

tests/atomic_product_edit.mjs

Required cases:

A. Normal edit, mode unchanged

Edit name/price/variant.

Verify all save correctly.

--------------------------------------------------

B. Successful atomic mode + metadata edit

All balances zero.
No open transfer/return.

Change:

name
+
inventory_mode
+
price/variant as supported

Verify all commit together.

--------------------------------------------------

C. Duplicate name after requesting valid mode change

Verify:

RPC fails
name unchanged
mode unchanged
variants/prices unchanged

--------------------------------------------------

D. Non-zero Main stock

Attempt:

metadata change
+
piece_stock → kg_meal

Verify:

mode change rejected
metadata unchanged

--------------------------------------------------

E. Selling-branch balance > 0

Same rollback requirement.

--------------------------------------------------

F. Open transfer

Attempt edit with mode change.

Verify:

entire edit rolls back.

--------------------------------------------------

G. Open return

Attempt edit with mode change.

Verify:

entire edit rolls back.

--------------------------------------------------

H. Variant failure

Force invalid/duplicate variant according to existing constraints.

Verify:

product metadata unchanged
mode unchanged
variant state unchanged

--------------------------------------------------

I. Price failure

Force invalid price according to existing validation.

Verify entire edit rollback.

--------------------------------------------------

J. Mode-only edit

Safe boundary.

Verify mode changes successfully without a second app RPC.

--------------------------------------------------

K. Raw mode UPDATE

Normal authenticated direct:

UPDATE products.inventory_mode

still rejected.

--------------------------------------------------

L. Create regression

create_complete_product continues:

- transactional creation
- inventory_mode support
- variant integrity
- existing authorization

--------------------------------------------------

M. No stale Product Edit sequence

Source assertion:

Product Edit Save no longer performs:

setProductInventoryMode()
then
updateCompleteProduct()

as separate committed operations.

--------------------------------------------------

N. Direct product insert cleanup

If stale helper was removed:

verify active source contains no unauthorized direct product creation path.

--------------------------------------------------

O. Shift-close cleanup

If stale service/type references were removed:

verify active app code uses close_cashier_shift, not end_cashier_shift.

Do not alter shift DB behavior.

--------------------------------------------------

P. 9-argument compatibility + single signature

Old 9-argument update_complete_product call (no p_inventory_mode):

- succeeds through the new function default
- normal product edit works
- inventory_mode remains unchanged
- non-zero stock does not trigger mode-change validation

Also assert exactly one public.update_complete_product callable signature
exists after the new migration.

Q. New Product Edit always sends mode

Source/service assertion:

updateCompleteProduct / Product Edit Save always passes p_inventory_mode
as piece_stock or kg_meal. It must not omit the argument.

--------------------------------------------------

R. Recreated update_complete_product hardening

Assert the live function is SECURITY DEFINER and uses the hardened
search_path (empty / '').

==================================================
REGRESSION TESTS
==================================================

PART 4A (run now when implementing 4A):

new shipment/arrival concurrency tests A–F (both RPCs)
milestone12_3_cashier_shipment_arrival
relevant KG/transfer regressions
typecheck only if TS/error mapping is touched

PART 4B (do not run/create yet):

npm run typecheck

new atomic_product_edit test

existing:

create_product_integrity
update_complete_product_integrity
product_active_after_opening
repeat_opening_stock
kg_meal_shift_reconciliation

plus any existing product/variant/price suites touched by the implementation.

If cleanup touches shift service/type code:

run relevant shift close tests too.

Do not run GUI/browser/mobile automation.

Do not change unrelated expectations simply to get green tests.

==================================================
ACCEPTANCE CRITERIA
==================================================

PART 4A is complete only when:

[ ] confirm_shipment_arrival and report_shipment_issue lock products
    FOR SHARE after transfer FOR UPDATE via PERFORM/loop (or equivalent
    consumed lock), without SELECT DISTINCT FOR SHARE and without a
    result-returning bare SELECT in PL/pgSQL.

[ ] Any snapshot vs live inventory_mode mismatch rejects with a domain
    error; transfer stays pending_receipt; no inventory mutate.

[ ] Matching piece+piece and kg+kg receipt behavior is unchanged.

[ ] Function signatures, SECURITY DEFINER, empty search_path, auth, and
    grants are preserved.

[ ] Arrival-wins two-session test passes (mode waits, then rejects).

[ ] No test expects set_product_inventory_mode to succeed while
    pending_receipt still exists.

[ ] No fake production RPC was added solely for testing.

[ ] 4A migration does not drop/recreate update_complete_product.

[ ] milestone12_3 and relevant KG/transfer regressions pass.

[ ] No db push.

PART 4B (later) is complete only when:

[ ] One Product Edit Save is one atomic database transaction.

[ ] Inventory mode and normal product fields cannot partially save.

[ ] Duplicate-name failure rolls back mode.

[ ] Mode-validation failure rolls back metadata changes.

[ ] Variant failure rolls back mode/product changes.

[ ] Price failure rolls back the entire edit.

[ ] Normal edits with unchanged mode do not require zero inventory.

[ ] Safe mode-only edit works.

[ ] Raw inventory_mode UPDATE remains blocked.

[ ] Existing safe mode-change rules remain unchanged.

[ ] Historical quantities are untouched.

[ ] Product Creation behavior remains unchanged.

[ ] Product Edit UI performs one server mutation for one Save.

[ ] The updated Product Edit service always sends p_inventory_mode
    (piece_stock or kg_meal), even when mode is unchanged.

[ ] Old 9-argument update_complete_product calls still work via DEFAULT NULL
    and do not trigger mode-change validation.

[ ] Exactly one update_complete_product callable signature remains.

[ ] Recreated update_complete_product remains SECURITY DEFINER with
    SET search_path = ''.

[ ] Mode-conversion concurrency race is closed by Part 4A (arrival/issue
    wait on product FOR SHARE). Do not ship Part 4B while those RPCs can
    add piece stock without waiting on the product lock.

[ ] No client-side rollback workaround exists.

[ ] No obsolete callable Product Edit RPC overload accidentally remains.

[ ] CreateReturnScreen and createReturn are not deleted in Part 4.

[ ] Proven-dead direct product INSERT app paths are removed/deprecated.

[ ] Active client code does not try to use end_cashier_shift as a valid close.

[ ] No unrelated architecture is refactored.

[ ] Typecheck passes.

[ ] Relevant regression tests pass.

==================================================
OUT OF SCOPE
==================================================

Do NOT change:

- KG display/input
- remittance/waste reports
- branch performance
- shift reconciliation
- 9 PM behavior
- transfer receiving semantics except 4A lock + mismatch reject
  (matching piece/kg receipt behavior stays)
- POS inventory semantics
- product creation architecture except regression compatibility
- role model
- inventory mode business rules
- product availability toggles
- recipe/BOM
- exports
- unrelated dead code
- Part 5 full regression sweep

==================================================
DEPLOYMENT
==================================================

If a new RPC migration is required:

create it locally only.

DO NOT run:

npx supabase db push

Do not modify the live database.

Do not deploy an app build.

==================================================
FINAL REPORT
==================================================

PART 4A report:

1. Lock SQL (FOR loop + PERFORM ... FOR SHARE per product_id, not
   DISTINCT FOR SHARE, not a bare SELECT in PL/pgSQL)
2. Security preserved (DEFINER, search_path, grants, signatures)
3. Mismatch reject vs matching receipt behavior
4. Tests A–F + PASS/FAIL (no unreachable mode-wins-while-pending test)
5. Files changed (20260928110000 only; no update_complete_product DROP)
6. Remaining risks
7. Required deployment command (do not run it)

PART 4B report (later, do not produce yet):

1. Inspection findings
2. Root cause of partial Product Edit
3. New migration filename 20260928120000_atomic_product_edit.sql
4. Atomic RPC design
5. Product Edit UI/service change
6. Inventory mode validation preservation
7. Rollback behavior
8. Stale/dead code removed or intentionally retained
9. Files changed
10. Tests + PASS/FAIL
11. Remaining Part 4 risks
12. Required deployment command if migration exists

Do not begin Part 5. Do not begin Part 4B until 4A is implemented,
tested, reviewed, and deployed.