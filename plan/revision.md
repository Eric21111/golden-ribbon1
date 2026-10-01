ONE FINAL PLAN CLARIFICATION — LOCK HELPER

The updated plan is approved, but apply this clarification before implementation.

Current lock_branch_inventory_gate(branch, enforce_freeze) is NOT a
branch-only lock.

It currently locks:

1. branch FOR UPDATE
2. an automatically selected open or pending-closed shift FOR UPDATE
3. branch_inventory rows ORDER BY product_id FOR UPDATE

Therefore do NOT implement Begin/Finalize as:

lock_branch_inventory_gate(branch)
→ then target shift FOR UPDATE

while assuming the helper only obtained the branch lock.

That does not guarantee the exact target-shift ordering in every state,
especially an idempotent finalize retry after pending flags are already clear.

For Revision-7 close paths, guarantee the exact order:

BRANCH
→ EXACT TARGET SHIFT
→ INVENTORY ROWS
→ WRITES

Preferred approach:

- add/refactor an INTERNAL target-aware locking helper for close operations,
  e.g. conceptually:
    lock_shift_inventory_gate(branch_id, shift_id, enforce_freeze)
- it must:
    1. lock exact branch FOR UPDATE
    2. lock exact supplied shift FOR UPDATE
    3. revalidate that shift belongs to that branch
    4. optionally run freeze validation as appropriate
    5. lock branch_inventory ORDER BY product_id FOR UPDATE
- revoke it from public / anon / authenticated
- SECURITY DEFINER
- search_path = ''

OR equivalently implement those exact locks directly inside the close core.

Do not rely on the existing helper's automatic:
"prefer open shift, otherwise oldest pending shift"
selection for Begin/Finalize when the target shift ID is already known.

Normal sale/receipt/return mutators may continue using the general
lock_branch_inventory_gate if appropriate.

Required ordering:

begin_shift_close_core:
branch → EXACT target shift → inventory → cutoff/baselines

finalize_cashier_shift_reconciliation:
branch → EXACT target shift → inventory → validation/writes

idempotent finalized retry:
branch → EXACT target shift → inventory if needed
(or if safely determined read-only, branch → exact target shift and no
inventory mutation/locking)
but NEVER branch → inventory → target shift.

close_overdue_shifts:
discover IDs without locks
→ call begin_shift_close_core
→ core owns branch → exact shift → inventory.

Add a regression/static assertion proving the close functions do not acquire
the target shift after inventory locks.

Everything else in the revised hardening plan is approved.

Proceed with implementation.
No db push.
No deploy.
Return implementation report and STOP.