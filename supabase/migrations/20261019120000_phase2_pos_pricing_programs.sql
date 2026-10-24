-- Phase 2: POS pricing programs + meal variant hardening.
-- Forward-only additive migration. Does not rewrite historical sales totals.
--
-- BUSINESS RULE FLAG (back_office_guard):
--   Default pricing_mode = 'fixed_unit_price' with fixed_amount = 13
--   meaning EACH line is charged ₱13 (not ₱13 off catalog).
--   Switch to 'amount_off' in sale_pricing_program_settings if ops confirms deduction.
begin;

create type public.sale_pricing_program as enum (
  'standard',
  'employee_meal',
  'pwd',
  'back_office_guard'
);

create table public.sale_pricing_program_settings (
  program public.sale_pricing_program primary key,
  -- pwd: percent off catalog (e.g. 25). Ignored for other programs.
  discount_percent numeric(5,2),
  -- back_office_guard: 'fixed_unit_price' | 'amount_off'
  pricing_mode text,
  fixed_amount numeric(12,2),
  label text not null,
  updated_at timestamptz not null default now(),
  constraint sale_pricing_program_settings_pwd_chk check (
    program <> 'pwd'
    or (discount_percent is not null and discount_percent >= 0 and discount_percent <= 100)
  ),
  constraint sale_pricing_program_settings_guard_chk check (
    program <> 'back_office_guard'
    or (
      pricing_mode in ('fixed_unit_price', 'amount_off')
      and fixed_amount is not null
      and fixed_amount >= 0
    )
  )
);

alter table public.sale_pricing_program_settings enable row level security;
create policy sale_pricing_program_settings_select
  on public.sale_pricing_program_settings for select to authenticated
  using (true);
revoke all on public.sale_pricing_program_settings from public, anon, authenticated;
grant select on public.sale_pricing_program_settings to authenticated;

insert into public.sale_pricing_program_settings(program, discount_percent, pricing_mode, fixed_amount, label)
values
  ('standard', null, null, null, 'Standard'),
  ('employee_meal', null, null, null, 'Employee / guest meal'),
  ('pwd', 25.00, null, null, 'PWD discount'),
  -- FLAG: fixed unit price ₱13 — confirm with business before relying on this.
  ('back_office_guard', null, 'fixed_unit_price', 13.00, 'Back office / security guard');

alter table public.sales
  add column if not exists pricing_program public.sale_pricing_program not null default 'standard',
  add column if not exists catalog_subtotal numeric(12,2),
  add column if not exists discount_amount numeric(12,2) not null default 0
    check (discount_amount >= 0);

comment on column public.sales.pricing_program is
  'Order pricing program. employee_meal is ₱0 revenue with inventory still deducted.';
comment on column public.sales.catalog_subtotal is
  'Pre-program catalog total. Null on historical rows created before Phase 2.';
comment on column public.sales.discount_amount is
  'catalog_subtotal - total_amount (0 when no program discount).';

alter table public.sale_items
  add column if not exists catalog_unit_price numeric(12,2),
  add column if not exists discount_amount numeric(12,2) not null default 0
    check (discount_amount >= 0);

comment on column public.sale_items.catalog_unit_price is
  'Catalog unit price before pricing program. Null on historical rows.';
comment on column public.sale_items.discount_amount is
  'Per-line catalog subtotal minus charged subtotal.';

-- Backfill catalog fields for existing rows (no amount changes).
-- sales_immutable and sale_items_immutable reject every update. Disable them
-- only for this fill of the new columns. total_amount and unit_price stay as stored.
alter table public.sales disable trigger sales_immutable;
alter table public.sale_items disable trigger sale_items_immutable;

update public.sales
set catalog_subtotal = total_amount
where catalog_subtotal is null;

update public.sale_items
set catalog_unit_price = unit_price
where catalog_unit_price is null;

alter table public.sales enable trigger sales_immutable;
alter table public.sale_items enable trigger sale_items_immutable;

-- ---------------------------------------------------------------------------
-- Charged unit price helper
-- ---------------------------------------------------------------------------
create or replace function public.apply_sale_pricing_program(
  p_catalog_unit numeric,
  p_program public.sale_pricing_program
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.sale_pricing_program_settings%rowtype;
  v_pct numeric(5,2);
begin
  if p_catalog_unit is null or p_catalog_unit < 0 then
    raise exception 'Invalid catalog unit price.' using errcode = '22023';
  end if;

  if p_program = 'standard' then
    return round(p_catalog_unit, 2);
  end if;
  if p_program = 'employee_meal' then
    return 0::numeric(12,2);
  end if;

  select * into v_settings
  from public.sale_pricing_program_settings
  where program = p_program;
  if not found then
    raise exception 'Unknown pricing program.' using errcode = '22023';
  end if;

  if p_program = 'pwd' then
    v_pct := coalesce(v_settings.discount_percent, 25);
    return round(p_catalog_unit * (1 - (v_pct / 100.0)), 2);
  end if;

  -- back_office_guard
  if v_settings.pricing_mode = 'amount_off' then
    return round(greatest(0, p_catalog_unit - coalesce(v_settings.fixed_amount, 0)), 2);
  end if;
  -- Default / fixed_unit_price
  return round(coalesce(v_settings.fixed_amount, 13), 2);
end;
$$;

revoke all on function public.apply_sale_pricing_program(numeric, public.sale_pricing_program)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- confirm_sale — pricing programs + require variant when options exist
-- ---------------------------------------------------------------------------
drop function if exists public.confirm_sale(uuid, jsonb, numeric, text);

create function public.confirm_sale(
  p_shift_id uuid,
  p_items jsonb,
  p_amount_paid numeric,
  p_idempotency_key text,
  p_pricing_program text default 'standard'
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_branch uuid;
  v_shift public.shifts%rowtype;
  v_sale public.sales%rowtype;
  v_items jsonb;
  v_item record;
  v_product public.products%rowtype;
  v_branch_product public.branch_products%rowtype;
  v_variant public.branch_product_variants%rowtype;
  v_catalog_price numeric(12,2);
  v_charged_price numeric(12,2);
  v_variant_name text;
  v_stock bigint;
  v_catalog_total numeric(12,2) := 0;
  v_charged_total numeric(12,2) := 0;
  v_program public.sale_pricing_program;
  v_has_variants boolean;
begin
  begin
    v_program := coalesce(nullif(btrim(p_pricing_program), ''), 'standard')::public.sale_pricing_program;
  exception when invalid_text_representation then
    raise exception 'Invalid pricing program.' using errcode = '22023';
  end;

  select * into v_actor
  from public.profiles
  where id = v_user
    and is_active
    and role = 'cashier'
  for update;
  if not found then
    raise exception 'An active Cashier account is required.'
      using errcode = '42501';
  end if;
  v_branch := v_actor.branch_id;

  if p_idempotency_key is null
     or length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid order confirmation key.'
      using errcode = '22023';
  end if;
  if p_amount_paid is null
     or p_amount_paid::text in ('NaN','Infinity','-Infinity')
     or p_amount_paid < 0
     or p_amount_paid > 9999999999.99
     or p_amount_paid <> round(p_amount_paid, 2) then
    raise exception 'Enter a valid payment with at most two decimal places.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'The cart must contain products.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'The cart must contain 1 to 200 products.'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
       or coalesce(v_item.value->>'quantity', '') !~ '^[1-9][0-9]{0,5}$'
       or coalesce(v_item.value->>'product_id', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (
         v_item.value->'variant_id' is not null
         and jsonb_typeof(v_item.value->'variant_id') is distinct from 'null'
         and coalesce(v_item.value->>'variant_id', '') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ) then
      raise exception 'Invalid product, variant, or quantity.'
        using errcode = '22023';
    end if;
  end loop;

  select jsonb_agg(
    jsonb_build_object('product_id', product_id, 'variant_id', variant_id, 'quantity', quantity)
    order by product_id, variant_id
  )
  into v_items
  from (
    select (value->>'product_id')::uuid as product_id,
           nullif(value->>'variant_id', '')::uuid as variant_id,
           sum((value->>'quantity')::bigint) as quantity
    from jsonb_array_elements(p_items)
    group by 1, 2
  ) normalized;

  select * into v_sale
  from public.sales
  where cashier_id = v_user
    and idempotency_key = p_idempotency_key;
  if found then
    if v_sale.shift_id <> p_shift_id
       or v_sale.request_items <> v_items
       or v_sale.amount_paid <> p_amount_paid
       or v_sale.pricing_program is distinct from v_program then
      raise exception 'This confirmation key belongs to a different order.'
        using errcode = '22023';
    end if;
    return v_sale;
  end if;

  if v_branch is null then
    raise exception 'Your assigned branch is unavailable.'
      using errcode = '42501';
  end if;

  -- Revision 7C insertion point (YES): reject when shifts.sales_cutoff_at is set.
  -- Revision 7C insertion point (YES): reject while inventory_reconciliation_required is pending.

  perform public.lock_branch_inventory_gate(v_branch);

  perform 1
  from public.branches
  where id = v_branch
    and is_active
    and not is_main_branch;
  if not found then
    raise exception 'Your assigned branch is unavailable.'
      using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id;
  if not found
     or v_shift.cashier_id <> v_user
     or v_shift.branch_id <> v_branch
     or v_shift.status <> 'open' then
    raise exception 'An open shift belonging to you is required.'
      using errcode = '42501';
  end if;

  -- Stock check (one pool per product — variants never double-deduct).
  for v_item in
    select product_id, sum(quantity) as quantity
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    group by product_id
    order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for share;
    if not found or not v_product.is_active then
      raise exception 'A selected product is inactive or unavailable.'
        using errcode = '22023';
    end if;

    select * into v_branch_product
    from public.branch_products
    where branch_id = v_branch
      and product_id = v_item.product_id
      and is_active
    for share;
    if not found then
      raise exception 'A selected product is not available in this branch catalog.'
        using errcode = '22023';
    end if;

    select quantity_on_hand into v_stock
    from public.branch_inventory
    where branch_id = v_branch
      and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_product.name, coalesce(v_stock, 0), v_item.quantity
        using errcode = '22023';
    end if;
  end loop;

  -- Price + variant requirement
  for v_item in
    select *
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    order by product_id, variant_id
  loop
    select exists (
      select 1
      from public.branch_product_variants bpv
      where bpv.branch_id = v_branch
        and bpv.product_id = v_item.product_id
        and bpv.is_active
    ) into v_has_variants;

    if v_has_variants and v_item.variant_id is null then
      select name into v_variant_name from public.products where id = v_item.product_id;
      raise exception 'Select a meal option (variant) for %.'
        , coalesce(v_variant_name, 'this product')
        using errcode = '22023';
    end if;

    if v_item.variant_id is not null then
      select * into v_variant
      from public.branch_product_variants
      where id = v_item.variant_id
        and branch_id = v_branch
        and product_id = v_item.product_id
        and is_active
      for share;
      if not found then
        raise exception 'A selected variant is not available in this branch catalog.'
          using errcode = '22023';
      end if;
      v_catalog_price := v_variant.selling_price;
    else
      select * into v_branch_product
      from public.branch_products
      where branch_id = v_branch
        and product_id = v_item.product_id;
      v_catalog_price := v_branch_product.selling_price;
    end if;

    v_charged_price := public.apply_sale_pricing_program(v_catalog_price, v_program);
    v_catalog_total := v_catalog_total + v_catalog_price * v_item.quantity;
    v_charged_total := v_charged_total + v_charged_price * v_item.quantity;
  end loop;

  v_catalog_total := round(v_catalog_total, 2);
  v_charged_total := round(v_charged_total, 2);

  if v_charged_total > 9999999999.99 then
    raise exception 'Order total exceeds the supported limit.'
      using errcode = '22023';
  end if;
  if p_amount_paid < v_charged_total then
    raise exception 'Insufficient payment. Total: %, Remaining: %',
      v_charged_total, v_charged_total - p_amount_paid
      using errcode = '22023';
  end if;

  insert into public.sales(
    sale_number, branch_id, shift_id, cashier_id,
    subtotal, total_amount, amount_paid, change_amount,
    pricing_program, catalog_subtotal, discount_amount,
    idempotency_key, request_items
  ) values (
    'SALE-' || lpad(nextval('public.sale_number_seq')::text, 10, '0'),
    v_branch, p_shift_id, v_user,
    v_charged_total, v_charged_total, p_amount_paid, p_amount_paid - v_charged_total,
    v_program, v_catalog_total, greatest(v_catalog_total - v_charged_total, 0),
    p_idempotency_key, v_items
  )
  returning * into v_sale;

  for v_item in
    select *
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    order by product_id, variant_id
  loop
    if v_item.variant_id is not null then
      select * into v_variant
      from public.branch_product_variants
      where id = v_item.variant_id;
      v_catalog_price := v_variant.selling_price;
      v_variant_name := v_variant.name;
    else
      select * into v_branch_product
      from public.branch_products
      where branch_id = v_branch
        and product_id = v_item.product_id;
      v_catalog_price := v_branch_product.selling_price;
      v_variant_name := null;
    end if;

    v_charged_price := public.apply_sale_pricing_program(v_catalog_price, v_program);

    insert into public.sale_items(
      sale_id, product_id, variant_id, variant_name, quantity,
      catalog_unit_price, unit_price, discount_amount, subtotal
    ) values (
      v_sale.id,
      v_item.product_id,
      v_item.variant_id,
      v_variant_name,
      v_item.quantity,
      v_catalog_price,
      v_charged_price,
      greatest((v_catalog_price - v_charged_price) * v_item.quantity, 0),
      v_item.quantity * v_charged_price
    );
  end loop;

  for v_item in
    select product_id, sum(quantity) as quantity
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    group by product_id
    order by product_id
  loop
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity
    where branch_id = v_branch
      and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity;
    if not found then
      raise exception 'Insufficient stock during sale processing.' using errcode = '22023';
    end if;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by
    ) values (
      v_branch, v_item.product_id, 'sale', -v_item.quantity,
      'sale', v_sale.id, v_user
    );
  end loop;

  return v_sale;
end;
$$;

revoke all on function public.confirm_sale(uuid, jsonb, numeric, text, text) from public, anon;
grant execute on function public.confirm_sale(uuid, jsonb, numeric, text, text) to authenticated;

comment on function public.confirm_sale(uuid, jsonb, numeric, text, text) is
  'Confirm POS sale. Optional p_pricing_program: standard|employee_meal|pwd|back_office_guard. Variants share one product stock pool.';

-- ---------------------------------------------------------------------------
-- POS inventory: order variants by master sort_order then name
-- ---------------------------------------------------------------------------
create or replace function public.list_cashier_pos_inventory()
returns table (
  branch_id uuid,
  branch_name text,
  product_id uuid,
  product_name text,
  product_sku text,
  selling_price numeric,
  quantity_on_hand numeric,
  updated_at timestamptz,
  variants jsonb,
  inventory_mode public.inventory_mode
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_branch_id uuid;
begin
  select * into v_user from public.profiles where id = auth.uid() and is_active;
  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  select s.branch_id into v_branch_id
  from public.shifts s
  where s.cashier_id = v_user.id and s.status = 'open'
  order by s.started_at desc
  limit 1;
  if v_branch_id is null then
    v_branch_id := v_user.branch_id;
  end if;
  if v_branch_id is null or v_branch_id is distinct from v_user.branch_id then
    raise exception 'No authorized branch is assigned to this cashier.' using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.name,
    p.id,
    p.name,
    p.sku,
    bp.selling_price,
    coalesce(bi.quantity_on_hand, 0),
    coalesce(bi.updated_at, bp.updated_at),
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', bpv.id, 'name', bpv.name, 'selling_price', bpv.selling_price)
        order by coalesce(pv.sort_order, 2147483647), bpv.name, bpv.id
      )
      from public.branch_product_variants bpv
      left join public.product_variants pv
        on pv.product_id = bpv.product_id
       and lower(pv.name) = lower(bpv.name)
      where bpv.branch_id = bp.branch_id
        and bpv.product_id = bp.product_id
        and bpv.is_active
    ), '[]'::jsonb),
    p.inventory_mode
  from public.branch_products bp
  join public.products p on p.id = bp.product_id
  join public.branches b on b.id = bp.branch_id
  left join public.branch_inventory bi
    on bi.product_id = bp.product_id and bi.branch_id = bp.branch_id
  where bp.branch_id = v_branch_id
    and bp.is_active
    and p.is_active
    and b.is_active
    and not b.is_main_branch
  order by p.name, p.id;
end;
$$;

revoke all on function public.list_cashier_pos_inventory() from public, anon;
grant execute on function public.list_cashier_pos_inventory() to authenticated;

commit;
