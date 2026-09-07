begin;

create or replace function public.prevent_employee_change_during_open_shift()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.branch_id is distinct from old.branch_id
    or new.role is distinct from old.role
    or (old.is_active and not new.is_active)
  ) and exists (
    select 1
    from public.shifts s
    where s.cashier_id = old.id and s.status = 'open'
  ) then
    raise exception 'Employee has an active shift. End the shift before changing branch, role, or active status.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_open_shift
before update of role, branch_id, is_active on public.profiles
for each row execute function public.prevent_employee_change_during_open_shift();

create or replace function public.list_employees()
returns table (
  id uuid,
  full_name text,
  email text,
  role public.user_role,
  branch_id uuid,
  branch_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'owner'::public.user_role then
    raise exception 'Unauthorized: owner access is required.' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, u.email::text, p.role, p.branch_id,
         b.name, p.is_active, p.created_at, p.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.branches b on b.id = p.branch_id
  where p.role in ('manager', 'cashier')
  order by p.full_name, u.email;
end;
$$;

create or replace function public.owner_update_employee(
  p_employee_id uuid,
  p_full_name text,
  p_role public.user_role,
  p_branch_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_role public.user_role;
begin
  if public.current_user_role() is distinct from 'owner'::public.user_role then
    raise exception 'Unauthorized: owner access is required.' using errcode = '42501';
  end if;
  if p_employee_id = auth.uid() then
    raise exception 'The owner account cannot be edited as an employee.' using errcode = '42501';
  end if;
  if p_full_name is null or char_length(trim(p_full_name)) not between 2 and 120 then
    raise exception 'Full name must contain between 2 and 120 characters.' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('manager', 'cashier') then
    raise exception 'Employee role must be Manager or Cashier.' using errcode = '22023';
  end if;
  if p_is_active is null then
    raise exception 'Employee status is required.' using errcode = '22023';
  end if;

  perform 1
  from public.branches
  where id = p_branch_id and is_active and not is_main_branch
  for share;
  if not found then
    raise exception 'Select an active selling branch.' using errcode = '22023';
  end if;

  select role into v_existing_role
  from public.profiles
  where id = p_employee_id
  for update;
  if not found or v_existing_role not in ('manager', 'cashier') then
    raise exception 'Employee account was not found.' using errcode = 'P0002';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      role = p_role,
      branch_id = p_branch_id,
      is_active = p_is_active
  where id = p_employee_id;
end;
$$;

create or replace function public.create_employee_profile_from_server(
  p_requester_id uuid,
  p_employee_id uuid,
  p_full_name text,
  p_role public.user_role,
  p_branch_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = p_requester_id and role = 'owner' and is_active
  ) then
    raise exception 'Unauthorized: owner access is required.' using errcode = '42501';
  end if;
  if p_full_name is null or char_length(trim(p_full_name)) not between 2 and 120 then
    raise exception 'Full name must contain between 2 and 120 characters.' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('manager', 'cashier') then
    raise exception 'Employee role must be Manager or Cashier.' using errcode = '22023';
  end if;
  if p_is_active is null then
    raise exception 'Employee status is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.branches
    where id = p_branch_id and is_active and not is_main_branch
  ) then
    raise exception 'Select an active selling branch.' using errcode = '22023';
  end if;

  insert into public.profiles(id, full_name, role, branch_id, is_active)
  values (p_employee_id, trim(p_full_name), p_role, p_branch_id, p_is_active);
end;
$$;

revoke all on function public.prevent_employee_change_during_open_shift() from public;
revoke all on function public.list_employees() from public, anon;
revoke all on function public.owner_update_employee(uuid, text, public.user_role, uuid, boolean) from public, anon;
revoke all on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean) from public, anon, authenticated;
grant execute on function public.list_employees() to authenticated;
grant execute on function public.owner_update_employee(uuid, text, public.user_role, uuid, boolean) to authenticated;
grant execute on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean) to service_role;

comment on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean)
is 'Privileged Edge Function entry point that creates the profile paired with a new Auth user.';

commit;
