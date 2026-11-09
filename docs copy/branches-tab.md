# Branches Tab

Owner-only **Branch hub** for master data. Manager and Cashier have no Branches tab.

Matches Inventory / Transfers hub patterns: search, chips, sticky CTA, `FlatList` + pull-to-refresh. No overflow menu in Phase 1.

| Role | Route | Screen |
|------|-------|--------|
| Owner | `/owner/branches` | `app/(owner)/owner/branches/index.tsx` |

Shared: `src/features/branches/BranchHub.tsx`

---

## Shell

```
Header · Main and selling locations
Search
Chips: All | Active | Inactive | Main
Branch list (pull to refresh)
Sticky CTA: [ Create branch ]
```

| Element | Behavior |
|---------|----------|
| Search | Name or code (client-side) |
| Chips | `is_active` / `is_main_branch` filters |
| Sort | Server: Main first, then name A–Z |
| Row tap | Edit screen `/owner/branches/[id]` |
| Pull to refresh | Refetch branches |

---

## Leads to

| Action | Destination |
|--------|-------------|
| Create branch | Bottom sheet modal (`BranchForm`) |
| Tap row | `/owner/branches/[id]` (edit) |
| Home → Active Branches / Quick Access | `/owner/branches` |

Legacy `/owner/branches/create` redirects to the list.

---

## Related (unchanged)

| Screen | Route |
|--------|-------|
| Create | `/owner/branches/create` |
| Edit | `/owner/branches/[id]` |

Soft-delete via inactive only (no hard delete). Phase 2: confirm on deactivate / change Main.
