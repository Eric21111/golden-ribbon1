// Simulate the trusted function only after the fixture's cashier identity is known.
export async function verifiedClose(db,shiftId) {
  // Historical migration fixtures deliberately predate the PIN endpoint.
  const version = await db.query("select to_regprocedure('public.begin_verified_cashier_close(uuid,uuid)') is not null as current");
  if (!version.rows[0].current) return db.query('select public.begin_cashier_shift_close($1) as p',[shiftId]);
  const {rows:[actor]}=await db.query("select auth.uid() as id, current_setting('role') as role");
  if (!['authenticated','none','postgres'].includes(actor.role)) throw Error('Unexpected test role');
  await db.exec('set role service_role');
  try {
    return await db.query('select public.begin_verified_cashier_close($1,$2) as p',[shiftId,actor.id]);
  } finally {
    await db.exec(actor.role==='authenticated'?'set role authenticated':'reset role');
  }
}
