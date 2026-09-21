begin;

-- ============================================================================
-- Milestone 12.2 — Branch product variants + transfer-driven branch catalog
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Branch product variants
-- ----------------------------------------------------------------------------

create table public.branch_product_variants (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null,
  product_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 60),
  selling_price numeric(12,2) not null check (selling_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, product_id, name),
  foreign key (branch_id, product_id)
    references public.branch_products(branch_id, product_id) on delete cascade
);

create index branch_product_variants_product_id_idx
  on public.branch_product_variants(product_id);

create trigger branch_product_variants_set_updated_at
before update on public.branch_product_variants
for each row execute function public.set_updated_at();

alter table public.branch_product_variants enable row level security;

create policy branch_product_variants_select_authorized
on public.branch_product_variants for select
to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or (
    public.current_user_role() = 'manager'
    and branch_id = public.current_user_branch_id()
  )
);

revoke all on public.branch_product_variants from public, anon, authenticated;
grant select on public.branch_product_variants to authenticated;

comment on table public.branch_product_variants is
  'Named price variants of a branch_products entry (e.g. "With Rice" / "Without Rice"). Inventory stays on the base product; only pricing branches by variant.';

-- Main Branch Managers are the only operational administrators allowed to
-- create, reprice, enable, or disable branch product variants.
create or replace function public.configure_branch_product_variants(
  p_branch_id uuid,
  p_product_id uuid,
  p_variants jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  perform 1
  from public.branches b
  where b.id = p_branch_id
    and b.is_active
    and not b.is_main_branch
  for share;
  if not found then
    raise exception 'Catalog branch is missing, inactive, or is the Main Branch.'
      using errcode = '22023';
  end if;

  perform 1
  from public.branch_products bp
  where bp.branch_id = p_branch_id
    and bp.product_id = p_product_id
  for share;
  if not found then
    raise exception 'Configure the branch catalog price for this product before adding variants.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_variants) is distinct from 'array'
     or jsonb_array_length(p_variants) not between 1 and 50 then
    raise exception 'Provide 1 to 50 variants.'
      using errcode = '22023';
  end if;

  if (select count(*) from jsonb_array_elements(p_variants)) <>
     (select count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(p_variants)) then
    raise exception 'Each variant name may appear only once.'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_variants) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
       or char_length(trim(coalesce(v_item.value->>'name', ''))) not between 1 and 60
       or coalesce(v_item.value->>'selling_price', '') !~
         '^[0-9]{1,10}(\.[0-9]{1,2})?$'
       or jsonb_typeof(v_item.value->'is_active') is distinct from 'boolean' then
      raise exception 'Each variant requires a name, non-negative price with at most two decimals, and active status.'
        using errcode = '22023';
    end if;
  end loop;

  for v_item in
    select *
    from jsonb_to_recordset(p_variants)
      as x(name text, selling_price numeric, is_active boolean)
  loop
    insert into public.branch_product_variants(
      branch_id, product_id, name, selling_price, is_active
    ) values (
      p_branch_id, p_product_id, trim(v_item.name), v_item.selling_price, v_item.is_active
    )
    on conflict (branch_id, product_id, name) do update
    set selling_price = excluded.selling_price,
        is_active = excluded.is_active;
  end loop;
end;
$$;

revoke all on function public.configure_branch_product_variants(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.configure_branch_product_variants(uuid, uuid, jsonb)
  to authenticated;

-- sale_items: preserve historical variant identity + price. A product may now
-- appear more than once per sale (one line per distinct variant), so the old
-- one-row-per-product constraint is replaced with one row per product+variant
-- (NULL variant treated as a single slot via the coalesce sentinel below).
alter table public.sale_items
  add column variant_id uuid references public.branch_product_variants(id) on delete set null,
  add column variant_name text;

alter table public.sale_items
  drop constraint sale_items_sale_id_product_id_key;

create unique index sale_items_sale_product_variant_idx
  on public.sale_items(
    sale_id,
    product_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

comment on column public.sale_items.variant_id is
  'Branch product variant selected for this line, if any. May become null if the variant record is later removed; variant_name preserves history.';
comment on column public.sale_items.variant_name is
  'Snapshot of the variant name at sale time. Null for single-price (no-variant) lines.';

-- ----------------------------------------------------------------------------
-- confirm_sale — variant-aware checkout. Cart lines are keyed by
-- (product_id, variant_id); inventory is decremented once per product,
-- aggregated across every variant line for that product.
-- ----------------------------------------------------------------------------

create or replace function public.confirm_sale(
  p_shift_id uuid,
  p_items jsonb,
  p_amount_paid numeric,
  p_idempotency_key text
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
  v_price numeric;
  v_variant_name text;
  v_stock bigint;
  v_total numeric := 0;
begin
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
       or v_sale.amount_paid <> p_amount_paid then
      raise exception 'This confirmation key belongs to a different order.'
        using errcode = '22023';
    end if;
    return v_sale;
  end if;

  perform 1
  from public.branches
  where id = v_branch
    and is_active
    and not is_main_branch
  for share;
  if not found then
    raise exception 'Your assigned branch is unavailable.'
      using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;
  if not found
     or v_shift.cashier_id <> v_user
     or v_shift.branch_id <> v_branch
     or v_shift.status <> 'open' then
    raise exception 'An open shift belonging to you is required.'
      using errcode = '42501';
  end if;

  -- Pass 1: per product (aggregated across any variant lines), lock and
  -- validate the product, branch catalog entry, and available stock.
  -- Deterministic product order preserves the existing deadlock protections.
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

  -- Pass 2: per line (product + optional variant), resolve the authoritative
  -- price — the variant price when a valid active variant is selected,
  -- otherwise the branch catalog price — and accumulate the order total.
  for v_item in
    select *
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    order by product_id, variant_id
  loop
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
      v_price := v_variant.selling_price;
    else
      select * into v_branch_product
      from public.branch_products
      where branch_id = v_branch
        and product_id = v_item.product_id;
      v_price := v_branch_product.selling_price;
    end if;

    v_total := v_total + v_price * v_item.quantity;
  end loop;

  if v_total > 9999999999.99 then
    raise exception 'Order total exceeds the supported limit.'
      using errcode = '22023';
  end if;
  if p_amount_paid < v_total then
    raise exception 'Insufficient payment. Total: %, Remaining: %',
      v_total, v_total - p_amount_paid
      using errcode = '22023';
  end if;

  insert into public.sales(
    sale_number, branch_id, shift_id, cashier_id,
    subtotal, total_amount, amount_paid, change_amount,
    idempotency_key, request_items
  ) values (
    'SALE-' || lpad(nextval('public.sale_number_seq')::text, 10, '0'),
    v_branch, p_shift_id, v_user,
    v_total, v_total, p_amount_paid, p_amount_paid - v_total,
    p_idempotency_key, v_items
  )
  returning * into v_sale;

  -- Pass 3: one sale_items row per line, snapshotting the resolved price and
  -- variant name so later repricing or renaming never alters this history.
  for v_item in
    select *
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    order by product_id, variant_id
  loop
    if v_item.variant_id is not null then
      select * into v_variant
      from public.branch_product_variants
      where id = v_item.variant_id;
      v_price := v_variant.selling_price;
      v_variant_name := v_variant.name;
    else
      select * into v_branch_product
      from public.branch_products
      where branch_id = v_branch
        and product_id = v_item.product_id;
      v_price := v_branch_product.selling_price;
      v_variant_name := null;
    end if;

    insert into public.sale_items(
      sale_id, product_id, variant_id, variant_name, quantity, unit_price, subtotal
    ) values (
      v_sale.id,
      v_item.product_id,
      v_item.variant_id,
      v_variant_name,
      v_item.quantity,
      v_price,
      v_item.quantity * v_price
    );
  end loop;

  -- Pass 4: one inventory movement per product, aggregating quantity across
  -- any variant lines. Inventory tracking stays on the base product only.
  for v_item in
    select product_id, sum(quantity) as quantity
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, quantity bigint)
    group by product_id
    order by product_id
  loop
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity
    where branch_id = v_branch
      and product_id = v_item.product_id;

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

revoke all on function public.confirm_sale(uuid, jsonb, numeric, text)
  from public, anon;
grant execute on function public.confirm_sale(uuid, jsonb, numeric, text)
  to authenticated;

-- Variant-aware live price refresh for the POS checkout screen. Prices come
-- from the cashier's open-shift branch only; never trusts the client.
create or replace function public.get_cashier_line_prices(
  p_lines jsonb
)
returns table (
  product_id uuid,
  variant_id uuid,
  selling_price numeric,
  variant_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_branch_id uuid;
  v_line record;
begin
  select * into v_user
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
    and p.role = 'cashier';
  if not found then
    raise exception 'Unauthorized: active cashier access is required.'
      using errcode = '42501';
  end if;

  select s.branch_id into v_branch_id
  from public.shifts s
  where s.cashier_id = v_user.id
    and s.status = 'open'
  order by s.started_at desc
  limit 1;

  if v_branch_id is null or v_branch_id is distinct from v_user.branch_id then
    raise exception 'An open shift belonging to your assigned branch is required.'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'Provide 1 to 200 lines to price.'
      using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line.value) is distinct from 'object'
       or coalesce(v_line.value->>'product_id', '') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (
         v_line.value->'variant_id' is not null
         and jsonb_typeof(v_line.value->'variant_id') is distinct from 'null'
         and coalesce(v_line.value->>'variant_id', '') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ) then
      raise exception 'Invalid product or variant.'
        using errcode = '22023';
    end if;
  end loop;

  return query
  select
    lines.product_id,
    lines.variant_id,
    coalesce(bpv.selling_price, bp.selling_price) as selling_price,
    bpv.name as variant_name
  from (
    select distinct
      (value->>'product_id')::uuid as product_id,
      nullif(value->>'variant_id', '')::uuid as variant_id
    from jsonb_array_elements(p_lines)
  ) lines
  join public.branch_products bp
    on bp.branch_id = v_branch_id
   and bp.product_id = lines.product_id
   and bp.is_active
  join public.products p
    on p.id = bp.product_id
   and p.is_active
  left join public.branch_product_variants bpv
    on bpv.id = lines.variant_id
   and bpv.branch_id = v_branch_id
   and bpv.product_id = lines.product_id
   and bpv.is_active
  where lines.variant_id is null or bpv.id is not null;
end;
$$;

revoke all on function public.get_cashier_line_prices(jsonb) from public, anon;
grant execute on function public.get_cashier_line_prices(jsonb) to authenticated;

-- list_cashier_pos_inventory now also surfaces each product's active variants
-- so the POS can show a selector instead of the single branch catalog price.
-- The OUT parameter shape changed (new `variants` column), which Postgres
-- does not allow via create-or-replace, so the old signature is dropped first.
drop function if exists public.list_cashier_pos_inventory();

create function public.list_cashier_pos_inventory()
returns table (
  branch_id uuid,
  branch_name text,
  product_id uuid,
  product_name text,
  product_sku text,
  selling_price numeric,
  quantity_on_hand bigint,
  updated_at timestamptz,
  variants jsonb
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
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active;

  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.'
      using errcode = '42501';
  end if;

  select s.branch_id into v_branch_id
  from public.shifts s
  where s.cashier_id = v_user.id
    and s.status = 'open'
  order by s.started_at desc
  limit 1;

  if v_branch_id is null then
    v_branch_id := v_user.branch_id;
  end if;

  if v_branch_id is null or v_branch_id is distinct from v_user.branch_id then
    raise exception 'No authorized branch is assigned to this cashier.'
      using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.name,
    p.id,
    p.name,
    p.sku,
    bp.selling_price,
    coalesce(bi.quantity_on_hand, 0)::bigint,
    coalesce(bi.updated_at, bp.updated_at),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', bpv.id, 'name', bpv.name, 'selling_price', bpv.selling_price)
          order by bpv.name
        )
        from public.branch_product_variants bpv
        where bpv.branch_id = bp.branch_id
          and bpv.product_id = bp.product_id
          and bpv.is_active
      ),
      '[]'::jsonb
    )
  from public.branch_products bp
  join public.products p on p.id = bp.product_id
  join public.branches b on b.id = bp.branch_id
  left join public.branch_inventory bi
    on bi.product_id = bp.product_id
   and bi.branch_id = bp.branch_id
  where bp.branch_id = v_branch_id
    and bp.is_active
    and p.is_active
    and b.is_active
    and not b.is_main_branch
  order by p.name, p.id;
end;
$$;

revoke all on function public.list_cashier_pos_inventory()
  from public, anon;
grant execute on function public.list_cashier_pos_inventory()
  to authenticated;

-- ----------------------------------------------------------------------------
-- B. Transfer-driven branch availability
-- ----------------------------------------------------------------------------

-- Sending a product to a destination branch now provisions that branch's
-- catalog entry instead of requiring it to already exist: a missing entry is
-- created (a destination price is required to introduce a new product), and
-- an inactive entry is reactivated. An existing active entry's price is left
-- untouched — a transfer never copies another branch's price. Stock only
-- becomes sellable once receive_stock_transfer credits branch_inventory.
create or replace function public.send_stock_transfer(
  p_to_branch_id uuid,
  p_items jsonb,
  p_notes text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_from_branch_id uuid;
  v_transfer_id uuid;
  v_transfer_number text;
  v_item record;
  v_available bigint;
  v_product_active boolean;
  v_branch_product public.branch_products%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.'
      using errcode = '22023';
  end if;

  select id into v_transfer_id
  from public.stock_transfers
  where send_idempotency_key = p_idempotency_key;
  if v_transfer_id is not null then
    return v_transfer_id;
  end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one product to send.'
      using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each product may appear only once.'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
       or (
         v_item.value->'destination_price' is not null
         and jsonb_typeof(v_item.value->'destination_price') is distinct from 'null'
         and coalesce(v_item.value->>'destination_price', '') !~
           '^[0-9]{1,10}(\.[0-9]{1,2})?$'
       ) then
      raise exception 'Invalid transfer item.'
        using errcode = '22023';
    end if;
  end loop;

  select id into v_from_branch_id
  from public.branches
  where is_main_branch and is_active
  for share;
  if v_from_branch_id is null then
    raise exception 'No active Main Branch is configured.'
      using errcode = '22023';
  end if;

  perform 1
  from public.branches
  where id = p_to_branch_id
    and is_active
    and not is_main_branch
  for share;
  if not found then
    raise exception 'Destination branch is missing, inactive, or is the Main Branch.'
      using errcode = '22023';
  end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           (value->>'quantity_sent')::bigint as quantity_sent,
           nullif(value->>'destination_price', '') as destination_price_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    if v_item.quantity_sent <= 0 then
      raise exception 'Transfer quantities must be positive.'
        using errcode = '22023';
    end if;

    select is_active into v_product_active
    from public.products
    where id = v_item.product_id
    for share;
    if not found or not v_product_active then
      raise exception 'Product is missing or inactive.'
        using errcode = '22023';
    end if;

    -- A product no longer needs a pre-existing branch catalog row to be
    -- transferred: create it (new products require a destination price) or
    -- reactivate it (existing price is preserved unless a new one is given).
    -- An already-active entry's price is never altered by a transfer.
    select * into v_branch_product
    from public.branch_products
    where branch_id = p_to_branch_id
      and product_id = v_item.product_id
    for update;

    if not found then
      if v_item.destination_price_text is null then
        raise exception 'Provide a destination price to introduce a new product to this branch.'
          using errcode = '22023';
      end if;
      insert into public.branch_products(branch_id, product_id, selling_price, is_active)
      values (p_to_branch_id, v_item.product_id, v_item.destination_price_text::numeric, true);
    elsif not v_branch_product.is_active then
      update public.branch_products
      set is_active = true,
          selling_price = coalesce(
            v_item.destination_price_text::numeric,
            v_branch_product.selling_price
          )
      where branch_id = p_to_branch_id
        and product_id = v_item.product_id;
    end if;

    select quantity_on_hand into v_available
    from public.branch_inventory
    where branch_id = v_from_branch_id
      and product_id = v_item.product_id
    for update;

    if v_available is null or v_available < v_item.quantity_sent then
      raise exception 'Insufficient stock. Available: %, requested: %.',
        coalesce(v_available, 0), v_item.quantity_sent
        using errcode = '22003';
    end if;
  end loop;

  v_transfer_number :=
    'TR-' || lpad(nextval('public.stock_transfer_number_seq')::text, 6, '0');

  insert into public.stock_transfers(
    transfer_number, from_branch_id, to_branch_id, status,
    created_by, sent_by, sent_at, notes, send_idempotency_key
  ) values (
    v_transfer_number, v_from_branch_id, p_to_branch_id, 'pending_receipt',
    v_user_id, v_user_id, now(), nullif(trim(p_notes), ''), p_idempotency_key
  )
  returning id into v_transfer_id;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           (value->>'quantity_sent')::bigint as quantity_sent
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    insert into public.stock_transfer_items(
      stock_transfer_id, product_id, quantity_sent
    ) values (
      v_transfer_id, v_item.product_id, v_item.quantity_sent
    );

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity_sent
    where branch_id = v_from_branch_id
      and product_id = v_item.product_id
      and quantity_on_hand >= v_item.quantity_sent;

    if not found then
      raise exception 'Insufficient stock during transfer processing.'
        using errcode = '22003';
    end if;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_from_branch_id, v_item.product_id, 'transfer_out',
      -v_item.quantity_sent, 'stock_transfer', v_transfer_id,
      v_user_id, nullif(trim(p_notes), '')
    );
  end loop;

  return v_transfer_id;
end;
$$;

revoke all on function public.send_stock_transfer(uuid, jsonb, text, text)
  from public, anon;
grant execute on function public.send_stock_transfer(uuid, jsonb, text, text)
  to authenticated;

commit;
