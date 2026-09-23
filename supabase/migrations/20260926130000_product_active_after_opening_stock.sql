-- Products may become active only after Main has opening stock.
-- initialize_main_branch_inventory activates after the qty/movement write.

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
  v_current_qty    bigint;
  v_product_id     uuid;
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

  select id into v_main_branch_id
  from public.branches
  where is_main_branch and is_active
  for share;

  if v_main_branch_id is null then
    raise exception 'No active Main Branch is configured.' using errcode = '22023';
  end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
           (value->>'quantity')::bigint as quantity
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    if v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity > 999999 then
      raise exception 'Opening quantities must be whole numbers between 1 and 999999.'
        using errcode = '22023';
    end if;

    select id into v_product_id
    from public.products
    where id = v_item.product_id
    for update;
    if v_product_id is null then
      raise exception 'Product is missing.' using errcode = '22023';
    end if;

    insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
    values (v_main_branch_id, v_item.product_id, 0)
    on conflict (branch_id, product_id) do nothing;

    select quantity_on_hand into v_current_qty
    from public.branch_inventory
    where branch_id = v_main_branch_id and product_id = v_item.product_id
    for update;

    select exists (
      select 1 from public.inventory_movements
      where branch_id = v_main_branch_id
        and product_id = v_item.product_id
        and movement_type = 'opening_stock'
    ) into v_has_opening;

    if not v_has_opening and v_current_qty <> 0 then
      raise exception 'Opening stock has already been initialized for a selected product.'
        using errcode = '55000';
    end if;

    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand + v_item.quantity
    where branch_id = v_main_branch_id and product_id = v_item.product_id;

    if not v_has_opening then
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_main_branch_id, v_item.product_id, 'opening_stock', v_item.quantity,
        'opening_stock', null, v_user_id, nullif(trim(p_notes), '')
      );
    else
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes
      ) values (
        v_main_branch_id, v_item.product_id, 'adjustment', v_item.quantity,
        'adjustment', v_adjustment_id, v_user_id, nullif(trim(p_notes), '')
      );
    end if;

    update public.products
    set is_active = true
    where id = v_item.product_id and not is_active;
  end loop;
end;
$$;

revoke all on function public.initialize_main_branch_inventory(jsonb, text)
  from public, anon;
grant execute on function public.initialize_main_branch_inventory(jsonb, text)
  to authenticated;

create or replace function public.protect_product_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_active and not coalesce(old.is_active, false) then
    if not exists (
      select 1
      from public.inventory_movements m
      join public.branches b on b.id = m.branch_id
      where m.product_id = new.id
        and b.is_main_branch
        and m.movement_type = 'opening_stock'
    ) and not exists (
      select 1
      from public.branch_inventory i
      join public.branches b on b.id = i.branch_id
      where i.product_id = new.id
        and b.is_main_branch
        and i.quantity_on_hand > 0
    ) then
      raise exception 'A product can become active only after Main Branch opening stock is set.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists products_protect_activation on public.products;
create trigger products_protect_activation
before update of is_active on public.products
for each row execute function public.protect_product_activation();
