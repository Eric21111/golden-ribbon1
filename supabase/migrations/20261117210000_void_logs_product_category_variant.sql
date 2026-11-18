begin;

-- Return product name, variant, and category separately so Void logs can show a
-- category icon and a variant pill (same chrome as other product lists).
drop function if exists public.list_sale_void_logs(integer);

create function public.list_sale_void_logs(p_offset integer default 0)
returns table(
  event_id uuid,
  recorded_at timestamptz,
  sale_number text,
  product_name text,
  variant_name text,
  product_category text,
  branch_name text,
  cashier_name text,
  quantity integer,
  amount numeric,
  reason text,
  note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (v->>'id')::uuid,
    (v->>'at')::timestamptz,
    s.sale_number,
    p.name,
    nullif(btrim(coalesce(i.variant_name, '')), ''),
    p.product_category,
    b.name,
    actor.full_name,
    (v->>'quantity')::integer,
    (v->>'amount')::numeric,
    v->>'reason',
    v->>'note'
  from public.profiles viewer
  join public.sales s on viewer.role = 'owner'
    or (viewer.role = 'manager' and (public.is_main_branch_manager() or viewer.branch_id = s.branch_id))
    or (viewer.role = 'cashier' and viewer.branch_id = s.branch_id and viewer.id = s.cashier_id)
  join public.sale_items i on i.sale_id = s.id and i.void_history <> '[]'::jsonb
  cross join lateral jsonb_array_elements(i.void_history) v
  join public.profiles actor on actor.id = (v->>'cashier_id')::uuid
  join public.products p on p.id = i.product_id
  join public.branches b on b.id = s.branch_id
  where viewer.id = auth.uid() and viewer.is_active
  order by 2 desc, 1 desc
  limit 51 offset greatest(0, p_offset);
$$;

revoke all on function public.list_sale_void_logs(integer) from public, anon;
grant execute on function public.list_sale_void_logs(integer) to authenticated;

commit;
