# Home Tab

Role-specific **command centers**. Day-to-day CRUD lives in bottom tabs; Home focuses on metrics, reports, and exceptions.

| Role | Route | Screen |
|------|-------|--------|
| Owner | `/owner/dashboard` | `app/(owner)/owner/dashboard.tsx` |
| Manager | `/manager/dashboard` | `app/(manager)/manager/dashboard.tsx` |
| Cashier | `/cashier/dashboard` | `app/(cashier)/cashier/dashboard.tsx` |

Related: `src/features/auth/roleRoutes.ts`, `src/components/RoleNavigation.tsx`

Pull-to-refresh via `Screen` `onRefresh` / `refreshing`. Log out lives on **Profile** only (not Home).

---

## Owner Home

**Sections**

| Section | Grid / content |
|---------|----------------|
| Business Snapshot | 2 × 2 metrics |
| Sales & Performance | 2 × 2 + Shift History + Audit History |
| Inventory | 2 × 2 (non-tab destinations) |
| Needs Attention | Alert cards only when count > 0; else quiet “Nothing needs attention” |

Quick Access removed (tabs cover Inventory / Transfers / Branches / Products / Employees / Profile).

**Tablet:** centered ~640 column (`Screen constrain`). No master–detail splits (Owner is supervisory).

**Leads to**

| Section | Label | Destination |
|---------|-------|-------------|
| Snapshot | Today's Sales / Orders Today | `/owner/sales` |
| Snapshot | Active Branches | `/owner/branches` |
| Snapshot | Active Products | `/owner/products` |
| Sales | Sales by Branch | `/owner/reports/sales-by-branch` |
| Sales | Product Sales Summary | `/owner/reports/product-sales` |
| Sales | Branch Performance | `/owner/reports/branch-performance` |
| Sales | Sales History | `/owner/sales` |
| Sales | Shift History | `/owner/shifts` |
| Sales | Audit History | `/owner/audit` |
| Inventory | Inventory by Branch | `/owner/inventory-by-branch` |
| Inventory | Inventory Reconciliation | `/owner/reports/inventory-reconciliation` |
| Inventory | Inventory History | `/owner/movements` |
| Inventory | Stock Returns | `/owner/returns` |
| Attention | Pending Transfers | `/owner/transfers` |
| Attention | Pending Return Receipts | `/owner/returns` |
| Attention | Transfer Discrepancies | `/owner/reports/transfer-discrepancies` |
| Attention | Return Discrepancies | `/owner/reports/return-discrepancies` |

---

## Manager Home

**Sections**

| Section | Content |
|---------|---------|
| Branch Snapshot | Today's Sales, Orders Today, Products in stock, Pending incoming |
| Sales | Product sales, Sales history, Shift history, Recent sales preview |
| Needs Attention | Pending incoming / returns in transit only when count > 0 |
| Inventory | Stock returns, Inventory history |

**Tablet:** content capped/centered via `ConstrainedWidth` (~640). Same sectioned dashboard; 2-up cards unchanged.

Products / Profile / Log out removed (tabs cover them).

---

## Cashier Home

**Content**

1. Shift status (start or active shift + running Orders / Total sales from `get_shift_summary`)
2. Actions: **OPEN POS** (primary) → Current Shift Sales → **END SHIFT** (Home only; not on POS)
3. Shift History card

Profile and Log out removed (Profile tab). Pull-to-refresh refetches active shift and summary.

| Label | Destination |
|-------|-------------|
| START SHIFT | `/cashier/pos` (`replace` after success) |
| OPEN POS | `/cashier/pos` |
| CURRENT SHIFT SALES | `/cashier/sales` |
| END SHIFT | confirm; optional View Details → `/cashier/shifts/{id}` |
| Shift History | `/cashier/shifts` |

**Tablet:** content capped/centered via `ConstrainedWidth` (~640). Same single-column shift card (not a dashboard grid).

Related: `docs/cashier-pos-sales.md`
