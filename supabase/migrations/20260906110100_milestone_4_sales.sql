begin;
create type public.sale_status as enum ('completed', 'voided');
create sequence public.sale_number_seq;
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text not null unique,
  branch_id uuid not null references public.branches(id),
  shift_id uuid not null references public.shifts(id),
  cashier_id uuid not null references public.profiles(id),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  total_amount numeric(12,2) not null check (total_amount = subtotal),
  amount_paid numeric(12,2) not null check (amount_paid >= total_amount),
  change_amount numeric(12,2) not null check (change_amount = amount_paid - total_amount),
  status public.sale_status not null default 'completed',
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  idempotency_key text not null check (length(idempotency_key) between 16 and 100),
  request_items jsonb not null,
  unique(cashier_id, idempotency_key)
);
create index sales_shift_time on public.sales(shift_id, sold_at desc);
create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  product_id uuid not null references public.products(id),
  quantity bigint not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  subtotal numeric(12,2) not null check (subtotal = quantity * unit_price),
  created_at timestamptz not null default now(),
  unique(sale_id, product_id)
);
alter table public.inventory_movements drop constraint inventory_movements_reference_type_check;
alter table public.inventory_movements add constraint inventory_movements_reference_type_check
  check (reference_type in ('opening_stock', 'stock_transfer', 'adjustment', 'sale'));
alter table public.inventory_movements drop constraint inventory_movements_sign_check;
alter table public.inventory_movements add constraint inventory_movements_sign_check check (
  (movement_type in ('opening_stock', 'transfer_in') and quantity > 0)
  or (movement_type in ('transfer_out', 'sale') and quantity < 0)
  or movement_type = 'adjustment'
);
create unique index inventory_movements_sale_once on public.inventory_movements(reference_id, product_id)
where reference_type = 'sale';
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
create policy sales_select_own_shift on public.sales for select to authenticated using (
  public.current_user_role() = 'cashier' and cashier_id = auth.uid()
  and branch_id = public.current_user_branch_id()
  and exists (select 1 from public.shifts s where s.id = shift_id and s.status = 'open')
);
create policy sale_items_select_own on public.sale_items for select to authenticated using (
  exists (select 1 from public.sales s where s.id = sale_id)
);
revoke all on public.sales, public.sale_items from anon, authenticated;
grant select on public.sales, public.sale_items to authenticated;
revoke all on sequence public.sale_number_seq from public, anon, authenticated;

create function public.confirm_sale(p_shift_id uuid, p_items jsonb, p_amount_paid numeric, p_idempotency_key text)
returns public.sales
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_branch uuid;
  v_shift public.shifts%rowtype;
  v_sale public.sales%rowtype;
  v_items jsonb;
  v_item record;
  v_product public.products%rowtype;
  v_stock bigint;
  v_total numeric := 0;
begin
  -- Profile lock serializes employee changes and concurrent submissions by this cashier.
  select branch_id into v_branch from public.profiles
    where id = v_user and is_active and role = 'cashier' for update;
  if not found then raise exception 'An active Cashier account is required.' using errcode = '42501'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid order confirmation key.' using errcode = '22023'; end if;
  if p_amount_paid is null or p_amount_paid::text in ('NaN','Infinity','-Infinity')
    or p_amount_paid < 0 or p_amount_paid > 9999999999.99 or p_amount_paid <> round(p_amount_paid,2) then
    raise exception 'Enter a valid payment with at most two decimal places.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'The cart must contain products.' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'The cart must contain 1 to 200 products.' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item.value) is distinct from 'object'
      or coalesce(v_item.value->>'quantity','') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(v_item.value->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid product or quantity.' using errcode = '22023'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity) order by product_id)
    into v_items from (select (value->>'product_id')::uuid product_id,
      sum((value->>'quantity')::bigint) quantity from jsonb_array_elements(p_items) group by 1) q;
  select * into v_sale from public.sales where cashier_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    if v_sale.shift_id <> p_shift_id or v_sale.request_items <> v_items or v_sale.amount_paid <> p_amount_paid then
      raise exception 'This confirmation key belongs to a different order.' using errcode = '22023'; end if;
    return v_sale;
  end if;
  perform 1 from public.branches where id = v_branch and is_active and not is_main_branch for share;
  if not found then raise exception 'Your assigned branch is unavailable.' using errcode = '42501'; end if;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.cashier_id <> v_user or v_shift.branch_id <> v_branch or v_shift.status <> 'open' then
    raise exception 'An open shift belonging to you is required.' using errcode = '42501'; end if;
  -- Deterministic product order prevents sales from deadlocking each other.
  for v_item in select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity bigint) order by product_id loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found or not v_product.is_active then
      raise exception 'A selected product is inactive or unavailable.' using errcode = '22023'; end if;
    select quantity_on_hand into v_stock from public.branch_inventory
      where branch_id = v_branch and product_id = v_item.product_id for update;
    if coalesce(v_stock,0) < v_item.quantity then
      raise exception 'Insufficient stock. % — Available: %, Requested: %', v_product.name, coalesce(v_stock,0), v_item.quantity using errcode = '22023'; end if;
    v_total := v_total + v_product.selling_price * v_item.quantity;
  end loop;
  if v_total > 9999999999.99 then raise exception 'Order total exceeds the supported limit.' using errcode = '22023'; end if;
  if p_amount_paid < v_total then
    raise exception 'Insufficient payment. Total: %, Remaining: %', v_total, v_total - p_amount_paid using errcode = '22023'; end if;
  insert into public.sales(sale_number, branch_id, shift_id, cashier_id, subtotal, total_amount, amount_paid, change_amount, idempotency_key, request_items)
    values ('SALE-' || lpad(nextval('public.sale_number_seq')::text, 10, '0'), v_branch, p_shift_id, v_user,
      v_total, v_total, p_amount_paid, p_amount_paid-v_total, p_idempotency_key, v_items) returning * into v_sale;
  for v_item in select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity bigint) order by product_id loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.sale_items(sale_id, product_id, quantity, unit_price, subtotal)
      values(v_sale.id, v_item.product_id, v_item.quantity, v_product.selling_price, v_item.quantity*v_product.selling_price);
    update public.branch_inventory set quantity_on_hand = quantity_on_hand-v_item.quantity
      where branch_id = v_branch and product_id = v_item.product_id;
    insert into public.inventory_movements(branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by)
      values(v_branch, v_item.product_id, 'sale', -v_item.quantity, 'sale', v_sale.id, v_user);
  end loop;
  return v_sale;
end;
$$;
revoke all on function public.confirm_sale(uuid,jsonb,numeric,text) from public, anon;
grant execute on function public.confirm_sale(uuid,jsonb,numeric,text) to authenticated;
commit;
