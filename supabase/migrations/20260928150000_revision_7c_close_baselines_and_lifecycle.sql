begin;

-- Revision 7C part 1: close baselines, lifecycle allowlist, freeze helpers.
-- Does not implement End Shift UI (7D) or reports (7E).

-- ---------------------------------------------------------------------------
-- 1) shift_product_close_baselines — universe + metadata frozen at cutoff
-- ---------------------------------------------------------------------------
create table if not exists public.shift_product_close_baselines (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  sku_snapshot text,
  closing_stock_behavior public.closing_stock_behavior not null,
  opening_quantity bigint not null check (opening_quantity >= 0),
  captured_at timestamptz not null default now(),
  unique (shift_id, product_id)
);

create index if not exists shift_product_close_baselines_branch_idx
  on public.shift_product_close_baselines (branch_id, shift_id);

alter table public.shift_product_close_baselines enable row level security;

drop policy if exists shift_product_close_baselines_select on public.shift_product_close_baselines;
create policy shift_product_close_baselines_select
on public.shift_product_close_baselines for select to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or exists (
    select 1 from public.shifts s
    where s.id = shift_id and s.cashier_id = (select auth.uid())
  )
);

revoke all on public.shift_product_close_baselines from public, anon;
grant select on public.shift_product_close_baselines to authenticated;

-- ---------------------------------------------------------------------------
-- 2) protect_shift_lifecycle — allow recon-flag clears on closed shifts only
-- ---------------------------------------------------------------------------
create or replace function public.protect_shift_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'closed' then
    -- Allow SECURITY DEFINER finalize/auto paths to clear pending recon flags only.
    -- Never reopen, never clear sales_cutoff_at, never change identity.
    if new.status is distinct from 'closed'
       or new.ended_at is distinct from old.ended_at
       or new.sales_cutoff_at is distinct from old.sales_cutoff_at
       or new.branch_id is distinct from old.branch_id
       or new.cashier_id is distinct from old.cashier_id
       or new.started_at is distinct from old.started_at then
      raise exception 'A closed shift cannot be modified.' using errcode = '55000';
    end if;
    if new.reconciliation_required is distinct from old.reconciliation_required
       or new.inventory_reconciliation_required is distinct from old.inventory_reconciliation_required then
      -- Only allow clearing flags (true -> false), never setting pending again on a closed shift.
      if (new.reconciliation_required and not old.reconciliation_required)
         or (new.inventory_reconciliation_required and not old.inventory_reconciliation_required) then
        raise exception 'A closed shift cannot be modified.' using errcode = '55000';
      end if;
      return new;
    end if;
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

-- ---------------------------------------------------------------------------
-- 3) Manila business-date helpers (internal)
-- ---------------------------------------------------------------------------
create or replace function public.manila_business_date(p_ts timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (timezone('Asia/Manila', p_ts))::date;
$$;

revoke all on function public.manila_business_date(timestamptz) from public, anon, authenticated;

create or replace function public.current_manila_business_date()
returns date
language sql
stable
set search_path = ''
as $$
  select public.manila_business_date(now());
$$;

revoke all on function public.current_manila_business_date() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Selling-branch freeze assert (pending recon OR finalized same Manila day)
-- ---------------------------------------------------------------------------
create or replace function public.assert_selling_branch_inventory_not_frozen(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.current_manila_business_date();
  v_is_main boolean;
begin
  if p_branch_id is null then
    raise exception 'Branch is required.' using errcode = '22023';
  end if;

  select is_main_branch into v_is_main
  from public.branches
  where id = p_branch_id;
  if not found then
    raise exception 'Branch is missing.' using errcode = '22023';
  end if;
  -- Main branch stock ops are not under selling-booth freeze.
  if v_is_main then
    return;
  end if;

  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id
      and s.inventory_reconciliation_required
  ) then
    raise exception 'Branch inventory is frozen until pending reconciliation completes.'
      using errcode = '55000';
  end if;

  -- Post-finalization same-day freeze (Manila business date).
  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id
      and s.status = 'closed'
      and not s.inventory_reconciliation_required
      and exists (select 1 from public.shift_reconciliations r where r.shift_id = s.id)
      and public.manila_business_date(coalesce(s.sales_cutoff_at, s.ended_at)) = v_today
  ) then
    raise exception 'Branch inventory is frozen after final close for this business day.'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_selling_branch_inventory_not_frozen(uuid)
  from public, anon, authenticated;

comment on function public.assert_selling_branch_inventory_not_frozen(uuid) is
  'Internal. Rejects selling-branch stock mutations during pending inventory recon or after same-Manila-day finalized close.';

-- ---------------------------------------------------------------------------
-- 5) lock_branch_inventory_gate — open or pending-closed shift; optional freeze
-- ---------------------------------------------------------------------------
drop function if exists public.lock_branch_inventory_gate(uuid);

create or replace function public.lock_branch_inventory_gate(
  p_branch_id uuid,
  p_enforce_freeze boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift_id uuid;
begin
  if p_branch_id is null then
    raise exception 'Branch is required for inventory lock.' using errcode = '22023';
  end if;

  perform 1
  from public.branches
  where id = p_branch_id
  for update;
  if not found then
    raise exception 'Branch is missing.' using errcode = '22023';
  end if;

  -- Prefer open shift; else lock oldest closed shift with pending inventory recon.
  select s.id
  into v_shift_id
  from public.shifts s
  where s.branch_id = p_branch_id
    and s.status = 'open'
  order by s.started_at, s.id
  limit 1
  for update;

  if v_shift_id is null then
    select s.id
    into v_shift_id
    from public.shifts s
    where s.branch_id = p_branch_id
      and s.status = 'closed'
      and s.inventory_reconciliation_required
    order by s.ended_at, s.id
    limit 1
    for update;
  end if;

  if p_enforce_freeze then
    perform public.assert_selling_branch_inventory_not_frozen(p_branch_id);
  end if;

  perform 1
  from public.branch_inventory bi
  where bi.branch_id = p_branch_id
  order by bi.product_id
  for update;
end;
$$;

revoke all on function public.lock_branch_inventory_gate(uuid, boolean)
  from public, anon, authenticated;

comment on function public.lock_branch_inventory_gate(uuid, boolean) is
  'Internal inventory lock. Branch FOR UPDATE → open or pending-closed shift → optional selling freeze assert → inventory by product_id. Finalize/begin-close pass p_enforce_freeze=false.';

-- ---------------------------------------------------------------------------
-- 6) Same-day finalized close guard for start_cashier_shift
-- ---------------------------------------------------------------------------
create or replace function public.assert_branch_may_start_shift(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.current_manila_business_date();
begin
  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id
      and s.inventory_reconciliation_required
  ) then
    raise exception 'Complete pending inventory reconciliation before starting a new shift.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id
      and s.status = 'closed'
      and not s.inventory_reconciliation_required
      and exists (select 1 from public.shift_reconciliations r where r.shift_id = s.id)
      and public.manila_business_date(coalesce(s.sales_cutoff_at, s.ended_at)) = v_today
  ) then
    raise exception 'A final close already completed for this branch today. Start again next business day.'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_branch_may_start_shift(uuid)
  from public, anon, authenticated;

commit;
