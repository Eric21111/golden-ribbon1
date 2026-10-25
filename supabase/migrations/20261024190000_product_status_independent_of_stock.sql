-- Product Status (is_active) is independent of stock quantity.
-- Enabling a product no longer requires Main Branch opening stock.
-- Opening stock changes quantity only. It does not enable or disable the product.
-- A sale of an enabled product with no stock still fails on insufficient stock.

begin;

drop trigger if exists products_protect_activation on public.products;

create or replace function public.set_product_status(
  p_product_id uuid,
  p_is_active boolean
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  if p_is_active is null then
    raise exception 'Product status is required.' using errcode = '22023';
  end if;

  update public.products
  set is_active = p_is_active
  where id = p_product_id
  returning * into v_product;

  if not found then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  return v_product;
end;
$$;

revoke all on function public.set_product_status(uuid, boolean) from public, anon;
grant execute on function public.set_product_status(uuid, boolean) to authenticated;

comment on function public.set_product_status(uuid, boolean) is
  'Sets Product Status only. Does not change selling price, stock, or sell_in_pos. Zero stock is allowed.';

create or replace function public.initialize_main_branch_inventory(
  p_items jsonb,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id        uuid := auth.uid();
  v_main_branch_id uuid;
  v_item           record;
  v_product        public.products%rowtype;
  v_current_qty    numeric(14,3);
  v_quantity       numeric(14,3);
  v_has_opening    boolean;
  v_adjustment_id  uuid := gen_random_uuid();
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one product with a positive opening quantity.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each product may appear only once.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Notes too long (maximum 1000 characters).' using errcode = '22023';
  end if;

  select id into v_main_branch_id from public.branches where is_main_branch and is_active;
  if v_main_branch_id is null then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  perform public.lock_branch_inventory_gate(v_main_branch_id);

  for v_item in
    select (value->>'product_id')::uuid as product_id, value->>'quantity' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    select * into v_product from public.products where id = v_item.product_id for update;
    if not found then
      raise exception 'Product is missing.' using errcode = '22023';
    end if;

    begin
      v_quantity := public.parse_inventory_quantity(v_item.quantity_text, v_product.inventory_mode, false);
    exception when others then
      if v_product.inventory_mode = 'kg_meal' then
        raise exception 'KG opening quantities must be positive with up to 3 decimals.' using errcode = '22023';
      end if;
      raise exception 'Opening quantities must be whole numbers between 1 and 999999.' using errcode = '22023';
    end;

    insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
    values (v_main_branch_id, v_item.product_id, 0)
    on conflict (branch_id, product_id) do nothing;

    select quantity_on_hand into v_current_qty
    from public.branch_inventory
    where branch_id = v_main_branch_id and product_id = v_item.product_id
    for update;

    select exists (
      select 1 from public.inventory_movements
      where branch_id = v_main_branch_id and product_id = v_item.product_id
        and movement_type = 'opening_stock'
    ) into v_has_opening;

    if not v_has_opening and v_current_qty <> 0 then
      raise exception 'Opening stock has already been initialized for a selected product.'
        using errcode = '55000';
    end if;

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand + v_quantity
    where branch_id = v_main_branch_id and product_id = v_item.product_id;

    if not v_has_opening then
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_main_branch_id, v_item.product_id, 'opening_stock', v_quantity,
        'opening_stock', null, v_user_id, nullif(trim(p_notes), '')
      );
    else
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_main_branch_id, v_item.product_id, 'adjustment', v_quantity,
        'adjustment', v_adjustment_id, v_user_id, nullif(trim(p_notes), '')
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.initialize_main_branch_inventory(jsonb, text) from public, anon;
grant execute on function public.initialize_main_branch_inventory(jsonb, text) to authenticated;

commit;
