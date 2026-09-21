begin;

-- ============================================================================
-- Milestone 12.6 — Prevent accidental duplicate base products
-- ============================================================================
-- Investigation summary (see delivery notes): no code path in the Branch
-- Catalog/Pricing screen, branchProductService, configure_branch_products, or
-- configure_branch_product_variants ever inserts into public.products — FK
-- constraints make branch_products/branch_product_variants rows structurally
-- incapable of creating a parent product. The observed "Longsilog" /
-- "Longsilog-2" duplicate is two separate rows in public.products itself
-- (different SKUs, same name), which the SKU uniqueness index does not catch.
--
-- This guards against that exact failure mode: a duplicate base product
-- created (accidentally or otherwise) with the same name as an existing one.
-- It does not change any pricing/branch-catalog behavior.
create unique index products_name_unique_ci on public.products (lower(trim(name)));

comment on index public.products_name_unique_ci is
  'Prevents two base products from sharing a display name (case/whitespace-insensitive). Same-name pricing variations belong in product_variants / branch_product_variants, not a second products row.';

commit;
