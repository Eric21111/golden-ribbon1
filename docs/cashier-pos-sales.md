# Cashier POS & Sales

Cashier shift sales flow. End shift lives on **Home** only (not POS).

| Screen | Route | File |
|--------|-------|------|
| Point of Sale | `/cashier/pos` | `app/(cashier)/cashier/pos.tsx` |
| Checkout | `/cashier/payment` | `app/(cashier)/cashier/payment.tsx` |
| Current Shift Sales | `/cashier/sales` | `app/(cashier)/cashier/sales.tsx` |
| Sale detail | `/cashier/sales/[id]` | `app/(cashier)/cashier/sales/[id].tsx` |

Shared: `PosProductCard`, `PosOrderPane`, `OrderSummary`, `SaleListItem` under `src/features/pos/`. Cart: `cartStore`. Confirm sale: `checkoutStore`.

Layout helpers: `src/lib/layout.ts` (`useLayout`, tablet when shortest edge ≥ 600), `ConstrainedWidth`.

Requires an **active shift**; otherwise redirects to Home.

---

## Point of Sale

### Phone
1. Header + search (name / SKU)
2. Single-column `FlatList` + pull-to-refresh
3. Sticky footer: item count + total, Clear order, **CHECKOUT**

### Tablet
Full-width **split**:
- **Left (~65%):** search + product **grid** (2 cols, or 3 when width ≥ 1100)
- **Right (~35%, max 420):** `PosOrderPane` — live line items with ±, Clear, **CHECKOUT**

Stock deducts only after confirmed checkout. No END SHIFT on this screen.

---

## Checkout

Centered column on tablet (`paymentMaxWidth` 520).

1. Scrollable review: live price refresh, `OrderSummary`, Money Given
2. Sticky footer: **CONFIRM SALE** / retry, Back to order
3. Confirm dialog before first submit (total, money given, change)
4. Success modal → DONE clears cart and returns to POS

Query invalidation via `invalidateCompletedSaleQueries` (inventory, shift-sales, shifts summaries, dashboards).

---

## Current Shift Sales

Hub for **this shift only** (`listShiftSales`).

### Phone
Search + `FlatList` → push `/cashier/sales/[id]`

### Tablet
**Master–detail:** list (~360px) | `SaleDetailsBody` pane. Row select highlights; first filtered sale auto-selected.

No create CTA (sales are created from POS).
