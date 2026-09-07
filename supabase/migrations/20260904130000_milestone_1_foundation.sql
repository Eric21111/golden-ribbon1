begin;

create extension if not exists pgcrypto;

create type public.user_role as enum ('owner', 'manager', 'cashier');

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  code text not null check (code ~ '^[A-Za-z0-9-]{2,20}$'),
  address text check (address is null or char_length(address) <= 300),
  is_main_branch boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index branches_code_unique_ci on public.branches (lower(code));
create unique index branches_one_main_branch on public.branches (is_main_branch) where is_main_branch;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  role public.user_role not null,
  branch_id uuid references public.branches(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_branch_check check (
    (role = 'owner' and branch_id is null)
    or (role in ('manager', 'cashier') and branch_id is not null)
  )
);

create index profiles_branch_id_idx on public.profiles(branch_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  sku text not null check (sku ~ '^[A-Za-z0-9-]{2,40}$'),
  description text check (description is null or char_length(description) <= 500),
  selling_price numeric(12, 2) not null check (selling_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index products_sku_unique_ci on public.products (lower(sku));
create index products_name_search_idx on public.products (lower(name));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger branches_set_updated_at
before update on public.branches
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create or replace function public.validate_profile_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role in ('manager', 'cashier') then
    if not exists (
      select 1 from public.branches b
      where b.id = new.branch_id and not b.is_main_branch
    ) then
      raise exception 'Managers and cashiers must be assigned to a selling branch.';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_validate_branch
before insert or update of role, branch_id on public.profiles
for each row execute function public.validate_profile_branch();

create or replace function public.prevent_assigned_branch_becoming_main()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_main_branch and not old.is_main_branch and exists (
    select 1 from public.profiles p where p.branch_id = new.id
  ) then
    raise exception 'A branch assigned to managers or cashiers cannot become the Main Branch.';
  end if;
  return new;
end;
$$;

create trigger branches_protect_staff_assignment
before update of is_main_branch on public.branches
for each row execute function public.prevent_assigned_branch_becoming_main();

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.current_user_branch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.branch_id from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'owner', false)
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.validate_profile_branch() from public;
revoke all on function public.prevent_assigned_branch_becoming_main() from public;
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_user_branch_id() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_branch_id() to authenticated;
grant execute on function public.is_owner() to authenticated;

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;

create policy "profiles_select_self"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "branches_select_allowed"
on public.branches for select
to authenticated
using (
  public.is_owner()
  or id = public.current_user_branch_id()
);

create policy "branches_insert_owner"
on public.branches for insert
to authenticated
with check (public.is_owner());

create policy "branches_update_owner"
on public.branches for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

create policy "products_select_active_staff"
on public.products for select
to authenticated
using (public.current_user_role() is not null);

create policy "products_insert_owner"
on public.products for insert
to authenticated
with check (public.is_owner());

create policy "products_update_owner"
on public.products for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

revoke all on public.branches, public.profiles, public.products from anon;
grant select on public.profiles to authenticated;
grant select, insert, update on public.branches to authenticated;
grant select, insert, update on public.products to authenticated;

comment on table public.branches is 'Company branch master data; exactly one row may be marked as the Main Branch.';
comment on table public.profiles is 'Application role and branch assignment for a Supabase Auth user.';
comment on table public.products is 'Product master data. Inventory quantities belong in future inventory tables.';

commit;
