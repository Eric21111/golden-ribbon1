begin;

-- Investigation/resolution lifecycle for system-generated discrepancies.
-- Does not change quantities, inventory, or receive-time notes.

create type public.discrepancy_resolution_status as enum ('open', 'resolved');
create type public.discrepancy_resolution_reason as enum (
  'confirmed_shortage',
  'confirmed_excess',
  'counting_error',
  'encoding_error',
  'transfer_handling_issue',
  'return_handling_issue',
  'other'
);

alter table public.return_discrepancies
  add column status public.discrepancy_resolution_status not null default 'open',
  add column resolved_by uuid references public.profiles(id) on delete restrict,
  add column resolved_at timestamptz,
  add column resolution_reason public.discrepancy_resolution_reason,
  add column resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000);

alter table public.transfer_discrepancies
  add column status public.discrepancy_resolution_status not null default 'open',
  add column resolved_by uuid references public.profiles(id) on delete restrict,
  add column resolved_at timestamptz,
  add column resolution_reason public.discrepancy_resolution_reason,
  add column resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000);

alter table public.return_discrepancies
  add constraint return_discrepancies_resolution_state_check check (
    (
      status = 'open'
      and resolved_by is null
      and resolved_at is null
      and resolution_reason is null
      and resolution_note is null
    ) or (
      status = 'resolved'
      and resolved_by is not null
      and resolved_at is not null
      and resolution_reason is not null
      and (
        resolution_reason <> 'other'
        or (resolution_note is not null and btrim(resolution_note) <> '')
      )
    )
  );

alter table public.transfer_discrepancies
  add constraint transfer_discrepancies_resolution_state_check check (
    (
      status = 'open'
      and resolved_by is null
      and resolved_at is null
      and resolution_reason is null
      and resolution_note is null
    ) or (
      status = 'resolved'
      and resolved_by is not null
      and resolved_at is not null
      and resolution_reason is not null
      and (
        resolution_reason <> 'other'
        or (resolution_note is not null and btrim(resolution_note) <> '')
      )
    )
  );

drop trigger if exists return_discrepancies_immutable on public.return_discrepancies;
drop trigger if exists transfer_discrepancies_immutable on public.transfer_discrepancies;

create or replace function public.protect_return_discrepancy_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
  end if;
  if old.status = 'resolved' then
    raise exception 'This discrepancy has already been resolved.' using errcode = '55000';
  end if;
  if new.status is distinct from 'resolved'::public.discrepancy_resolution_status then
    raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
    or new.stock_return_id is distinct from old.stock_return_id
    or new.stock_return_item_id is distinct from old.stock_return_item_id
    or new.product_id is distinct from old.product_id
    or new.quantity_expected is distinct from old.quantity_expected
    or new.quantity_received is distinct from old.quantity_received
    or new.difference is distinct from old.difference
    or new.discrepancy_type is distinct from old.discrepancy_type
    or new.notes is distinct from old.notes
    or new.recorded_by is distinct from old.recorded_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.protect_transfer_discrepancy_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
  end if;
  if old.status = 'resolved' then
    raise exception 'This discrepancy has already been resolved.' using errcode = '55000';
  end if;
  if new.status is distinct from 'resolved'::public.discrepancy_resolution_status then
    raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
    or new.stock_transfer_id is distinct from old.stock_transfer_id
    or new.stock_transfer_item_id is distinct from old.stock_transfer_item_id
    or new.product_id is distinct from old.product_id
    or new.quantity_expected is distinct from old.quantity_expected
    or new.quantity_received is distinct from old.quantity_received
    or new.difference is distinct from old.difference
    or new.discrepancy_type is distinct from old.discrepancy_type
    or new.notes is distinct from old.notes
    or new.recorded_by is distinct from old.recorded_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger return_discrepancies_protect_audit
before update or delete on public.return_discrepancies
for each row execute function public.protect_return_discrepancy_audit();

create trigger transfer_discrepancies_protect_audit
before update or delete on public.transfer_discrepancies
for each row execute function public.protect_transfer_discrepancy_audit();

create or replace function public.resolve_return_discrepancy(
  p_id uuid,
  p_reason text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason public.discrepancy_resolution_reason;
  v_note   text;
  v_row    public.return_discrepancies%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'You are not allowed to resolve discrepancies.' using errcode = '42501';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Select a resolution reason.' using errcode = '22023';
  end if;
  begin
    v_reason := btrim(p_reason)::public.discrepancy_resolution_reason;
  exception
    when invalid_text_representation then
      raise exception 'Select a resolution reason.' using errcode = '22023';
  end;
  if v_reason = 'other' and v_note is null then
    raise exception 'Enter a note for this resolution.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Enter a note for this resolution.' using errcode = '22023';
  end if;

  select * into v_row
  from public.return_discrepancies
  where id = p_id
  for update;
  if not found then
    raise exception 'This discrepancy is no longer available.' using errcode = 'P0002';
  end if;
  if v_row.status = 'resolved' then
    raise exception 'This discrepancy has already been resolved.' using errcode = '55000';
  end if;

  update public.return_discrepancies
  set status = 'resolved',
      resolved_by = auth.uid(),
      resolved_at = now(),
      resolution_reason = v_reason,
      resolution_note = v_note
  where id = p_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.resolve_transfer_discrepancy(
  p_id uuid,
  p_reason text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason public.discrepancy_resolution_reason;
  v_note   text;
  v_row    public.transfer_discrepancies%rowtype;
begin
  if not public.is_main_branch_manager() then
    raise exception 'You are not allowed to resolve discrepancies.' using errcode = '42501';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Select a resolution reason.' using errcode = '22023';
  end if;
  begin
    v_reason := btrim(p_reason)::public.discrepancy_resolution_reason;
  exception
    when invalid_text_representation then
      raise exception 'Select a resolution reason.' using errcode = '22023';
  end;
  if v_reason = 'other' and v_note is null then
    raise exception 'Enter a note for this resolution.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Enter a note for this resolution.' using errcode = '22023';
  end if;

  select * into v_row
  from public.transfer_discrepancies
  where id = p_id
  for update;
  if not found then
    raise exception 'This discrepancy is no longer available.' using errcode = 'P0002';
  end if;
  if v_row.status = 'resolved' then
    raise exception 'This discrepancy has already been resolved.' using errcode = '55000';
  end if;

  update public.transfer_discrepancies
  set status = 'resolved',
      resolved_by = auth.uid(),
      resolved_at = now(),
      resolution_reason = v_reason,
      resolution_note = v_note
  where id = p_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.resolve_return_discrepancy(uuid, text, text) from public, anon;
grant execute on function public.resolve_return_discrepancy(uuid, text, text) to authenticated;
revoke all on function public.resolve_transfer_discrepancy(uuid, text, text) from public, anon;
grant execute on function public.resolve_transfer_discrepancy(uuid, text, text) to authenticated;

create or replace function public.report_transfer_discrepancies(
  p_branch_id uuid default null,
  p_discrepancy_type text default null,
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
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Owner or Main Branch Manager access is required.' using errcode = '42501';
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
        'id', td.id,
        'transfer_id', st.id,
        'transfer_number', st.transfer_number,
        'branch_id', dest.id,
        'branch_name', dest.name,
        'from_branch_name', src.name,
        'to_branch_name', dest.name,
        'product_id', p.id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_sent', td.quantity_expected,
        'quantity_received', td.quantity_received,
        'difference', td.difference,
        'discrepancy_type', td.discrepancy_type,
        'created_at', td.created_at,
        'notes', td.notes,
        'status', td.status,
        'resolved_by', td.resolved_by,
        'resolved_at', td.resolved_at,
        'resolution_reason', td.resolution_reason,
        'resolution_note', td.resolution_note,
        'resolved_by_name', resolver.full_name
      ) order by td.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from public.transfer_discrepancies td
  join public.stock_transfers st on st.id = td.stock_transfer_id
  join public.branches dest on dest.id = st.to_branch_id
  join public.branches src on src.id = st.from_branch_id
  join public.products p on p.id = td.product_id
  left join public.profiles resolver on resolver.id = td.resolved_by
  where (p_branch_id is null or st.to_branch_id = p_branch_id)
    and (p_discrepancy_type is null or p_discrepancy_type = 'all' or td.discrepancy_type::text = p_discrepancy_type)
    and (v_start is null or (td.created_at >= v_start and td.created_at < v_end));

  return v_result;
end;
$$;

create or replace function public.report_return_discrepancies(
  p_branch_id uuid default null,
  p_discrepancy_type text default null,
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
  if not (public.is_owner() or public.is_main_branch_manager()) then
    raise exception 'Owner or Main Branch Manager access is required.' using errcode = '42501';
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
        'id', rd.id,
        'return_id', sr.id,
        'return_number', sr.return_number,
        'branch_id', b.id,
        'branch_name', b.name,
        'from_branch_name', sr.from_branch_name,
        'to_branch_name', sr.to_branch_name,
        'product_id', p.id,
        'product_name', p.name,
        'product_sku', p.sku,
        'quantity_returned', rd.quantity_expected,
        'quantity_received', rd.quantity_received,
        'difference', rd.difference,
        'discrepancy_type', rd.discrepancy_type,
        'created_at', rd.created_at,
        'notes', rd.notes,
        'status', rd.status,
        'resolved_by', rd.resolved_by,
        'resolved_at', rd.resolved_at,
        'resolution_reason', rd.resolution_reason,
        'resolution_note', rd.resolution_note,
        'resolved_by_name', resolver.full_name
      ) order by rd.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from public.return_discrepancies rd
  join public.stock_returns sr on sr.id = rd.stock_return_id
  join public.branches b on b.id = sr.from_branch_id
  join public.products p on p.id = rd.product_id
  left join public.profiles resolver on resolver.id = rd.resolved_by
  where (p_branch_id is null or sr.from_branch_id = p_branch_id)
    and (p_discrepancy_type is null or p_discrepancy_type = 'all' or rd.discrepancy_type::text = p_discrepancy_type)
    and (v_start is null or (rd.created_at >= v_start and rd.created_at < v_end));

  return v_result;
end;
$$;

revoke all on function public.report_transfer_discrepancies(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_transfer_discrepancies(uuid, text, text, timestamptz, timestamptz) to authenticated;
revoke all on function public.report_return_discrepancies(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_return_discrepancies(uuid, text, text, timestamptz, timestamptz) to authenticated;

comment on function public.resolve_return_discrepancy(uuid, text, text) is
  'Main Manager records an investigation outcome. Does not change inventory or original quantities.';
comment on function public.resolve_transfer_discrepancy(uuid, text, text) is
  'Main Manager records an investigation outcome. Does not change inventory or original quantities.';

commit;
