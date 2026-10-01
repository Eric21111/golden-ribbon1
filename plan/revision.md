Revision 7 Final Hardening Patch 2 plan is APPROVED with THREE implementation
clarifications.

1. TRUE POSTGRES FIXTURE UNIQUENESS

Per-scenario isolation must use a runtime-unique prefix not only for UUIDs but
also for every constrained/user-defined identifier that may collide on rerun,
including as applicable:

- branch IDs
- branch codes
- product IDs
- product SKUs
- profile/cashier IDs
- idempotency keys
- scenario-specific names/keys used by unique constraints

The runner should be safely rerunnable against the same disposable migrated DB
with APPLY_MIGRATIONS=0 without deleting immutable business history.

2. VERIFY FINAL close_overdue_shifts FUNCTION

In Patch-2 regression coverage, do not only grep the new migration source.

After applying the full migration chain in PGlite, query pg_get_functiondef()
for the effective final public.close_overdue_shifts().

Assert that the FINAL installed definition:

- discovers candidates without FOR UPDATE
- calls begin_shift_close_core
- contains no generic EXCEPTION WHEN OTHERS THEN NULL swallow

Older historical migrations may still contain the superseded definition and
must not be edited.

3. LIVE VERIFIER ADMIN MUTATIONS

Make the rule absolute:

EVERY admin.from(...).insert(...)
EVERY admin.from(...).update(...)
EVERY admin.from(...).upsert(...)
EVERY admin.from(...).delete(...)

used by milestone10_5_live_verification.mjs must inspect the returned error.

Do not silently continue after a rejected admin mutation.

Prefer a small helper if useful so this remains consistent.

All other Patch-2 plan sections are approved.

Proceed with local implementation.

No db push.
No deployment.

Run full regression/typecheck and report PGlite and true PostgreSQL separately.
STOP after the implementation report.