-- Drink Choice, Step 1: storage for the eligible drinks of a meal variant.
--
-- A meal variant can "include a drink": the cashier picks ONE of its eligible drinks per meal ordered, and that drink
-- comes out of the drink's own stock. This migration only stores which drinks are eligible. Selling them is a later
-- step; nothing reads this table yet.
--
-- ADDITIVE: one new table, new indexes and an access policy. No existing table, column or function changes.

begin;

create table public.product_drink_choices (
  id uuid primary key default gen_random_uuid(),
  -- The meal being sold.
  product_id uuid not null references public.products(id) on delete cascade,
  -- The meal variant that includes a drink. Drink choice is a property of an option, never of the product alone.
  variant_id uuid not null,
  -- The drink the cashier may pick: a real product with its own stock. Cannot be removed while it is offered.
  drink_product_id uuid not null references public.products(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The variant must belong to the meal (the same composite reference product_stock_uses uses).
  constraint product_drink_choices_variant_belongs_to_product_fkey
    foreign key (variant_id, product_id)
    references public.product_variants (id, product_id)
    on delete cascade,
  -- A meal is not its own drink.
  constraint product_drink_choices_not_self_chk check (drink_product_id <> product_id)
);

-- One entry per drink per variant.
create unique index product_drink_choices_variant_drink_key
  on public.product_drink_choices (variant_id, drink_product_id);

create index product_drink_choices_product_idx on public.product_drink_choices (product_id);
create index product_drink_choices_drink_idx on public.product_drink_choices (drink_product_id);

create trigger product_drink_choices_set_updated_at
before update on public.product_drink_choices
for each row execute function public.set_updated_at();

-- Same visibility as the other product master data: any signed-in staff member with a role can read; nobody can
-- write through the API (writes go through the security-definer product RPCs).
alter table public.product_drink_choices enable row level security;

create policy product_drink_choices_select_staff
on public.product_drink_choices for select
to authenticated
using (public.current_user_role() is not null);

revoke all on public.product_drink_choices from public, anon, authenticated;
grant select on public.product_drink_choices to authenticated;

comment on table public.product_drink_choices is
  'Eligible drinks of a meal variant (Drink Choice). The cashier picks one per meal ordered; it is deducted from the drink''s own stock. variant_id is the MASTER variant (product_variants.id).';

commit;
