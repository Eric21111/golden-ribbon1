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

Row tap opens the **Edit product** bottom sheet (`ProductForm`, single page: info, branch price per branch, Active toggle once opening stock exists).

---

## Create product — 3-step wizard

**Primary CTA:** Create product → bottom sheet modal (`CreateProductWizard`, `src/features/products/CreateProductWizard.tsx`).

Flow: **Product Information → Variants → Branch Pricing → Create product**, with a step indicator (1‑2‑3) and Back/Next at the bottom of the sheet.

1. **Product Information** — Product name, SKU (auto-filled from name, editable), Description (optional). Must pass validation before advancing.
2. **Variants (optional)** — Variant **names only** (e.g. Without Rice, With Rice); add/remove freely. No price entry here.
3. **Branch Pricing** — Pick a selling branch (chips); if there are variants, set a price per variant for that branch (any can be left blank); if not, set one branch price. Switching branches keeps prices already typed for each one, so pricing for other branches can be added without losing work. Setting a price is optional — the product can be created with none set and priced later from branch catalogs.

New products are always created **inactive**; a Main Manager must set opening stock before a product can activate.

---

## Related

`ProductForm` (`src/features/products/ProductForm.tsx`) is still used for **Edit** only. `src/features/products/productSchema.ts` / `generateSku.ts` are shared helpers.
