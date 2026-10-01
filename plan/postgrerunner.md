TRUE POSTGRES RUNNER — JSON PARAMETER HARNESS FIX ONLY

The real PostgreSQL test was executed and failed before meaningful
concurrency assertions because JSON parameters are double-encoded by
postgres.js.

Observed real PostgreSQL failures:

sale/sale:
- both confirm_sale calls rejected:
  "The cart must contain products."

sale/begin-close:
- sale rejected with:
  "The cart must contain products."

receipt/begin-close setup:
- send_stock_transfer rejected:
  "Select at least one product to send."

ROOT CAUSE:

tests/revision_7e_concurrency_postgres.mjs currently uses patterns like:

${JSON.stringify([...])}::jsonb

and:

${payload}::jsonb

postgres.js infers the parameter as JSON/JSONB and serializes the already
JSON.stringify'd string again, so PostgreSQL receives a JSON string instead
of a JSON array.

APPLICATION RPCs are behaving correctly by rejecting non-array p_items.

==================================================
FIX — HARNESS ONLY
==================================================

Do NOT modify application code.
Do NOT modify migrations.
Do NOT modify RPC validation.

In tests/revision_7e_concurrency_postgres.mjs only:

Change every pre-stringified JSON binding from:

${JSON.stringify(value)}::jsonb

to:

${JSON.stringify(value)}::text::jsonb

And change precomputed payload bindings from:

${payload}::jsonb
${payloadA}::jsonb
${payloadB}::jsonb

to:

${payload}::text::jsonb
${payloadA}::text::jsonb
${payloadB}::text::jsonb

Audit the entire runner and ensure ALL JSON payload bindings use the same
safe pattern.

Expected affected operations include:
- confirm_sale sale/sale
- confirm_sale sale/begin-close
- confirm_sale post-cutoff
- send_stock_transfer receipt/begin-close
- identical finalize payloads
- conflicting first-finalize payloads

Do not weaken any database validation.

Run normal tests/typecheck afterward.

Do NOT run db push.
Do NOT deploy.

Return implementation report and STOP.