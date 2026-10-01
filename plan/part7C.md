    REVISION 7C — END SHIFT / REMITTANCE + INVENTORY & CASH RECONCILIATION ENGINE

PHASE: PLAN FIRST — DO NOT IMPLEMENT YET

Revision 7A and 7B have already been implemented LOCALLY.

DO NOT:
- db push
- deploy
- perform production cutover
- start Revision 7D UI
- start Revision 7E reports/cleanup

Return a detailed Revision 7C PLAN first.

==================================================
REVISION 7 STATUS
==================================================

7A — implemented locally
- PCS cutover schema
- closing_stock_behavior
- quantified waste schema
- shift_product_opening_stock
- shift_product_reconciliations
- inventory_reconciliation_required
- sales_cutoff_at
- cutover snapshots
- whole-PCS enforcement
- active kg_meal retirement scaffolding

7B — implemented locally
- current operations PCS-only
- inventory-mode UX removed
- closing-stock behavior Product Create/Edit
- transfers/receipts/returns PCS
- POS stock tracked/deducted for every active product
- cart max = available PCS
- leftover return remains accountability/waste, no Main restock
- common inventory lock gate aligned across normal mutators
- historical KG display preserved

7C — THIS PLAN:
- final daily sales cutoff
- End Shift / Remittance server workflow
- branch inventory freeze
- physical remaining counts
- closing waste quantities
- expected-vs-actual reconciliation
- exact / shortage / excess
- keep_at_branch finalization
- record_as_unsold finalization
- cash reconciliation
- manual close
- pending/auto-close reconciliation
- same-day final-close protection

7D later:
- cashier End Shift UI/UX

7E later:
- reports/history/final cleanup

==================================================
FINAL BUSINESS RULES — LOCKED
==================================================

A. END SHIFT / REMIT = FINAL DAILY SALES CUTOFF
--------------------------------------------------

When the cashier STARTS End Shift / Remittance:

- booth stops accepting sales
- even if customers are still present
- even if unsold food remains
- even if mall/store building remains open

No more selling for that branch for that business day.

Therefore:

Start End Shift
→ sales cutoff begins immediately
→ branch stock-changing selling operations freeze
→ cashier performs physical count/cash count
→ final reconciliation completes the close

This is not merely a UI rule.

It must be enforced server-side.

==================================================
B. THREE DIFFERENT STOCK CONCEPTS
==================================================

Never conflate these:

1. keep_at_branch
   - remaining usable stock stays at selling booth
   - available next business day
   - example: bottled drinks
   - NOT waste
   - NOT unsold disposal
   - NOT auto return-to-Main

2. record_as_unsold
   - remaining usable stock at final close is recorded as unsold
   - removed from usable selling-branch inventory
   - next usable branch stock becomes 0
   - example: prepared food

3. leftover-return-to-Main
   - separate manual accountability/waste-return workflow from 7B
   - Main receives/counts returned PCS
   - no usable Main restock
   - no sellable return_in
   - NOT automatically triggered by closing behavior

7C must not automatically create leftover-return records.

==================================================
C. WASTE VS UNSOLD
==================================================

Waste:
- damaged
- spoiled
- dropped
- broken
- otherwise unusable
- counted in PCS

Unsold:
- still usable/good stock remaining when final selling stops
- applies to record_as_unsold products
- separate from waste

Example:

System stock before close: 30 pcs
Waste: 5 pcs
Actual usable remaining: 23 pcs

Expected usable remaining after declared waste:
25 pcs

Difference:
25 - 23 = 2 shortage

For record_as_unsold:
- shortage = 2
- waste = 5
- unsold = 23
- ending usable stock = 0

For keep_at_branch:
- shortage = 2
- waste = 5
- carried stock = 23
- ending usable stock = 23

==================================================
D. INVENTORY FORMULA
==================================================

Session audit formula:

opening
+ received
- outgoing
- sold
+/- session adjustments
- closing waste
= expected usable remaining

Inventory Difference
=
Expected Remaining
- Actual Physical Remaining

Interpretation:

0
= exact

positive
= shortage

negative
= excess

Cashier never calculates this manually.

Server calculates it.

The session movement accounting must use the 7A/7B rules:

- opening from shift_product_opening_stock
- transfer_in / allowed inbound = received
- transfer_out / return_out = outgoing
- sale = sold
- adjustment = signed adjustment_quantity
- unknown/unclassified movement must not silently disappear

==================================================
E. CASH FORMULA
==================================================

Expected Cash
=
authoritative completed POS sales for the shift

Actual Cash
=
cashier input

Cash Difference
=
Expected Cash - Actual Cash

0 = exact
positive = shortage
negative = excess

Do not trust a client-provided expected cash amount.

Server derives it.

==================================================
F. TWO-PHASE CLOSING WORKFLOW
==================================================

A single "submit everything and then freeze" operation is NOT sufficient.

The business rule says sales stop when the cashier STARTS remittance.

Therefore design a two-phase server workflow.

Conceptually:

PHASE 1 — BEGIN CLOSE

Cashier taps End Shift / Remit.

Server atomically:

- authenticates cashier/current shift
- locks branch/shift consistently
- ensures close is not already finalized
- sets final sales cutoff
- freezes selling-branch inventory mutations
- marks reconciliation pending
- snapshots/fixes the reconciliation product universe
- returns authoritative close-preview data

No inventory reconciliation is finalized yet.

PHASE 2 — FINALIZE RECONCILIATION

Cashier submits:

- actual physical remaining PCS per required product
- waste PCS per product, default 0
- actual cash

Server atomically:

- re-locks branch/shift/products
- verifies no forbidden stock mutation occurred after cutoff
- recomputes authoritative movement/cash figures
- validates submitted product set
- records waste
- calculates inventory difference/result
- reconciles ledger to physical stock
- applies keep_at_branch / record_as_unsold
- records cash reconciliation
- completes shift reconciliation
- clears pending flags
- returns final summary

Design exact RPC names/signatures.

Prefer clear names such as:

begin_cashier_shift_close(...)
get_my_pending_shift_reconciliation(...)
finalize_cashier_shift_reconciliation(...)

but inspect current RPC architecture first.

Do not create redundant APIs if existing close/reconcile RPCs can be safely
rewritten.

==================================================
G. WHAT HAPPENS TO SHIFT STATUS AT BEGIN CLOSE
==================================================

Evaluate the safest design.

Preferred semantics to evaluate:

When End Shift starts:

- sales_cutoff_at = server now()
- shift status becomes closed
- closed_at/end timestamp is recorded
- reconciliation_required = true
- inventory_reconciliation_required = true

The session is operationally over immediately.

Reconciliation may finish minutes later.

This would let manual close and auto-close share one "closed but pending
reconciliation" model.

If keeping status open with sales_cutoff_at is safer with current schema,
explain why.

Do NOT invent a new shift enum unless genuinely necessary.

==================================================
H. SALES_CUTOFF_AT IS SERVER AUTHORITY
==================================================

Never accept cutoff timestamp from the client.

Server writes it.

Once non-null for the shift:

confirm_sale
must reject.

7C must implement the actual freeze, not only comments.

==================================================
I. FULL SELLING-BRANCH FREEZE
==================================================

7B documented YES freeze insertion points.

7C must now enforce them.

After sales_cutoff_at is set OR while inventory reconciliation is pending,
reject selling-branch stock mutation through at least:

- confirm_sale
- confirm_shipment_arrival
- report_shipment_issue
- create_stock_return
- apply_leftover_return
- any selling-branch inventory adjustment path
- any other selling-branch inventory mutator discovered

Main-only operations are not automatically frozen unless they touch the same
selling branch.

Use the common:

lock_branch_inventory_gate

and the established lock order.

Do not enforce only in UI.

==================================================
J. PENDING CLOSED-SHIFT FREEZE
==================================================

Auto-close may leave:

shift status = closed
inventory_reconciliation_required = true

There may be no open shift row.

Therefore the inventory gate cannot only inspect an OPEN shift.

It must also detect a CLOSED shift for that selling branch with unfinished
inventory reconciliation and reject mutation.

Audit/update lock_branch_inventory_gate or add an internal helper as needed.

Do not allow stock changes before pending physical reconciliation completes.

==================================================
K. GLOBAL LOCK ORDER
==================================================

Preserve the agreed ordering:

1. branch FOR UPDATE
2. relevant shift FOR UPDATE
3. branch_inventory rows FOR UPDATE in deterministic product_id order
4. relevant product rows if metadata snapshots require them
5. business writes

Audit every 7C mutation path for consistent ordering.

Avoid deadlocks.

==================================================
L. RECONCILIATION PRODUCT UNIVERSE
==================================================

Define exactly which products the cashier must physically count.

It must be deterministic and complete.

At minimum consider union of:

- products with shift_product_opening_stock for the shift
- products with inventory_movements during the shift
- products with current selling-branch stock relevant to the session
- products first received/introduced mid-session

Do not let a product with session inventory activity disappear simply because
it had no opening snapshot.

Prefer avoiding irrelevant never-stocked zero products.

For every required product:

actual_remaining must be provided at finalization.

Waste may default to 0.

Do not let client omit a required product to hide a shortage/excess.

Do not let client submit duplicate or unrelated product IDs.

==================================================
M. FREEZE PRODUCT METADATA USED BY CLOSING
==================================================

closing_stock_behavior must not change underneath a pending close.

Example:

Begin End Shift at 7:30 PM
product = keep_at_branch

Manager edits product at 7:35 PM to record_as_unsold

Finalization must not silently change the closing outcome.

Therefore 7C must snapshot at cutoff, for each reconciliation product:

- product_name
- sku if available
- closing_stock_behavior

and any other critical semantics used for closing.

Use an appropriate pending-close baseline design.

Options to evaluate:

- dedicated shift_product_close_baselines table
- safely creating pending reconciliation rows at begin-close
- another deterministic snapshot approach

Do not simply read the live products.closing_stock_behavior at finalization.

Historical finalized reconciliation must retain the snapshot.

==================================================
N. BEGIN-CLOSE PREVIEW DATA
==================================================

7D will need authoritative server data.

7C should expose enough data for a future one-screen cashier close UI.

Per product, preview should make available at least:

- product_id
- product_name_snapshot
- sku snapshot if applicable
- closing behavior snapshot
- opening quantity
- received quantity
- outgoing quantity
- sold quantity
- signed session adjustment quantity
- authoritative system balance before closing waste
- possibly expected remaining once waste is supplied

Cash preview:

- expected cash
- shift identifier
- cutoff time

Cashier input itself belongs to 7D, but 7C must provide the backend payload.

Do not require 7D to reconstruct inventory totals on the client from raw
movement history.

==================================================
O. FINALIZATION INPUT
==================================================

Plan a strict payload.

Conceptually:

shift_id

actual_cash

products: [
  {
    product_id,
    actual_remaining,
    waste_quantity
  }
]

All quantities:
- whole PCS
- >= 0

Waste can be omitted only if server explicitly treats omission as 0.

Actual remaining must be present for every required product.

Client must NOT supply:

- expected remaining
- difference
- result
- unsold quantity
- carried quantity
- expected cash
- closing behavior

Those are server-calculated/snapshotted.

==================================================
P. WASTE STORAGE
==================================================

For new PCS closes:

shift_waste_occurrences.quantity

must represent real PCS waste.

Recommended:

- one row per shift/product only when waste > 0
- quantity = entered PCS
- optional note remains nullable
- waste = 0 need not create occurrence row

But:

shift_product_reconciliations.waste_quantity
must store 0 or positive quantity for every reconciled product.

Inventory ledger gets auditable waste movement.

Do not fabricate waste during auto-close.

==================================================
Q. RECONCILIATION LEDGER ORDER — AUDIT CAREFULLY
==================================================

The previous design discussed:

waste movement
→ discrepancy adjustment
→ unsold movement

Before implementing, test the edge case:

system balance before close = 5
cashier reports:
waste = 10
actual usable = 0

Waste-first would temporarily push usable inventory negative if inventory has
a nonnegative constraint.

Do NOT simply reject a physically possible discrepancy because of ledger
write order unless there is a sound business reason.

Evaluate a transaction-safe equivalent ordering.

For example, mathematically:

system balance B
physical accounted = actual_remaining A + waste W

reconciliation adjustment
=
(A + W) - B

Then:

1. adjustment moves ledger to total physically accounted stock
2. waste movement removes W
3. usable balance becomes A
4. record_as_unsold removes A if applicable

This produces the same shortage/excess:

difference
=
B - W - A

but avoids a negative intermediate balance.

Audit this against:

- existing movement sign rules
- adjustment semantics
- shift_product_reconciliations fields
- 7A approved formulas
- branch_inventory nonnegative constraint

If there is a better safe ordering, document it.

Do not silently change the business meaning of shortage/excess.

==================================================
R. EXACT / SHORTAGE / EXCESS
==================================================

For each product:

difference = expected - actual

result:
difference = 0  → exact
difference > 0  → shortage
difference < 0  → excess

Store:

- expected_remaining
- actual_remaining
- discrepancy/difference
- result
- waste_quantity
- unsold_quantity
- carried_quantity
- movement-accounting snapshots

For keep_at_branch:

carried_quantity = actual_remaining
unsold_quantity = 0
ending usable stock = actual_remaining

For record_as_unsold:

unsold_quantity = actual_remaining
carried_quantity = 0
ending usable stock = 0

==================================================
S. ATOMICITY
==================================================

Finalization must be one server-side transaction.

If reconciliation fails for ONE product:

- no product reconciliation rows commit
- no waste movement commits
- no adjustment commits
- no unsold movement commits
- no cash reconciliation commits
- pending reconciliation remains pending

Never partially close a shift.

==================================================
T. IDEMPOTENCY / RETRY SAFETY
==================================================

Network timeout after final submit must not duplicate:

- waste movements
- adjustment movements
- unsold movements
- shift_product_reconciliations
- cash reconciliation

Use uniqueness/reference protections.

Define behavior for:

- first successful finalization
- duplicate retry after success
- retry after transaction failure
- conflicting second payload after success

Prefer returning existing finalized result on safe duplicate retry or a clear
"already reconciled" result.

Never duplicate stock mutations.

==================================================
U. EXPECTED CASH AUTHORITY
==================================================

Expected cash must be recomputed server-side from completed POS sales assigned
to the shift.

Audit:
- cancelled/voided sales
- non-completed transactions
- any existing status rules

Reuse established authoritative sales logic rather than making a second
definition.

No sale can occur after cutoff.

==================================================
V. EXISTING CASH RECONCILIATION
==================================================

Preserve:

shift_reconciliations

and existing cash history semantics.

Do not create a second competing cash-reconciliation table without a strong
reason.

Inventory reconciliation and cash reconciliation must finalize atomically.

Audit existing:

close_cashier_shift
reconcile_closed_shift
record_shift_reconciliation
get_my_pending_shift_reconciliation

Decide which should be:

- rewritten
- deprecated
- internally shared
- replaced

Avoid multiple competing close paths.

==================================================
W. LEGACY SHIFT COMPATIBILITY
==================================================

Pre-Revision-7 shifts:

inventory_reconciliation_required = false

must remain CASH-ONLY historical reconciliation.

Do not force old shifts to provide product physical counts.

Existing cash-only reconciliation for legacy shifts must continue to work.

New PCS shifts:

inventory_reconciliation_required = true when closing/pending

use cash + inventory reconciliation.

Clearly distinguish the two paths.

==================================================
X. AUTO-CLOSE
==================================================

Current 9 PM auto-close remains a safety mechanism.

Do not change its schedule in 7C unless current source requires correction.

For a NEW PCS shift auto-closed without manual End Shift:

server must:

- stop sales
- set sales_cutoff_at if not already set
- close shift
- set reconciliation_required = true
- set inventory_reconciliation_required = true

Do NOT fabricate:

- actual cash
- physical remaining
- waste
- unsold
- carried stock
- discrepancy result

Inventory remains frozen until cashier completes pending reconciliation.

get_my_pending_shift_reconciliation (or replacement) must expose enough data
to resume later.

==================================================
Y. MANUAL CLOSE VS AUTO-CLOSED RECONCILIATION
==================================================

Use the same final reconciliation engine for both wherever possible.

Manual:

begin close
→ cutoff
→ count
→ finalize

Auto-close:

automatic cutoff/close
→ pending
→ cashier later opens pending reconciliation
→ count
→ same finalize engine

Do not maintain two different formulas.

==================================================
Z. NO NEW SHIFT WHILE INVENTORY RECONCILIATION PENDING
==================================================

7A already prepared this rule.

Keep it.

If a branch has unresolved:

inventory_reconciliation_required = true

start_cashier_shift must reject.

However:

legacy cash-only pending shifts must not incorrectly require inventory counts.

==================================================
AA. FINAL DAILY CLOSE — NO REOPEN SAME BUSINESS DAY
==================================================

Important business rule:

End Shift / Remit is the FINAL sales close for that branch for the day.

After a manually finalized daily close:

the cashier must NOT simply start a new selling shift again later the same
business day.

Example:

7:30 PM final remittance completes
→ someone tries to start another shift at 8:00 PM
→ server rejects

Audit current business-date helpers (existing reports use Manila business
date).

Plan a server-side same-business-day final-close guard.

Do not rely only on UI.

This guard must not prevent the NEXT business day's legitimate shift.

For an auto-closed prior-day shift reconciled the next morning:
after reconciliation is complete, the current day's new shift should be
allowed according to business-date semantics.

Do not add cashier handoff architecture.

The confirmed operation uses the same cashier account/session model.

==================================================
AB. CUT-OFF/PENDING FREEZE FOR RECEIPTS
==================================================

Pending transfer receipts can remain pending across a close.

Do not fabricate receipt.

After closing begins:

- branch cannot receive it until reconciliation is finished / valid next
  session state allows it

Do not automatically cancel pending transfer.

Historical/pending transfer integrity must remain.

==================================================
AC. PRODUCT EDIT DURING PENDING CLOSE
==================================================

Normal Product Management may continue independently where safe, BUT:

the closing session must use snapshotted metadata/closing behavior captured at
cutoff.

Editing the live product after cutoff must not rewrite the pending or
historical close outcome.

==================================================
AD. AUTHORIZATION
==================================================

Preserve existing role boundaries.

Cashier:
- may begin/reconcile own authorized branch shift according to current rules
- cannot edit product closing behavior
- cannot directly mutate inventory tables

Owner/Main Manager:
- existing management rights remain
- do not widen cashier permissions

All new mutation RPCs:

SECURITY DEFINER where appropriate
SET search_path = ''

REVOKE public/anon
GRANT minimum required execution

Internal lock/reconciliation helpers should not be directly callable unless
required.

==================================================
AE. 7D BOUNDARY — DO NOT BUILD FINAL UI
==================================================

7C should implement backend/server reconciliation and the service/types needed
to consume it.

Do NOT build the final polished cashier End Shift screen yet.

7D will implement the efficient one-screen UX.

7C may update/remove legacy service contracts as required for the new backend,
but avoid doing the full presentation redesign.

==================================================
AF. 7E BOUNDARY
==================================================

Do not redesign report/history screens in 7C.

Write complete data correctly so 7E can report:

- waste PCS
- unsold PCS
- carried PCS
- inventory exact/shortage/excess
- cash exact/shortage/excess
- legacy KG history

==================================================
AG. REMAINING LEGACY KG END-SHIFT LOGIC
==================================================

Audit all closing/reconciliation code for residual:

- kg_meal
- occurrence-only waste assumptions
- Not tracked
- Unmeasured
- meal-specific close paths
- MAX meal logic
- KG-specific End Shift copy

7C backend must no longer use active KG closing logic.

Historical data compatibility remains.

7D/7E will clean presentation where appropriate.

==================================================
AH. REQUIRED TESTS
==================================================

Plan tests covering at least:

1. Begin-close sets server cutoff.
2. Begin-close closes/marks session according to chosen model.
3. Sale after cutoff rejected.
4. Shipment arrival after cutoff rejected.
5. Shipment issue after cutoff rejected.
6. Stock return after cutoff rejected.
7. Leftover return after cutoff rejected.
8. Pending inventory reconciliation freezes branch mutation.
9. Legacy cash-only pending shift does not incorrectly require product recon.
10. No new shift while inventory reconciliation pending.
11. No second selling shift after final close in same business day.
12. Next business day shift is allowed.
13. Opening stock pulled from immutable opening snapshot.
14. Mid-session-first product uses opening 0.
15. Received/outgoing/sold/session adjustment totals correct.
16. Unknown movement causes safe failure.
17. Required product universe cannot be omitted.
18. Duplicate product input rejected.
19. Whole PCS actual count/waste validation.
20. Exact inventory result.
21. Inventory shortage.
22. Inventory excess.
23. Waste quantity recorded.
24. keep_at_branch leaves actual stock.
25. record_as_unsold records/removes actual remaining.
26. Mixed products in one shift.
27. Closing behavior frozen at cutoff despite later product edit.
28. Cash exact.
29. Cash shortage.
30. Cash excess.
31. Expected cash ignores invalid/non-completed sales according to existing rules.
32. Inventory + cash finalize atomically.
33. Failure on one product rolls back entire close.
34. Duplicate finalize cannot duplicate movements.
35. Network-style retry is idempotent/safe.
36. Auto-close sets pending flags without fabricating counts.
37. Auto-closed shift uses same finalization engine.
38. Pending auto-close blocks mutations/new shift.
39. Waste > pre-close system balance edge case does not create invalid negative
    intermediate inventory; discrepancy still represented correctly.
40. Historical pre-7 cash-only reconciliation still works.
41. No active kg_meal End Shift branch.
42. SECURITY DEFINER/search_path/grants correct.
43. Existing 7A and 7B tests remain green.
44. Full regression remains green.
45. npm run typecheck passes.

Use real PostgreSQL integration/concurrency tests if available.

PGlite tests are useful but do not claim they prove true concurrent-session
behavior if they do not.

==================================================
AI. PLAN OUTPUT REQUIRED
==================================================

Return a structured Revision 7C PLAN containing:

1. Current close/reconciliation architecture found
2. Current close RPCs/functions and which are retained/replaced
3. Proposed two-phase closing API
4. Shift status/cutoff state model
5. Full selling-branch freeze implementation
6. Pending closed-shift freeze implementation
7. Global lock-order implementation
8. Reconciliation product-universe definition
9. Product metadata/closing-behavior snapshot strategy
10. Begin-close preview payload
11. Finalization input contract
12. Movement aggregation rules
13. Waste persistence model
14. Safe ledger reconciliation ordering
15. Inventory exact/shortage/excess calculation
16. keep_at_branch finalization
17. record_as_unsold finalization
18. Cash expected/actual reconciliation
19. Manual close flow
20. Auto-close flow
21. Legacy cash-only shift compatibility
22. Same-business-day no-reopen rule
23. Idempotency/retry design
24. Transaction rollback/atomicity design
25. Security/RLS/grants
26. New migration(s) expected
27. Service/type changes expected
28. Exact 7C/7D boundary
29. Tests to add/update
30. Risks/regression areas
31. Any business decision still required

IMPORTANT:

If you discover a genuine missing BUSINESS decision:
STOP and identify it.

Do not invent one.

If you discover a genuine 7A/7B defect:
STOP and report it instead of silently editing existing 7A/7B migrations.

Use new forward migration(s) only.

Do not implement yet.

Return the Revision 7C PLAN for review.