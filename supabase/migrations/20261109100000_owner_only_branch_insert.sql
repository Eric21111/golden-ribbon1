begin;

-- Restore Owner-only selling-branch INSERT. Milestone 11 moved this to the Main
-- Branch Manager with other operational writes; product docs and the original
-- Owner Branches UI expected Owner create authority. UPDATE stays with the Main
-- Branch Manager. No table structure changes.

drop policy if exists "branches_insert_main_manager" on public.branches;
drop policy if exists "branches_insert_owner" on public.branches;

create policy "branches_insert_owner"
on public.branches for insert
to authenticated
with check (public.is_owner() and not is_main_branch);

commit;
