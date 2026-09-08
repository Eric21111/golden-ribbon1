# Products Tab

Shared **Product hub** for Owner (write) and Manager (read-only). Cashier has no Products tab.

Matches Branches / Inventory / Transfers hub patterns.

| Role | Route | Screen |
|------|-------|--------|
| Owner | `/owner/products` | `app/(owner)/owner/products/index.tsx` |
| Manager | `/manager/products` | `app/(manager)/manager/products.tsx` |

Shared: `src/features/products/ProductHub.tsx`

**Tablet:** 2-column product grid, catalog max width ~900.

---

## Shell

```
Header + subtitle
Search (name or SKU)
Chips (Owner): All | Active | Inactive
Product list (pull to refresh)
Sticky CTA (Owner): [ Create product ]
```

| Element | Behavior |
|---------|----------|
| Search | Server-side `ilike` on name + SKU via `useProducts` |
| Activity chips | Owner only; client filter on fetched results |
| Manager scope | `activeOnly=true` always; no chips; no row press |
| Sort | Server: name A–Z |
| Row tap (Owner) | Edit `/owner/products/[id]` |
| Pull to refresh | Refetch products |

---

## Owner

**Subtitle:** Catalog master data  
**Primary CTA:** Create product → bottom sheet modal (`ProductForm`)  
**Row →** `/owner/products/[id]` (edit)

Legacy `/owner/products/create` redirects to the list.

## Manager

**Subtitle:** Active catalog reference  
**No CTA, no chevron, rows not pressable**

---

## Related (unchanged)

| Screen | Route |
|--------|-------|
| Create | `/owner/products/create` |
| Edit | `/owner/products/[id]` |

Soft-deactivate via inactive (no hard delete). Phase 2: confirm on deactivate; Manager peek sheet.
