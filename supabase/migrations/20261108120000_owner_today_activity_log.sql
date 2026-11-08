-- Owner dashboard "Today Log": today's (Asia/Manila) employee activity across all branches.
-- Read-only. Derived from the records each successful operation already writes; the audit_logs subsystem
-- was removed in Milestone 11 and is intentionally not recreated. One row per operation:
--   opening_stock_set   inventory_movements at Main (first-time opening_stock + repeat-opening adjustments),
--                       grouped per initialize_main_branch_inventory call (same branch, actor, transaction time).
--                       At Main, reference_type 'adjustment' is written only by that function (shift-close
--                       adjustments are at selling branches; local purchases use reference_type 'local_purchase').
--   transfer_sent       stock_transfers.sent_at / sent_by
--   shift_started       shifts.started_at / cashier_id (reopened = listed in shift_reopen_events.new_shift_id)
--   transfer_received   stock_transfers.received_at / received_by (confirm arrival or report issue)
--   shift_ended         shifts.ended_at / cashier_id. Shifts carry no record of who closed them.
--                       close_overdue_shifts (9 PM Manila cron) only closes shifts started before the latest
--                       21:00 Manila cutoff, so a close is possibly_automatic exactly when started_at precedes
--                       the latest 21:00 Manila at or before ended_at; every other close was the cashier's.
--   return_sent         stock_returns.returned_at / returned_by
--   return_received     stock_returns.received_at / received_by

create or replace function public.get_owner_today_activity_log()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_limit constant integer := 500;
  v_total integer;
  v_activities jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  v_business_date := (timezone('Asia/Manila', now()))::date;
  v_start := v_business_date::timestamp at time zone 'Asia/Manila';
  v_end := v_start + interval '1 day';

  with events as (
    select
      'opening_stock:' || m.branch_id || ':' || m.created_by || ':'
        || to_char(m.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') as id,
      'opening_stock_set'::text as action,
      1 as seq,
      m.created_at as occurred_at,
      m.created_by as actor_id,
      null::text as actor_name_snapshot,
      m.branch_id,
      null::text as branch_name_snapshot,
      jsonb_build_object(
        'product_count', count(distinct m.product_id),
        'added_count', count(distinct m.product_id) filter (where m.movement_type = 'adjustment')
      ) as detail
    from public.inventory_movements m
    join public.branches b on b.id = m.branch_id
    where m.created_at >= v_start and m.created_at < v_end
      and b.is_main_branch
      and (
        m.movement_type = 'opening_stock'
        or (m.movement_type = 'adjustment' and m.reference_type = 'adjustment')
      )
    group by m.branch_id, m.created_by, m.created_at

    union all
    select
      'transfer_sent:' || t.id, 'transfer_sent', 2, t.sent_at, t.sent_by, null, t.from_branch_id, null,
      jsonb_build_object(
        'reference', t.transfer_number,
        'counterpart_branch_name', tb.name,
        'item_count', (select count(*) from public.stock_transfer_items i where i.stock_transfer_id = t.id)
      )
    from public.stock_transfers t
    left join public.branches tb on tb.id = t.to_branch_id
    where t.sent_at >= v_start and t.sent_at < v_end and t.sent_by is not null

    union all
    select
      'shift_started:' || s.id, 'shift_started', 3, s.started_at, s.cashier_id, null, s.branch_id, null,
      jsonb_build_object(
        'reopened', exists (select 1 from public.shift_reopen_events e where e.new_shift_id = s.id)
      )
    from public.shifts s
    where s.started_at >= v_start and s.started_at < v_end

    union all
    select
      'transfer_received:' || t.id, 'transfer_received', 4, t.received_at, t.received_by, null, t.to_branch_id, null,
      jsonb_build_object(
        'reference', t.transfer_number,
        'counterpart_branch_name', fb.name,
        'with_issue', t.status = 'received_with_discrepancy',
        'item_count', (select count(*) from public.stock_transfer_items i where i.stock_transfer_id = t.id)
      )
    from public.stock_transfers t
    left join public.branches fb on fb.id = t.from_branch_id
    where t.received_at >= v_start and t.received_at < v_end and t.received_by is not null

    union all
    select
      'shift_ended:' || s.id, 'shift_ended', 5, s.ended_at, s.cashier_id, null, s.branch_id, null,
      jsonb_build_object(
        'possibly_automatic',
        s.started_at < (
          (timezone('Asia/Manila', s.ended_at) - interval '21 hours')::date + time '21:00'
        ) at time zone 'Asia/Manila'
      )
    from public.shifts s
    where s.status = 'closed' and s.ended_at >= v_start and s.ended_at < v_end

    union all
    select
      'return_sent:' || r.id, 'return_sent', 6, r.returned_at, r.returned_by, r.returned_by_name,
      r.from_branch_id, r.from_branch_name,
      jsonb_build_object(
        'reference', r.return_number,
        'counterpart_branch_name', r.to_branch_name,
        'item_count', (select count(*) from public.stock_return_items i where i.stock_return_id = r.id)
      )
    from public.stock_returns r
    where r.returned_at >= v_start and r.returned_at < v_end and r.status <> 'draft'

    union all
    select
      'return_received:' || r.id, 'return_received', 7, r.received_at, r.received_by, r.received_by_name,
      r.to_branch_id, r.to_branch_name,
      jsonb_build_object(
        'reference', r.return_number,
        'counterpart_branch_name', r.from_branch_name,
        'with_issue', r.status = 'received_with_discrepancy',
        'item_count', (select count(*) from public.stock_return_items i where i.stock_return_id = r.id)
      )
    from public.stock_returns r
    where r.received_at >= v_start and r.received_at < v_end and r.received_by is not null
  ),
  ranked as (
    select e.*, row_number() over (order by e.occurred_at desc, e.seq desc, e.id desc) as position
    from events e
  )
  select
    (select count(*) from events),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'action', r.action,
          'occurred_at', r.occurred_at,
          'actor_id', r.actor_id,
          'actor_name', coalesce(p.full_name, r.actor_name_snapshot, 'Unknown employee'),
          'actor_role', p.role,
          'branch_id', r.branch_id,
          'branch_name', coalesce(b.name, r.branch_name_snapshot, 'Unknown branch'),
          'detail', r.detail
        ) order by r.position
      ) filter (where r.position <= v_limit),
      '[]'::jsonb
    )
  into v_total, v_activities
  from ranked r
  left join public.profiles p on p.id = r.actor_id
  left join public.branches b on b.id = r.branch_id;

  return jsonb_build_object(
    'business_date', v_business_date,
    'total_count', v_total,
    'truncated', v_total > v_limit,
    'activities', v_activities
  );
end;
$$;

revoke all on function public.get_owner_today_activity_log() from public, anon;
grant execute on function public.get_owner_today_activity_log() to authenticated;

comment on function public.get_owner_today_activity_log() is
  'Owner-only, read-only. Today''s (Asia/Manila) employee activity derived from existing operation records, newest first.';
