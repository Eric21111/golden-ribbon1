begin;
alter table public.sales add column payment_method text check (payment_method in ('cash','gcash'));
alter table public.shift_reconciliations add column expected_gcash numeric(12,2), add column actual_gcash numeric(12,2),
  add constraint reconciliation_gcash_pair check ((expected_gcash is null)=(actual_gcash is null) and expected_gcash>=0 and actual_gcash>=0);

create function public.shift_payment_totals(p_shift uuid) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('cash',coalesce(sum(total_amount) filter(where payment_method='cash'),0),
    'gcash',coalesce(sum(total_amount) filter(where payment_method='gcash'),0),
    'unrecorded_count',count(*) filter(where payment_method is null),
    'recorded_count',count(payment_method))
  from public.sales where shift_id=p_shift and status='completed'
$$;
revoke all on function public.shift_payment_totals(uuid) from public,anon,authenticated;

create or replace function public.confirm_sale(
  p_shift_id uuid,
  p_items jsonb,
  p_amount_paid numeric,
  p_idempotency_key text,
  p_pricing_program text,
  p_payment_method text
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
  v_deductions jsonb;
  v_stock_name text;
  v_mapped jsonb := '[]'::jsonb;
  v_bvariant public.branch_product_variants%rowtype;
  v_masters uuid[];
  v_master uuid;
  v_drink_product public.products%rowtype;
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

  if p_payment_method is not null and p_payment_method not in ('cash','gcash') then
    raise exception 'Choose Cash or GCash.' using errcode='22023';
  end if;
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
       ) or (
         v_item.value->'drink_product_id' is not null
         and jsonb_typeof(v_item.value->'drink_product_id') is distinct from 'null'
         and coalesce(v_item.value->>'drink_product_id', '') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ) then
      raise exception 'Invalid product, variant, or quantity.'
        using errcode = '22023';
    end if;
  end loop;

  select jsonb_agg(
    jsonb_build_object('product_id', product_id, 'variant_id', variant_id, 'quantity', quantity)
      || case
           when drink_product_id is null then '{}'::jsonb
           else jsonb_build_object('drink_product_id', drink_product_id)
         end
    order by product_id, variant_id, drink_product_id
  )
  into v_items
  from (
    select (value->>'product_id')::uuid as product_id,
           nullif(value->>'variant_id', '')::uuid as variant_id,
           nullif(value->>'drink_product_id', '')::uuid as drink_product_id,
           sum((value->>'quantity')::bigint) as quantity
    from jsonb_array_elements(p_items)
    group by 1, 2, 3
  ) normalized;

  select * into v_sale
  from public.sales
  where cashier_id = v_user
    and idempotency_key = p_idempotency_key;
  if found then
    if v_sale.shift_id <> p_shift_id
       or v_sale.request_items <> v_items
       or v_sale.payment_method is distinct from p_payment_method
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

  -- Sold-product checks (unchanged): every product in the cart must be active and in this branch's catalog.
  for v_item in
    select product_id
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

    -- A product with configured options sells only through an ACTIVE branch option. With every option off, or none set up
    -- at this branch, it is unavailable: refuse it here, before any stock is read, and never fall back to the base price.
    if public.pos_options_unavailable(v_branch, v_item.product_id) then
      raise exception 'No option of "%" is available at this branch.', v_product.name
        using errcode = '22023';
    end if;
  end loop;

  -- Shared inventory (product_stock_uses). The POS sends the BRANCH variant (branch_product_variants.id), but recipes
  -- are stored against the MASTER variant (product_variants.id). Resolve each cart line's branch variant to its master
  -- variant by product and case-insensitive name, exactly as list_cashier_pos_inventory pairs them:
  --   * the branch variant must exist, be active, and belong to this branch and product (else the sale is refused);
  --   * more than one master variant with that name (names differ only by case) is ambiguous: the sale is refused
  --     rather than guessing which recipe to apply;
  --   * no master variant with that name means the option has no recipe of its own, so it uses the product-level
  --     lines (or the legacy rule). It never borrows another variant's recipe.
  for v_item in
    select x.product_id, x.variant_id, x.drink_product_id, x.quantity
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, drink_product_id uuid, quantity bigint)
    order by x.product_id, x.variant_id, x.drink_product_id
  loop
    v_master := null;
    if v_item.variant_id is not null then
      select * into v_bvariant
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

      select array_agg(pv.id order by pv.id) into v_masters
      from public.product_variants pv
      where pv.product_id = v_bvariant.product_id
        and lower(pv.name) = lower(v_bvariant.name);

      if coalesce(cardinality(v_masters), 0) > 1 then
        raise exception 'The option "%" is set up more than once for this product. Ask a manager to fix the product options.',
          v_bvariant.name
          using errcode = '22023';
      elsif coalesce(cardinality(v_masters), 0) = 1 then
        v_master := v_masters[1];
        -- keep the master variant in place while its recipe is read
        perform 1 from public.product_variants where id = v_master for share;
      end if;
    end if;

    -- Drink Choice. An option that includes a drink needs exactly one of its eligible drinks. A drink is never
    -- accepted for an option that does not include one, and never one the option does not offer: the sale is refused
    -- rather than silently ignoring or guessing.
    if v_master is not null
       and exists (
         select 1 from public.product_drink_choices d
         where d.variant_id = v_master and d.product_id = v_item.product_id
       ) then
      if v_item.drink_product_id is null then
        raise exception 'Choose a drink for %.', v_bvariant.name
          using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.product_drink_choices d
        where d.variant_id = v_master
          and d.product_id = v_item.product_id
          and d.drink_product_id = v_item.drink_product_id
      ) then
        raise exception 'That drink is not offered with %.', v_bvariant.name
          using errcode = '22023';
      end if;
      select * into v_drink_product
      from public.products
      where id = v_item.drink_product_id
      for share;
      if not found or not v_drink_product.is_active then
        raise exception 'The selected drink is inactive or unavailable.'
          using errcode = '22023';
      end if;
    elsif v_item.drink_product_id is not null then
      raise exception 'This item does not include a drink.'
        using errcode = '22023';
    end if;

    v_mapped := v_mapped || jsonb_build_array(jsonb_build_object(
      'product_id', v_item.product_id,
      'master_variant_id', v_master,
      'drink_product_id', v_item.drink_product_id,
      'quantity', v_item.quantity
    ));
  end loop;

  -- Expand every cart line into the inventory it uses, ONCE, and add the needs up per ingredient across the whole
  -- cart. Each line resolves independently:
  --   1. its master variant's own lines, when it has any;
  --   2. otherwise the product-level lines (variant_id is null);
  --   3. otherwise the legacy rule: one unit of the sold product itself.
  -- Exactly one rule applies per line (never a mix), so a unit is never counted twice. Ingredients are NOT
  -- expanded again: an ingredient's own configuration is ignored.
  with resolved as (
    select it.product_id, it.master_variant_id, it.drink_product_id, it.quantity,
      case
        when it.master_variant_id is not null and exists (
          select 1 from public.product_stock_uses vu
          where vu.variant_id = it.master_variant_id and vu.product_id = it.product_id
        ) then 'variant'
        when exists (
          select 1 from public.product_stock_uses pu
          where pu.product_id = it.product_id and pu.variant_id is null
        ) then 'product'
        else 'legacy'
      end as source
    from jsonb_to_recordset(v_mapped) as it(product_id uuid, master_variant_id uuid, drink_product_id uuid, quantity bigint)
  ),
  lines as (
    select r.quantity * u.quantity as quantity, u.ingredient_product_id as ingredient_id
    from resolved r
    join public.product_stock_uses u
      on (r.source = 'variant' and u.variant_id = r.master_variant_id and u.product_id = r.product_id)
      or (r.source = 'product' and u.product_id = r.product_id and u.variant_id is null)
    union all
    select r.quantity, r.product_id
    from resolved r
    where r.source = 'legacy'
    union all
    select r.quantity, r.drink_product_id
    from resolved r
    where r.drink_product_id is not null
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('product_id', d.ingredient_id, 'quantity', d.quantity)
      order by d.ingredient_id
    ),
    '[]'::jsonb
  )
  into v_deductions
  from (
    select l.ingredient_id, sum(l.quantity)::bigint as quantity
    from lines l
    group by l.ingredient_id
  ) d;

  -- Stock check: one check per ingredient against the combined need of the whole order. Locking order is
  -- unchanged in effect: lock_branch_inventory_gate above already holds every branch_inventory row of this branch.
  for v_item in
    select x.product_id, x.quantity
    from jsonb_to_recordset(v_deductions) as x(product_id uuid, quantity bigint)
    order by x.product_id
  loop
    select quantity_on_hand into v_stock
    from public.branch_inventory
    where branch_id = v_branch
      and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity then
      select name into v_stock_name from public.products where id = v_item.product_id;
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_stock_name, coalesce(v_stock, 0), v_item.quantity
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

  if p_payment_method='gcash' and p_amount_paid<>v_charged_total then
    raise exception 'GCash requires the exact amount charged.' using errcode='22023';
  end if;
  insert into public.sales(
    sale_number, branch_id, shift_id, cashier_id,
    subtotal, total_amount, amount_paid, change_amount,
    payment_method, pricing_program, catalog_subtotal, discount_amount,
    idempotency_key, request_items
  ) values (
    'SALE-' || lpad(nextval('public.sale_number_seq')::text, 10, '0'),
    v_branch, p_shift_id, v_user,
    v_charged_total, v_charged_total, p_amount_paid, p_amount_paid - v_charged_total,
    p_payment_method, v_program, v_catalog_total, greatest(v_catalog_total - v_charged_total, 0),
    p_idempotency_key, v_items
  )
  returning * into v_sale;

  for v_item in
    select *
    from jsonb_to_recordset(v_items) as x(product_id uuid, variant_id uuid, drink_product_id uuid, quantity bigint)
    order by product_id, variant_id, drink_product_id
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
      catalog_unit_price, unit_price, discount_amount, subtotal,
      drink_product_id, drink_name
    ) values (
      v_sale.id,
      v_item.product_id,
      v_item.variant_id,
      v_variant_name,
      v_item.quantity,
      v_catalog_price,
      v_charged_price,
      greatest((v_catalog_price - v_charged_price) * v_item.quantity, 0),
      v_item.quantity * v_charged_price,
      v_item.drink_product_id,
      (select p.name from public.products p where p.id = v_item.drink_product_id)
    );
  end loop;

  -- Deduct each ingredient once, with one inventory movement per ingredient (the inventory_movements_sale_once
  -- index allows exactly one 'sale' movement per sale and product).
  for v_item in
    select x.product_id, x.quantity
    from jsonb_to_recordset(v_deductions) as x(product_id uuid, quantity bigint)
    order by x.product_id
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
revoke all on function public.confirm_sale(uuid,jsonb,numeric,text,text,text) from public,anon;
grant execute on function public.confirm_sale(uuid,jsonb,numeric,text,text,text) to authenticated;
create or replace function public.confirm_sale(p_shift_id uuid,p_items jsonb,p_amount_paid numeric,p_idempotency_key text,p_pricing_program text default 'standard')
returns public.sales language sql security invoker set search_path='' as $$
  select * from public.confirm_sale(p_shift_id,p_items,p_amount_paid,p_idempotency_key,p_pricing_program,null::text)
$$;

create or replace function public.build_shift_close_preview(p_shift public.shifts)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenders jsonb := public.shift_payment_totals(p_shift.id);
  v_expected_cash numeric(12,2);
  v_products jsonb := '[]'::jsonb;
  v_base record;
  v_agg record;
  v_requires_count boolean;
  v_cutoff timestamptz := coalesce(p_shift.sales_cutoff_at, p_shift.ended_at, now());
begin
  select coalesce(sum(s.total_amount), 0)::numeric(12,2) into v_expected_cash
  from public.sales s
  where s.shift_id = p_shift.id and s.status = 'completed';

  for v_base in
    select * from public.shift_product_close_baselines b
    where b.shift_id = p_shift.id
    order by b.product_name_snapshot, b.product_id
  loop
    select * into v_agg
    from public.aggregate_shift_product_movements(p_shift, v_base.product_id, v_base.opening_quantity);

    v_requires_count := v_base.opening_quantity <> 0
      or v_agg.system_balance_before_waste <> 0
      or exists (
        select 1 from public.inventory_movements m
        where m.branch_id = p_shift.branch_id and m.product_id = v_base.product_id
          and m.created_at >= p_shift.started_at and m.created_at <= v_cutoff
      )
      or exists (
        select 1 from public.branch_inventory bi
        where bi.branch_id = p_shift.branch_id and bi.product_id = v_base.product_id
          and bi.quantity_on_hand <> 0
      );

    v_products := v_products || jsonb_build_array(jsonb_build_object(
      'product_id', v_base.product_id,
      'product_name_snapshot', v_base.product_name_snapshot,
      'sku_snapshot', v_base.sku_snapshot,
      'closing_stock_behavior', v_base.closing_stock_behavior,
      'opening_quantity', v_base.opening_quantity,
      'received_quantity', v_agg.received_quantity,
      'outgoing_quantity', v_agg.outgoing_quantity,
      'sold_quantity', v_agg.sold_quantity,
      'adjustment_quantity', v_agg.adjustment_quantity,
      'system_balance_before_waste', v_agg.system_balance_before_waste,
      'requires_count', v_requires_count
    ));
  end loop;

  return jsonb_build_object(
    'shift_id', p_shift.id, 'branch_id', p_shift.branch_id,
    'started_at', p_shift.started_at, 'ended_at', p_shift.ended_at,
    'sales_cutoff_at', p_shift.sales_cutoff_at,
    'inventory_reconciliation_required', p_shift.inventory_reconciliation_required,
    'reconciliation_required', p_shift.reconciliation_required,
    'mode', case when p_shift.inventory_reconciliation_required
      or exists (select 1 from public.shift_product_close_baselines b where b.shift_id = p_shift.id)
      then 'pcs_inventory_cash' else 'legacy_cash_only' end,
    'expected_cash', case when (v_tenders->>'unrecorded_count')::int=0 then (v_tenders->>'cash')::numeric else v_expected_cash end,
    'expected_gcash', case when (v_tenders->>'unrecorded_count')::int=0 then (v_tenders->>'gcash')::numeric end,
    'unrecorded_count', (v_tenders->>'unrecorded_count')::int, 'products', v_products, 'status', 'pending'
  );
end;
$$;

create or replace function public.finalize_cashier_shift_reconciliation(
  p_shift_id uuid,
  p_actual_cash text,
  p_products jsonb,
  p_actual_gcash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_branch_id uuid;
  v_tenders jsonb;
  v_actual_gcash numeric(12,2);
  v_expected_gcash numeric(12,2);
  v_actual numeric(12,2);
  v_expected numeric(12,2);
  v_cash_diff numeric(12,2);
  v_cash_result public.cash_reconciliation_result;
  v_existing_cash public.shift_reconciliations%rowtype;
  v_needs_inventory boolean;
  v_products jsonb;
  v_item record;
  v_base public.shift_product_close_baselines%rowtype;
  v_agg record;
  v_waste bigint;
  v_actual_rem bigint;
  v_expected_rem bigint;
  v_discrepancy bigint;
  v_result public.shift_product_recon_result;
  v_unsold bigint;
  v_carried bigint;
  v_recon_id uuid;
  v_adjust_ref uuid := gen_random_uuid();
  v_adjust_qty bigint;
  v_live numeric(14,3);
  v_reserved numeric(14,3);
  v_norm_products jsonb := '[]'::jsonb;
  v_existing_products jsonb;
  v_product_summaries jsonb := '[]'::jsonb;
  v_note text;
  v_mode public.inventory_mode;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select branch_id into v_branch_id
  from public.shifts
  where id = p_shift_id
    and cashier_id = v_user.id
    and branch_id is not distinct from v_user.branch_id;
  if v_branch_id is null then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  -- Branch → exact target shift (no inventory yet; may be read-only idempotent)
  perform public.lock_shift_inventory_gate(v_branch_id, p_shift_id, false, false);

  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.status <> 'closed' then
    raise exception 'Only a closed shift can be reconciled.' using errcode = '42501';
  end if;
  if not v_shift.reconciliation_required
     and not v_shift.inventory_reconciliation_required
     and exists (select 1 from public.shift_reconciliations r where r.shift_id = v_shift.id) then
    null;
  elsif not v_shift.reconciliation_required and not v_shift.inventory_reconciliation_required then
    raise exception 'This historical shift does not require reconciliation.' using errcode = '22023';
  end if;

  v_needs_inventory := v_shift.inventory_reconciliation_required
    or exists (select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id);

  v_actual := public.parse_actual_cash(p_actual_cash);
  select coalesce(sum(s.total_amount), 0)::numeric(12,2) into v_expected
  from public.sales s
  where s.shift_id = v_shift.id and s.status = 'completed';

  v_tenders := public.shift_payment_totals(v_shift.id);
  if (v_tenders->>'unrecorded_count')::int=0 and (p_actual_gcash is not null or (v_tenders->>'recorded_count')::int>0) then
    if p_actual_gcash is null then raise exception 'Enter actual GCash received using the updated app.' using errcode='22023'; end if;
    v_expected := (v_tenders->>'cash')::numeric;
    v_expected_gcash := (v_tenders->>'gcash')::numeric;
    v_actual_gcash := public.parse_actual_cash(p_actual_gcash);
  elsif p_actual_gcash is not null then
    raise exception 'This historical shift requires a combined collection count.' using errcode='22023';
  end if;

  if p_products is null or jsonb_typeof(p_products) = 'null' then
    v_products := '[]'::jsonb;
  elsif jsonb_typeof(p_products) <> 'array' then
    raise exception 'Product reconciliation list is invalid.' using errcode = '22023';
  else
    v_products := p_products;
  end if;

  if (select count(*) from jsonb_array_elements(v_products)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(v_products)) then
    raise exception 'Each product may appear only once.' using errcode = '22023';
  end if;

  if v_needs_inventory and exists (
    select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id
  ) then
    if exists (
      select 1 from public.shift_product_close_baselines b
      where b.shift_id = v_shift.id
        and not exists (
          select 1 from jsonb_array_elements(v_products) x
          where (x.value->>'product_id')::uuid = b.product_id
        )
    ) then
      raise exception 'Actual remaining is required for every close product.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_products) x
      where not exists (
        select 1 from public.shift_product_close_baselines b
        where b.shift_id = v_shift.id and b.product_id = (x.value->>'product_id')::uuid
      )
    ) then
      raise exception 'Unknown product in reconciliation payload.' using errcode = '22023';
    end if;
  elsif v_needs_inventory = false and jsonb_array_length(v_products) > 0 then
    raise exception 'This legacy shift does not accept product inventory counts.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(norm.obj order by norm.product_id), '[]'::jsonb)
  into v_norm_products
  from (
    select
      (value->>'product_id')::uuid as product_id,
      jsonb_build_object(
        'product_id', (value->>'product_id')::uuid,
        'actual_remaining', public.parse_inventory_quantity(value->>'actual_remaining', 'piece_stock', true)::bigint,
        'waste_quantity', public.parse_inventory_quantity(
          coalesce(nullif(btrim(value->>'waste_quantity'), ''), '0'),
          'piece_stock',
          true
        )::bigint,
        'discrepancy_note', nullif(btrim(coalesce(value->>'discrepancy_note', '')), '')
      ) as obj
    from jsonb_array_elements(v_products)
  ) norm;

  -- Idempotent retry (branch+exact shift already locked; no inventory mutation)
  select * into v_existing_cash from public.shift_reconciliations where shift_id = v_shift.id;
  if found then
    if v_existing_cash.actual_cash is distinct from v_actual or v_existing_cash.actual_gcash is distinct from v_actual_gcash then
      raise exception 'This shift has already been reconciled with a different cash amount.'
        using errcode = '22023';
    end if;
    if v_needs_inventory then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'product_id', r.product_id,
          'actual_remaining', r.actual_remaining,
          'waste_quantity', r.waste_quantity,
          'discrepancy_note', r.discrepancy_note
        )
        order by r.product_id
      ), '[]'::jsonb)
      into v_existing_products
      from public.shift_product_reconciliations r
      where r.shift_id = v_shift.id;
      if v_existing_products is distinct from v_norm_products then
        raise exception 'This shift has already been reconciled with a different inventory payload.'
          using errcode = '22023';
      end if;
    end if;
    -- Heal stuck pending flags after a prior successful remittance (no inventory rewrite).
    update public.shifts
    set reconciliation_required = false,
        inventory_reconciliation_required = false
    where id = v_shift.id
      and (reconciliation_required or inventory_reconciliation_required);
    return jsonb_build_object(
      'shift_id', v_shift.id,
      'shift_status', 'closed',
      'expected_cash', v_existing_cash.expected_cash,
      'actual_cash', v_existing_cash.actual_cash,
      'expected_gcash', v_existing_cash.expected_gcash, 'actual_gcash', v_existing_cash.actual_gcash,
      'difference', v_existing_cash.difference,
      'result', v_existing_cash.result,
      'products', public.shift_close_product_summaries(v_shift.id),
      'status', 'reconciled',
      'idempotent', true
    );
  end if;

  -- Mutating path: lock inventory rows now (branch+shift already held)
  perform 1
  from public.branch_inventory bi
  where bi.branch_id = v_branch_id
  order by bi.product_id
  for update;

  if v_needs_inventory and exists (
    select 1 from public.shift_product_close_baselines b where b.shift_id = v_shift.id
  ) then
    for v_item in
      select *
      from jsonb_to_recordset(v_norm_products)
        as x(product_id uuid, actual_remaining bigint, waste_quantity bigint, discrepancy_note text)
      order by product_id
    loop
      select * into v_base
      from public.shift_product_close_baselines
      where shift_id = v_shift.id and product_id = v_item.product_id;

      v_actual_rem := v_item.actual_remaining;
      v_waste := v_item.waste_quantity;
      v_note := nullif(btrim(coalesce(v_item.discrepancy_note, '')), '');
      if v_actual_rem is null or v_actual_rem < 0 or v_waste is null or v_waste < 0 then
        raise exception 'Actual remaining and waste must be whole PCS quantities >= 0.'
          using errcode = '22023';
      end if;
      if length(coalesce(v_note, '')) > 500 then
        raise exception 'Discrepancy note is too long (maximum 500 characters).'
          using errcode = '22023';
      end if;

      select p.inventory_mode into v_mode
      from public.products p
      where p.id = v_base.product_id;
      if v_mode = 'kg_meal' and (v_actual_rem <> 0 or v_waste <> 0) then
        raise exception
          'KG (%) is Main-tracked only. Booth close does not count KG stock — enter 0 remaining and 0 waste.',
          v_base.product_name_snapshot
          using errcode = '22023';
      end if;

      select * into v_agg
      from public.aggregate_shift_product_movements(v_shift, v_base.product_id, v_base.opening_quantity);

      select quantity_on_hand into v_live
      from public.branch_inventory
      where branch_id = v_shift.branch_id and product_id = v_base.product_id;
      if coalesce(v_live, 0) <> v_agg.system_balance_before_waste then
        raise exception 'System stock for % changed unexpectedly during close (live %, expected %).',
          v_base.product_name_snapshot, coalesce(v_live, 0), v_agg.system_balance_before_waste
          using errcode = '55000';
      end if;

      v_expected_rem := v_agg.system_balance_before_waste - v_waste;
      v_discrepancy := v_actual_rem - v_expected_rem;
      v_result := case
        when v_discrepancy = 0 then 'exact'::public.shift_product_recon_result
        when v_discrepancy < 0 then 'shortage'::public.shift_product_recon_result
        else 'excess'::public.shift_product_recon_result
      end;

      if v_discrepancy <> 0 and v_mode = 'kg_meal' and v_note is null then
        raise exception 'KG discrepancy note is required for %.', v_base.product_name_snapshot
          using errcode = '22023';
      end if;

      if v_base.closing_stock_behavior = 'keep_at_branch' then
        v_carried := v_actual_rem;
        v_unsold := 0;
      else
        v_carried := 0;
        v_unsold := v_actual_rem;
      end if;

      insert into public.shift_product_reconciliations (
        shift_id, branch_id, product_id,
        product_name_snapshot, sku_snapshot, closing_stock_behavior,
        opening_quantity, received_quantity, outgoing_quantity, sold_quantity,
        waste_quantity, adjustment_quantity, net_other_movement_quantity,
        expected_remaining, actual_remaining, discrepancy,
        unsold_quantity, carried_quantity, result, discrepancy_note, recorded_by
      ) values (
        v_shift.id, v_shift.branch_id, v_base.product_id,
        v_base.product_name_snapshot, v_base.sku_snapshot, v_base.closing_stock_behavior,
        v_base.opening_quantity, v_agg.received_quantity, v_agg.outgoing_quantity, v_agg.sold_quantity,
        v_waste, v_agg.adjustment_quantity, 0,
        v_expected_rem, v_actual_rem, v_discrepancy,
        v_unsold, v_carried, v_result, v_note, v_user.id
      )
      returning id into v_recon_id;

      -- Release any earlier reservation before waste/adjustment move the balance.
      update public.branch_inventory
      set quantity_awaiting_return = 0
      where branch_id = v_shift.branch_id and product_id = v_base.product_id;

      v_adjust_qty := (v_actual_rem + v_waste) - v_agg.system_balance_before_waste;
      if v_adjust_qty <> 0 then
        update public.branch_inventory
        set quantity_on_hand = quantity_on_hand + v_adjust_qty
        where branch_id = v_shift.branch_id and product_id = v_base.product_id;
        if not found then
          insert into public.branch_inventory(branch_id, product_id, quantity_on_hand)
          values (v_shift.branch_id, v_base.product_id, greatest(v_adjust_qty, 0));
          if v_adjust_qty < 0 then
            raise exception 'Insufficient stock during close adjustment for %.', v_base.product_name_snapshot
              using errcode = '22023';
          end if;
        end if;
        insert into public.inventory_movements(
          branch_id, product_id, movement_type, quantity,
          reference_type, reference_id, created_by, notes
        ) values (
          v_shift.branch_id, v_base.product_id, 'adjustment', v_adjust_qty,
          'adjustment', v_adjust_ref, v_user.id, 'Shift close inventory reconciliation'
        );
      end if;

      if v_waste > 0 then
        update public.branch_inventory
        set quantity_on_hand = quantity_on_hand - v_waste
        where branch_id = v_shift.branch_id
          and product_id = v_base.product_id
          and quantity_on_hand >= v_waste;
        if not found then
          raise exception 'Insufficient stock during waste write for %.', v_base.product_name_snapshot
            using errcode = '22023';
        end if;
        insert into public.inventory_movements(
          branch_id, product_id, movement_type, quantity,
          reference_type, reference_id, created_by
        ) values (
          v_shift.branch_id, v_base.product_id, 'waste', -v_waste,
          'shift_product_reconciliation', v_recon_id, v_user.id
        );
        insert into public.shift_waste_occurrences(
          shift_id, branch_id, product_id, recorded_by, quantity
        ) values (
          v_shift.id, v_shift.branch_id, v_base.product_id, v_user.id, v_waste
        );
      end if;

      -- Record the unsold count on the reconciliation row, but leave the pieces
      -- on hand. The cashier returns them afterwards; that submission is the only deduction.
      update public.branch_inventory
      set quantity_awaiting_return = case
        when v_base.closing_stock_behavior = 'record_as_unsold' then v_actual_rem
        else 0
      end
      where branch_id = v_shift.branch_id
        and product_id = v_base.product_id
        and (
          v_base.closing_stock_behavior = 'keep_at_branch'
          or quantity_on_hand = v_actual_rem
        );

      select quantity_on_hand, quantity_awaiting_return
      into v_live, v_reserved
      from public.branch_inventory
      where branch_id = v_shift.branch_id and product_id = v_base.product_id;
      if coalesce(v_live, 0) <> v_actual_rem then
        raise exception 'Close left unexpected usable stock for %.', v_base.product_name_snapshot
          using errcode = '55000';
      end if;
      if v_base.closing_stock_behavior = 'keep_at_branch' then
        if coalesce(v_reserved, 0) <> 0 then
          raise exception 'Carryover close reserved stock for %.', v_base.product_name_snapshot
            using errcode = '55000';
        end if;
      elsif coalesce(v_reserved, 0) <> v_actual_rem then
        raise exception 'Unsold close did not reserve the counted leftover for %.', v_base.product_name_snapshot
          using errcode = '55000';
      end if;

      v_product_summaries := v_product_summaries || jsonb_build_array(jsonb_build_object(
        'product_id', v_base.product_id,
        'expected_remaining', v_expected_rem,
        'actual_remaining', v_actual_rem,
        'waste_quantity', v_waste,
        'discrepancy', v_discrepancy,
        'result', v_result,
        'unsold_quantity', v_unsold,
        'carried_quantity', v_carried
      ));
    end loop;
  end if;

  v_cash_diff := v_expected - v_actual;
  v_cash_result := case
    when v_cash_diff = 0 then 'exact'::public.cash_reconciliation_result
    when v_cash_diff > 0 then 'shortage'::public.cash_reconciliation_result
    else 'excess'::public.cash_reconciliation_result
  end;

  insert into public.shift_reconciliations(
    shift_id, branch_id, expected_cash, actual_cash, difference, result, recorded_by, expected_gcash, actual_gcash
  ) values (
    v_shift.id, v_shift.branch_id, v_expected, v_actual, v_cash_diff, v_cash_result, v_user.id, v_expected_gcash, v_actual_gcash
  );

  update public.shifts
  set reconciliation_required = false,
      inventory_reconciliation_required = false
  where id = v_shift.id;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'shift_status', 'closed',
    'expected_cash', v_expected,
    'actual_cash', v_actual,
    'expected_gcash', v_expected_gcash, 'actual_gcash', v_actual_gcash,
    'difference', v_cash_diff,
    'result', v_cash_result,
    'products', v_product_summaries,
    'status', 'reconciled',
    'idempotent', false
  );
end;
$$;
revoke all on function public.finalize_cashier_shift_reconciliation(uuid,text,jsonb,text) from public,anon;
grant execute on function public.finalize_cashier_shift_reconciliation(uuid,text,jsonb,text) to authenticated;
create or replace function public.finalize_cashier_shift_reconciliation(p_shift_id uuid,p_actual_cash text,p_products jsonb default '[]'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.finalize_cashier_shift_reconciliation(p_shift_id,p_actual_cash,p_products,null::text)
$$;

create or replace function public.get_shift_remittance_detail(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_shift_id is null then
    raise exception 'Shift id is required.' using errcode = '22023';
  end if;
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Unauthorized: Owner or Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'shift_id', s.id,
    'branch_id', s.branch_id,
    'branch_name', b.name,
    'cashier_id', s.cashier_id,
    'cashier_name', cashier.full_name,
    'started_at', s.started_at,
    'ended_at', s.ended_at,
    'sales_cutoff_at', s.sales_cutoff_at,
    'inventory_reconciliation_required', s.inventory_reconciliation_required,
    'reconciliation_required', s.reconciliation_required,
    'cash_status', case when r.id is null then 'pending' else 'reconciled' end,
    'expected_cash', coalesce(r.expected_cash, case when (t.totals->>'unrecorded_count')::int=0 then (t.totals->>'cash')::numeric end, (
      select coalesce(sum(sales.total_amount), 0)::numeric(12,2)
      from public.sales
      where sales.shift_id = s.id and sales.status = 'completed'
    )),
    'actual_cash', r.actual_cash,
    'actual_gcash', r.actual_gcash,
    'expected_gcash', case when r.id is not null then r.expected_gcash when (t.totals->>'unrecorded_count')::int=0 then (t.totals->>'gcash')::numeric end,
    'difference', r.difference,
    'cash_result', r.result,
    'reconciled_at', r.reconciled_at,
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pr.id,
          'shift_id', pr.shift_id,
          'product_id', pr.product_id,
          'product_name_snapshot', pr.product_name_snapshot,
          'sku_snapshot', pr.sku_snapshot,
          'closing_stock_behavior', pr.closing_stock_behavior,
          'opening_quantity', pr.opening_quantity,
          'received_quantity', pr.received_quantity,
          'outgoing_quantity', pr.outgoing_quantity,
          'sold_quantity', pr.sold_quantity,
          'waste_quantity', pr.waste_quantity,
          'adjustment_quantity', pr.adjustment_quantity,
          'expected_remaining', pr.expected_remaining,
          'actual_remaining', pr.actual_remaining,
          'discrepancy', pr.discrepancy,
          'unsold_quantity', pr.unsold_quantity,
          'carried_quantity', pr.carried_quantity,
          'result', pr.result,
          'discrepancy_note', pr.discrepancy_note,
          'reconciled_at', pr.reconciled_at
        )
        order by pr.product_name_snapshot
      )
      from public.shift_product_reconciliations pr
      where pr.shift_id = s.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.shifts s
  cross join lateral (select public.shift_payment_totals(s.id) as totals) t
  join public.branches b on b.id = s.branch_id
  join public.profiles cashier on cashier.id = s.cashier_id
  left join public.shift_reconciliations r on r.shift_id = s.id
  where s.id = p_shift_id
    and s.status = 'closed'
    and not b.is_main_branch
    and (r.id is not null or s.reconciliation_required);

  if v_result is null then
    raise exception 'Shift remittance not found.' using errcode = '22023';
  end if;
  return v_result;
end;
$$;



create or replace function public.report_branch_shift_remittances(
  p_branch_id uuid default null,
  p_range_type text default 'all_time',
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := null;
  v_end timestamptz := null;
  v_result jsonb;
begin
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Unauthorized: Owner or Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  if p_range_type = 'today' then
    v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
    v_end := v_start + interval '1 day';
  elsif p_range_type = 'custom' then
    if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
      raise exception 'Valid start and end dates required for custom range.' using errcode = '22023';
    end if;
    v_start := p_start_date;
    v_end := p_end_date;
  elsif p_range_type = 'all_time' then
    v_start := null;
    v_end := null;
  else
    raise exception 'Invalid range type. Expected today, custom, or all_time.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'days',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'business_date', d.business_date,
          'expected_cash', d.expected_cash, 'expected_gcash', d.expected_gcash, 'actual_gcash', d.actual_gcash, 'pending_gcash', d.pending_gcash,
          'actual_remitted', d.actual_remitted,
          'total_shortage', d.total_shortage,
          'total_excess', d.total_excess,
          'reconciled_shift_count', d.reconciled_shift_count,
          'pending_shift_count', d.pending_shift_count,
          'pending_expected_cash', d.pending_expected_cash,
          'shifts', d.shifts
        )
        order by d.business_date desc
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from (
    select
      e.business_date,
      sum(e.expected_gcash) as expected_gcash, sum(e.actual_gcash) as actual_gcash,
      sum(e.expected_gcash) filter(where e.status='pending') as pending_gcash,
      coalesce(sum(e.expected_cash), 0)::numeric(12,2) as expected_cash,
      count(*) filter (where e.status = 'reconciled')::integer as reconciled_shift_count,
      case
        when count(*) filter (where e.status = 'reconciled') = 0 then null
        else coalesce(sum(e.actual_cash) filter (where e.status = 'reconciled'), 0)::numeric(12,2)
      end as actual_remitted,
      coalesce(sum(e.difference) filter (where e.status = 'reconciled' and e.difference > 0), 0)::numeric(12,2)
        + coalesce(sum(greatest(e.expected_gcash-e.actual_gcash,0)) filter(where e.status='reconciled'),0) as total_shortage,
      coalesce(sum(abs(e.difference)) filter (where e.status = 'reconciled' and e.difference < 0), 0)::numeric(12,2)
        + coalesce(sum(greatest(e.actual_gcash-e.expected_gcash,0)) filter(where e.status='reconciled'),0) as total_excess,
      count(*) filter (where e.status = 'pending')::integer as pending_shift_count,
      coalesce(sum(e.expected_cash) filter (where e.status = 'pending'), 0)::numeric(12,2) as pending_expected_cash,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'business_date', e.business_date,
            'shift_id', e.shift_id,
            'branch_id', e.branch_id,
            'branch_name', e.branch_name,
            'cashier_id', e.cashier_id,
            'cashier_name', e.cashier_name,
            'started_at', e.started_at,
            'ended_at', e.ended_at,
            'status', e.status,
            'expected_cash', e.expected_cash,
            'actual_cash', e.actual_cash, 'expected_gcash', e.expected_gcash, 'actual_gcash', e.actual_gcash,
            'difference', e.difference,
            'result', e.result,
            'reconciled_at', e.reconciled_at
          )
          order by e.ended_at desc, e.shift_id
        ),
        '[]'::jsonb
      ) as shifts
    from (
      select
        s.id as shift_id,
        (timezone('Asia/Manila', s.ended_at))::date as business_date,
        s.branch_id,
        b.name as branch_name,
        s.cashier_id,
        cashier.full_name as cashier_name,
        s.started_at,
        s.ended_at,
        case when r.id is null then 'pending' else 'reconciled' end as status,
        coalesce(r.expected_cash, case when (t->>'unrecorded_count')::int=0 then (t->>'cash')::numeric end, (
          select coalesce(sum(sales.total_amount), 0)::numeric(12,2)
          from public.sales
          where sales.shift_id = s.id and sales.status = 'completed'
        )) as expected_cash,
        case when r.id is not null then r.expected_gcash when (t->>'unrecorded_count')::int=0 then (t->>'gcash')::numeric end as expected_gcash,
        r.actual_gcash, r.actual_cash,
        r.difference,
        r.result,
        r.reconciled_at
      from public.shifts s
      cross join lateral public.shift_payment_totals(s.id) t
      join public.branches b on b.id = s.branch_id
      join public.profiles cashier on cashier.id = s.cashier_id
      left join public.shift_reconciliations r on r.shift_id = s.id
      where s.status = 'closed'
        and not b.is_main_branch
        and (p_branch_id is null or s.branch_id = p_branch_id)
        and (r.id is not null or s.reconciliation_required)
        and (v_start is null or (s.ended_at >= v_start and s.ended_at < v_end))
    ) e
    group by e.business_date
  ) d;

  return v_result;
end;
$$;

revoke all on function public.report_branch_shift_remittances(uuid, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.report_branch_shift_remittances(uuid, text, timestamptz, timestamptz)
  to authenticated;


create function public.list_cashier_day_stock()
returns table(product_id uuid, product_name text, on_hand numeric, awaiting_return numeric, available numeric, stock_unit_code text)
language sql stable security definer set search_path='' as $$
  select p.id, p.name, i.quantity_on_hand, i.quantity_awaiting_return,
    i.quantity_on_hand - i.quantity_awaiting_return, p.stock_unit_code
  from public.profiles u
  join public.branches b on b.id=u.branch_id and b.is_active and not b.is_main_branch
  join public.branch_inventory i on i.branch_id=b.id
  join public.products p on p.id=i.product_id
  where u.id=auth.uid() and u.is_active and u.role='cashier' and p.inventory_mode='piece_stock'
  order by p.name, p.id
$$;
revoke all on function public.list_cashier_day_stock() from public,anon;
grant execute on function public.list_cashier_day_stock() to authenticated;
commit;
