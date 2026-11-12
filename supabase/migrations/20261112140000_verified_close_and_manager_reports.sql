begin;
revoke execute on function public.begin_cashier_shift_close(uuid) from public,anon,authenticated;
create function public.begin_verified_cashier_close(p_shift_id uuid,p_cashier uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
begin
  select * into v_user
  from public.profiles
  where id = p_cashier and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id;
  if not found or v_shift.cashier_id <> v_user.id or v_shift.branch_id is distinct from v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  -- Keep the verified cashier attribution for existing shift audit triggers.
  perform set_config('request.jwt.claim.sub',v_user.id::text,true);
  return public.begin_shift_close_core(p_shift_id, v_user.id);
end;
$$;

revoke all on function public.begin_verified_cashier_close(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_verified_cashier_close(uuid,uuid) to service_role;

create function public.manager_today_payments(p_branch uuid default null)
returns table(method text,program text,amount numeric,orders bigint)
language sql stable security definer set search_path='' as $$
  select coalesce(s.payment_method::text,'unrecorded'),coalesce(s.pricing_program::text,'standard'),sum(s.total_amount),count(*)
  from public.sales s join public.profiles u on u.id=auth.uid() join public.branches b on b.id=u.branch_id
  where u.id=auth.uid() and u.role='manager' and u.is_active and (b.is_main_branch or b.id=s.branch_id) and (p_branch is null or s.branch_id=p_branch) and s.status='completed'
    and s.sold_at >= (timezone('Asia/Manila',now())::date::timestamp at time zone 'Asia/Manila')
    and s.sold_at < ((timezone('Asia/Manila',now())::date+1)::timestamp at time zone 'Asia/Manila')
  group by 1,2
$$;
revoke all on function public.manager_today_payments(uuid) from public,anon;
grant execute on function public.manager_today_payments(uuid) to authenticated;
create or replace function public.get_manager_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_branch uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_today_sales numeric(12,2);
  v_today_tx bigint;
  v_inventory_count bigint;
  v_pending_incoming bigint;
  v_returns_in_transit bigint;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;

  if not found or v_user.role is distinct from 'manager' then
    raise exception 'Unauthorized: Manager access required.' using errcode = '42501';
  end if;

  v_branch := v_user.branch_id;
  if v_branch is null then
    raise exception 'No branch assigned to this manager.' using errcode = '42501';
  end if;

  v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
  v_end := v_start + interval '1 day';

  select coalesce(sum(amount),0),coalesce(sum(orders),0) into v_today_sales,v_today_tx
  from public.manager_today_payments();

  select count(id)::bigint into v_inventory_count
  from public.branch_inventory
  where branch_id = v_branch and quantity_on_hand > 0;

  select count(id)::bigint into v_pending_incoming
  from public.stock_transfers
  where to_branch_id = v_branch and status = 'pending_receipt';

  select count(id)::bigint into v_returns_in_transit
  from public.stock_returns
  where (from_branch_id = v_branch or to_branch_id = v_branch)
    and status = 'in_transit';

  return jsonb_build_object(
    'today_sales', v_today_sales,
    'today_transactions', v_today_tx,
    'current_inventory_count', v_inventory_count,
    'pending_incoming_transfers_count', v_pending_incoming,
    'returns_in_transit_count', v_returns_in_transit
  );
end;
$$;
create function public.pos_inventory_for_branch(v_branch_id uuid)
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
as $$ begin
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
revoke all on function public.pos_inventory_for_branch(uuid) from public,anon,authenticated;
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

  return query select * from public.pos_inventory_for_branch(v_branch_id);
end $$;
create function public.manager_branch_stock(p_branch uuid)
returns table(product_id uuid,on_hand numeric,held numeric,available numeric,sellable numeric)
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles u join public.branches b on b.id=u.branch_id
    where u.id=auth.uid() and u.is_active and u.role='manager' and b.is_active and (b.is_main_branch or b.id=p_branch))
    then raise exception 'Unauthorized branch.' using errcode='42501'; end if;
  return query select coalesce(i.product_id,p.product_id),coalesce(i.quantity_on_hand,0),coalesce(i.quantity_awaiting_return,0),
    coalesce(i.quantity_on_hand-i.quantity_awaiting_return,0),p.sellable_quantity
    from (select * from public.branch_inventory where branch_id=p_branch) i
    full join public.pos_inventory_for_branch(p_branch) p on i.product_id=p.product_id;
end $$;
revoke all on function public.manager_branch_stock(uuid) from public,anon;
grant execute on function public.manager_branch_stock(uuid) to authenticated;
commit;
