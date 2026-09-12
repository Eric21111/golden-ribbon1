begin;

create or replace function public.can_change_own_email()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_owner() or public.is_main_branch_manager()
$$;

create or replace function public.assert_can_change_own_email()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_change_own_email() then
    raise exception 'Unauthorized: email changes are limited to the Owner and Main Branch Manager.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.can_change_own_email() from public, anon;
revoke all on function public.assert_can_change_own_email() from public, anon;
grant execute on function public.can_change_own_email() to authenticated;
grant execute on function public.assert_can_change_own_email() to authenticated;

commit;
