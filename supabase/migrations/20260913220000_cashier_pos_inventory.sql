begin;

-- Cashier POS catalog: read assigned/open-shift branch stock without depending on
-- branch_inventory RLS (which hides rows until a shift is open). confirm_sale is unchanged.

create or replace function public.list_cashier_pos_inventory()
returns table (
  branch_id uuid,
  branch_name text,
  product_id uuid,
  product_name text,
  product_sku text,
  selling_price numeric,
  quantity_on_hand bigint,
  updated_at timestamptz
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
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active;

  if not found or v_user.role is distinct from 'cashier' then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  select s.branch_id into v_branch_id
  from public.shifts s
  where s.cashier_id = v_user.id
    and s.status = 'open'
  limit 1;

  if v_branch_id is null then
    v_branch_id := v_user.branch_id;
  end if;

  if v_branch_id is null then
    raise exception 'No branch is assigned to this cashier.' using errcode = '42501';
  end if;

  return query
  select
    b.id,
    b.name,
    p.id,
    p.name,
    p.sku,
    p.selling_price,
    coalesce(bi.quantity_on_hand, 0)::bigint,
    bi.updated_at
  from public.products p
  join public.branches b on b.id = v_branch_id
  left join public.branch_inventory bi
    on bi.product_id = p.id
   and bi.branch_id = v_branch_id
  where p.is_active
  order by p.name, p.id;
end;
$$;

revoke all on function public.list_cashier_pos_inventory() from public, anon;
grant execute on function public.list_cashier_pos_inventory() to authenticated;

commit;
