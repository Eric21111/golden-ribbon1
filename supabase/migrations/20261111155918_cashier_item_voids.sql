begin;
alter table public.sale_items
  add column stock_per_unit jsonb,
  add column void_history jsonb not null default '[]',
  drop constraint sale_items_quantity_check,
  add constraint sale_items_quantity_check check (quantity > 0 or (quantity = 0 and jsonb_array_length(void_history)>0));
alter table public.sales add column void_amount numeric(12,2) not null default 0 check(void_amount>=0),
  drop constraint sales_check2,
  add constraint sales_change_amount_check check(change_amount = amount_paid - total_amount - void_amount);

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
  v_line_stock jsonb;
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
      'variant_id', v_item.variant_id,
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
    select it.product_id, it.variant_id, it.master_variant_id, it.drink_product_id, it.quantity,
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
    from jsonb_to_recordset(v_mapped) as it(product_id uuid, variant_id uuid, master_variant_id uuid, drink_product_id uuid, quantity bigint)
  ),
  lines as (
    select r.product_id, r.variant_id, r.drink_product_id, r.quantity as ordered, u.quantity as per_unit, u.ingredient_product_id as ingredient_id
    from resolved r
    join public.product_stock_uses u
      on (r.source = 'variant' and u.variant_id = r.master_variant_id and u.product_id = r.product_id)
      or (r.source = 'product' and u.product_id = r.product_id and u.variant_id is null)
    union all
    select r.product_id, r.variant_id, r.drink_product_id, r.quantity, 1, r.product_id
    from resolved r
    where r.source = 'legacy'
    union all
    select r.product_id, r.variant_id, r.drink_product_id, r.quantity, 1, r.drink_product_id
    from resolved r
    where r.drink_product_id is not null
  )
  select (select jsonb_agg(to_jsonb(t) order by t.product_id) from (
            select ingredient_id as product_id, sum(ordered * per_unit)::bigint as quantity
            from lines group by ingredient_id
          ) t),
         (select jsonb_agg(to_jsonb(t)) from (
            select product_id, variant_id, drink_product_id, ingredient_id, sum(per_unit)::bigint as units
            from lines group by product_id, variant_id, drink_product_id, ingredient_id
          ) t)
  into v_deductions, v_line_stock;

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
      drink_product_id, drink_name, stock_per_unit
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
      (select p.name from public.products p where p.id = v_item.drink_product_id),
      (select jsonb_object_agg(x.ingredient_id, x.units) from jsonb_to_recordset(v_line_stock)
        as x(product_id uuid, variant_id uuid, drink_product_id uuid, ingredient_id uuid, units bigint)
        where x.product_id=v_item.product_id and x.variant_id is not distinct from v_item.variant_id
          and x.drink_product_id is not distinct from v_item.drink_product_id)
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

create function public.void_cashier_sale_item(p_item uuid, p_quantity integer, p_expected_quantity integer, p_reason text, p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare
  branch uuid;
  sale public.sales%rowtype;
  item public.sale_items%rowtype;
  restoration record;
  amount numeric;
  catalog numeric;
  event_id uuid := gen_random_uuid();
  memo text := btrim(coalesce(p_note,''));
begin
  select branch_id into branch from public.profiles where id=auth.uid() and role='cashier' and is_active for update;
  if not found then raise exception 'An active cashier is required.'; end if;
  select s.* into sale from public.sales s join public.sale_items i on i.sale_id=s.id
    where i.id=p_item and s.cashier_id=auth.uid() and s.branch_id=branch;
  if not found then raise exception 'Receipt unavailable.'; end if;
  perform public.lock_branch_inventory_gate(branch);
  perform 1 from public.shifts where id=sale.shift_id and status='open' and sales_cutoff_at is null
    and cashier_id=auth.uid() and branch_id=branch for update;
  if not found then raise exception 'Only your open shift can be changed.'; end if;
  select * into item from public.sale_items where id=p_item for update;
  if p_quantity is null or p_quantity<1 or p_expected_quantity is distinct from item.quantity or p_quantity>item.quantity then
    raise exception 'Receipt quantity changed. Refresh the receipt before trying again.';
  end if;
  if sale.status <> 'completed' or item.stock_per_unit is null or item.stock_per_unit='{}' then
    raise exception 'Original stock details are unavailable for this item.';
  end if;
  if p_reason is null or p_reason not in ('Wrong item','Wrong quantity','Duplicate entry','Customer changed order','Order cancelled','Other')
    or length(memo)>250 or (p_reason='Other' and memo='') then raise exception 'Choose a reason and describe Other.'; end if;
  amount := item.unit_price*p_quantity;
  catalog := item.catalog_unit_price*p_quantity;
  for restoration in select key::uuid as product, value::bigint*p_quantity as units from jsonb_each_text(item.stock_per_unit) order by key loop
    update public.branch_inventory set quantity_on_hand=quantity_on_hand+restoration.units
      where branch_id=branch and product_id=restoration.product;
    if not found then raise exception 'Original stock balance unavailable.'; end if;
    insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by,notes)
      values(branch,restoration.product,'adjustment',restoration.units,'adjustment',event_id,auth.uid(),'Item void on '||sale.sale_number);
  end loop;
  perform set_config('app.cashier_item_void','on',true);
  update public.sale_items set quantity=quantity-p_quantity, subtotal=subtotal-amount,
    discount_amount=discount_amount-(catalog-amount),
    void_history=void_history||jsonb_build_array(jsonb_build_object('id',event_id,'quantity',p_quantity,'amount',amount,
      'reason',p_reason,'note',memo,'cashier_id',auth.uid(),'at',now())) where id=p_item;
  update public.sales set subtotal=subtotal-amount,total_amount=total_amount-amount,void_amount=void_amount+amount,
    catalog_subtotal=catalog_subtotal-catalog,discount_amount=discount_amount-(catalog-amount),
    status=case when exists(select 1 from public.sale_items where sale_id=sale.id and quantity>0)
      then status else 'voided'::public.sale_status end where id=sale.id;
  perform set_config('app.cashier_item_void','off',true);
end;
$$;
revoke all on function public.void_cashier_sale_item(uuid,integer,integer,text,text) from public,anon;
grant execute on function public.void_cashier_sale_item(uuid,integer,integer,text,text) to authenticated;

create or replace function public.protect_sale_history() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and current_setting('app.allow_archive_cleanup',true)='on' then return old; end if;
  if tg_op='UPDATE' and current_setting('app.cashier_item_void',true)='on'
    and current_user=pg_get_userbyid((select proowner from pg_proc where oid='public.void_cashier_sale_item(uuid,integer,integer,text,text)'::regprocedure))
    then return new; end if;
  raise exception 'Completed sale history is immutable.' using errcode='55000';
end;
$$;
commit;
