-- Shared inventory, Step 1: public.product_stock_uses
--
-- Stores which inventory products one unit of a sold product (or one of its variants) uses, and how many
-- whole stock units each. Example (Egg tracked in half-egg units): Chicken Curry / Viand Only uses Egg x1,
-- Tapa uses Egg x2, "Extra Egg" uses Egg x2 (its own pool). Every use deducts from the same branch_inventory
-- row of the ingredient product.
--
-- ADDITIVE ONLY. This migration creates one table and a few indexes. It does not change confirm_sale, the POS,
-- the product-saving RPCs, branch_inventory, inventory_movements, sales or any existing data. Nothing reads this
-- table yet; later steps wire it into confirm_sale and the product RPCs.

begin;

-- ---------------------------------------------------------------------------
-- 1) Allow a (variant, product) composite reference
-- ---------------------------------------------------------------------------
-- product_variants.id is already unique, so this index adds no new restriction on existing rows. It lets
-- product_stock_uses prove that a variant really belongs to the product it is attached to.
create unique index if not exists product_variants_id_product_id_key
  on public.product_variants (id, product_id);

-- ---------------------------------------------------------------------------
-- 2) Table
-- ---------------------------------------------------------------------------
create table public.product_stock_uses (
  id uuid primary key default gen_random_uuid(),
  -- The product being sold.
  product_id uuid not null references public.products(id) on delete cascade,
  -- NULL = the product-level configuration (a product with no variants, or the default for variants that
  -- have no lines of their own). Otherwise the variant these lines belong to.
  variant_id uuid,
  -- The inventory product whose stock is used. May be the sold product itself (e.g. BBQ uses BBQ x3).
  ingredient_product_id uuid not null references public.products(id) on delete restrict,
  -- Whole stock units of the ingredient used per ONE sold unit. Stock is whole numbers (see
  -- branch_inventory), so a half-egg is expressed by tracking Egg in half-egg units.
  quantity integer not null check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A variant must belong to the same product. With a NULL variant_id the constraint is not checked, which is
  -- exactly the product-level case.
  constraint product_stock_uses_variant_belongs_to_product_fkey
    foreign key (variant_id, product_id)
    references public.product_variants (id, product_id)
    on delete cascade
);

-- One line per ingredient in any single configuration. Two partial indexes because NULL variant_id values
-- are never equal to each other in a plain unique constraint.
create unique index product_stock_uses_product_level_key
  on public.product_stock_uses (product_id, ingredient_product_id)
  where variant_id is null;

create unique index product_stock_uses_variant_key
  on public.product_stock_uses (variant_id, ingredient_product_id)
  where variant_id is not null;

-- Lookups the sale path will need, and the foreign-key checks on delete.
create index product_stock_uses_product_idx
  on public.product_stock_uses (product_id);

create index product_stock_uses_ingredient_idx
  on public.product_stock_uses (ingredient_product_id);

create trigger product_stock_uses_set_updated_at
before update on public.product_stock_uses
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Access control
-- ---------------------------------------------------------------------------
-- Same visibility as product_variants (product master data): any signed-in staff member with a role can read.
-- There are no write grants and no write policies: nothing can insert, update or delete through the API yet.
-- Writes will arrive through security-definer RPCs in a later step.
alter table public.product_stock_uses enable row level security;

create policy product_stock_uses_select_staff
on public.product_stock_uses for select
to authenticated
using (public.current_user_role() is not null);

revoke all on public.product_stock_uses from public, anon, authenticated;
grant select on public.product_stock_uses to authenticated;

comment on table public.product_stock_uses is
  'Inventory products used per sold unit of a product or variant (shared inventory). variant_id NULL = product-level configuration. quantity is whole stock units of the ingredient; Egg is tracked in half-egg units. Not used by confirm_sale yet.';
comment on column public.product_stock_uses.variant_id is
  'NULL for the product-level configuration; otherwise a variant of product_id (enforced by a composite foreign key).';
comment on column public.product_stock_uses.ingredient_product_id is
  'The product whose branch_inventory stock is used. May equal product_id (the sold product''s own pool).';
comment on column public.product_stock_uses.quantity is
  'Whole stock units of the ingredient used per ONE sold unit (1-99).';

commit;
