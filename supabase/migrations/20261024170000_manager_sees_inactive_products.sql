-- Main Branch Managers must see products before opening stock activates them.
-- Stock-only products are created inactive, so the previous select policy hid them
-- from the product list and the stock picker. Selling-branch managers and cashiers
-- still see active products only. Cashier selling stays filtered by sell_in_pos.

begin;

drop policy if exists "products_select_active_staff" on public.products;
create policy "products_select_active_staff"
on public.products for select
to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or (
    public.current_user_role() in ('manager', 'cashier')
    and is_active
  )
);

commit;
