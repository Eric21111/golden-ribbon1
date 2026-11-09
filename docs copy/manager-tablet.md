# Manager tablet layouts

Breakpoint: shortest edge ≥ 600 (`useLayout` / `src/lib/layout.ts`).

| Tab | Tablet layout |
|-----|----------------|
| Home | Centered ~640 (`ConstrainedWidth`) |
| Inventory | Master–detail; sheet on phone only |
| Incoming | Master–detail + Count & receive when pending |
| Returns | Master–detail; Create return centered column |
| Products | 2-column catalog (~900 max) |
| Profile | Already centered ~520 |

Shared: `MasterDetailLayout`, `ConstrainedWidth`. Receive stock and create return use centered reading/form columns.
