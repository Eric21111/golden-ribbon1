begin;

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
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access is required.' using errcode = '42501';
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
  p_full_name   text,
  p_role        public.user_role,
  p_branch_id   uuid,
  p_is_active   boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_role public.user_role;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access is required.' using errcode = '42501';
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
  if not public.employee_assignment_is_valid(p_role, p_branch_id) then
    if p_role = 'cashier' then
      raise exception 'Select an active selling branch.' using errcode = '22023';
    end if;
    raise exception 'Select an active branch.' using errcode = '22023';
  end if;

  perform 1 from public.branches where id = p_branch_id for share;

  select role into v_existing_role
  from public.profiles
  where id = p_employee_id
  for update;
  if not found or v_existing_role not in ('manager', 'cashier') then
    raise exception 'Employee account was not found.' using errcode = 'P0002';
  end if;
  if v_existing_role = 'owner' or exists (
    select 1 from public.profiles where id = p_employee_id and role = 'owner'
  ) then
    raise exception 'The Owner account cannot be modified.' using errcode = '42501';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      role      = p_role,
      branch_id = p_branch_id,
      is_active = p_is_active
  where id = p_employee_id;
end;
$$;

create or replace function public.create_employee_profile_from_server(
  p_requester_id uuid,
  p_employee_id  uuid,
  p_full_name    text,
  p_role         public.user_role,
  p_branch_id    uuid,
  p_is_active    boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_requester_id
      and p.role = 'owner'
      and p.is_active
  ) then
    raise exception 'Unauthorized: Owner access is required.' using errcode = '42501';
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
  if not public.employee_assignment_is_valid(p_role, p_branch_id) then
    if p_role = 'cashier' then
      raise exception 'Select an active selling branch.' using errcode = '22023';
    end if;
    raise exception 'Select an active branch.' using errcode = '22023';
  end if;

  insert into public.profiles(id, full_name, role, branch_id, is_active)
  values (p_employee_id, trim(p_full_name), p_role, p_branch_id, p_is_active);
end;
$$;

revoke all on function public.list_employees() from public, anon;
revoke all on function public.owner_update_employee(uuid, text, public.user_role, uuid, boolean) from public, anon;
revoke all on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean) from public, anon, authenticated;
grant execute on function public.list_employees() to authenticated;
grant execute on function public.owner_update_employee(uuid, text, public.user_role, uuid, boolean) to authenticated;
grant execute on function public.create_employee_profile_from_server(uuid, uuid, text, public.user_role, uuid, boolean) to service_role;

commit;
