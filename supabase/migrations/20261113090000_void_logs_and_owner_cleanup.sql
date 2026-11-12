begin;
create function public.list_sale_void_logs(p_offset integer default 0)
returns table(event_id uuid, recorded_at timestamptz, sale_number text, product_name text,
  branch_name text, cashier_name text, quantity integer, amount numeric, reason text, note text)
language sql stable security definer set search_path = '' as $$
  select (v->>'id')::uuid, (v->>'at')::timestamptz, s.sale_number,
    concat_ws(' · ',p.name,i.variant_name), b.name, actor.full_name,
    (v->>'quantity')::integer,(v->>'amount')::numeric,v->>'reason',v->>'note'
  from public.profiles viewer
  join public.sales s on viewer.role='owner' or
    (viewer.role='manager' and (public.is_main_branch_manager() or viewer.branch_id=s.branch_id)) or
    (viewer.role='cashier' and viewer.branch_id=s.branch_id and viewer.id=s.cashier_id)
  join public.sale_items i on i.sale_id=s.id and i.void_history <> '[]'::jsonb
  cross join lateral jsonb_array_elements(i.void_history) v
  join public.profiles actor on actor.id=(v->>'cashier_id')::uuid
  join public.products p on p.id=i.product_id
  join public.branches b on b.id=s.branch_id
  where viewer.id=auth.uid() and viewer.is_active
  order by 2 desc,1 desc limit 51 offset greatest(0,p_offset)
$$;
revoke all on function public.list_sale_void_logs(integer) from public,anon;
grant execute on function public.list_sale_void_logs(integer) to authenticated;

-- Only the owner's own read notices with no outstanding delivery are eligible.
create function public.owner_cleanup_read_notices(p_ids uuid[] default null)
returns table(id uuid,title text,read_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  perform public.assert_owner_archive_access();
  if p_ids is null then
    return query select n.id,n.title,n.read_at from public.notifications n
    where n.recipient_id=auth.uid() and n.read_at is not null and not exists
      (select 1 from public.push_deliveries d where d.notification_id=n.id and d.status in ('pending','sending','sent'))
    order by n.read_at,n.id limit 50;
  else
    if cardinality(p_ids) not between 1 and 50 then raise exception 'Select 1 to 50 notices.'; end if;
    return query delete from public.notifications n where n.id=any(p_ids)
      and n.recipient_id=auth.uid() and n.read_at is not null and not exists
        (select 1 from public.push_deliveries d where d.notification_id=n.id and d.status in ('pending','sending','sent'))
      returning n.id,n.title,n.read_at;
    get diagnostics removed = row_count;
    if removed <> cardinality(p_ids) then
      raise exception 'The selection changed. Refresh and select again.';
    end if;
  end if;
end $$;
revoke all on function public.owner_cleanup_read_notices(uuid[]) from public,anon;
grant execute on function public.owner_cleanup_read_notices(uuid[]) to authenticated;
commit;
