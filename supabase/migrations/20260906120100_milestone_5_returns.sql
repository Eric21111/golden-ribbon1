begin;
create type public.stock_return_status as enum ('draft','in_transit','received','received_with_discrepancy','cancelled');
create sequence public.return_number_seq;
create table public.stock_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null unique,
  from_branch_id uuid not null references public.branches(id),
  to_branch_id uuid not null references public.branches(id),
  status public.stock_return_status not null default 'in_transit' check(status in ('draft','in_transit','cancelled')),
  created_by uuid not null references public.profiles(id),
  returned_by uuid not null references public.profiles(id),
  returned_at timestamptz not null default now(),
  received_by uuid references public.profiles(id) check(received_by is null),
  received_at timestamptz check(received_at is null),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  from_branch_name text not null,
  to_branch_name text not null,
  returned_by_name text not null,
  idempotency_key text not null,
  request_items jsonb not null,
  unique(created_by,idempotency_key),
  check(from_branch_id <> to_branch_id)
);
create table public.stock_return_items (
  id uuid primary key default gen_random_uuid(),
  stock_return_id uuid not null references public.stock_returns(id),
  product_id uuid not null references public.products(id),
  quantity_returned bigint not null check(quantity_returned > 0),
  quantity_received bigint check(quantity_received is null),
  product_name text not null,
  product_sku text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(stock_return_id,product_id)
);
create index stock_returns_branch_date on public.stock_returns(from_branch_id,returned_at desc);
alter table public.stock_returns enable row level security;
alter table public.stock_return_items enable row level security;
create policy returns_read on public.stock_returns for select to authenticated using (
  public.is_owner() or (public.current_user_role() = 'manager' and from_branch_id = public.current_user_branch_id())
);
create policy return_items_read on public.stock_return_items for select to authenticated using (
  exists(select 1 from public.stock_returns r where r.id = stock_return_id)
);
revoke all on public.stock_returns,public.stock_return_items from public,anon,authenticated;
grant select on public.stock_returns,public.stock_return_items to authenticated;
revoke all on sequence public.return_number_seq from public,anon,authenticated;
alter table public.inventory_movements drop constraint inventory_movements_reference_type_check;
alter table public.inventory_movements add constraint inventory_movements_reference_type_check
  check(reference_type in ('opening_stock','stock_transfer','adjustment','sale','stock_return'));
alter table public.inventory_movements drop constraint inventory_movements_sign_check;
alter table public.inventory_movements add constraint inventory_movements_sign_check check (
  (movement_type in ('opening_stock','transfer_in') and quantity > 0)
  or (movement_type in ('transfer_out','sale','return_out') and quantity < 0) or movement_type = 'adjustment'
);
create unique index inventory_movements_return_once on public.inventory_movements(reference_id,product_id)
  where reference_type = 'stock_return';

-- Narrow read endpoint includes inactive products, but only stock in this manager's branch.
create function public.list_return_inventory()
returns table(product_id uuid,product_name text,product_sku text,is_active boolean,quantity_on_hand bigint)
language sql stable security definer set search_path = '' as $$
  select p.id,p.name,p.sku,p.is_active,i.quantity_on_hand
  from public.branch_inventory i join public.products p on p.id=i.product_id
  where public.current_user_role()='manager' and i.branch_id=public.current_user_branch_id()
    and i.quantity_on_hand > 0 order by p.name,p.id;
$$;
revoke all on function public.list_return_inventory() from public,anon;
grant execute on function public.list_return_inventory() to authenticated;

create function public.create_stock_return(p_items jsonb,p_notes text,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user public.profiles%rowtype;
  v_source public.branches%rowtype;
  v_main public.branches%rowtype;
  v_existing public.stock_returns%rowtype;
  v_items jsonb;
  v_item record;
  v_product public.products%rowtype;
  v_stock bigint;
  v_id uuid;
  v_number text;
begin
  select * into v_user from public.profiles where id=auth.uid() and is_active and role='manager' for update;
  if not found then raise exception 'An active Manager account is required.' using errcode='42501'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100
    or length(coalesce(p_notes,'')) > 2000 then
    raise exception 'Invalid confirmation key or notes.' using errcode='22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Select products to return.' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'Select 1 to 200 products.' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
      or coalesce(v_item.value->>'quantity_returned','') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(v_item.value->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Return quantities must be positive whole numbers (maximum 999999).'
        using errcode='22023'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('product_id',product_id,'quantity_returned',quantity_returned) order by product_id)
    into v_items from (select (value->>'product_id')::uuid product_id,
      sum((value->>'quantity_returned')::bigint) quantity_returned from jsonb_array_elements(p_items) group by 1) q;
  select * into v_existing from public.stock_returns where created_by=v_user.id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_items <> v_items or v_existing.notes is distinct from p_notes then
      raise exception 'This confirmation key belongs to a different return.' using errcode='22023'; end if;
    return v_existing.id;
  end if;
  select * into v_source from public.branches where id=v_user.branch_id and is_active and not is_main_branch for share;
  if not found then raise exception 'Your assigned branch is unavailable.' using errcode='42501'; end if;
  select * into v_main from public.branches where is_main_branch and is_active for share;
  if not found then raise exception 'An active Main Branch is required.' using errcode='22023'; end if;
  -- Same product/inventory ordering as sales; locks remain held through commit.
  for v_item in select * from jsonb_to_recordset(v_items) as x(product_id uuid,quantity_returned bigint) order by product_id loop
    select * into v_product from public.products where id=v_item.product_id for share;
    if not found then raise exception 'Product unavailable.' using errcode='22023'; end if;
    select quantity_on_hand into v_stock from public.branch_inventory
      where branch_id=v_source.id and product_id=v_item.product_id for update;
    if coalesce(v_stock,0) < v_item.quantity_returned then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',v_product.name,coalesce(v_stock,0),v_item.quantity_returned using errcode='22023'; end if;
  end loop;
  v_number := nextval('public.return_number_seq')::text;
  insert into public.stock_returns(return_number,from_branch_id,to_branch_id,created_by,returned_by,
    from_branch_name,to_branch_name,returned_by_name,notes,idempotency_key,request_items)
  values('RET-'||lpad(v_number,greatest(6,length(v_number)),'0'),v_source.id,v_main.id,v_user.id,v_user.id,
    v_source.name,v_main.name,v_user.full_name,p_notes,p_idempotency_key,v_items) returning id into v_id;
  for v_item in select * from jsonb_to_recordset(v_items) as x(product_id uuid,quantity_returned bigint) order by product_id loop
    select * into v_product from public.products where id=v_item.product_id;
    insert into public.stock_return_items(stock_return_id,product_id,quantity_returned,product_name,product_sku)
      values(v_id,v_item.product_id,v_item.quantity_returned,v_product.name,v_product.sku);
    update public.branch_inventory set quantity_on_hand=quantity_on_hand-v_item.quantity_returned
      where branch_id=v_source.id and product_id=v_item.product_id;
    insert into public.inventory_movements(branch_id,product_id,movement_type,quantity,reference_type,reference_id,created_by,notes)
      values(v_source.id,v_item.product_id,'return_out',-v_item.quantity_returned,'stock_return',v_id,v_user.id,p_notes);
  end loop;
  return v_id;
end;
$$;
revoke all on function public.create_stock_return(jsonb,text,text) from public,anon;
grant execute on function public.create_stock_return(jsonb,text,text) to authenticated;
commit;
