begin;

-- Phase 4B backup safety:
-- Open archives exported/verified before void-history support must re-export and re-verify.
-- Cleaned archive history is preserved. New exports stamp export_format_version = 2.

alter table public.data_archives
  add column if not exists export_format_version integer not null default 1;

comment on column public.data_archives.export_format_version is
  '1 = pre-void-history export; 2 = includes void_history/void_events. Verify/cleanup require >= 2.';

-- Invalidate open archives that may lack void-event backups. Do not touch cleaned rows.
update public.data_archives
set
  status = 'prepared',
  export_generated_at = null,
  verified_at = null,
  export_format_version = 1
where status in ('exported', 'verified', 'failed');

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

  -- Fresh export stamps void-history format and clears verification so Owner must re-verify.
  update public.data_archives
  set status = 'exported',
      verified_at = null,
      export_generated_at = now(),
      export_format_version = 2
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
      'export_format_version', v_archive.export_format_version,
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
  if coalesce(v_archive.export_format_version, 1) < 2 then
    raise exception
      'Export a fresh archive backup that includes void history before verifying.'
      using errcode = 'P0001';
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

  if coalesce(v_archive.export_format_version, 1) < 2 then
    raise exception
      'Export a fresh archive backup that includes void history before cleaning.'
      using errcode = 'P0001';
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

-- Include export_format_version on active archive status payload.
create or replace function public.get_archive_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_oldest timestamptz;
  v_sales bigint;
  v_items bigint;
  v_shifts bigint;
  v_last timestamptz;
  v_remind timestamptz;
  v_due boolean;
  v_open public.data_archives%rowtype;
  v_db_size bigint;
begin
  perform public.assert_owner_archive_access();

  v_cutoff := public.archive_retention_cutoff();

  select min(s.sold_at) into v_oldest from public.sales s;

  select count(*) into v_sales from public.sales s where s.sold_at < v_cutoff;
  select count(*) into v_items
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.sold_at < v_cutoff;
  select count(*) into v_shifts from public.eligible_archive_shifts(v_cutoff);

  select max(cleaned_at) into v_last
  from public.data_archives
  where status = 'cleaned';

  select remind_after into v_remind from public.archive_settings where id = 1;

  select * into v_open
  from public.data_archives
  where status in ('prepared', 'exported', 'verified')
  order by created_at desc
  limit 1;

  v_due := coalesce(v_sales, 0) > 0;

  begin
    v_db_size := pg_database_size(current_database());
  exception when others then
    v_db_size := null;
  end;

  return jsonb_build_object(
    'retention_days', public.archive_retention_days(),
    'cutoff_at', v_cutoff,
    'oldest_detailed_sale_at', v_oldest,
    'eligible_sales_count', coalesce(v_sales, 0),
    'eligible_sale_items_count', coalesce(v_items, 0),
    'eligible_shift_count', coalesce(v_shifts, 0),
    'estimated_records', coalesce(v_sales, 0) + coalesce(v_items, 0),
    'last_successful_archive_at', v_last,
    'next_archive_recommended_at', v_cutoff + make_interval(days => public.archive_retention_days()),
    'archive_due', v_due,
    'reminder_visible', v_due and (v_remind is null or v_remind <= now()),
    'remind_after', v_remind,
    'database_size_bytes', v_db_size,
    'active_archive', case
      when v_open.id is null then null
      else jsonb_build_object(
        'id', v_open.id,
        'period_start', v_open.period_start,
        'period_end', v_open.period_end,
        'status', v_open.status,
        'sales_count', v_open.sales_count,
        'sale_items_count', v_open.sale_items_count,
        'shift_count', v_open.shift_count,
        'revenue_total', v_open.revenue_total,
        'units_sold', v_open.units_sold,
        'export_generated_at', v_open.export_generated_at,
        'export_format_version', v_open.export_format_version,
        'verified_at', v_open.verified_at,
        'cleaned_at', v_open.cleaned_at,
        'created_at', v_open.created_at
      )
    end
  );
end;
$$;

revoke all on function public.get_archive_status() from public, anon;
grant execute on function public.get_archive_status() to authenticated;

commit;
