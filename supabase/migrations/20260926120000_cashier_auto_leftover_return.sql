-- Cashier leftover returns are automatic on-hand quantities (confirm only).
-- Discrepancy is recorded later when Main Manager counts the arrival.
-- 21:00 Asia/Manila closes leftover open shifts via the same leftover helper.
-- Cashiers may start a new shift after 9pm; this job does not lock POS.

create or replace function public.apply_leftover_return(
  p_cashier_id      uuid,
  p_notes           text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     public.profiles%rowtype;
  v_source   public.branches%rowtype;
  v_main     public.branches%rowtype;
  v_existing public.stock_returns%rowtype;
  v_items    jsonb;
  v_item     record;
  v_product  public.products%rowtype;
  v_stock    bigint;
  v_id       uuid;
  v_number   text;
begin
  if p_cashier_id is null then
    return null;
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100
    or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Invalid confirmation key or notes.' using errcode = '22023';
  end if;

  select * into v_user
  from public.profiles
  where id = p_cashier_id and role = 'cashier'
  for update;
  if not found or v_user.branch_id is null then
    return null;
  end if;

  select * into v_source
  from public.branches
  where id = v_user.branch_id and not is_main_branch
  for share;
  if not found then
    return null;
  end if;

  select * into v_main
  from public.branches
  where is_main_branch and is_active
  for share;
  if not found then
    return null;
  end if;

  select * into v_existing
  from public.stock_returns
  where created_by = v_user.id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.notes is distinct from p_notes then
      raise exception 'This confirmation key belongs to a different return.' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  perform 1
  from public.branch_inventory
  where branch_id = v_source.id
    and quantity_on_hand > 0
  for update;

  select jsonb_agg(
           jsonb_build_object(
             'product_id', q.product_id,
             'quantity_returned', q.quantity_returned
           )
           order by q.product_id
         )
    into v_items
  from (
    select i.product_id, i.quantity_on_hand as quantity_returned
    from public.branch_inventory i
    where i.branch_id = v_source.id
      and i.quantity_on_hand > 0
  ) q;

  if v_items is null or jsonb_array_length(v_items) = 0 then
    return null;
  end if;
  if jsonb_array_length(v_items) > 200 then
    raise exception 'Too many leftover products to return at once.' using errcode = '22023';
  end if;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id for share;
    if not found then
      raise exception 'Product unavailable.' using errcode = '22023';
    end if;
    select quantity_on_hand into v_stock
    from public.branch_inventory
    where branch_id = v_source.id and product_id = v_item.product_id
    for update;
    if coalesce(v_stock, 0) < v_item.quantity_returned then
      raise exception 'Insufficient stock. % — Available: %, Requested: %',
        v_product.name, coalesce(v_stock, 0), v_item.quantity_returned
        using errcode = '22023';
    end if;
  end loop;

  v_number := nextval('public.return_number_seq')::text;
  insert into public.stock_returns(
    return_number, from_branch_id, to_branch_id, created_by, returned_by,
    from_branch_name, to_branch_name, returned_by_name, notes, idempotency_key, request_items
  )
  values (
    'RET-' || lpad(v_number, greatest(6, length(v_number)), '0'),
    v_source.id, v_main.id, v_user.id, v_user.id,
    v_source.name, v_main.name, v_user.full_name, p_notes, p_idempotency_key, v_items
  )
  returning id into v_id;

  for v_item in
    select * from jsonb_to_recordset(v_items) as x(product_id uuid, quantity_returned bigint)
    order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id;
    insert into public.stock_return_items(stock_return_id, product_id, quantity_returned, product_name, product_sku)
    values (v_id, v_item.product_id, v_item.quantity_returned, v_product.name, v_product.sku);
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand - v_item.quantity_returned
    where branch_id = v_source.id and product_id = v_item.product_id;
    insert into public.inventory_movements(
      branch_id, product_id, movement_type, quantity, reference_type, reference_id, created_by, notes
    )
    values (
      v_source.id, v_item.product_id, 'return_out', -v_item.quantity_returned,
      'stock_return', v_id, v_user.id, p_notes
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.apply_leftover_return(uuid, text, text) from public, anon, authenticated;

create or replace function public.return_leftover_stock(
  p_notes           text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.profiles%rowtype;
  v_id   uuid;
begin
  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'An active Cashier account is required.' using errcode = '42501';
  end if;

  v_id := public.apply_leftover_return(v_user.id, p_notes, p_idempotency_key);
  if v_id is null then
    raise exception 'No leftover stock to return.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

revoke all on function public.return_leftover_stock(text, text) from public, anon;
grant execute on function public.return_leftover_stock(text, text) to authenticated;

create or replace function public.end_cashier_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id     uuid := auth.uid();
  v_user        public.profiles%rowtype;
  v_shift       public.shifts%rowtype;
  v_branch_name text;
  v_tx_count    bigint;
  v_total_sales numeric(12,2);
  v_was_open    boolean;
  v_leftover_id uuid;
begin
  select * into v_user
  from public.profiles
  where id = v_user_id and is_active and role = 'cashier'
  for update;
  if not found then
    raise exception 'Unauthorized: active cashier access required.' using errcode = '42501';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;
  if not found or v_shift.cashier_id <> v_user_id or v_shift.branch_id <> v_user.branch_id then
    raise exception 'Unable to access this shift.' using errcode = '42501';
  end if;

  v_was_open := v_shift.status = 'open';
  if v_was_open then
    v_leftover_id := public.apply_leftover_return(
      v_user.id,
      'Leftover return at end of shift',
      'end-shift-leftover-' || p_shift_id::text
    );
    update public.shifts
    set status = 'closed', ended_at = now()
    where id = p_shift_id
    returning * into v_shift;
  else
    select id into v_leftover_id
    from public.stock_returns
    where created_by = v_user.id
      and idempotency_key = 'end-shift-leftover-' || p_shift_id::text;
  end if;

  select b.name into v_branch_name from public.branches b where b.id = v_shift.branch_id;
  select count(s.id)::bigint, coalesce(sum(s.total_amount), 0)::numeric(12,2)
    into v_tx_count, v_total_sales
  from public.sales s
  where s.shift_id = p_shift_id and s.status = 'completed';

  return jsonb_build_object(
    'id', v_shift.id,
    'branch_id', v_shift.branch_id,
    'branch_name', v_branch_name,
    'cashier_id', v_shift.cashier_id,
    'cashier_name', v_user.full_name,
    'status', v_shift.status,
    'started_at', v_shift.started_at,
    'ended_at', v_shift.ended_at,
    'completed_transaction_count', v_tx_count,
    'total_sales', v_total_sales,
    'leftover_return_id', v_leftover_id
  );
end;
$$;

revoke all on function public.end_cashier_shift(uuid) from public, anon;
grant execute on function public.end_cashier_shift(uuid) to authenticated;

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
      v_leftover_id := public.apply_leftover_return(
        v_shift.cashier_id,
        'Automatic leftover return after 9:00 PM.',
        'auto-close-' || v_shift.id::text || '-' || to_char(v_cutoff_manila_date, 'YYYY-MM-DD')
      );
      update public.shifts
      set status = 'closed', ended_at = now()
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

-- Optional 13:00 UTC daily job (21:00 Asia/Manila, no DST). PGlite has no pg_cron.
do $cron$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    null;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'close-overdue-shifts-9pm-manila';
    perform cron.schedule(
      'close-overdue-shifts-9pm-manila',
      '0 13 * * *',
      $job$select public.close_overdue_shifts()$job$
    );
  end if;
exception when others then
  null;
end;
$cron$;
