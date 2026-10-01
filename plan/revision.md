Revision 7C plan is nearly approved.

Before implementation, add these five technical hardening requirements.

==================================================
1. POST-FINALIZATION SAME-DAY BRANCH FREEZE
==================================================

The selling branch must not become mutable again immediately after successful
reconciliation on the same Manila business date.

State model:

before final daily close
→ existing valid operations

begin close
→ freeze

closed + pending inventory reconciliation
→ freeze

finalized close on the SAME Manila business date
→ remain frozen

next Manila business day
→ operations may resume according to normal shift/workflow rules

Therefore every selling-branch mutator must also reject when the branch has a
FINALIZED daily close for the current Manila business date.

This applies to:
- confirm_sale
- confirm_shipment_arrival
- report_shipment_issue
- create_stock_return
- apply_leftover_return
- any other selling-branch stock mutation

Do not cancel pending transfers.
They remain pending until a valid later business/session state allows receipt.

Do not simply require an open shift for every mutation if that would break the
existing first-stock / pre-session receiving workflow. Use the finalized-close
business-date guard explicitly.

==================================================
2. CASH DISCREPANCY SIGN CONVENTION
==================================================

Inspect the actual current shift_reconciliations schema and cash writer.

Document exactly whether persisted cash difference is:

expected_cash - actual_cash

OR

actual_cash - expected_cash.

Then define exact result mapping:

exact
shortage
excess

Do not assume cash uses the same sign convention as
shift_product_reconciliations.

Preserve the existing schema where practical, but return semantic result fields
so the future 7D UI does not have to infer shortage/excess from an undocumented
sign.

Add exact/shortage/excess tests for cash.

==================================================
3. AUDIT 7A CONSTRAINTS FOR WASTE > SYSTEM BALANCE
==================================================

Before implementing the 7C engine, inspect the actual constraints on:

shift_product_reconciliations.expected_remaining
discrepancy
actual_remaining
waste_quantity
result

Required edge case:

B = system balance before waste = 5
W = waste = 10
A = actual usable remaining = 0

The approved reconciliation must represent the 5-piece physical excess and
must not fail merely because waste exceeds the pre-close system balance.

Safe ledger order remains:

adjustment = (A + W) - B
then waste -W
then optional unsold -A.

If the existing 7A schema prevents storing the mathematically required
reconciliation (for example expected_remaining cannot be negative):

STOP and report the concrete 7A constraint conflict.

Do NOT edit the 7A migration.
Design the correction as a NEW forward 7C migration after approval.

Do not clamp expected values to zero or otherwise hide the discrepancy.

==================================================
4. CANONICAL FINALIZE IDEMPOTENCY
==================================================

Define duplicate-finalize comparison using normalized business values, not raw
JSON equality.

Normalize:
- product rows by product_id
- omitted waste_quantity as 0
- whole PCS numeric representations
- actual cash through parse_actual_cash

A retry after successful finalize with the same normalized:
- actual cash
- product IDs
- actual remaining
- waste

may safely return the existing finalized summary.

A conflicting normalized payload after success must return a clear
already-finalized/conflicting-payload error.

Never duplicate movements or reconciliation rows.

==================================================
5. BEGIN CLOSE IS IRREVERSIBLE
==================================================

Once begin_cashier_shift_close successfully commits:

- sales cutoff is final
- shift remains closed
- no cancel-close RPC
- no reopen-current-shift RPC
- cashier must complete pending reconciliation

7D may ask for confirmation BEFORE invoking begin-close, but after the server
accepts it the daily selling session cannot be resumed.

Ensure protect_shift_lifecycle and all close RPCs preserve this invariant.

Update the Revision 7C PLAN only.

If item 3 discovers an actual 7A schema conflict, explicitly report it instead
of proceeding to implementation.

Otherwise return the revised 7C plan for final implementation approval.

Do not implement yet.
Do not db push.
Do not start 7D.