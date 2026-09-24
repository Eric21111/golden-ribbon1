begin;

-- Returned leftovers are waste. Receive records count + discrepancy only.
-- Do not restock Main branch_inventory or write stock-in return_in movements.

create or replace function public.receive_stock_return(
  p_return_id       uuid,
  p_items           jsonb,
  p_notes           text default null,
  p_idempotency_key text default null
) returns public.stock_return_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user            public.profiles%rowtype;
  v_return          public.stock_returns%rowtype;
  v_item            record;
  v_raw             text;
  v_received        bigint;
  v_difference      bigint;
  v_has_discrepancy boolean := false;
  v_final_status    public.stock_return_status;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  select * into v_user
  from public.profiles
  where id = auth.uid() and is_active;
  if not found then
    raise exception 'Active profile required.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Invalid request key.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Notes too long (maximum 2000 characters).' using errcode = '22023';
  end if;

  select * into v_return
  from public.stock_returns
  where id = p_return_id
  for update;
  if not found then
    raise exception 'This return is no longer available for receiving.' using errcode = 'P0002';
  end if;

  perform 1
  from public.branches
  where id = v_return.to_branch_id and is_main_branch and is_active;
  if not found then
    raise exception 'Destination branch is not an active Main Branch.' using errcode = '22023';
  end if;
  if v_user.branch_id is distinct from v_return.to_branch_id then
    raise exception 'Unauthorized: only Main Branch managers can receive returns.' using errcode = '42501';
  end if;
  if v_user.branch_id = v_return.from_branch_id then
    raise exception 'Unauthorized: selling branch manager cannot receive their own return.' using errcode = '42501';
  end if;

  if v_return.receive_idempotency_key = p_idempotency_key and
     v_return.status in ('received', 'received_with_discrepancy') then
    return v_return.status;
  end if;
  if v_return.status <> 'in_transit' then
    raise exception 'This return has already been received.' using errcode = '55000';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Enter a valid received quantity.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'stock_return_item_id') from jsonb_array_elements(p_items)) then
    raise exception 'Each return item may appear only once.' using errcode = '22023';
  end if;
  if (select count(*) from public.stock_return_items where stock_return_id = p_return_id) <>
     jsonb_array_length(p_items) then
    raise exception 'Enter a valid received quantity.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) x
    left join public.stock_return_items sri
      on sri.id = case
        when coalesce(x.value->>'stock_return_item_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (x.value->>'stock_return_item_id')::uuid
        else null
      end
     and sri.stock_return_id = p_return_id
    where sri.id is null
  ) then
    raise exception 'This return is no longer available for receiving.' using errcode = '22023';
  end if;

  for v_item in
    select sri.id, sri.product_id, sri.quantity_returned
    from public.stock_return_items sri
    where sri.stock_return_id = p_return_id
    order by sri.product_id
  loop
    select btrim(coalesce(x.value->>'quantity_received', ''))
    into v_raw
    from jsonb_array_elements(p_items) x
    where (x.value->>'stock_return_item_id')::uuid = v_item.id;

    if v_raw is null or v_raw = '' then
      raise exception 'Enter a valid received quantity.' using errcode = '22023';
    end if;
    if v_raw ~ '^-' then
      raise exception 'Received quantity cannot be negative.' using errcode = '22023';
    end if;
    if v_raw !~ '^[0-9]{1,6}$' then
      raise exception 'Enter a valid received quantity.' using errcode = '22023';
    end if;

    v_received := v_raw::bigint;

    update public.stock_return_items
    set quantity_received = v_received,
        updated_at = now()
    where id = v_item.id;

    v_difference := v_item.quantity_returned - v_received;
    if v_difference <> 0 then
      v_has_discrepancy := true;
      insert into public.return_discrepancies(
        stock_return_id, stock_return_item_id, product_id,
        quantity_expected, quantity_received, difference,
        discrepancy_type, notes, recorded_by
      ) values (
        p_return_id, v_item.id, v_item.product_id,
        v_item.quantity_returned, v_received, v_difference,
        case when v_difference > 0 then 'missing'::public.transfer_discrepancy_type
             else 'excess'::public.transfer_discrepancy_type end,
        nullif(trim(p_notes), ''), v_user.id
      );
    end if;
  end loop;

  v_final_status := case when v_has_discrepancy
    then 'received_with_discrepancy'::public.stock_return_status
    else 'received'::public.stock_return_status end;

  update public.stock_returns
  set status = v_final_status,
      received_by = v_user.id,
      received_by_name = v_user.full_name,
      received_at = now(),
      receive_idempotency_key = p_idempotency_key,
      updated_at = now()
  where id = p_return_id;

  return v_final_status;
end;
$$;

revoke all on function public.receive_stock_return(uuid, jsonb, text, text)
  from public, anon;
grant execute on function public.receive_stock_return(uuid, jsonb, text, text)
  to authenticated;

comment on function public.receive_stock_return(uuid, jsonb, text, text) is
  'Main Manager counts leftover waste. Records received qty and discrepancy. Does not increase sellable inventory.';

commit;
