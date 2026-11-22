# Quarantined migrations (not part of the active deploy path)

These SQL files are **unpublished Egg-only cutover experiments**. They are kept for
local reference and quarantined suites only.

- Do **not** copy them back into `supabase/migrations/` for Approach A (native half-step).
- Do **not** apply `apply_egg_half_unit_cutover()` in production.
- Active PGlite / deploy migration loaders read only `supabase/migrations/`.

| File | Notes |
| --- | --- |
| `20261122120000_egg_half_unit_cutover.sql` | Egg SKU ×2 cutover RPCs + client header gate |
| `20261122130000_egg_cutover_recon_era.sql` | Recon era buckets for that cutover |

Approach A general fractional Stock Used Per Order does not use these migrations.
