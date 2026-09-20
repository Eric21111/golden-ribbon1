# Golden Ribbon — Manual Test Checklist

Mark items with `[x]` when done. Leave `[ ]` if not tested / failed.

| Field | Value |
| --- | --- |
| Tester | |
| Date | |
| Build (Expo Go / APK / commit) | |
| Overall | Pass / Fail |

---

## Setup

- [ x] App opens (Expo Go or APK)
- [ x] Login works with valid credentials
- [ x] Wrong password shows clear error
- [ x] Accounts ready: Owner, Main Manager, Branch 1 Manager, Cashier (Branch 1)

---

## 1. Owner

- [ x] Login lands on Owner Home
- [ x] Account shows role Owner / all branches
- [ x] Create Main Branch Manager (Main Branch)
- [ x] Create Selling Manager (Branch 1)
- [ x] Create Cashier (Branch 1 only; Main not selectable)
- [ x] Employee list shows correct roles / emails / Active
- [ x] Owner cannot access POS / send transfer / opening stock
- [ x] Logout works

---

## 2. Main Branch Manager

- [ x] Login lands on Manager Home (drawer available)
- [ x] Products: view / create / edit active products
- [ x] Branches: Main + selling branches visible
- [ x] Branch Catalog: enable products for Branch 1 → Save
- [ x] Opening stock: set quantities → Confirm
- [ x] Inventory shows correct opening quantities
- [ x] Same product cannot be initialized again
- [ x] Send transfer to Branch 1 with quantities → Confirm
- [ x] Transfer appears as Pending
- [ x] Main Branch stock decreases after send
- [ x] Only catalog-enabled products are sendable

---

## 3. Selling Branch Manager (Branch 1)

- [ ] Login lands on Manager Home (no ops drawer)
- [ ] Home shows pending incoming
- [ ] Incoming: open pending transfer
- [ ] Receive with matching quantities → Confirm
- [ ] Transfer becomes Received
- [ ] Branch 1 inventory increases by received qty
- [ ] Same transfer cannot be received twice
- [ ] Cannot open Products / Opening stock / Send transfer / Catalog
- [ ] *(Optional)* Short receive creates discrepancy status

---

## 4. Cashier (Branch 1)

- [ ] Login lands on Cashier Home
- [ ] POS blocked when no active shift
- [ ] Start Shift works when stock exists
- [ ] All OOS → cannot start / open POS
- [ ] Some OOS → warning lists products, can Continue
- [ ] POS shows in-stock items by default
- [ ] OOS only appears when searched (at bottom)
- [ ] Add/remove cart qty; cannot exceed on-hand
- [ ] Stock does **not** drop until sale confirm
- [ ] Checkout: pay ≥ total, change correct
- [ ] Confirm sale succeeds; cart clears
- [ ] Sales tab shows the sale for this shift
- [ ] Home totals update after sale
- [ ] End Shift blocked if cart unfinished
- [ ] End Shift succeeds; summary shown

Suggested sale: Chicken ×2 + Beef ×1, pay 500 → verify total/change.

---

## 5. Returns (optional)

- [ ] Branch Manager creates return → Branch 1 stock ↓
- [ ] Main stock unchanged while In Transit
- [ ] Main Manager receives return → Main stock ↑
- [ ] Branch Manager cannot receive returns
- [ ] *(Optional)* Count mismatch creates discrepancy

---

## 6. Owner closeout

- [ ] Home shows today’s sale / revenue
- [ ] Reports → Sales by branch includes Branch 1
- [ ] Reports → Product sales match sold items
- [ ] Inventory by branch looks correct after transfer/sale/return
- [ ] Discrepancy reports show intentional shorts only
- [ ] Cannot deactivate cashier with open shift

---

## Smoke path (short)

- [ ] Owner creates 3 staff
- [ ] Main Manager: catalog → opening stock → send transfer
- [ ] Branch Manager: receive transfer
- [ ] Cashier: start shift → 1 sale → end shift
- [ ] Owner reports show Branch 1 sale

---

## Notes / bugs found

<!-- Write issues here. Example:
- [BUG] Cashier can open POS without shift
-->

-
-
-
