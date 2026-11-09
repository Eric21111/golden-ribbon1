begin;

-- Owner owns branch master-data edits (name/code/address/active). Soft-deactivate
-- via is_active only — there is no hard DELETE policy. Main Branch remains
-- protected by existing triggers. Main Branch Manager keeps SELECT for ops.

drop policy if exists "branches_update_main_manager" on public.branches;
drop policy if exists "branches_update_owner" on public.branches;

create policy "branches_update_owner"
on public.branches for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

commit;
