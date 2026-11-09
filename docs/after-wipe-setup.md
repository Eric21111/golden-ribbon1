# After the wipe: what to do, in order

Production now has two accounts and the Main Branch. Do not run the wipe script again.

Sign-in names from the preview:

- **Admin** — Owner
- **manager** — Main Branch Manager

Finish each section before the next one. The checkout tests at the end need a selling branch, a cashier, a product, and stock at that branch.

## 1. Confirm the two accounts

1. Sign in as **Admin**. You should land on the Owner dashboard.
2. Sign out.
3. Sign in as **manager**. You should land on the Main Branch Manager dashboard.
4. The manager home should show **Products**, **Branches**, **Transfers**, and **Stock returns**.

## 2. Create one selling branch

Stay signed in as **Admin** (Owner). The Owner creates, edits, and deactivates selling branches (soft-deactivate via Active). The Main Branch Manager can view branches but cannot change them.

1. Open **Branches** from the Owner sidebar or Administration on the dashboard.
2. Create one selling branch. Give it a real name and a short code.
3. Leave it active. Selling branches use cashier confirmation for incoming stock.
4. Confirm the list shows **Main Branch** and this new branch. Tap a selling branch to edit if needed.
5. Sign out, then sign in as **manager** for the next sections.

## 3. Create one product

Stay signed in as **manager**.

1. Open **Products**.
2. Create one simple product with a name, SKU, and selling price.
3. Save.
4. Confirm that product appears in the product list.

This covers: create a product and see it in the manager list.

## 4. Set opening stock on Main Branch

Stay signed in as **manager**.

1. Open **Inventory**.
2. Set an opening quantity for the new product on **Main Branch**. Use at least **5** so the later tests have stock to send and sell.
3. Confirm Main Branch inventory shows that quantity.

## 5. Create a cashier

Sign out, then sign in as **Admin**.

1. Open **Employees**.
2. Create one **Cashier**.
3. Assign that cashier to the selling branch from section 2, not to Main Branch.
4. Set a password you can type on the device, and leave the cashier active.
5. Confirm the employee list shows Admin, manager, and this cashier.

## 6. Send stock to the selling branch

Sign out, then sign in as **manager**.

1. Open **Transfers**.
2. Send the product to the selling branch. Send **4**. Leave **1** on Main Branch.
3. Confirm the transfer is waiting for the cashier to receive it.

## 7. Receive the stock

Sign out, then sign in as the **cashier**.

1. Open **Incoming shipments**.
2. Confirm the shipment arrived as sent.
3. The selling branch should now have **4** of the product.

## 8. Start a shift

Stay signed in as the **cashier**.

1. On the cashier dashboard, start a shift.
2. Open the POS. The product from section 3 should be listed.

## 9. Add to order, then leave

Stay on the POS.

1. Tap the product and add it with **Add to Order**.
2. Close that sheet without going to payment.
3. The POS should still respond: you can scroll and tap the product again.

This covers: open Add Order, exit, and the screen stays responsive.

## 10. Clear the order

The clear control asks twice. Nothing is sold.

1. Open **View Order**.
2. Tap **Clear order**.
3. Tap **Clear order now**.
4. The order should be empty.
5. Open **View Order** again and confirm it is still empty.

This covers: tap Clear Order twice and the cart is empty.

## 11. Open the payment screen

1. Add **1** of the product again.
2. Continue to the payment screen.
3. Tap the amount field, the number keys, and the back or cancel control. Each one should respond.
4. Do not complete payment yet if you still need the clear-order check above. If you already cleared the order, this is the first real sale path.

This covers: payment controls are clickable.

## 12. Complete a normal sale

1. With **1** in the order, enter an amount that covers the total.
2. Confirm the sale.
3. The receipt should show that product, quantity **1**, and the total you were charged.
4. Sign in as **manager** and open the selling branch inventory. The quantity should be **3** (4 received, minus 1 sold).

This covers: normal checkout, receipt, and stock deduction.

## 13. Reject a sale that asks for too much stock

Sign back in as the **cashier**. The shift should still be open.

1. Add a quantity **higher than the stock left** (more than 3 if section 12 sold 1).
2. Try to complete payment.
3. The sale should be rejected, and the stock quantity should stay the same.

This covers: checkout with insufficient stock.

## 14. Submit a return

Stay signed in as the **cashier**, with the shift still open and at least **1** left in stock.

1. Open the return screen.
2. Return **1** of the product.
3. Read the confirmation before you accept it. The quantity should be **1**, and the product name should match.
4. After it is saved, selling-branch stock should drop by **1**. Main Branch stock does not increase from this step.

This covers: submit a return and check the confirmation values.

## 15. Open Shift Remittance Detail

1. As the **cashier**, finish **End Shift** and complete the remittance.
2. Sign in as **Admin** or **manager**.
3. Open **Reports**, then **Shift remittances**, then that shift.

If the detail screen opens and shows the cash and product counts from the remittance, this check passes.

If it says the report function is missing, the shift-remittance migration is not on production yet. Stop there. Do not guess quantities from another screen.
