-- Phase 3 Final QA: explicit non-returnable settings, local-purchase catalog, KG messaging.
-- Additive. Does not clear existing is_non_returnable flags. No name-based classification.
begin;

comment on column public.products.is_non_returnable is
  'Explicit product setting. When true: stays at branch (carryover), excluded from leftover/physical returns, eligible for local purchase. Set via set_product_non_returnable — never inferred from product name.';

-- Catalog for cashier local-purchase UI (non-returnable PCS only).
drop function if exists public.list_cashier_local_purchase_catalog();
create function public.list_cashier_local_purchase_catalog()
returns table(
  product_id uuid,
  product_name text,
  product_sku text,
  quantity_on_hand bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.sku,
    coalesce(trunc(i.quantity_on_hand), 0)::bigint
  from public.products p
  join public.branch_products bp
    on bp.product_id = p.id
   and bp.branch_id = public.current_user_branch_id()
   and bp.is_active
  left join public.branch_inventory i
    on i.product_id = p.id
   and i.branch_id = public.current_user_branch_id()
  where public.current_user_role() in ('cashier', 'manager')
    and p.is_active
    and p.is_non_returnable
    and p.inventory_mode = 'piece_stock'
    and public.current_user_branch_id() is not null
  order by p.name, p.id;
$$;

revoke all on function public.list_cashier_local_purchase_catalog() from public, anon;
grant execute on function public.list_cashier_local_purchase_catalog() to authenticated;

comment on function public.list_cashier_local_purchase_catalog() is
  'Selling-branch non-returnable PCS products eligible for record_branch_local_purchase.';

-- Re-assert local purchase eligibility (explicit non-returnable only).
create or replace function public.record_branch_local_purchase(
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
  v_user public.profiles%rowtype;
  v_branch uuid;
  v_item record;
  v_product public.products%rowtype;
  v_qty numeric(14,3);
  v_ref uuid;
  v_existing uuid;
begin
  select * into v_user from public.profiles where id = auth.uid() and is_active for update;
  if not found or v_user.role not in ('cashier', 'manager') then
    raise exception 'Unauthorized: cashier or manager access required.' using errcode = '42501';
  end if;
  v_branch := v_user.branch_id;
  if v_branch is null then
    raise exception 'Branch assignment is required.' using errcode = '42501';
  end if;
  perform 1 from public.branches where id = v_branch and is_active and not is_main_branch;
  if not found then
    raise exception 'Local purchases are only for selling branches.' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid confirmation key.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Notes too long (maximum 1000 characters).' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Select 1 to 100 products.' using errcode = '22023';
  end if;

  select m.reference_id into v_existing
  from public.inventory_movements m
  where m.branch_id = v_branch
    and m.movement_type = 'adjustment'
    and m.reference_type = 'local_purchase'
    and m.created_by = v_user.id
    and m.notes like ('idem:' || p_idempotency_key || '%')
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  if exists (
    select 1 from public.shifts s
    where s.branch_id = v_branch
      and s.status = 'closed'
      and (s.reconciliation_required or s.inventory_reconciliation_required)
  ) then
    raise exception 'Complete pending remittance before recording local purchases.'
      using errcode = '55000';
  end if;

  perform public.lock_branch_inventory_gate(v_branch);
  v_ref := gen_random_uuid();

  for v_item in
    select (value->>'product_id')::uuid as product_id, value->>'quantity' as quantity_text
    from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found or not v_product.is_active then
      raise exception 'Product is missing or inactive.' using errcode = '22023';
    end if;
    if v_product.inventory_mode is distinct from 'piece_stock' then
      raise exception
        'KG inventory is Main-tracked only. Local purchases and booth stock counts use piece stock — no automatic KG conversion.'
        using errcode = '22023';
    end if;
    if not v_product.is_non_returnable then
      raise exception '% is not marked non-returnable. Flag it in product settings before local purchase.',
        v_product.name using errcode = '22023';
    end if;
    v_qty := public.parse_inventory_quantity(v_item.quantity_text, 'piece_stock', false);
    perform public.seed_branch_catalog(v_branch, v_item.product_id);

    insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
    values (v_branch, v_item.product_id, v_qty)
    on conflict (branch_id, product_id) do update
    set quantity_on_hand = branch_inventory.quantity_on_hand + excluded.quantity_on_hand;

    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity,
      reference_type, reference_id, created_by, notes
    ) values (
      v_branch, v_item.product_id, 'adjustment', v_qty,
      'local_purchase', v_ref, v_user.id,
      'idem:' || p_idempotency_key
        || case when nullif(trim(p_notes), '') is null then '' else ' | ' || trim(p_notes) end
    );
  end loop;

  return v_ref;
end;
$$;

revoke all on function public.record_branch_local_purchase(jsonb, text, text) from public, anon;
grant execute on function public.record_branch_local_purchase(jsonb, text, text) to authenticated;

commit;
