begin;

-- ============================================================================
-- Milestone 12.5 — Default product variants + branch availability defaults
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Default product variants (product-level, not branch-specific)
-- ----------------------------------------------------------------------------

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  default_price numeric(12,2) not null check (default_price >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, name)
);

create index product_variants_product_id_idx on public.product_variants(product_id);

create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute function public.set_updated_at();

alter table public.product_variants enable row level security;

-- Default variants are product master data: any active staff member may read
-- them (same visibility as public.products), but only the Main Branch
-- Manager may write, via configure_product_variants below.
create policy product_variants_select_staff
on public.product_variants for select
to authenticated
using (public.current_user_role() is not null);

revoke all on public.product_variants from public, anon, authenticated;
grant select on public.product_variants to authenticated;

comment on table public.product_variants is
  'Product-level default variants (e.g. "With Rice" / "Without Rice") and their default prices. Copied into branch_product_variants the first time a branch receives the product via transfer.';

create or replace function public.configure_product_variants(
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
  v_idx int := 0;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  perform 1
  from public.products
  where id = p_product_id
  for share;
  if not found then
    raise exception 'Product does not exist.'
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
       or coalesce(v_item.value->>'default_price', '') !~
         '^[0-9]{1,10}(\.[0-9]{1,2})?$'
       or jsonb_typeof(v_item.value->'is_active') is distinct from 'boolean' then
      raise exception 'Each variant requires a name, non-negative default price with at most two decimals, and active status.'
        using errcode = '22023';
    end if;
  end loop;

  if not exists (
    select 1
    from jsonb_array_elements(p_variants) x
    where (x.value->>'is_active')::boolean
  ) then
    raise exception 'At least one variant must be active.'
      using errcode = '22023';
  end if;

  for v_item in
    select *
    from jsonb_to_recordset(p_variants)
      as x(name text, default_price numeric, is_active boolean)
  loop
    insert into public.product_variants(
      product_id, name, default_price, is_active, sort_order
    ) values (
      p_product_id, trim(v_item.name), v_item.default_price, v_item.is_active, v_idx
    )
    on conflict (product_id, name) do update
    set default_price = excluded.default_price,
        is_active = excluded.is_active,
        sort_order = excluded.sort_order;
    v_idx := v_idx + 1;
  end loop;
end;
$$;

revoke all on function public.configure_product_variants(uuid, jsonb)
  from public, anon;
grant execute on function public.configure_product_variants(uuid, jsonb)
  to authenticated;

-- ----------------------------------------------------------------------------
-- B + C. Transfer-driven branch catalog: copy default variants and default
-- to carried/ON. Reactivation of an already-known (not "first time") branch
-- catalog entry never touches its variants or prices — existing
-- branch-specific data is never overwritten by a later transfer.
-- ----------------------------------------------------------------------------

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
  v_product public.products%rowtype;
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
           (value->>'quantity_sent')::bigint as quantity_sent
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    if v_item.quantity_sent <= 0 then
      raise exception 'Transfer quantities must be positive.'
        using errcode = '22023';
    end if;

    select * into v_product
    from public.products
    where id = v_item.product_id
    for share;
    if not found or not v_product.is_active then
      raise exception 'Product is missing or inactive.'
        using errcode = '22023';
    end if;

    -- A product no longer needs a pre-existing branch catalog row to be
    -- transferred. Introducing it for the first time: creates the branch
    -- catalog entry (carried/ON by default) at the product's base
    -- selling_price, and copies every currently-active default variant into
    -- branch_product_variants at its default_price (also ON by default).
    -- Reactivating an already-known entry never touches variants or prices —
    -- an already-active entry's price is never altered by a transfer either.
    select * into v_branch_product
    from public.branch_products
    where branch_id = p_to_branch_id
      and product_id = v_item.product_id
    for update;

    if not found then
      insert into public.branch_products(branch_id, product_id, selling_price, is_active)
      values (p_to_branch_id, v_item.product_id, v_product.selling_price, true);

      insert into public.branch_product_variants(
        branch_id, product_id, name, selling_price, is_active
      )
      select p_to_branch_id, v_item.product_id, pv.name, pv.default_price, true
      from public.product_variants pv
      where pv.product_id = v_item.product_id
        and pv.is_active
      on conflict (branch_id, product_id, name) do nothing;
    elsif not v_branch_product.is_active then
      update public.branch_products
      set is_active = true
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
