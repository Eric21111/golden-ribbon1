# Transfers Tab

Shared **Transfer hub** for Owner Transfers and Manager Incoming. Matches Inventory hub patterns (search, chips, sticky CTA, overflow, pull-to-refresh).

| Role | Bottom tab | Route | Screen |
|------|------------|-------|--------|
| Owner | Transfers | `/owner/transfers` | `app/(owner)/owner/transfers/index.tsx` |
| Manager | Incoming | `/manager/incoming` | `app/(manager)/manager/incoming/index.tsx` |

Shared: `src/features/transfers/TransferHub.tsx`

**Tablet:** Manager Incoming uses master–detail + Count & receive when pending. Owner Transfers use centered list only (`enableMasterDetail={false}`).

---

## Shell

```
Header (title + context)     [⋯]
Search
Status chips
Destination chips (Owner only)
Transfer list (pull to refresh)
Sticky primary CTA (Owner only)
```

| Element | Behavior |
|---------|----------|
| Search | Transfer #, from/to branch name (client-side) |
| Status chips | All / Pending / Received / Discrepancy |
| Destination | Owner: selling branches + All (server filter `to_branch_id`) |
| Status filter | Server filter via `useTransfers` |
| Row tap | Stack detail / receive screen |
| Pull to refresh | Refetch list |

---

## Owner — Transfers

**Context:** Main → branches  
**Default status:** All  
**Primary CTA:** Create transfer → `/owner/transfers/create`

**Overflow**

| Label | Destination |
|-------|-------------|
| Transfer discrepancies | `/owner/reports/transfer-discrepancies` |

**Row →** `/owner/transfers/[id]` (read-only detail)

---

## Manager — Incoming

**Context:** Assigned branch name  
**Default status:** Pending (`pending_receipt`) — action queue first  
**No sticky CTA** (managers receive, they don’t send)

**Status chip order:** Pending · All · Received · Discrepancy

**Row →** `/manager/incoming/[id]` (receive flow if pending, else read-only)

---

## Related flows (unchanged Phase 1)

| Flow | Route |
|------|-------|
| Create / review / send | `/owner/transfers/create` |
| Owner detail | `/owner/transfers/[id]` |
| Manager receive / detail | `/manager/incoming/[id]` |

Phase 2 (not in this pass): product search on create, confirm alerts on send/receive.
