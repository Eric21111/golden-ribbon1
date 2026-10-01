/**
 * Revision 7C test helper: begin close + finalize with system-exact counts.
 * Prefer importing this over resurrecting close_cashier_shift.
 */

function productsFromBegin(preview) {
  return (preview?.products ?? []).map((p) => {
    const remaining =
      p.system_balance_before_waste ?? p.actual_remaining ?? p.expected_remaining ?? 0;
    return {
      product_id: p.product_id,
      actual_remaining: String(remaining),
      waste_quantity: String(p.waste_quantity ?? 0),
    };
  });
}

export async function closeShiftExact(db, shiftId, actualCash = '0') {
  const preview = (
    await db.query('select public.begin_cashier_shift_close($1) preview', [shiftId])
  ).rows[0].preview;

  // Already finalized begin response — still run identical finalize for idempotency coverage.
  let products = productsFromBegin(preview);

  // Fallback if begin preview omitted products (should not happen for PCS closes).
  if (products.length === 0 && preview?.inventory_reconciliation_required) {
    const pending = (await db.query('select public.get_my_pending_shift_reconciliation() p')).rows[0].p;
    products = productsFromBegin(pending);
  }

  const result = (
    await db.query(
      'select public.finalize_cashier_shift_reconciliation($1,$2,$3::jsonb) result',
      [shiftId, actualCash, JSON.stringify(products)],
    )
  ).rows[0].result;
  return { result, products, preview };
}

/** Move a finalized/closed shift onto the prior Manila business day so same-day freeze lifts. */
export async function backdateClosedShiftToYesterday(db, shiftId) {
  await db.exec('reset role');
  await db.exec(`alter table public.shifts disable trigger shifts_protect_lifecycle`);
  await db.exec(`
    update public.shifts
    set started_at = ((timezone('Asia/Manila', now())::date - 1) + time '10:00') at time zone 'Asia/Manila',
        sales_cutoff_at = ((timezone('Asia/Manila', now())::date - 1) + time '20:00') at time zone 'Asia/Manila',
        ended_at = ((timezone('Asia/Manila', now())::date - 1) + time '20:00') at time zone 'Asia/Manila'
    where id = '${shiftId}'
  `);
  await db.exec(`alter table public.shifts enable trigger shifts_protect_lifecycle`);
}
