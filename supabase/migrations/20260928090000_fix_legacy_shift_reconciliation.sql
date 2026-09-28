begin;

-- Explicit remittance eligibility. Existing rows stay false (legacy).
-- Future inserts default true. Open->closed close paths also set true.
alter table public.shifts
  add column reconciliation_required boolean not null default false;

alter table public.shifts
  alter column reconciliation_required set default true;

create or replace function public.start_cashier_shift()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashier_id         uuid := auth.uid();
  v_user               public.profiles%rowtype;
  v_branch_id          uuid;
  v_shift_id           uuid;
  v_existing_branch_id uuid;
begin
  select * into v_user
  from public.profiles
  where id = v_cashier_id and role = 'cashier' and is_active
  for update;
  if not found then
    raise exception 'Unauthorized: cashier access is required.' using errcode = '42501';
  end if;

  v_branch_id := v_user.branch_id;
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

  insert into public.shifts(branch_id, cashier_id, status, started_at, reconciliation_required)
  values (v_branch_id, v_cashier_id, 'open', now(), true)
  returning id into v_shift_id;

  return v_shift_id;
end;
$$;

revoke all on function public.start_cashier_shift() from public, anon;
grant execute on function public.start_cashier_shift() to authenticated;

create or replace function public.close_overdue_shifts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now_manila          timestamp;
  v_cutoff_manila_date  date;
  v_cutoff              timestamptz;
  v_shift               public.shifts%rowtype;
  v_leftover_id         uuid;
  v_closed_count        integer := 0;
  v_leftover_count      integer := 0;
begin
  v_now_manila := timezone('Asia/Manila', now());
  if v_now_manila < (v_now_manila::date + time '21:00') then
    v_cutoff_manila_date := v_now_manila::date - 1;
  else
    v_cutoff_manila_date := v_now_manila::date;
  end if;
  v_cutoff := (v_cutoff_manila_date + time '21:00') at time zone 'Asia/Manila';

  for v_shift in
    select *
    from public.shifts
    where status = 'open'
      and started_at < v_cutoff
    order by started_at, id
    for update skip locked
  loop
    begin
      v_leftover_id := null;
      update public.shifts
      set status = 'closed', ended_at = now(), reconciliation_required = true
      where id = v_shift.id
        and status = 'open';
      if found then
        v_closed_count := v_closed_count + 1;
        if v_leftover_id is not null then
          v_leftover_count := v_leftover_count + 1;
        end if;
      end if;
    exception when others then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'closed_count', v_closed_count,
    'leftover_return_count', v_leftover_count,
    'cutoff_at', v_cutoff
  );
end;
$$;

revoke all on function public.close_overdue_shifts() from public, anon, authenticated;

create or replace function public.close_cashier_shift(
  p_shift_id uuid,
  p_actual_cash text,
  p_waste jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_result jsonb;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.cashier_id <> v_user.id or v_shift.branch_id is distinct from v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'This shift is already closed.' using errcode = '42501';
  end if;

  v_result := public.record_shift_reconciliation(v_shift, v_user.id, p_actual_cash, p_waste);
  update public.shifts
  set status = 'closed', ended_at = now(), reconciliation_required = true
  where id = p_shift_id and status = 'open';
  return v_result || jsonb_build_object('shift_status', 'closed');
end;
$$;

revoke all on function public.close_cashier_shift(uuid, text, jsonb) from public, anon;
grant execute on function public.close_cashier_shift(uuid, text, jsonb) to authenticated;

create or replace function public.reconcile_closed_shift(
  p_shift_id uuid,
  p_actual_cash text,
  p_waste jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found or v_shift.cashier_id <> v_user.id or v_shift.branch_id is distinct from v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;
  if v_shift.status <> 'closed' then
    raise exception 'Only a closed shift can be reconciled later.' using errcode = '42501';
  end if;
  if not v_shift.reconciliation_required then
    raise exception 'This historical shift does not require reconciliation.' using errcode = '22023';
  end if;

  return public.record_shift_reconciliation(v_shift, v_user.id, p_actual_cash, p_waste);
end;
$$;

revoke all on function public.reconcile_closed_shift(uuid, text, jsonb) from public, anon;
grant execute on function public.reconcile_closed_shift(uuid, text, jsonb) to authenticated;

create or replace function public.get_my_pending_shift_reconciliation()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_expected numeric(12,2);
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier';
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts s
  where s.cashier_id = v_user.id
    and s.branch_id = v_user.branch_id
    and s.status = 'closed'
    and s.reconciliation_required
    and not exists (select 1 from public.shift_reconciliations r where r.shift_id = s.id)
  order by s.ended_at asc, s.id
  limit 1;
  if not found then
    return null;
  end if;

  select coalesce(sum(sales.total_amount), 0)::numeric(12,2) into v_expected
  from public.sales
  where shift_id = v_shift.id and status = 'completed';

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'started_at', v_shift.started_at,
    'ended_at', v_shift.ended_at,
    'expected_cash', v_expected,
    'actual_cash', null,
    'difference', null,
    'result', null,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.get_my_pending_shift_reconciliation() from public, anon;
grant execute on function public.get_my_pending_shift_reconciliation() to authenticated;

create or replace function public.report_branch_shift_remittances(
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Unauthorized: Owner or Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.ended_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      s.id as shift_id,
      s.branch_id,
      b.name as branch_name,
      s.cashier_id,
      s.ended_at,
      case when r.id is null then 'pending' else 'reconciled' end as status,
      coalesce(r.expected_cash, (
        select coalesce(sum(sales.total_amount), 0)::numeric(12,2)
        from public.sales
        where sales.shift_id = s.id and sales.status = 'completed'
      )) as expected_cash,
      r.actual_cash,
      r.difference,
      r.result
    from public.shifts s
    join public.branches b on b.id = s.branch_id
    left join public.shift_reconciliations r on r.shift_id = s.id
    where s.status = 'closed'
      and not b.is_main_branch
      and (p_branch_id is null or s.branch_id = p_branch_id)
      and (r.id is not null or s.reconciliation_required)
  ) q;
  return v_result;
end;
$$;

revoke all on function public.report_branch_shift_remittances(uuid) from public, anon;
grant execute on function public.report_branch_shift_remittances(uuid) to authenticated;

commit;
