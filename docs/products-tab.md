# Products Tab

**Manager-only** (Main Branch Manager, via `MainBranchGuard`). Owner and other roles have no Products screen.

| Role | Route | Screen |
|------|-------|--------|
| Manager | `/manager/products` | `app/(manager)/manager/products/index.tsx` |

---

## Shell

```
Header
Search (name or SKU) + status chips (All | Active | Inactive)
Product list (pull to refresh)
Sticky footer: [ Create product ]  [ View branch catalogs ]
```

Row tap opens **Edit product** — the same 3-step wizard as Create, pre-filled (`EditProductWizard`, `src/features/products/EditProductWizard.tsx`).

---

## Create / Edit product — 3-step wizard

Both share the same steps, layout, and pricing modes. Create uses `CreateProductWizard`; Edit uses `EditProductWizard`, pre-filled from the product's current data.

Flow: **Product Information → Variants → Branch Pricing → Create/Save**, with a step indicator (1‑2‑3) and Back/Next at the bottom of the sheet.

1. **Product Information** — Product name, SKU (Create auto-fills it from the name; Edit leaves the existing SKU as typed), Description (optional). Edit also has the **Active** toggle here, gated by the same opening-stock rule as before (`canActivate`). Must pass validation before advancing.
2. **Variants (optional)** — Variant **names only** (e.g. Without Rice, With Rice); add/rename/remove freely. No price entry here — pricing always happens in Step 3. In Edit, removing an existing variant **hard-deletes** it (and its prices on every branch) when saved — there is no undo. New sales already keep their own frozen variant name/price, so past sales are unaffected either way.
3. **Branch Pricing** — segmented control, two modes:
   - **Same for All** (default): one price per variant (or one price if no variants), automatically applied to every selling branch — no per-branch selection.
   - **Different per Branch**: pick one branch at a time (chips) and set its own price per variant; switch branches to configure others, each keeps what was typed.
   Pricing is optional — leaving the price field(s) blank skips branch pricing entirely (Create) or leaves existing branch prices for branches not resubmitted untouched (Edit). If a branch has variants at all, every variant needs a price for that branch (the server enforces this — no partially-priced branch). In Edit, whichever mode has existing prices is pre-selected and pre-filled; if branches already disagree on price, it opens in **Different per Branch** with each branch's real values rather than guessing a shared one.

Both save **atomically** in a single database transaction — `create_complete_product` for Create, `update_complete_product` for Edit — so a failed save never leaves the product half-updated. New products are always created **inactive**; a Main Manager must set opening stock before a product can activate.

---

## Related

`ProductForm` (`src/features/products/ProductForm.tsx`) is no longer used by either flow — kept only because a regression test pins specific strings in it. `src/features/products/productSchema.ts` / `generateSku.ts` are shared helpers.
