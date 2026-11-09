# Cashier POS & Sales

Cashier shift sales flow. End shift lives on **Home** only (not POS).

| Screen | Route | File |
|--------|-------|------|
| Point of Sale | `/cashier/pos` | `app/(cashier)/cashier/pos.tsx` |
| Order Summary / Checkout | `/cashier/payment` | `app/(cashier)/cashier/payment.tsx` |
| Current Shift Sales | `/cashier/sales` | `app/(cashier)/cashier/sales.tsx` |
| Sale detail | `/cashier/sales/[id]` | `app/(cashier)/cashier/sales/[id].tsx` |

Order flow: **Select Item → Add to Order → View Order → Confirm Order → Order Summary → Checkout**. "Checkout" is reserved for the final payment/transaction step; everything before that is order building.

Shared: `PosProductRow`, `PosItemSheet`, `PosOrderPane`, `PosViewOrderSheet`, `PosOrderLine`, `OrderSummary` under `src/features/pos/`. Cart: `cartStore`. Confirm sale: `checkoutStore`. (`PosProductCard` is unused legacy code kept for its regression test.)

Layout helpers: `src/lib/layout.ts` (`useLayout`, tablet when shortest edge ≥ 600), `ConstrainedWidth`.

Requires an **active shift**; otherwise redirects to Home.

---

## Point of Sale

Single-column list of separate cards (icon chip + Name/Price on line 1, muted "Available: N" on line 2), gap between cards, paginated 10 items per page (`Pagination`, `useClientPagination`) to minimize scrolling. Tapping a card opens `PosItemSheet` — a bottom sheet with SKU, quantity stepper, variant/option picker and a live subtotal, then **Add to Order**.

### Phone
1. Header + search (name / SKU)
2. Single-column `FlatList` of `PosProductRow` cards + pull-to-refresh, paginated footer ("Page X of Y" + Prev/Next)
3. Sticky footer: item count + total, **VIEW ORDER** (opens `PosViewOrderSheet` — a bottom sheet with per-line ± quantity, an explicit remove button (`PosOrderLine`), Clear order, and **Confirm Order** → pushes `/cashier/payment`)

### Tablet
Full-width **split**:
- **Left (~65%):** search + paginated product list
- **Right (~35%, max 420):** `PosOrderPane` — always-visible live line items with ± quantity, remove, Clear, **Confirm Order** → pushes `/cashier/payment`

Stock deducts only after checkout is confirmed on the Order Summary screen. No END SHIFT on this screen.

---

## Order Summary / Checkout

Centered column on tablet (`paymentMaxWidth` 520). Read-only review — editing happens back on POS via View Order.

1. Scrollable review: live price refresh, `OrderSummary`, Money Given
2. Sticky footer: **Checkout** / retry, Back to order
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
