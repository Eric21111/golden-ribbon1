begin;

-- Shift Remittance detail (#6/#5): Owner / Main Manager can open Cash or GCash and see
-- completed-sale totals by pricing program for that closed shift. Sales revenue only —
-- not remitted actual cash. Does not change remittance math.

create or replace function public.manager_shift_payments(p_shift_id uuid)
returns table(method text, program text, amount numeric, orders bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Unauthorized: Owner or Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  if p_shift_id is null then
    raise exception 'Shift is required.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.shifts s where s.id = p_shift_id) then
    raise exception 'Shift not found.' using errcode = 'P0002';
  end if;

  return query
  select
    coalesce(s.payment_method::text, 'unrecorded') as method,
    coalesce(s.pricing_program::text, 'standard') as program,
    coalesce(sum(s.total_amount), 0)::numeric as amount,
    count(*)::bigint as orders
  from public.sales s
  where s.shift_id = p_shift_id
    and s.status = 'completed'
  group by 1, 2
  order by 1, 2;
end;
$$;

revoke all on function public.manager_shift_payments(uuid) from public, anon;
grant execute on function public.manager_shift_payments(uuid) to authenticated;

comment on function public.manager_shift_payments(uuid) is
  'Completed sale totals by payment method and pricing program for one shift. Read-only sales figures for remittance detail.';

commit;
