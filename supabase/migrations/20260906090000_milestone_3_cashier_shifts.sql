begin;

create type public.shift_status as enum ('open', 'closed');

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  cashier_id uuid not null references public.profiles(id) on delete restrict,
  status public.shift_status not null default 'open',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_lifecycle_check check (
    (status = 'open' and ended_at is null)
    or (status = 'closed' and ended_at is not null and ended_at >= started_at)
  )
);

create unique index shifts_one_open_per_cashier_idx
on public.shifts(cashier_id) where status = 'open';
create index shifts_cashier_started_at_idx on public.shifts(cashier_id, started_at desc);
create index shifts_branch_started_at_idx on public.shifts(branch_id, started_at desc);

create trigger shifts_set_updated_at
before update on public.shifts
for each row execute function public.set_updated_at();

create or replace function public.validate_shift_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    join public.branches b on b.id = p.branch_id
    where p.id = new.cashier_id
      and p.role = 'cashier'
      and p.is_active
      and p.branch_id = new.branch_id
      and b.is_active
      and not b.is_main_branch
  ) then
    raise exception 'Cashier must use their assigned active selling branch.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger shifts_validate_assignment
before insert or update of branch_id, cashier_id on public.shifts
for each row execute function public.validate_shift_assignment();

create or replace function public.protect_shift_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'closed' then
    raise exception 'A closed shift cannot be modified.' using errcode = '55000';
  end if;
  if new.branch_id is distinct from old.branch_id
     or new.cashier_id is distinct from old.cashier_id
     or new.started_at is distinct from old.started_at then
    raise exception 'Shift identity and start time cannot be changed.' using errcode = '55000';
  end if;
  if new.status <> 'closed' or new.ended_at is null then
    raise exception 'An open shift can only transition to closed.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger shifts_protect_lifecycle
before update on public.shifts
for each row execute function public.protect_shift_lifecycle();

create or replace function public.start_cashier_shift()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashier_id uuid := auth.uid();
  v_branch_id uuid;
  v_shift_id uuid;
  v_existing_branch_id uuid;
begin
  if public.current_user_role() is distinct from 'cashier'::public.user_role then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  select branch_id into v_branch_id
  from public.profiles
  where id = v_cashier_id and role = 'cashier' and is_active
  for update;
  if v_branch_id is null then
    raise exception 'No branch is assigned to this cashier.' using errcode = '42501';
  end if;

  perform 1
  from public.branches
  where id = v_branch_id and is_active and not is_main_branch
  for share;
  if not found then
    raise exception 'The assigned branch is inactive or invalid.' using errcode = '22023';
  end if;

  select id, branch_id into v_shift_id, v_existing_branch_id
  from public.shifts
  where cashier_id = v_cashier_id and status = 'open'
  limit 1;

  if v_shift_id is not null then
    if v_existing_branch_id <> v_branch_id then
      raise exception 'The existing shift belongs to another branch.' using errcode = '42501';
    end if;
    return v_shift_id;
  end if;

  insert into public.shifts(branch_id, cashier_id, status, started_at)
  values (v_branch_id, v_cashier_id, 'open', now())
  returning id into v_shift_id;

  return v_shift_id;
end;
$$;

create or replace function public.end_cashier_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashier_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
begin
  if public.current_user_role() is distinct from 'cashier'::public.user_role then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if not found or v_shift.cashier_id <> v_cashier_id
     or v_shift.branch_id <> public.current_user_branch_id() then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;
  if v_shift.status = 'closed' then
    return;
  end if;

  update public.shifts
  set status = 'closed', ended_at = now()
  where id = p_shift_id;
end;
$$;

revoke all on function public.validate_shift_assignment() from public;
revoke all on function public.protect_shift_lifecycle() from public;
revoke all on function public.start_cashier_shift() from public, anon;
revoke all on function public.end_cashier_shift(uuid) from public, anon;
grant execute on function public.start_cashier_shift() to authenticated;
grant execute on function public.end_cashier_shift(uuid) to authenticated;

alter table public.shifts enable row level security;

create policy "shifts_select_own"
on public.shifts for select to authenticated
using (
  public.current_user_role() = 'cashier'
  and cashier_id = auth.uid()
  and branch_id = public.current_user_branch_id()
);

revoke all on public.shifts from anon, authenticated;
grant select on public.shifts to authenticated;

drop policy "branch_inventory_select_authorized" on public.branch_inventory;
create policy "branch_inventory_select_authorized"
on public.branch_inventory for select to authenticated
using (
  public.is_owner()
  or (public.current_user_role() = 'manager' and branch_id = public.current_user_branch_id())
  or (
    public.current_user_role() = 'cashier'
    and branch_id = public.current_user_branch_id()
    and exists (
      select 1
      from public.shifts s
      where s.cashier_id = auth.uid()
        and s.branch_id = branch_inventory.branch_id
        and s.status = 'open'
    )
  )
);

drop policy "products_select_active_staff" on public.products;
create policy "products_select_active_staff"
on public.products for select to authenticated
using (
  public.is_owner()
  or (
    public.current_user_role() in ('manager', 'cashier')
    and is_active
  )
);

comment on table public.shifts is 'Cashier work sessions; creation and closure occur only through restricted RPCs.';

commit;
