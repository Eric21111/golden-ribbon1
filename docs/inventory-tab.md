# Inventory Tab

Shared **Inventory hub** for Owner and Manager. Cashier has no Inventory tab.

HCI focus: aesthetic & minimalist — one sticky primary action, search + light chips, rare actions in overflow, detail in a bottom sheet (phone) or detail pane (tablet).

| Role | Route | Screen |
|------|-------|--------|
| Owner | `/owner/inventory` | `app/(owner)/owner/inventory/index.tsx` |
| Manager | `/manager/inventory` | `app/(manager)/manager/inventory.tsx` |

Shared: `src/features/inventory/InventoryHub.tsx`

**Tablet:** master–detail (list | `InventoryProductDetails`) for Manager. Owner uses centered list + sheet (`enableMasterDetail={false}`).

---

## Shell (both roles)

```
Header (title + context)     [⋯]
Search
Filter chips
Product list (pull to refresh)
Sticky primary CTA
```

| Element | Behavior |
|---------|----------|
| Search | Name or SKU, client-side |
| Chips | All · In stock · Low · Out (+ Not set for Owner) |
| Low stock | Qty ≤ 5 and initialized |
| Row tap | Product bottom sheet |
| ⋯ | Overflow action sheet |
| Pull to refresh | Refetch inventory |

---

## Owner

**Context:** Main Branch  
**Primary CTA / sheet action:** Send stock → `/owner/transfers/create`

**Overflow**

| Label | Destination |
|-------|-------------|
| Set up opening stock | `/owner/inventory/setup` |
| Inventory history | `/owner/movements` |
| Inventory by branch | `/owner/inventory-by-branch` |
| Inventory reconciliation | `/owner/reports/inventory-reconciliation` |

---

## Manager

**Context:** Assigned branch name  
**Primary CTA / sheet action:** Return unsold stock → `/manager/returns/create`

**Overflow**

| Label | Destination |
|-------|-------------|
| Return history | `/manager/returns` |
| Inventory history | `/manager/movements` |

---

## Product sheet

Shows name, SKU, on-hand qty, status, price, last updated.  
Primary action matches the role CTA above. Qty is not edited here (ledger flows only).
