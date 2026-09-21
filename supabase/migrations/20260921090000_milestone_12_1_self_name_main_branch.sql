begin;

-- ============================================================================
-- Milestone 12.1 — Self name editing + permanent Main Branch
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Owner accounts always belong to the Main Branch.
--    Drop the old "owner has no branch" rule, ensure a Main Branch exists
--    for any environment that already has an Owner but never got one
--    (identified only by is_main_branch = true, never a hardcoded id),
--    backfill every existing Owner onto it, then require branch_id on
--    every role. The bootstrap insert is scoped to "an Owner profile
--    already exists" so a brand-new environment — where profiles is still
--    empty at migration time and gets seeded afterwards — never gets a
--    phantom Main Branch created out from under it.
-- --------------------------------------------------------------------------

alter table public.profiles drop constraint profiles_role_branch_check;

insert into public.branches (name, code, is_main_branch, is_active)
select 'Main Branch', 'MAIN', true, true
where not exists (select 1 from public.branches where is_main_branch)
  and exists (select 1 from public.profiles where role = 'owner');

update public.profiles p
set branch_id = m.id
from (select id from public.branches where is_main_branch limit 1) m
where p.role = 'owner' and p.branch_id is distinct from m.id;

alter table public.profiles alter column branch_id set not null;

-- Server-side enforcement: an Owner row is always pinned to the Main Branch,
-- regardless of what a client sends — the Main Branch is identified only by
-- is_main_branch = true, never a hardcoded id. If no Main Branch exists yet
-- (a brand-new environment bootstrapping its first Owner), one is created
-- idempotently here rather than left to a client to choose. Cashier/manager
-- assignment rules are unchanged from milestone 11.
create or replace function public.validate_profile_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_main_branch_id uuid;
begin
  if new.role = 'owner' then
    insert into public.branches (name, code, is_main_branch, is_active)
    select 'Main Branch', 'MAIN', true, true
    where not exists (select 1 from public.branches where is_main_branch);

    select id into v_main_branch_id from public.branches where is_main_branch limit 1;
    if v_main_branch_id is null then
      raise exception 'The Main Branch must be configured before an Owner account can be created.' using errcode = '55000';
    end if;
    new.branch_id := v_main_branch_id;
  elsif new.role = 'cashier' then
    if not exists (
      select 1 from public.branches b
      where b.id = new.branch_id and not b.is_main_branch
    ) then
      raise exception 'Cashiers must be assigned to a selling branch.';
    end if;
  elsif new.role = 'manager' then
    if not exists (
      select 1 from public.branches b
      where b.id = new.branch_id
    ) then
      raise exception 'Managers must be assigned to an existing branch.';
    end if;
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 3. Main Branch protections — add "cannot be renamed" and "cannot be
--    deleted" to the existing "cannot convert / cannot deactivate / only
--    one Main Branch" protections from milestone 11.
-- --------------------------------------------------------------------------

create or replace function public.protect_main_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_main_branch then
    if new.is_main_branch is distinct from true then
      raise exception 'The Main Branch cannot be converted to a selling branch.' using errcode = '55000';
    end if;
    if not new.is_active then
      raise exception 'The Main Branch cannot be deactivated.' using errcode = '55000';
    end if;
    if old.name = 'Main Branch' and new.name is distinct from 'Main Branch' then
      raise exception 'The Main Branch cannot be renamed.' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_main_branch_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_main_branch then
    raise exception 'The Main Branch cannot be deleted.' using errcode = '55000';
  end if;
  return old;
end;
$$;

drop trigger if exists branches_protect_main_delete on public.branches;
create trigger branches_protect_main_delete
before delete on public.branches
for each row execute function public.protect_main_branch_delete();

revoke all on function public.protect_main_branch_delete() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 4. Self-service name editing.
--    Any authenticated user may rename their own account. The target user
--    is derived from auth.uid() — no id parameter exists, so one account
--    can never edit another. Role, branch, and active status are untouched.
-- --------------------------------------------------------------------------

create or replace function public.update_own_name(p_full_name text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_name    text := trim(coalesce(p_full_name, ''));
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Full name must contain between 2 and 120 characters.' using errcode = '22023';
  end if;

  update public.profiles
  set full_name = v_name
  where id = v_user_id
  returning * into v_profile;

  if not found then
    raise exception 'Your account profile was not found.' using errcode = 'P0002';
  end if;

  return v_profile;
end;
$$;

revoke all on function public.update_own_name(text) from public, anon;
grant execute on function public.update_own_name(text) to authenticated;

commit;
