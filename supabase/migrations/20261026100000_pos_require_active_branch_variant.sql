-- POS: a product with configured options must be sold through an ACTIVE branch option.
--
-- Bug: confirm_sale decided "this product has options" by looking only at ACTIVE branch options. With every branch option
-- switched off, or no option rows at the branch, the product looked like a single-price product: the menu listed it with no
-- options and a sale went through at branch_products.selling_price (the first option's price at creation, never updated),
-- deducting only the product itself (no option recipe, no drink choice).
--
-- Rule (new): a product "has configured options" when it has ANY master option (a product_variants row, active or not: a
-- retired option still means the product was set up with options, so it can never fall back to single price). Then:
--   * it needs an active branch option (branch_product_variants) at the branch to be on the menu or sold;
--   * with none, it is unavailable: left off list_cashier_pos_inventory, refused by confirm_sale, and get_cashier_line_prices
--     returns no row for it (the client reads a missing row as "no longer available");
--   * a line without an option is never priced from the base price for such a product.
-- A product WITHOUT master options (a genuine single-price product) is unaffected everywhere.
--
-- ADDITIVE and data-preserving: two small internal helper functions, then create or replace of the three functions with the
-- same signatures, return types, grants and behavior except the lines marked above. Nothing is updated, deleted or backfilled:
-- existing sales, sale_items, prices, recipes, branch rows and inventory are untouched, and an idempotent replay of an earlier
-- sale still returns that sale. Affected products simply stop being sellable until an option is re-enabled for the branch.

begin;

-- True when the product has configured options but the branch has no active option for it.
create or replace function public.pos_options_unavailable(p_branch_id uuid, p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.product_variants pv
      where pv.product_id = p_product_id
    )
    and not exists (
      select 1 from public.branch_product_variants bpv
      where bpv.branch_id = p_branch_id and bpv.product_id = p_product_id and bpv.is_active
    );
$$;

-- True when a sale line for the product must name an option (it has configured options, or active branch options).
create or replace function public.pos_option_required(p_branch_id uuid, p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.product_variants pv
      where pv.product_id = p_product_id
    )
    or exists (
      select 1 from public.branch_product_variants bpv
      where bpv.branch_id = p_branch_id and bpv.product_id = p_product_id and bpv.is_active
    );
$$;

revoke all on function public.pos_options_unavailable(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pos_option_required(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- confirm_sale: copied from 20261024120000 with ONE addition (the guard after the branch-catalog check)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_sale(
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


revoke all on function public.confirm_sale(uuid, jsonb, numeric, text, text) from public, anon;
grant execute on function public.confirm_sale(uuid, jsonb, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- list_cashier_pos_inventory: copied from 20261024160000 with ONE added condition
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
  inventory_mode public.inventory_mode,
  sellable_quantity numeric,
  stock_uses jsonb
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
  with cat as (
    select
      b.id as c_branch,
      b.name as c_branch_name,
      p.id as c_pid,
      p.name as c_pname,
      p.sku as c_sku,
      bp.selling_price as c_price,
      coalesce(bi.quantity_on_hand, 0) as c_qoh,
      coalesce(bi.updated_at, bp.updated_at) as c_upd,
      p.inventory_mode as c_mode
    from public.branch_products bp
    join public.products p on p.id = bp.product_id
    join public.branches b on b.id = bp.branch_id
    left join public.branch_inventory bi
      on bi.product_id = bp.product_id and bi.branch_id = bp.branch_id
    where bp.branch_id = v_branch_id
      and bp.is_active
      and p.is_active
      and p.sell_in_pos
      and not public.pos_options_unavailable(bp.branch_id, p.id)
      and b.is_active
      and not b.is_main_branch
  ),
  prod as (
    select c.*, public.pos_effective_stock_lines(c.c_pid, null) as c_lines
    from cat c
  ),
  var as (
    select
      c.c_pid as v_pid,
      bpv.id as v_id,
      bpv.name as v_name,
      bpv.selling_price as v_price,
      (
        select min(pv.sort_order)
        from public.product_variants pv
        where pv.product_id = bpv.product_id
          and lower(pv.name) = lower(bpv.name)
      ) as v_sort,
      public.pos_effective_stock_lines(bpv.product_id, bpv.name) as v_lines,
      public.pos_variant_drink_ids(bpv.product_id, bpv.name) as v_drinks
    from cat c
    join public.branch_product_variants bpv
      on bpv.branch_id = c.c_branch
     and bpv.product_id = c.c_pid
     and bpv.is_active
  ),
  var_s as (
    select
      v.*,
      case
        when v.v_drinks is null and v.v_lines is not null and exists (
          select 1
          from public.product_drink_choices dc
          join public.product_variants dpv on dpv.id = dc.variant_id
          where dc.product_id = v.v_pid and lower(dpv.name) = lower(v.v_name)
        ) then 0
        when v.v_drinks is null or cardinality(v.v_drinks) = 0
          then public.pos_lines_sellable(v_branch_id, v.v_lines)
        else least(
          public.pos_lines_sellable(v_branch_id, v.v_lines),
          (
            select coalesce(sum(floor(coalesce(dbi.quantity_on_hand, 0))), 0)
            from unnest(v.v_drinks) as d(drink_id)
            left join public.branch_inventory dbi
              on dbi.branch_id = v_branch_id and dbi.product_id = d.drink_id
          )
        )
      end as v_sellable
    from var v
  ),
  ing as (
    select s.pid as i_pid, e.ing_id as i_ing
    from (
      select pr.c_pid as pid, pr.c_lines as lines from prod pr
      union all
      select v.v_pid, v.v_lines from var v
      union all
      select v.v_pid, (
        select jsonb_agg(jsonb_build_object('ingredient_product_id', d.drink_id, 'quantity', 1))
        from unnest(coalesce(v.v_drinks, '{}'::uuid[])) as d(drink_id)
      )
      from var v
    ) s
    cross join lateral (
      select distinct (x.value->>'ingredient_product_id')::uuid as ing_id
      from jsonb_array_elements(coalesce(s.lines, '[]'::jsonb)) x
    ) e
  ),
  ing_stock as (
    select
      i.i_pid as s_pid,
      jsonb_object_agg(i.i_ing::text, coalesce(ibi.quantity_on_hand, 0)) as s_stock,
      jsonb_object_agg(i.i_ing::text, ip.name) as s_names
    from ing i
    join public.products ip on ip.id = i.i_ing
    left join public.branch_inventory ibi
      on ibi.branch_id = v_branch_id and ibi.product_id = i.i_ing
    group by i.i_pid
  )
  select
    c.c_branch,
    c.c_branch_name,
    c.c_pid,
    c.c_pname,
    c.c_sku,
    c.c_price,
    c.c_qoh,
    c.c_upd,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.v_id,
          'name', v.v_name,
          'selling_price', v.v_price,
          'sellable_quantity', v.v_sellable
        )
        order by coalesce(v.v_sort, 2147483647), v.v_name, v.v_id
      )
      from var_s v
      where v.v_pid = c.c_pid
    ), '[]'::jsonb),
    c.c_mode,
    case
      when exists (select 1 from var_s v where v.v_pid = c.c_pid)
        then (select max(v.v_sellable) from var_s v where v.v_pid = c.c_pid)
      else public.pos_lines_sellable(v_branch_id, c.c_lines)
    end,
    jsonb_build_object(
      'product', c.c_lines,
      'variants', coalesce((select jsonb_object_agg(v.v_id::text, v.v_lines) from var_s v where v.v_pid = c.c_pid), '{}'::jsonb),
      'drinks', coalesce((
        select jsonb_object_agg(v.v_id::text, to_jsonb(v.v_drinks))
        from var_s v
        where v.v_pid = c.c_pid and v.v_drinks is not null and cardinality(v.v_drinks) > 0
      ), '{}'::jsonb),
      'ingredient_stock', coalesce(s.s_stock, '{}'::jsonb),
      'ingredient_names', coalesce(s.s_names, '{}'::jsonb)
    )
  from prod c
  left join ing_stock s on s.s_pid = c.c_pid
  order by c.c_pname, c.c_pid;
end;
$$;


revoke all on function public.list_cashier_pos_inventory() from public, anon;
grant execute on function public.list_cashier_pos_inventory() to authenticated;

comment on function public.list_cashier_pos_inventory() is
  'Cashier POS catalog for the open shift branch. Products with sell_in_pos false are omitted as standalone items. A product with configured options is omitted while the branch has no active option for it. Stock of omitted products can still fill a meal Drink Choice or a recipe.';

-- ---------------------------------------------------------------------------
-- get_cashier_line_prices: copied from 20260922110000 with ONE changed condition
-- ---------------------------------------------------------------------------
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
  -- A line without an option is priced only for a genuine single-price product. A product with configured options has no
  -- base price to fall back to: no row means "no longer available" to the client.
  where (lines.variant_id is null and not public.pos_option_required(v_branch_id, lines.product_id))
     or bpv.id is not null;
end;
$$;


revoke all on function public.get_cashier_line_prices(jsonb) from public, anon;
grant execute on function public.get_cashier_line_prices(jsonb) to authenticated;

commit;
