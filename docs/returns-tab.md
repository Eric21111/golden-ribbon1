# Returns Tab

Shared **Return hub** for Owner and Manager. Matches Incoming / Transfer hub patterns.

| Role | Route | Screen |
|------|-------|--------|
| Owner | `/owner/returns` | `ReturnHistory role="owner"` |
| Manager | `/manager/returns` | `ReturnHistory role="manager"` |

Shared: `src/features/returns/ReturnHub.tsx`

**Tablet:** Manager uses master–detail. Owner uses centered list (`enableMasterDetail={false}`). Create/receive flows use centered columns.

---

## Shell

```
Header + subtitle     [⋯ Owner]
Search (return # / branch)
Status chips
Return list (pull to refresh)
Sticky CTA (Manager create only)
```

| Element | Behavior |
|---------|----------|
| Search | Client-side on return #, from/to branch |
| Status filter | Server via `useReturns(branchId, status)` |
| Manager scope | Assigned `branch_id` only |
| Owner scope | All branches |
| Row tap | Detail screen |

---

## Manager

**Default status:** In transit  
**Chip order:** In transit · All · Received · Discrepancy  
**Primary CTA:** Create return → `/manager/returns/create` (hidden on Main Branch)  
**Row →** `/manager/returns/[id]`

---

## Owner

**Default status:** All  
**Chip order:** All · In transit · Received · Discrepancy  
**Overflow:** Return discrepancies → `/owner/returns/discrepancies`  
**Row →** `/owner/returns/[id]` (receive from detail when in transit)

---

## Related flows (unchanged)

| Flow | Route |
|------|-------|
| Create return | `/manager/returns/create` |
| Owner receive | `/owner/returns/receive/[id]` |
