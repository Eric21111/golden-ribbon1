-- Drink Choice, Step 3: record the chosen drink on a sale line.
--
-- A meal sold with a drink is ONE sale line (the meal's price is unchanged); the drink chosen is stored on it for
-- history, and the drink's stock is deducted through the normal inventory movements. Two lines of the same meal with
-- different drinks are different lines, so the one-row-per-line uniqueness now includes the drink.
--
-- ADDITIVE: two nullable columns (null on every existing row and on every sale without a drink) and a uniqueness
-- index that is strictly looser than the one it replaces, so no existing row can violate it.

begin;

alter table public.sale_items
  add column if not exists drink_product_id uuid references public.products(id),
  add column if not exists drink_name text;

comment on column public.sale_items.drink_product_id is
  'The drink the cashier chose for this meal line (Drink Choice), if its option includes one. Null otherwise.';
comment on column public.sale_items.drink_name is
  'Snapshot of the chosen drink''s name at sale time.';

create unique index if not exists sale_items_sale_product_variant_drink_idx
  on public.sale_items(
    sale_id,
    product_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(drink_product_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- The previous index (no drink) would reject a second line of the same meal with a different drink.
drop index if exists public.sale_items_sale_product_variant_idx;

commit;
