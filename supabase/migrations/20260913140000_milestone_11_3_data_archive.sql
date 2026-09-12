begin;

-- Milestone 11.3 — Owner-only sales archive, historical summaries, and confirmed cleanup.
-- Transfers, returns, inventory_movements, master data, and open shifts are never deleted here.

create type public.data_archive_status as enum (
  'prepared',
  'exported',
  'verified',
  'cleaned',
  'failed'
);

create table public.daily_product_sales_summary (
  business_date date not null,
  product_id uuid not null references public.products(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  quantity_sold bigint not null check (quantity_sold >= 0),
  revenue numeric(12,2) not null check (revenue >= 0),
  transaction_count bigint not null check (transaction_count >= 0),
  created_at timestamptz not null default now(),
  primary key (business_date, product_id, branch_id)
);

create table public.daily_branch_sales_summary (
  business_date date not null,
  branch_id uuid not null references public.branches(id) on delete restrict,
  transaction_count bigint not null check (transaction_count >= 0),
  quantity_sold bigint not null check (quantity_sold >= 0),
  revenue numeric(12,2) not null check (revenue >= 0),
  created_at timestamptz not null default now(),
  primary key (business_date, branch_id)
);

create table public.data_archives (
  id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status public.data_archive_status not null,
  sales_count bigint not null default 0 check (sales_count >= 0),
  sale_items_count bigint not null default 0 check (sale_items_count >= 0),
  shift_count bigint not null default 0 check (shift_count >= 0),
  revenue_total numeric(12,2) not null default 0 check (revenue_total >= 0),
  units_sold bigint not null default 0 check (units_sold >= 0),
  export_generated_at timestamptz,
  verified_at timestamptz,
  cleaned_at timestamptz,
  created_at timestamptz not null default now(),
  constraint data_archives_period_check check (period_start < period_end)
);

create unique index data_archives_one_open_idx
  on public.data_archives ((true))
  where status in ('prepared', 'exported', 'verified');

create table public.archive_settings (
  id integer primary key check (id = 1),
  remind_after timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.archive_settings (id, remind_after) values (1, null);

alter table public.daily_product_sales_summary enable row level security;
alter table public.daily_branch_sales_summary enable row level security;
alter table public.data_archives enable row level security;
alter table public.archive_settings enable row level security;

create policy daily_product_sales_summary_owner_select
  on public.daily_product_sales_summary for select to authenticated
  using (public.is_owner());
create policy daily_branch_sales_summary_owner_select
  on public.daily_branch_sales_summary for select to authenticated
  using (public.is_owner());
create policy data_archives_owner_select
  on public.data_archives for select to authenticated
  using (public.is_owner());

revoke all on public.daily_product_sales_summary, public.daily_branch_sales_summary, public.data_archives, public.archive_settings
  from public, anon, authenticated;
grant select on public.daily_product_sales_summary, public.daily_branch_sales_summary, public.data_archives
  to authenticated;

-- Allow confirmed archive cleanup to delete immutable sale rows. Updates stay blocked.
create or replace function public.protect_sale_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_archive_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception 'Completed sale history is immutable.' using errcode = '55000';
end;
$$;

create or replace function public.archive_retention_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 90;
$$;

create or replace function public.archive_retention_cutoff()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((timezone('Asia/Manila', now()))::date - public.archive_retention_days())::timestamp
    at time zone 'Asia/Manila';
$$;

create or replace function public.assert_owner_archive_access()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access is required.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.eligible_archive_sales(p_cutoff timestamptz)
returns setof public.sales
language sql
stable
set search_path = ''
as $$
  select s.*
  from public.sales s
  where s.sold_at < p_cutoff;
$$;

create or replace function public.eligible_archive_shifts(p_cutoff timestamptz)
returns setof public.shifts
language sql
stable
set search_path = ''
as $$
  select sh.*
  from public.shifts sh
  where sh.status = 'closed'
    and sh.ended_at < p_cutoff
    and not exists (
      select 1
      from public.sales s
      where s.shift_id = sh.id
        and s.sold_at >= p_cutoff
    );
$$;

create or replace function public.upsert_daily_sales_summaries(p_start timestamptz, p_end timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_product_sales_summary (
    business_date, product_id, branch_id, quantity_sold, revenue, transaction_count
  )
  select
    (timezone('Asia/Manila', s.sold_at))::date,
    si.product_id,
    s.branch_id,
    sum(si.quantity)::bigint,
    sum(si.subtotal)::numeric(12,2),
    count(distinct s.id)::bigint
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.status = 'completed'
    and s.sold_at >= p_start
    and s.sold_at < p_end
  group by 1, 2, 3
  on conflict (business_date, product_id, branch_id) do update
    set quantity_sold = excluded.quantity_sold,
        revenue = excluded.revenue,
        transaction_count = excluded.transaction_count;

  insert into public.daily_branch_sales_summary (
    business_date, branch_id, transaction_count, quantity_sold, revenue
  )
  select
    completed.business_date,
    completed.branch_id,
    count(*)::bigint,
    coalesce((
      select sum(si.quantity)::bigint
      from public.sale_items si
      join public.sales s2 on s2.id = si.sale_id
      where s2.status = 'completed'
        and s2.branch_id = completed.branch_id
        and (timezone('Asia/Manila', s2.sold_at))::date = completed.business_date
        and s2.sold_at >= p_start
        and s2.sold_at < p_end
    ), 0),
    coalesce(sum(completed.total_amount), 0)::numeric(12,2)
  from (
    select
      s.id,
      s.branch_id,
      s.total_amount,
      (timezone('Asia/Manila', s.sold_at))::date as business_date
    from public.sales s
    where s.status = 'completed'
      and s.sold_at >= p_start
      and s.sold_at < p_end
  ) completed
  group by completed.business_date, completed.branch_id
  on conflict (business_date, branch_id) do update
    set transaction_count = excluded.transaction_count,
        quantity_sold = excluded.quantity_sold,
        revenue = excluded.revenue;
end;
$$;

create or replace function public.verify_summary_totals(p_start timestamptz, p_end timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_src_revenue numeric(12,2);
  v_src_units bigint;
  v_src_tx bigint;
  v_sum_revenue numeric(12,2);
  v_sum_units bigint;
  v_sum_tx bigint;
  v_prod_revenue numeric(12,2);
  v_prod_units bigint;
begin
  select
    coalesce(sum(s.total_amount), 0)::numeric(12,2),
    coalesce((
      select sum(si.quantity)::bigint
      from public.sale_items si
      join public.sales s2 on s2.id = si.sale_id
      where s2.status = 'completed'
        and s2.sold_at >= p_start
        and s2.sold_at < p_end
    ), 0),
    count(s.id)::bigint
  into v_src_revenue, v_src_units, v_src_tx
  from public.sales s
  where s.status = 'completed'
    and s.sold_at >= p_start
    and s.sold_at < p_end;

  select
    coalesce(sum(d.revenue), 0)::numeric(12,2),
    coalesce(sum(d.quantity_sold), 0)::bigint,
    coalesce(sum(d.transaction_count), 0)::bigint
  into v_sum_revenue, v_sum_units, v_sum_tx
  from public.daily_branch_sales_summary d
  where (d.business_date::timestamp at time zone 'Asia/Manila') >= p_start
    and (d.business_date::timestamp at time zone 'Asia/Manila') < p_end;

  select
    coalesce(sum(d.revenue), 0)::numeric(12,2),
    coalesce(sum(d.quantity_sold), 0)::bigint
  into v_prod_revenue, v_prod_units
  from public.daily_product_sales_summary d
  where (d.business_date::timestamp at time zone 'Asia/Manila') >= p_start
    and (d.business_date::timestamp at time zone 'Asia/Manila') < p_end;

  if v_src_revenue is distinct from v_sum_revenue
     or v_src_units is distinct from v_sum_units
     or v_src_tx is distinct from v_sum_tx
     or v_src_revenue is distinct from v_prod_revenue
     or v_src_units is distinct from v_prod_units then
    raise exception 'Archive verification failed. No data was deleted.' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.archive_source_counts(p_start timestamptz, p_end timestamptz)
returns table (
  sales_count bigint,
  sale_items_count bigint,
  shift_count bigint,
  revenue_total numeric,
  units_sold bigint
)
language sql
stable
set search_path = ''
as $$
  select
    (select count(*)::bigint from public.sales s where s.sold_at >= p_start and s.sold_at < p_end),
    (select count(*)::bigint
       from public.sale_items si
       join public.sales s on s.id = si.sale_id
      where s.sold_at >= p_start and s.sold_at < p_end),
    (select count(*)::bigint from public.eligible_archive_shifts(p_end)),
    coalesce((
      select sum(s.total_amount)::numeric(12,2)
      from public.sales s
      where s.status = 'completed'
        and s.sold_at >= p_start
        and s.sold_at < p_end
    ), 0),
    coalesce((
      select sum(si.quantity)::bigint
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
      where s.status = 'completed'
        and s.sold_at >= p_start
        and s.sold_at < p_end
    ), 0);
$$;

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
    'estimated_records', coalesce(v_sales, 0) + coalesce(v_items, 0) + coalesce(v_shifts, 0),
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

create or replace function public.dismiss_archive_reminder()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_owner_archive_access();
  update public.archive_settings
  set remind_after = now() + interval '7 days',
      updated_at = now()
  where id = 1;
  return public.get_archive_status();
end;
$$;

revoke all on function public.dismiss_archive_reminder() from public, anon;
grant execute on function public.dismiss_archive_reminder() to authenticated;

create or replace function public.prepare_sales_archive()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_start timestamptz;
  v_counts record;
  v_archive public.data_archives%rowtype;
begin
  perform public.assert_owner_archive_access();
  perform pg_advisory_xact_lock(hashtext('prepare_sales_archive'));

  v_cutoff := public.archive_retention_cutoff();

  select min(s.sold_at) into v_start
  from public.sales s
  where s.sold_at < v_cutoff;

  if v_start is null then
    raise exception 'No detailed sales older than 90 days.' using errcode = 'P0001';
  end if;

  v_start := ((timezone('Asia/Manila', v_start))::date)::timestamp at time zone 'Asia/Manila';

  select * into v_archive
  from public.data_archives
  where status in ('prepared', 'exported', 'verified')
  order by created_at desc
  limit 1;

  perform public.upsert_daily_sales_summaries(v_start, v_cutoff);
  perform public.verify_summary_totals(v_start, v_cutoff);

  select * into v_counts from public.archive_source_counts(v_start, v_cutoff);

  if v_archive.id is null then
    insert into public.data_archives (
      period_start, period_end, status,
      sales_count, sale_items_count, shift_count, revenue_total, units_sold
    ) values (
      v_start, v_cutoff, 'prepared',
      v_counts.sales_count, v_counts.sale_items_count, v_counts.shift_count,
      v_counts.revenue_total, v_counts.units_sold
    )
    returning * into v_archive;
  else
    update public.data_archives
    set period_start = v_start,
        period_end = v_cutoff,
        status = 'prepared',
        sales_count = v_counts.sales_count,
        sale_items_count = v_counts.sale_items_count,
        shift_count = v_counts.shift_count,
        revenue_total = v_counts.revenue_total,
        units_sold = v_counts.units_sold,
        export_generated_at = null,
        verified_at = null
    where id = v_archive.id
    returning * into v_archive;
  end if;

  return to_jsonb(v_archive);
end;
$$;

revoke all on function public.prepare_sales_archive() from public, anon;
grant execute on function public.prepare_sales_archive() to authenticated;

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
      si.subtotal
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    join public.products pr on pr.id = si.product_id
    where s.sold_at >= v_archive.period_start
      and s.sold_at < v_archive.period_end
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

  select count(*) into v_movements_before from public.inventory_movements;

  perform set_config('app.allow_archive_cleanup', 'on', true);

  delete from public.sale_items si
  using public.sales s
  where si.sale_id = s.id
    and s.sold_at >= v_archive.period_start
    and s.sold_at < v_archive.period_end;

  delete from public.sales s
  where s.sold_at >= v_archive.period_start
    and s.sold_at < v_archive.period_end;

  delete from public.shifts sh
  where sh.id in (select id from public.eligible_archive_shifts(v_archive.period_end));

  perform set_config('app.allow_archive_cleanup', 'off', true);

  select count(*) into v_movements_after from public.inventory_movements;
  if v_movements_after is distinct from v_movements_before then
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

-- Historical + live reporting: use remaining detailed sales for dates that still
-- exist in sales; use daily summaries for dates that have already been cleaned.
create or replace function public.report_sales_by_branch(
  p_range_type text default 'today',
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := null;
  v_end timestamptz := null;
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  if p_range_type = 'today' then
    v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
    v_end := v_start + interval '1 day';
  elsif p_range_type = 'custom' then
    if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
      raise exception 'Valid start and end dates required for custom range.' using errcode = '22023';
    end if;
    v_start := p_start_date;
    v_end := p_end_date;
  elsif p_range_type = 'all_time' then
    v_start := null;
    v_end := null;
  else
    raise exception 'Invalid range type. Expected today, custom, or all_time.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'branch_id', b.id,
        'branch_name', b.name,
        'transaction_count', coalesce(s.tx_count, 0),
        'total_sales', coalesce(s.total_sales, 0)
      ) order by b.name
    ),
    '[]'::jsonb
  ) into v_result
  from public.branches b
  left join (
    select branch_id, sum(tx_count)::bigint as tx_count, sum(total_sales)::numeric(12,2) as total_sales
    from (
      select
        s.branch_id,
        count(s.id)::bigint as tx_count,
        sum(s.total_amount)::numeric(12,2) as total_sales
      from public.sales s
      where s.status = 'completed'
        and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
      group by s.branch_id
      union all
      select
        d.branch_id,
        d.transaction_count,
        d.revenue
      from public.daily_branch_sales_summary d
      where (v_start is null or (
        (d.business_date::timestamp at time zone 'Asia/Manila') >= v_start
        and (d.business_date::timestamp at time zone 'Asia/Manila') < v_end
      ))
        and not exists (
          select 1 from public.sales live
          where (timezone('Asia/Manila', live.sold_at))::date = d.business_date
        )
    ) u
    group by branch_id
  ) s on s.branch_id = b.id
  where b.is_active and not b.is_main_branch;

  return v_result;
end;
$$;

revoke all on function public.report_sales_by_branch(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_sales_by_branch(text, timestamptz, timestamptz) to authenticated;

create or replace function public.report_product_sales(
  p_range_type text default 'today',
  p_branch_id uuid default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user public.profiles%rowtype;
  v_branch uuid := null;
  v_start timestamptz := null;
  v_end timestamptz := null;
  v_result jsonb;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active;

  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;

  if v_user.role = 'owner' then
    v_branch := p_branch_id;
  elsif v_user.role = 'manager' then
    v_branch := v_user.branch_id;
  else
    raise exception 'Unauthorized: Owner or Manager access required.' using errcode = '42501';
  end if;

  if p_range_type = 'today' then
    v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
    v_end := v_start + interval '1 day';
  elsif p_range_type = 'custom' then
    if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
      raise exception 'Valid start and end dates required for custom range.' using errcode = '22023';
    end if;
    v_start := p_start_date;
    v_end := p_end_date;
  elsif p_range_type = 'all_time' then
    v_start := null;
    v_end := null;
  else
    raise exception 'Invalid range type. Expected today, custom, or all_time.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', p.id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_sold', coalesce(agg.qty, 0),
        'total_revenue', coalesce(agg.revenue, 0)
      ) order by coalesce(agg.revenue, 0) desc, p.name
    ),
    '[]'::jsonb
  ) into v_result
  from public.products p
  left join (
    select product_id, sum(qty)::bigint as qty, sum(revenue)::numeric(12,2) as revenue
    from (
      select
        si.product_id,
        sum(si.quantity)::bigint as qty,
        sum(si.subtotal)::numeric(12,2) as revenue
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
      where s.status = 'completed'
        and (v_branch is null or s.branch_id = v_branch)
        and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
      group by si.product_id
      union all
      select
        d.product_id,
        d.quantity_sold,
        d.revenue
      from public.daily_product_sales_summary d
      where (v_branch is null or d.branch_id = v_branch)
        and (v_start is null or (
          (d.business_date::timestamp at time zone 'Asia/Manila') >= v_start
          and (d.business_date::timestamp at time zone 'Asia/Manila') < v_end
        ))
        and not exists (
          select 1 from public.sales live
          where (timezone('Asia/Manila', live.sold_at))::date = d.business_date
        )
    ) u
    group by product_id
  ) agg on agg.product_id = p.id
  where p.is_active or coalesce(agg.qty, 0) > 0;

  return v_result;
end;
$$;

revoke all on function public.report_product_sales(text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_product_sales(text, uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.report_branch_performance(
  p_range_type text default 'today',
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  if p_range_type = 'today' then
    v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
    v_end := v_start + interval '1 day';
  elsif p_range_type = 'custom' then
    if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
      raise exception 'Valid half-open start and end timestamps are required.' using errcode = '22023';
    end if;
    v_start := p_start_date;
    v_end := p_end_date;
  elsif p_range_type = 'all_time' then
    v_start := null;
    v_end := null;
  else
    raise exception 'Invalid range type. Expected today, custom, or all_time.' using errcode = '22023';
  end if;

  with sales_union as (
    select s.branch_id, count(s.id)::bigint as tx_count, sum(s.total_amount)::numeric(12,2) as total_sales
    from public.sales s
    where s.status = 'completed'
      and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
    group by s.branch_id
    union all
    select d.branch_id, d.transaction_count, d.revenue
    from public.daily_branch_sales_summary d
    where (v_start is null or (
      (d.business_date::timestamp at time zone 'Asia/Manila') >= v_start
      and (d.business_date::timestamp at time zone 'Asia/Manila') < v_end
    ))
      and not exists (
        select 1 from public.sales live
        where (timezone('Asia/Manila', live.sold_at))::date = d.business_date
      )
  ),
  sales_agg as (
    select branch_id, sum(tx_count)::bigint as tx_count, sum(total_sales)::numeric(12,2) as total_sales
    from sales_union
    group by branch_id
  ),
  item_union as (
    select s.branch_id, sum(si.quantity)::bigint as quantity_sold
    from public.sales s
    join public.sale_items si on si.sale_id = s.id
    where s.status = 'completed'
      and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
    group by s.branch_id
    union all
    select d.branch_id, d.quantity_sold
    from public.daily_branch_sales_summary d
    where (v_start is null or (
      (d.business_date::timestamp at time zone 'Asia/Manila') >= v_start
      and (d.business_date::timestamp at time zone 'Asia/Manila') < v_end
    ))
      and not exists (
        select 1 from public.sales live
        where (timezone('Asia/Manila', live.sold_at))::date = d.business_date
      )
  ),
  item_agg as (
    select branch_id, sum(quantity_sold)::bigint as quantity_sold
    from item_union
    group by branch_id
  ),
  transfer_disc_agg as (
    select st.to_branch_id as branch_id,
      coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::bigint as transfer_missing_qty,
      coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::bigint as transfer_excess_qty
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    where v_start is null or (td.created_at >= v_start and td.created_at < v_end)
    group by st.to_branch_id
  ),
  return_disc_agg as (
    select sr.from_branch_id as branch_id,
      coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint as return_missing_qty,
      coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint as return_excess_qty
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    where v_start is null or (rd.created_at >= v_start and rd.created_at < v_end)
    group by sr.from_branch_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'branch_id', b.id,
    'branch_name', b.name,
    'transaction_count', coalesce(sa.tx_count, 0),
    'total_sales', coalesce(sa.total_sales, 0),
    'quantity_sold', coalesce(ia.quantity_sold, 0),
    'transfer_missing_qty', coalesce(tda.transfer_missing_qty, 0),
    'transfer_excess_qty', coalesce(tda.transfer_excess_qty, 0),
    'return_missing_qty', coalesce(rda.return_missing_qty, 0),
    'return_excess_qty', coalesce(rda.return_excess_qty, 0),
    'total_missing_qty', coalesce(tda.transfer_missing_qty, 0) + coalesce(rda.return_missing_qty, 0),
    'total_excess_qty', coalesce(tda.transfer_excess_qty, 0) + coalesce(rda.return_excess_qty, 0)
  ) order by b.name), '[]'::jsonb)
  into v_result
  from public.branches b
  left join sales_agg sa on sa.branch_id = b.id
  left join item_agg ia on ia.branch_id = b.id
  left join transfer_disc_agg tda on tda.branch_id = b.id
  left join return_disc_agg rda on rda.branch_id = b.id
  where b.is_active and not b.is_main_branch;

  return v_result;
end;
$$;

revoke all on function public.report_branch_performance(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_branch_performance(text, timestamptz, timestamptz) to authenticated;

create or replace function public.get_branch_performance_details(
  p_branch_id uuid,
  p_range_type text default 'today',
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_branch record;
  v_transaction_count bigint;
  v_total_sales numeric(12,2);
  v_quantity_sold bigint;
  v_transfer_missing_qty bigint;
  v_transfer_excess_qty bigint;
  v_return_missing_qty bigint;
  v_return_excess_qty bigint;
  v_metrics jsonb;
  v_inventory jsonb;
  v_products_sold jsonb;
  v_transfer_disc jsonb;
  v_return_disc jsonb;
  v_recent_transfers jsonb;
  v_recent_returns jsonb;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access required.' using errcode = '42501';
  end if;

  select b.id, b.name, b.is_active, b.is_main_branch
    into v_branch
  from public.branches b
  where b.id = p_branch_id;

  if not found then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;

  if p_range_type = 'today' then
    v_start := (timezone('Asia/Manila', now()))::date::timestamp at time zone 'Asia/Manila';
    v_end := v_start + interval '1 day';
  elsif p_range_type = 'custom' then
    if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
      raise exception 'Valid start and end dates required for custom range.' using errcode = '22023';
    end if;
    v_start := p_start_date;
    v_end := p_end_date;
  elsif p_range_type = 'all_time' then
    v_start := null;
    v_end := null;
  else
    raise exception 'Invalid range type. Expected today, custom, or all_time.' using errcode = '22023';
  end if;

  select coalesce(sum(tx_count), 0)::bigint, coalesce(sum(total_sales), 0)::numeric(12,2)
    into v_transaction_count, v_total_sales
  from (
    select count(*)::bigint as tx_count, coalesce(sum(s.total_amount), 0)::numeric(12,2) as total_sales
    from public.sales s
    where s.branch_id = p_branch_id
      and s.status = 'completed'
      and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
    union all
    select d.transaction_count, d.revenue
    from public.daily_branch_sales_summary d
    where d.branch_id = p_branch_id
      and (v_start is null or (
        (d.business_date::timestamp at time zone 'Asia/Manila') >= v_start
        and (d.business_date::timestamp at time zone 'Asia/Manila') < v_end
      ))
      and not exists (
        select 1 from public.sales live
        where (timezone('Asia/Manila', live.sold_at))::date = d.business_date
      )
  ) u;

  select coalesce(sum(quantity_sold), 0)::bigint
    into v_quantity_sold
  from (
    select coalesce(sum(si.quantity), 0)::bigint as quantity_sold
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.branch_id = p_branch_id
      and s.status = 'completed'
      and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
    union all
    select d.quantity_sold
    from public.daily_branch_sales_summary d
    where d.branch_id = p_branch_id
      and (v_start is null or (
        (d.business_date::timestamp at time zone 'Asia/Manila') >= v_start
        and (d.business_date::timestamp at time zone 'Asia/Manila') < v_end
      ))
      and not exists (
        select 1 from public.sales live
        where (timezone('Asia/Manila', live.sold_at))::date = d.business_date
      )
  ) u;

  select
    coalesce(sum(td.difference) filter (where td.discrepancy_type = 'missing'), 0)::bigint,
    coalesce(sum(abs(td.difference)) filter (where td.discrepancy_type = 'excess'), 0)::bigint
    into v_transfer_missing_qty, v_transfer_excess_qty
  from public.transfer_discrepancies td
  join public.stock_transfers st on st.id = td.stock_transfer_id
  where st.to_branch_id = p_branch_id
    and (v_start is null or (td.created_at >= v_start and td.created_at < v_end));

  select
    coalesce(sum(rd.difference) filter (where rd.discrepancy_type = 'missing'), 0)::bigint,
    coalesce(sum(abs(rd.difference)) filter (where rd.discrepancy_type = 'excess'), 0)::bigint
    into v_return_missing_qty, v_return_excess_qty
  from public.return_discrepancies rd
  join public.stock_returns sr on sr.id = rd.stock_return_id
  where sr.from_branch_id = p_branch_id
    and (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end));

  v_metrics := jsonb_build_object(
    'transaction_count', v_transaction_count,
    'total_sales', v_total_sales,
    'quantity_sold', v_quantity_sold,
    'transfer_missing_qty', v_transfer_missing_qty,
    'transfer_excess_qty', v_transfer_excess_qty,
    'return_missing_qty', v_return_missing_qty,
    'return_excess_qty', v_return_excess_qty,
    'total_missing_qty', v_transfer_missing_qty + v_return_missing_qty,
    'total_excess_qty', v_transfer_excess_qty + v_return_excess_qty
  );

  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', inventory.product_id,
      'product_name', inventory.product_name,
      'product_sku', inventory.product_sku,
      'quantity_on_hand', inventory.quantity_on_hand
    ) order by inventory.product_name), '[]'::jsonb)
    into v_inventory
  from (
    select p.id as product_id, p.name as product_name, p.sku as product_sku,
           coalesce(bi.quantity_on_hand, 0) as quantity_on_hand
    from public.products p
    left join public.branch_inventory bi
      on bi.product_id = p.id and bi.branch_id = p_branch_id
    where p.is_active
  ) inventory;

  with product_totals as (
    select product_id, product_name, product_sku,
           sum(quantity_sold)::bigint as quantity_sold,
           sum(total_revenue)::numeric(12,2) as total_revenue
    from (
      select p.id as product_id, p.name as product_name, p.sku as product_sku,
             sum(si.quantity)::bigint as quantity_sold,
             sum(si.subtotal)::numeric(12,2) as total_revenue
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
      join public.products p on p.id = si.product_id
      where s.branch_id = p_branch_id
        and s.status = 'completed'
        and (v_start is null or (s.sold_at >= v_start and s.sold_at < v_end))
      group by p.id, p.name, p.sku
      union all
      select p.id, p.name, p.sku, d.quantity_sold, d.revenue
      from public.daily_product_sales_summary d
      join public.products p on p.id = d.product_id
      where d.branch_id = p_branch_id
        and (v_start is null or (
          (d.business_date::timestamp at time zone 'Asia/Manila') >= v_start
          and (d.business_date::timestamp at time zone 'Asia/Manila') < v_end
        ))
        and not exists (
          select 1 from public.sales live
          where (timezone('Asia/Manila', live.sold_at))::date = d.business_date
        )
    ) u
    group by product_id, product_name, product_sku
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', pt.product_id,
      'product_name', pt.product_name,
      'product_sku', pt.product_sku,
      'quantity_sold', pt.quantity_sold,
      'total_revenue', pt.total_revenue
    ) order by pt.quantity_sold desc), '[]'::jsonb)
    into v_products_sold
  from product_totals pt;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'stock_transfer_id', d.stock_transfer_id,
      'transfer_number', d.transfer_number,
      'product_id', d.product_id,
      'product_name', d.product_name,
      'product_sku', d.product_sku,
      'quantity_expected', d.quantity_expected,
      'quantity_received', d.quantity_received,
      'difference', d.difference,
      'discrepancy_type', d.discrepancy_type,
      'created_at', d.created_at,
      'notes', d.notes
    ) order by d.created_at desc), '[]'::jsonb)
    into v_transfer_disc
  from (
    select td.id, st.id as stock_transfer_id, st.transfer_number,
           p.id as product_id, p.name as product_name, p.sku as product_sku,
           td.quantity_expected, td.quantity_received, td.difference,
           td.discrepancy_type, td.created_at, td.notes
    from public.transfer_discrepancies td
    join public.stock_transfers st on st.id = td.stock_transfer_id
    join public.products p on p.id = td.product_id
    where st.to_branch_id = p_branch_id
      and (v_start is null or (td.created_at >= v_start and td.created_at < v_end))
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'stock_return_id', d.stock_return_id,
      'return_number', d.return_number,
      'product_id', d.product_id,
      'product_name', d.product_name,
      'product_sku', d.product_sku,
      'quantity_expected', d.quantity_expected,
      'quantity_received', d.quantity_received,
      'difference', d.difference,
      'discrepancy_type', d.discrepancy_type,
      'created_at', d.created_at,
      'notes', d.notes
    ) order by d.created_at desc), '[]'::jsonb)
    into v_return_disc
  from (
    select rd.id, sr.id as stock_return_id, sr.return_number,
           p.id as product_id, p.name as product_name, p.sku as product_sku,
           rd.quantity_expected, rd.quantity_received, rd.difference,
           rd.discrepancy_type, rd.created_at, rd.notes
    from public.return_discrepancies rd
    join public.stock_returns sr on sr.id = rd.stock_return_id
    join public.products p on p.id = rd.product_id
    where sr.from_branch_id = p_branch_id
      and (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end))
  ) d;

  with recent as (
    select st.id, st.transfer_number, st.status, st.sent_at, st.received_at, st.created_at
    from public.stock_transfers st
    where st.to_branch_id = p_branch_id
    order by st.created_at desc
    limit 5
  ), item_counts as (
    select sti.stock_transfer_id, count(*)::bigint as items_count
    from public.stock_transfer_items sti
    join recent r on r.id = sti.stock_transfer_id
    group by sti.stock_transfer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'transfer_number', r.transfer_number,
      'status', r.status,
      'sent_at', r.sent_at,
      'received_at', r.received_at,
      'items_count', coalesce(ic.items_count, 0)
    ) order by r.created_at desc), '[]'::jsonb)
    into v_recent_transfers
  from recent r
  left join item_counts ic on ic.stock_transfer_id = r.id;

  with recent as (
    select sr.id, sr.return_number, sr.status, sr.returned_at, sr.received_at, sr.created_at
    from public.stock_returns sr
    where sr.from_branch_id = p_branch_id
    order by sr.created_at desc
    limit 5
  ), item_counts as (
    select sri.stock_return_id, count(*)::bigint as items_count
    from public.stock_return_items sri
    join recent r on r.id = sri.stock_return_id
    group by sri.stock_return_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'return_number', r.return_number,
      'status', r.status,
      'returned_at', r.returned_at,
      'received_at', r.received_at,
      'items_count', coalesce(ic.items_count, 0)
    ) order by r.created_at desc), '[]'::jsonb)
    into v_recent_returns
  from recent r
  left join item_counts ic on ic.stock_return_id = r.id;

  return jsonb_build_object(
    'branch', jsonb_build_object('id', v_branch.id, 'name', v_branch.name),
    'metrics', v_metrics,
    'current_inventory', v_inventory,
    'products_sold', v_products_sold,
    'transfer_discrepancies', v_transfer_disc,
    'return_discrepancies', v_return_disc,
    'recent_transfers', v_recent_transfers,
    'recent_returns', v_recent_returns
  );
end;
$$;

revoke all on function public.get_branch_performance_details(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_branch_performance_details(uuid, text, timestamptz, timestamptz) to authenticated;

-- Restore the archive-aware sale-history guard after isolated M105 product cleanup.
create or replace function public.cleanup_isolated_test_products(p_product_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return 0;
  end if;
  if exists (
    select 1
    from unnest(p_product_ids) as product_id
    where not exists (
      select 1
      from public.products p
      where p.id = product_id
        and (p.sku ~* '^m105-' or p.name ~* '^m105 ')
    )
  ) then
    raise exception 'Only isolated M105 test products can be cleaned.' using errcode = '42501';
  end if;

  execute $sql$
    create or replace function public.block_immutable_record_changes()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_sale_history()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_stock_return_items()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_completed_transfer_items()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $fn$
  $sql$;

  delete from public.transfer_discrepancies
  where stock_transfer_id in (
    select stock_transfer_id from public.stock_transfer_items where product_id = any(p_product_ids)
  );
  delete from public.stock_transfer_items where product_id = any(p_product_ids);
  delete from public.stock_transfers st
  where not exists (select 1 from public.stock_transfer_items sti where sti.stock_transfer_id = st.id)
    and exists (
      select 1 from public.inventory_movements im
      where im.reference_id = st.id and im.product_id = any(p_product_ids)
    );

  delete from public.return_discrepancies
  where stock_return_id in (
    select stock_return_id from public.stock_return_items where product_id = any(p_product_ids)
  );
  delete from public.stock_return_items where product_id = any(p_product_ids);
  delete from public.stock_returns sr
  where not exists (select 1 from public.stock_return_items sri where sri.stock_return_id = sr.id)
    and exists (
      select 1 from public.inventory_movements im
      where im.reference_id = sr.id and im.product_id = any(p_product_ids)
    );

  delete from public.sale_items where product_id = any(p_product_ids);
  delete from public.sales s
  where not exists (select 1 from public.sale_items si where si.sale_id = s.id)
    and (
      s.sale_number like 'SALE-M105-%'
      or exists (
        select 1 from public.inventory_movements im
        where im.reference_id = s.id and im.product_id = any(p_product_ids)
      )
    );

  delete from public.inventory_movements where product_id = any(p_product_ids);
  delete from public.branch_inventory where product_id = any(p_product_ids);
  delete from public.products where id = any(p_product_ids);
  get diagnostics v_count = row_count;

  execute $sql$
    create or replace function public.block_immutable_record_changes()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_sale_history()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      if tg_op = 'DELETE' and current_setting('app.allow_archive_cleanup', true) = 'on' then
        return old;
      end if;
      raise exception 'Completed sale history is immutable.' using errcode = '55000';
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_stock_return_items()
    returns trigger language plpgsql set search_path = '' as $fn$
    declare
      v_status public.stock_return_status;
    begin
      select sr.status into v_status
      from public.stock_returns sr
      where sr.id = case when tg_op = 'DELETE' then old.stock_return_id else new.stock_return_id end;
      if tg_op = 'DELETE' then
        if v_status <> 'draft' then
          raise exception 'Sent or completed return items are immutable.' using errcode = '55000';
        end if;
        return old;
      end if;
      if v_status = 'in_transit' then
        if new.stock_return_id is distinct from old.stock_return_id
           or new.product_id is distinct from old.product_id
           or new.quantity_returned is distinct from old.quantity_returned
           or new.product_name is distinct from old.product_name
           or new.product_sku is distinct from old.product_sku
           or old.quantity_received is not null
           or new.quantity_received is null then
          raise exception 'Only the one-time received quantity may be recorded for an in-transit return item.' using errcode = '55000';
        end if;
      elsif v_status <> 'draft' then
        raise exception 'Completed return items are immutable.' using errcode = '55000';
      end if;
      return new;
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_completed_transfer_items()
    returns trigger language plpgsql set search_path = '' as $fn$
    declare
      v_status public.stock_transfer_status;
    begin
      select status into v_status
      from public.stock_transfers
      where id = case when tg_op = 'DELETE' then old.stock_transfer_id else new.stock_transfer_id end;
      if v_status in ('received', 'received_with_discrepancy', 'cancelled') then
        raise exception 'Completed transfer items are immutable.' using errcode = '55000';
      end if;
      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end;
    $fn$
  $sql$;

  return v_count;
end;
$$;

revoke all on function public.cleanup_isolated_test_products(uuid[]) from public, anon, authenticated;
grant execute on function public.cleanup_isolated_test_products(uuid[]) to service_role;

revoke all on function public.archive_retention_days() from public, anon;
revoke all on function public.archive_retention_cutoff() from public, anon;
revoke all on function public.assert_owner_archive_access() from public, anon;
revoke all on function public.eligible_archive_sales(timestamptz) from public, anon, authenticated;
revoke all on function public.eligible_archive_shifts(timestamptz) from public, anon, authenticated;
revoke all on function public.upsert_daily_sales_summaries(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.verify_summary_totals(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.archive_source_counts(timestamptz, timestamptz) from public, anon, authenticated;

commit;
