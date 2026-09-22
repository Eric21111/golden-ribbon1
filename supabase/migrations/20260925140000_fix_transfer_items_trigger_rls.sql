-- Fix cashier confirm: deferred trigger ensure_transfer_has_complete_items runs at
-- COMMIT as the session role (authenticated). With RLS on stock_transfer_items,
-- cashiers cannot see rows, so the trigger falsely raises
-- "A stock transfer must contain at least one item."
-- Make the integrity trigger SECURITY DEFINER so it always sees items.

create or replace function public.ensure_transfer_has_complete_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.stock_transfer_items where stock_transfer_id = new.id
  ) then
    raise exception 'A stock transfer must contain at least one item.' using errcode = '23514';
  end if;
  if new.status in ('received', 'received_with_discrepancy') and exists (
    select 1 from public.stock_transfer_items
    where stock_transfer_id = new.id and quantity_received is null
  ) then
    raise exception 'Every transfer item requires an actual received quantity.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_transfer_has_complete_items() from public, anon, authenticated;

-- Also allow cashiers to read transfer items for transfers to their branch
-- (list/confirm UX and any invoker-context checks).
drop policy if exists "stock_transfer_items_select_authorized" on public.stock_transfer_items;
create policy "stock_transfer_items_select_authorized"
on public.stock_transfer_items for select
to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or exists (
    select 1
    from public.stock_transfers st
    where st.id = stock_transfer_id
      and (
        (
          public.current_user_role() = 'manager'
          and (
            st.from_branch_id = public.current_user_branch_id()
            or st.to_branch_id = public.current_user_branch_id()
          )
        )
        or (
          public.current_user_role() = 'cashier'
          and st.to_branch_id = public.current_user_branch_id()
        )
      )
  )
);

notify pgrst, 'reload schema';
