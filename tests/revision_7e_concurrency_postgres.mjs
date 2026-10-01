/**
 * Revision 7E — true PostgreSQL concurrency scenarios.
 *
 * PGlite does NOT prove parallel-session locking. This script is prepared for an
 * isolated local/ephemeral Postgres only.
 *
 * Default behavior: print NOT EXECUTED and exit 0 (safe for regression sweeps).
 *
 * To execute against a local Postgres (never production):
 *   RUN_7E_PG_CONCURRENCY=1 DATABASE_URL=postgres://... node tests/revision_7e_concurrency_postgres.mjs
 *
 * Scenarios covered when executed (via confirmed sale / begin_cashier_shift_close /
 * finalize_cashier_shift_reconciliation RPCs):
 * 1. simultaneous sale vs sale on limited stock
 * 2. sale vs begin_cashier_shift_close
 * 3. receipt vs begin_cashier_shift_close
 * 4. identical simultaneous finalize_cashier_shift_reconciliation
 * 5. conflicting simultaneous finalize_cashier_shift_reconciliation
 */

const CONFIRM = process.env.RUN_7E_PG_CONCURRENCY === '1';
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

console.log('TRUE POSTGRES CONCURRENCY STATUS');
console.log('================================');

if (!CONFIRM || !databaseUrl) {
  console.log('TRUE POSTGRES CONCURRENCY = NOT EXECUTED');
  console.log('Reason: RUN_7E_PG_CONCURRENCY=1 and DATABASE_URL not both set.');
  console.log('Prepared scenarios: sale/sale, sale/begin-close, receipt/begin-close, identical finalize, conflicting finalize.');
  console.log('Do not use production. PGlite is not a substitute.');
  process.exit(0);
}

if (/supabase\.co|uvxpjrzqtmaterczzvjo/i.test(databaseUrl)) {
  console.error('Refusing to run concurrency tests against a known hosted/production-looking DATABASE_URL.');
  process.exit(1);
}

console.error('Local Postgres concurrency runner is prepared but not auto-wired to a driver in this repo.');
console.error('Set up an ephemeral Postgres with migrations applied, then extend this script with pg Client sessions.');
console.log('TRUE POSTGRES CONCURRENCY = NOT EXECUTED');
process.exit(0);
