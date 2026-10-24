-- October 24 bug fixes. Forward-only. Does not rewrite historical sales or remittances.
begin;

-- Back office / guard is ₱13 OFF each eligible unit, not a ₱13 fixed price.
update public.sale_pricing_program_settings
set pricing_mode = 'amount_off',
    fixed_amount = 13.00,
    label = 'Back office / security guard',
    updated_at = now()
where program = 'back_office_guard';

comment on table public.sale_pricing_program_settings is
  'POS pricing programs. back_office_guard uses amount_off (₱13 off catalog per unit). Historical sales keep the totals already stored.';

-- A completed same-day remittance still blocks Start shift. An open shift created
-- by reopen_cashier_shift is allowed to sell; the closed remittance is not rewritten.
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

  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id and s.status = 'open'
  ) then
    return;
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
    raise exception 'Branch inventory is frozen after final close for this business day.'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_selling_branch_inventory_not_frozen(uuid)
  from public, anon, authenticated;

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
      and (
        not exists (
          select 1 from public.shift_reconciliations r where r.shift_id = s.id
        )
        or exists (
          select 1
          from public.shift_product_close_baselines b
          where b.shift_id = s.id
            and not exists (
              select 1
              from public.shift_product_reconciliations pr
              where pr.shift_id = b.shift_id
                and pr.product_id = b.product_id
            )
        )
      )
  ) then
    raise exception 'Complete pending inventory reconciliation before starting a new shift.'
      using errcode = '55000';
  end if;

  -- An already-open session (including a same-day reopen) is attached, not duplicated.
  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id and s.status = 'open'
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.shifts s
    where s.branch_id = p_branch_id
      and s.status = 'closed'
      and exists (select 1 from public.shift_reconciliations r where r.shift_id = s.id)
      and public.manila_business_date(coalesce(s.sales_cutoff_at, s.ended_at)) = v_today
      and not exists (
        select 1
        from public.shift_product_close_baselines b
        where b.shift_id = s.id
          and not exists (
            select 1
            from public.shift_product_reconciliations pr
            where pr.shift_id = b.shift_id
              and pr.product_id = b.product_id
          )
      )
  ) then
    raise exception 'A final close already completed for this branch today. Start again next business day.'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.assert_branch_may_start_shift(uuid)
  from public, anon, authenticated;

-- One product setting: non-returnable forces keep-at-branch. Turning it off
-- restores returnable close behavior only when the flag was previously on.
create or replace function public.set_product_non_returnable(
  p_product_id uuid,
  p_is_non_returnable boolean
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_flag boolean := coalesce(p_is_non_returnable, false);
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;
  update public.products
  set is_non_returnable = v_flag,
      closing_stock_behavior = case
        when v_flag then 'keep_at_branch'::public.closing_stock_behavior
        when is_non_returnable then 'record_as_unsold'::public.closing_stock_behavior
        else closing_stock_behavior
      end
  where id = p_product_id
  returning * into v_product;
  if not found then
    raise exception 'Product is missing.' using errcode = '22023';
  end if;
  return v_product;
end;
$$;

revoke all on function public.set_product_non_returnable(uuid, boolean) from public, anon;
grant execute on function public.set_product_non_returnable(uuid, boolean) to authenticated;

-- Same-day POS reopen after a completed remittance. Leaves the closed shift
-- and its reconciliation rows untouched (no second remittance of that shift).
create table if not exists public.shift_reopen_events (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  closed_shift_id uuid not null references public.shifts(id),
  new_shift_id uuid not null references public.shifts(id),
  reopened_by uuid not null references public.profiles(id),
  reason text not null check (char_length(reason) between 8 and 500),
  created_at timestamptz not null default now()
);

create index if not exists shift_reopen_events_branch_idx
  on public.shift_reopen_events (branch_id, created_at desc);

alter table public.shift_reopen_events enable row level security;

drop policy if exists shift_reopen_events_select on public.shift_reopen_events;
create policy shift_reopen_events_select
on public.shift_reopen_events for select to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or reopened_by = (select auth.uid())
);

revoke all on public.shift_reopen_events from public, anon;
grant select on public.shift_reopen_events to authenticated;

create or replace function public.reopen_cashier_shift(p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_closed public.shifts%rowtype;
  v_open uuid;
  v_open_cashier uuid;
  v_new uuid;
  v_captured_at timestamptz := now();
  v_today date := public.current_manila_business_date();
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and role = 'cashier' and is_active
  for update;
  if not found then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;
  if v_user.branch_id is null then
    raise exception 'No branch is assigned to this cashier.' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 8 and 500 then
    raise exception 'Enter a reopen reason between 8 and 500 characters.' using errcode = '22023';
  end if;

  perform 1
  from public.branches
  where id = v_user.branch_id and is_active and not is_main_branch;
  if not found then
    raise exception 'The assigned branch is inactive or invalid.' using errcode = '22023';
  end if;

  perform public.lock_branch_inventory_gate(v_user.branch_id, false);

  -- Incomplete remittance still blocks. A finished remittance does not.
  if exists (
    select 1
    from public.shifts s
    where s.branch_id = v_user.branch_id
      and s.inventory_reconciliation_required
      and (
        not exists (select 1 from public.shift_reconciliations r where r.shift_id = s.id)
        or exists (
          select 1
          from public.shift_product_close_baselines b
          where b.shift_id = s.id
            and not exists (
              select 1
              from public.shift_product_reconciliations pr
              where pr.shift_id = b.shift_id and pr.product_id = b.product_id
            )
        )
      )
  ) then
    raise exception 'Complete pending inventory reconciliation before starting a new shift.'
      using errcode = '55000';
  end if;

  select id, cashier_id into v_open, v_open_cashier
  from public.shifts
  where branch_id = v_user.branch_id and status = 'open'
  order by started_at, id
  limit 1;
  if v_open is not null then
    if v_open_cashier = v_user.id then
      return v_open;
    end if;
    raise exception 'Another selling session is already active for this branch.'
      using errcode = '55000';
  end if;

  select * into v_closed
  from public.shifts s
  where s.branch_id = v_user.branch_id
    and s.cashier_id = v_user.id
    and s.status = 'closed'
    and public.manila_business_date(coalesce(s.sales_cutoff_at, s.ended_at)) = v_today
    and exists (select 1 from public.shift_reconciliations r where r.shift_id = s.id)
    and not exists (
      select 1
      from public.shift_product_close_baselines b
      where b.shift_id = s.id
        and not exists (
          select 1
          from public.shift_product_reconciliations pr
          where pr.shift_id = b.shift_id and pr.product_id = b.product_id
        )
    )
  order by s.ended_at desc nulls last, s.id desc
  limit 1;
  if not found then
    raise exception 'Reopen POS is only available after your own completed remittance today.'
      using errcode = '42501';
  end if;

  insert into public.shifts(
    branch_id, cashier_id, status, started_at,
    reconciliation_required, inventory_reconciliation_required
  )
  values (v_user.branch_id, v_user.id, 'open', v_captured_at, true, false)
  returning id into v_new;

  insert into public.shift_product_opening_stock (
    shift_id, branch_id, product_id, product_name_snapshot, opening_quantity, captured_at
  )
  select
    v_new,
    v_user.branch_id,
    p.id,
    p.name,
    coalesce(bi.quantity_on_hand, 0)::bigint,
    v_captured_at
  from public.products p
  left join public.branch_inventory bi
    on bi.product_id = p.id and bi.branch_id = v_user.branch_id
  where exists (
      select 1 from public.branch_products bp
      where bp.branch_id = v_user.branch_id and bp.product_id = p.id
    )
    or bi.product_id is not null;

  insert into public.shift_reopen_events(
    branch_id, closed_shift_id, new_shift_id, reopened_by, reason
  ) values (
    v_user.branch_id, v_closed.id, v_new, v_user.id, v_reason
  );

  return v_new;
end;
$$;

revoke all on function public.reopen_cashier_shift(text) from public, anon;
grant execute on function public.reopen_cashier_shift(text) to authenticated;

comment on function public.reopen_cashier_shift(text) is
  'Cashier same-day POS reopen after a completed remittance. Audited. Does not alter the closed shift or its remittance.';

commit;
