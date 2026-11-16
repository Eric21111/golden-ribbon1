begin;

-- Phase 4B final safety:
-- 1) Archive export includes sale_items.void_history (+ flattened void_events).
-- 2) Fail closed: do not delete sales still required for unresolved remittance expected Cash/GCash.

create or replace function public.archive_assert_remittance_safe(p_start timestamptz, p_end timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  -- Pending/legacy expected payments for unreconciled closed shifts come from live sales
  -- (shift_payment_totals / sales sum). Deleting those sales would zero historical expected.
  if exists (
    select 1
    from public.sales s
    join public.shifts sh on sh.id = s.shift_id
    where s.sold_at >= p_start
      and s.sold_at < p_end
      and s.status = 'completed'
      and sh.status = 'closed'
      and sh.reconciliation_required
      and not exists (
        select 1
        from public.shift_reconciliations r
        where r.shift_id = sh.id
      )
  ) then
    raise exception
      'Cannot clean archived sales while closed shifts still need remittance. Expected Cash/GCash for those shifts comes from live sales. Reconcile them first.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.archive_assert_remittance_safe(timestamptz, timestamptz)
  from public, anon, authenticated;

create or replace function public.get_archive_export(p_archive_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archive public.data_archives%rowtype;
  v_counts record;
  v_sales jsonb;
  v_items jsonb;
  v_shifts jsonb;
  v_void_events jsonb;
begin
  perform public.assert_owner_archive_access();

  select * into v_archive
  from public.data_archives
  where id = p_archive_id;

  if not found then
    raise exception 'Archive record was not found.' using errcode = 'P0002';
  end if;

  if v_archive.status = 'cleaned' then
    raise exception 'This archive has already been cleaned.' using errcode = 'P0001';
  end if;

  select * into v_counts
  from public.archive_source_counts(v_archive.period_start, v_archive.period_end);

  if v_counts.sales_count is distinct from v_archive.sales_count
     or v_counts.sale_items_count is distinct from v_archive.sale_items_count
     or v_counts.shift_count is distinct from v_archive.shift_count
     or v_counts.revenue_total is distinct from v_archive.revenue_total
     or v_counts.units_sold is distinct from v_archive.units_sold then
    update public.data_archives set status = 'failed' where id = v_archive.id;
    raise exception 'Archive verification failed. No data was deleted.' using errcode = '55000';
  end if;

  select coalesce(jsonb_agg(row_to_json(r) order by r.sold_at, r.sale_number), '[]'::jsonb)
  into v_sales
  from (
    select
      s.id,
      s.sale_number,
      b.name as branch_name,
      s.branch_id,
      s.cashier_id,
      p.full_name as cashier_name,
      s.shift_id,
      s.status,
      s.subtotal,
      s.total_amount,
      s.amount_paid,
      s.change_amount,
      s.sold_at
    from public.sales s
    join public.branches b on b.id = s.branch_id
    join public.profiles p on p.id = s.cashier_id
    where s.sold_at >= v_archive.period_start
      and s.sold_at < v_archive.period_end
  ) r;

  select coalesce(jsonb_agg(row_to_json(r) order by r.sale_id, r.product_name), '[]'::jsonb)
  into v_items
  from (
    select
      si.id,
      si.sale_id,
      si.product_id,
      pr.name as product_name,
      pr.sku as product_sku,
      si.quantity,
      si.unit_price,
      si.subtotal,
      si.void_history
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    join public.products pr on pr.id = si.product_id
    where s.sold_at >= v_archive.period_start
      and s.sold_at < v_archive.period_end
  ) r;

  select coalesce(jsonb_agg(row_to_json(r) order by r.voided_at, r.void_event_id), '[]'::jsonb)
  into v_void_events
  from (
    select
      (v->>'id') as void_event_id,
      si.id as sale_item_id,
      si.sale_id,
      s.sale_number,
      si.product_id,
      pr.name as product_name,
      (v->>'quantity')::numeric as quantity,
      (v->>'amount')::numeric as amount,
      v->>'reason' as reason,
      coalesce(v->>'note', '') as note,
      (v->>'cashier_id') as actor_id,
      actor.full_name as actor_name,
      (v->>'at') as voided_at
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    join public.products pr on pr.id = si.product_id
    cross join lateral jsonb_array_elements(coalesce(si.void_history, '[]'::jsonb)) v
    left join public.profiles actor on actor.id = nullif(v->>'cashier_id', '')::uuid
    where s.sold_at >= v_archive.period_start
      and s.sold_at < v_archive.period_end
      and jsonb_array_length(coalesce(si.void_history, '[]'::jsonb)) > 0
  ) r;

  select coalesce(jsonb_agg(row_to_json(r) order by r.ended_at, r.id), '[]'::jsonb)
  into v_shifts
  from (
    select
      sh.id,
      sh.cashier_id,
      p.full_name as cashier_name,
      sh.branch_id,
      b.name as branch_name,
      sh.started_at,
      sh.ended_at,
      sh.status
    from public.eligible_archive_shifts(v_archive.period_end) sh
    join public.profiles p on p.id = sh.cashier_id
    join public.branches b on b.id = sh.branch_id
  ) r;

  if jsonb_array_length(v_sales) is distinct from v_archive.sales_count
     or jsonb_array_length(v_items) is distinct from v_archive.sale_items_count
     or jsonb_array_length(v_shifts) is distinct from v_archive.shift_count then
    update public.data_archives set status = 'failed' where id = v_archive.id;
    raise exception 'Archive verification failed. No data was deleted.' using errcode = '55000';
  end if;

  update public.data_archives
  set status = case when status in ('verified', 'exported') then status else 'exported' end,
      export_generated_at = coalesce(export_generated_at, now())
  where id = v_archive.id
  returning * into v_archive;

  return jsonb_build_object(
    'archive', to_jsonb(v_archive),
    'sales', v_sales,
    'sale_items', v_items,
    'void_events', v_void_events,
    'shifts', v_shifts,
    'manifest', jsonb_build_object(
      'archive_id', v_archive.id,
      'package_name', format(
        'golden-ribbon-archive-%s_%s',
        to_char(timezone('Asia/Manila', v_archive.period_start), 'YYYY-MM-DD'),
        to_char(timezone('Asia/Manila', v_archive.period_end), 'YYYY-MM-DD')
      ),
      'start_date', v_archive.period_start,
      'end_date', v_archive.period_end,
      'generated_at', v_archive.export_generated_at,
      'sales_row_count', v_archive.sales_count,
      'sale_item_row_count', v_archive.sale_items_count,
      'shift_row_count', v_archive.shift_count,
      'void_event_row_count', jsonb_array_length(v_void_events),
      'revenue_total', v_archive.revenue_total,
      'units_sold', v_archive.units_sold
    )
  );
end;
$$;

revoke all on function public.get_archive_export(uuid) from public, anon;
grant execute on function public.get_archive_export(uuid) to authenticated;

create or replace function public.verify_sales_archive(p_archive_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archive public.data_archives%rowtype;
  v_counts record;
begin
  perform public.assert_owner_archive_access();

  select * into v_archive from public.data_archives where id = p_archive_id;
  if not found then
    raise exception 'Archive record was not found.' using errcode = 'P0002';
  end if;
  if v_archive.status = 'cleaned' then
    return to_jsonb(v_archive);
  end if;
  if v_archive.export_generated_at is null then
    raise exception 'Export the archive and save a copy before verification.' using errcode = 'P0001';
  end if;

  select * into v_counts
  from public.archive_source_counts(v_archive.period_start, v_archive.period_end);

  if v_counts.sales_count is distinct from v_archive.sales_count
     or v_counts.sale_items_count is distinct from v_archive.sale_items_count
     or v_counts.shift_count is distinct from v_archive.shift_count
     or v_counts.revenue_total is distinct from v_archive.revenue_total
     or v_counts.units_sold is distinct from v_archive.units_sold then
    update public.data_archives set status = 'failed' where id = v_archive.id;
    raise exception 'Archive verification failed. No data was deleted.' using errcode = '55000';
  end if;

  begin
    perform public.verify_summary_totals(v_archive.period_start, v_archive.period_end);
  exception when others then
    update public.data_archives set status = 'failed' where id = v_archive.id;
    raise exception 'Archive verification failed. No data was deleted.' using errcode = '55000';
  end;

  perform public.archive_assert_remittance_safe(v_archive.period_start, v_archive.period_end);

  update public.data_archives
  set status = 'verified',
      verified_at = now()
  where id = v_archive.id
  returning * into v_archive;

  return to_jsonb(v_archive);
end;
$$;

revoke all on function public.verify_sales_archive(uuid) from public, anon;
grant execute on function public.verify_sales_archive(uuid) to authenticated;

create or replace function public.cleanup_archived_sales(p_archive_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archive public.data_archives%rowtype;
  v_counts record;
  v_variance bigint;
  v_movements_before bigint;
  v_movements_after bigint;
  v_shifts_before bigint;
  v_shifts_after bigint;
  v_recon_before bigint;
  v_recon_after bigint;
  v_waste_before bigint;
  v_waste_after bigint;
begin
  perform public.assert_owner_archive_access();
  perform pg_advisory_xact_lock(hashtext('cleanup_archived_sales'));

  if p_confirmation is distinct from 'DELETE ARCHIVED DATA' then
    raise exception 'Type DELETE ARCHIVED DATA to confirm cleanup.' using errcode = 'P0001';
  end if;

  select * into v_archive from public.data_archives where id = p_archive_id;
  if not found then
    raise exception 'Archive record was not found.' using errcode = 'P0002';
  end if;

  if v_archive.status = 'cleaned' then
    return to_jsonb(v_archive);
  end if;

  if v_archive.status is distinct from 'verified' or v_archive.export_generated_at is null then
    raise exception 'Archive must be exported and verified before cleanup.' using errcode = 'P0001';
  end if;

  select * into v_counts
  from public.archive_source_counts(v_archive.period_start, v_archive.period_end);

  if v_counts.sales_count is distinct from v_archive.sales_count
     or v_counts.sale_items_count is distinct from v_archive.sale_items_count
     or v_counts.shift_count is distinct from v_archive.shift_count
     or v_counts.revenue_total is distinct from v_archive.revenue_total
     or v_counts.units_sold is distinct from v_archive.units_sold then
    update public.data_archives set status = 'failed' where id = v_archive.id;
    raise exception 'Archive verification failed. No data was deleted.' using errcode = '55000';
  end if;

  perform public.verify_summary_totals(v_archive.period_start, v_archive.period_end);
  perform public.archive_assert_remittance_safe(v_archive.period_start, v_archive.period_end);

  select count(*) into v_movements_before from public.inventory_movements;
  select count(*) into v_shifts_before from public.shifts;
  select count(*) into v_recon_before from public.shift_reconciliations;
  select count(*) into v_waste_before from public.shift_waste_occurrences;

  perform set_config('app.allow_archive_cleanup', 'on', true);

  delete from public.sale_items si
  using public.sales s
  where si.sale_id = s.id
    and s.sold_at >= v_archive.period_start
    and s.sold_at < v_archive.period_end;

  delete from public.sales s
  where s.sold_at >= v_archive.period_start
    and s.sold_at < v_archive.period_end;

  perform set_config('app.allow_archive_cleanup', 'off', true);

  select count(*) into v_movements_after from public.inventory_movements;
  select count(*) into v_shifts_after from public.shifts;
  select count(*) into v_recon_after from public.shift_reconciliations;
  select count(*) into v_waste_after from public.shift_waste_occurrences;

  if v_movements_after is distinct from v_movements_before
     or v_shifts_after is distinct from v_shifts_before
     or v_recon_after is distinct from v_recon_before
     or v_waste_after is distinct from v_waste_before then
    raise exception 'Archive verification failed. No data was deleted.' using errcode = '55000';
  end if;

  select coalesce(sum(abs(coalesce(bi.quantity_on_hand, 0) - coalesce(led.qty, 0))), 0)
  into v_variance
  from public.branch_inventory bi
  full join (
    select branch_id, product_id, sum(quantity) as qty
    from public.inventory_movements
    group by branch_id, product_id
  ) led on led.branch_id = bi.branch_id and led.product_id = bi.product_id;

  if v_variance <> 0 then
    raise exception 'Archive verification failed. No data was deleted.' using errcode = '55000';
  end if;

  update public.data_archives
  set status = 'cleaned',
      cleaned_at = now()
  where id = v_archive.id
  returning * into v_archive;

  update public.archive_settings
  set remind_after = null,
      updated_at = now()
  where id = 1;

  return to_jsonb(v_archive);
end;
$$;

revoke all on function public.cleanup_archived_sales(uuid, text) from public, anon;
grant execute on function public.cleanup_archived_sales(uuid, text) to authenticated;

comment on function public.archive_assert_remittance_safe(timestamptz, timestamptz) is
  'Blocks archive cleanup/verify when completed sales in range belong to unreconciled closed shifts that still need live sales for expected Cash/GCash.';

comment on function public.get_archive_export(uuid) is
  'Owner archive export package including sales, sale_items (with void_history), flattened void_events, and related shifts for backup context.';

commit;
