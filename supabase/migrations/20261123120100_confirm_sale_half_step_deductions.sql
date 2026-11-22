-- Approach A Phase 2: confirm_sale / void restore exact fractional ingredient quantities.
-- Cart order quantities, prices, discounts, and payments stay integer/money as before.
-- Preserves the back_office_guard category pricing patch from 20261112101643.

begin;

do $migration$
declare
  definition text := pg_get_functiondef('public.confirm_sale(uuid,jsonb,numeric,text,text,text)'::regprocedure);
begin
  if position('v_stock bigint;' in definition) = 0 then
    raise exception 'confirm_sale stock variable not found for half-step patch.';
  end if;
  if position('sum(ordered * per_unit)::bigint as quantity' in definition) = 0 then
    raise exception 'confirm_sale deduction aggregate not found for half-step patch.';
  end if;

  definition := replace(definition, 'v_stock bigint;', 'v_stock numeric(14,3);');
  definition := replace(
    definition,
    'sum(ordered * per_unit)::bigint as quantity',
    'sum(ordered * per_unit) as quantity'
  );
  definition := replace(
    definition,
    'sum(per_unit)::bigint as units',
    'sum(per_unit) as units'
  );
  definition := replace(
    definition,
    'from jsonb_to_recordset(v_deductions) as x(product_id uuid, quantity bigint)',
    'from jsonb_to_recordset(v_deductions) as x(product_id uuid, quantity numeric)'
  );
  definition := replace(
    definition,
    'as x(product_id uuid, variant_id uuid, drink_product_id uuid, ingredient_id uuid, units bigint)',
    'as x(product_id uuid, variant_id uuid, drink_product_id uuid, ingredient_id uuid, units numeric)'
  );

  if position('v_stock numeric(14,3);' in definition) = 0
     or position('sum(ordered * per_unit) as quantity' in definition) = 0 then
    raise exception 'confirm_sale half-step patch did not apply cleanly.';
  end if;
  -- Cart quantity aggregations must remain bigint.
  if position('sum((value->>''quantity'')::bigint)' in definition) = 0 then
    raise exception 'confirm_sale cart quantity bigint cast missing after patch.';
  end if;

  execute definition;
end;
$migration$;

create or replace function public.void_cashier_sale_item(
  p_item uuid,
  p_quantity integer,
  p_expected_quantity integer,
  p_reason text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  branch uuid;
  sale public.sales%rowtype;
  item public.sale_items%rowtype;
  restoration record;
  amount numeric;
  catalog numeric;
  event_id uuid := gen_random_uuid();
  memo text := btrim(coalesce(p_note, ''));
begin
  select branch_id into branch
  from public.profiles
  where id = auth.uid() and role = 'cashier' and is_active
  for update;
  if not found then
    raise exception 'An active cashier is required.';
  end if;

  select s.* into sale
  from public.sales s
  join public.sale_items i on i.sale_id = s.id
  where i.id = p_item and s.cashier_id = auth.uid() and s.branch_id = branch;
  if not found then
    raise exception 'Receipt unavailable.';
  end if;

  perform public.lock_branch_inventory_gate(branch);
  perform 1
  from public.shifts
  where id = sale.shift_id
    and status = 'open'
    and sales_cutoff_at is null
    and cashier_id = auth.uid()
    and branch_id = branch
  for update;
  if not found then
    raise exception 'Only your open shift can be changed.';
  end if;

  select * into item from public.sale_items where id = p_item for update;
  if p_quantity is null
     or p_quantity < 1
     or p_expected_quantity is distinct from item.quantity
     or p_quantity > item.quantity then
    raise exception 'Receipt quantity changed. Refresh the receipt before trying again.';
  end if;
  if sale.status <> 'completed' or item.stock_per_unit is null or item.stock_per_unit = '{}'::jsonb then
    raise exception 'Original stock details are unavailable for this item.';
  end if;
  if p_reason is null
     or p_reason not in ('Wrong item', 'Wrong quantity', 'Duplicate entry', 'Customer changed order', 'Order cancelled', 'Other')
     or length(memo) > 250
     or (p_reason = 'Other' and memo = '') then
    raise exception 'Choose a reason and describe Other.';
  end if;

  amount := item.unit_price * p_quantity;
  catalog := item.catalog_unit_price * p_quantity;

  for restoration in
    select key::uuid as product, (value::numeric * p_quantity) as units
    from jsonb_each_text(item.stock_per_unit)
    order by key
  loop
    if not public.is_piece_half_step(restoration.units) then
      raise exception 'Original stock details are invalid for this item.';
    end if;
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand + restoration.units
    where branch_id = branch and product_id = restoration.product;
    if not found then
      raise exception 'Original stock balance unavailable.';
    end if;
    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes
    ) values (
      branch, restoration.product, 'adjustment', restoration.units, 'adjustment', event_id, auth.uid(),
      'Item void on ' || sale.sale_number
    );
  end loop;

  perform set_config('app.cashier_item_void', 'on', true);
  update public.sale_items
  set quantity = quantity - p_quantity,
      subtotal = subtotal - amount,
      discount_amount = discount_amount - (catalog - amount),
      void_history = void_history || jsonb_build_array(jsonb_build_object(
        'id', event_id,
        'quantity', p_quantity,
        'amount', amount,
        'reason', p_reason,
        'note', memo,
        'cashier_id', auth.uid(),
        'at', now()
      ))
  where id = p_item;
  update public.sales
  set subtotal = subtotal - amount,
      total_amount = total_amount - amount,
      void_amount = void_amount + amount,
      catalog_subtotal = catalog_subtotal - catalog,
      discount_amount = discount_amount - (catalog - amount),
      status = case
        when exists (select 1 from public.sale_items where sale_id = sale.id and quantity > 0)
          then status
        else 'voided'::public.sale_status
      end
  where id = sale.id;
  perform set_config('app.cashier_item_void', 'off', true);
end;
$$;

revoke all on function public.void_cashier_sale_item(uuid, integer, integer, text, text) from public, anon;
grant execute on function public.void_cashier_sale_item(uuid, integer, integer, text, text) to authenticated;

comment on function public.confirm_sale(uuid, jsonb, numeric, text, text, text) is
  'Confirm POS sale. Order quantities stay whole. Ingredient deductions use numeric half-step stock units from product_stock_uses.';

commit;
