-- Approach C′: Egg single-inventory cutover support (install-only).
--
-- DATA SAFETY: This migration installs schema, audit structures, and operator-only
-- functions. It does NOT convert Egg balances, recipes, movements, or metadata.
-- Production cutover requires a separate explicit call to
-- public.apply_egg_half_unit_cutover() by a privileged database operator after
-- approval (see tests/egg_half_unit_cutover.mjs).
--
-- Historical display: pre-cutover movement quantities remain whole-egg numbers;
-- post-cutover use half-egg units. Report UIs that label all Egg rows with the
-- live stock_unit_code are NOT fully fixed by this migration — era-aware display
-- remains a production blocker until tested.

begin;

-- ---------------------------------------------------------------------------
-- 0) Narrow session-gated bypasses for the one-time Egg unit cutover only.
--     Set local GUCs inside apply/rollback; never leave them on for other work.
-- ---------------------------------------------------------------------------
create or replace function public.protect_stock_unit_definition() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stock_unit_code is distinct from old.stock_unit_code then
    if current_setting('app.allow_stock_unit_cutover', true) is distinct from 'on' then
      raise exception 'Stock units cannot be changed. Create a new stock item with the correct unit.'
        using errcode = '55000';
    end if;
  end if;
  if new.stock_unit_code in ('half_egg', 'half_serving', 'quarter_serving')
     and new.inventory_mode <> 'piece_stock' then
    raise exception 'Portion stock must remain piece-based.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.block_immutable_record_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Controlled rollback of unit_conversion movements only (never routine edits).
  if tg_op = 'DELETE'
     and tg_table_name = 'inventory_movements'
     and current_setting('app.allow_unit_conversion_rollback', true) = 'on'
     and old.reference_type = 'unit_conversion' then
    return old;
  end if;
  raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Allow unit_conversion adjustments (distinct from opening/purchase/waste)
-- ---------------------------------------------------------------------------
alter table public.inventory_movements drop constraint if exists inventory_movements_reference_type_check;
alter table public.inventory_movements add constraint inventory_movements_reference_type_check
  check (reference_type in (
    'opening_stock', 'stock_transfer', 'adjustment', 'sale', 'stock_return',
    'shift_product_reconciliation', 'local_purchase', 'unit_conversion'
  ));

alter table public.inventory_movements drop constraint if exists inventory_movements_type_reference_match_check;
alter table public.inventory_movements add constraint inventory_movements_type_reference_match_check
  check (
    (movement_type = 'opening_stock' and reference_type = 'opening_stock' and reference_id is null)
    or (movement_type in ('transfer_out', 'transfer_in') and reference_type = 'stock_transfer' and reference_id is not null)
    or (movement_type = 'adjustment' and reference_type in ('adjustment', 'local_purchase', 'unit_conversion') and reference_id is not null)
    or (movement_type = 'sale' and reference_type = 'sale' and reference_id is not null)
    or (movement_type in ('return_out', 'return_in') and reference_type = 'stock_return' and reference_id is not null)
    or (movement_type in ('waste', 'unsold') and reference_type = 'shift_product_reconciliation' and reference_id is not null)
  );

-- ---------------------------------------------------------------------------
-- 2) Auditable cutover ledger (non-repeatable; era boundary for reports)
-- ---------------------------------------------------------------------------
create table if not exists public.stock_unit_cutovers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  from_stock_unit_code text,
  to_stock_unit_code text not null,
  factor integer not null check (factor = 2),
  cutover_at timestamptz not null default now(),
  conversion_reference_id uuid not null,
  applied_by uuid references public.profiles(id),
  notes text not null,
  rolled_back_at timestamptz
);

comment on table public.stock_unit_cutovers is
  'Unit-scale cutover ledger. Active cutover = rolled_back_at is null. cutover_at is the era boundary: movements before it keep pre-cutover physical meaning; after it use the new internal unit.';

-- At most one active cutover per product; rolled-back rows remain for audit.
create unique index if not exists stock_unit_cutovers_active_product_uidx
  on public.stock_unit_cutovers(product_id)
  where rolled_back_at is null;

create index if not exists stock_unit_cutovers_product_id_idx
  on public.stock_unit_cutovers(product_id);

alter table public.stock_unit_cutovers enable row level security;

drop policy if exists stock_unit_cutovers_select_owner on public.stock_unit_cutovers;
create policy stock_unit_cutovers_select_owner
  on public.stock_unit_cutovers for select to authenticated
  using (public.is_owner());

revoke all on table public.stock_unit_cutovers from public, anon;
grant select on table public.stock_unit_cutovers to authenticated;

create or replace function public.egg_half_unit_cutover_at()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select c.cutover_at
  from public.stock_unit_cutovers c
  join public.products p on p.id = c.product_id
  where p.sku = 'EGG'
    and c.rolled_back_at is null
  limit 1;
$$;

revoke all on function public.egg_half_unit_cutover_at() from public, anon;
grant execute on function public.egg_half_unit_cutover_at() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Apply cutover (atomic, guarded, non-repeatable)
-- ---------------------------------------------------------------------------
create or replace function public.apply_egg_half_unit_cutover()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_egg public.products%rowtype;
  v_half public.products%rowtype;
  v_actor uuid;
  v_ref uuid := gen_random_uuid();
  v_cutover_at timestamptz := clock_timestamp();
  v_branch record;
  v_on_hand numeric(14,3);
  v_awaiting numeric(14,3);
  v_movements numeric(14,3);
  v_delta numeric(14,3);
  v_branches_converted integer := 0;
  v_recipes_converted integer := 0;
  v_open_shifts integer;
  v_open_transfers integer;
  v_open_returns integer;
  v_open_discrepancies integer;
  v_bad_recipe integer;
begin
  -- Privileged DB operator only (SQL editor / migrate role). Never via app JWT.
  if auth.uid() is not null then
    raise exception
      'Egg unit cutover is restricted to a privileged database operator session (no app login).'
      using errcode = '42501';
  end if;

  select * into v_egg from public.products where sku = 'EGG' for update;
  if not found then
    return jsonb_build_object('status', 'skipped', 'reason', 'EGG product not found');
  end if;

  -- HALF-EGG is a separate product and must remain untouched.
  select * into v_half from public.products where sku = 'HALF-EGG';
  if found and v_half.id = v_egg.id then
    raise exception 'EGG and HALF-EGG must be distinct products.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.stock_unit_cutovers c
    where c.product_id = v_egg.id and c.rolled_back_at is null
  ) then
    raise exception 'Egg half-unit cutover already applied.' using errcode = '55000';
  end if;

  if v_egg.stock_unit_code is not null then
    raise exception
      'Egg stock_unit_code is already %. Cutover expects legacy NULL (whole-egg units).',
      v_egg.stock_unit_code
      using errcode = '55000';
  end if;

  if v_egg.inventory_mode is distinct from 'piece_stock' then
    raise exception 'Egg must remain piece_stock for half-egg cutover.' using errcode = '22023';
  end if;

  select id into v_actor
  from public.profiles
  where role = 'owner' and is_active
  order by created_at
  limit 1;
  if v_actor is null then
    raise exception 'Active owner profile required to attribute conversion adjustments.'
      using errcode = '55000';
  end if;

  -- Abort on active shifts (incompatible mid-shift app/device state).
  select count(*)::int into v_open_shifts from public.shifts where status = 'open';
  if v_open_shifts > 0 then
    raise exception 'Close all open shifts before Egg unit cutover (% open).', v_open_shifts
      using errcode = '55000';
  end if;

  -- Open transfers involving Egg.
  select count(*)::int into v_open_transfers
  from public.stock_transfers st
  join public.stock_transfer_items sti on sti.stock_transfer_id = st.id
  where sti.product_id = v_egg.id
    and st.status in ('draft', 'pending_receipt');
  if v_open_transfers > 0 then
    raise exception 'Resolve open Egg transfers before cutover (%).', v_open_transfers
      using errcode = '55000';
  end if;

  -- Open returns involving Egg.
  select count(*)::int into v_open_returns
  from public.stock_returns sr
  join public.stock_return_items sri on sri.stock_return_id = sr.id
  where sri.product_id = v_egg.id
    and sr.status in ('draft', 'in_transit');
  if v_open_returns > 0 then
    raise exception 'Resolve open Egg returns before cutover (%).', v_open_returns
      using errcode = '55000';
  end if;

  -- Unresolved transfer / return discrepancies for Egg.
  select count(*)::int into v_open_discrepancies
  from (
    select td.id from public.transfer_discrepancies td
    where td.product_id = v_egg.id and td.status = 'open'
    union all
    select rd.id from public.return_discrepancies rd
    where rd.product_id = v_egg.id and rd.status = 'open'
  ) d;
  if v_open_discrepancies > 0 then
    raise exception 'Resolve open Egg discrepancies before cutover (%).', v_open_discrepancies
      using errcode = '55000';
  end if;

  -- Recipe quantities must survive ×2 within 1..99.
  select count(*)::int into v_bad_recipe
  from public.product_stock_uses u
  where u.ingredient_product_id = v_egg.id
    and (u.quantity < 1 or u.quantity > 49 or u.quantity <> floor(u.quantity));
  if v_bad_recipe > 0 then
    raise exception 'Egg recipe quantities must be whole numbers 1..49 before ×2 cutover.'
      using errcode = '55000';
  end if;

  -- Validate EVERY branch: on_hand must match movement sum (including zero rows).
  for v_branch in
    select b.id as branch_id, b.name as branch_name, b.code as branch_code
    from public.branches b
    order by b.code
  loop
    select coalesce(bi.quantity_on_hand, 0), coalesce(bi.quantity_awaiting_return, 0)
      into v_on_hand, v_awaiting
    from public.branch_inventory bi
    where bi.branch_id = v_branch.branch_id and bi.product_id = v_egg.id;

    if not found then
      v_on_hand := 0;
      v_awaiting := 0;
    end if;

    select coalesce(sum(m.quantity), 0) into v_movements
    from public.inventory_movements m
    where m.branch_id = v_branch.branch_id and m.product_id = v_egg.id;

    if v_on_hand <> v_movements then
      raise exception
        'Egg balance mismatch at % (%): on_hand=% movements_sum=%. Aborting cutover.',
        v_branch.branch_name, v_branch.branch_code, v_on_hand, v_movements
        using errcode = '55000';
    end if;

    if v_on_hand <> floor(v_on_hand) or v_awaiting <> floor(v_awaiting) then
      raise exception
        'Egg quantities at % must be whole numbers before cutover.',
        v_branch.branch_code
        using errcode = '55000';
    end if;

    if v_awaiting > v_on_hand then
      raise exception
        'Egg awaiting_return exceeds on_hand at % before cutover.',
        v_branch.branch_code
        using errcode = '55000';
    end if;
  end loop;

  -- Narrow, controlled bypass of stock_unit immutability for this cutover only.
  perform set_config('app.allow_stock_unit_cutover', 'on', true);
  update public.products
  set stock_unit_code = 'half_egg'
  where id = v_egg.id
    and stock_unit_code is null;
  if not found then
    perform set_config('app.allow_stock_unit_cutover', 'off', true);
    raise exception 'Egg stock_unit_code update failed.' using errcode = '55000';
  end if;
  perform set_config('app.allow_stock_unit_cutover', 'off', true);

  -- ×2 recipes (physical meaning preserved: former 1 whole egg → 2 half-egg units).
  update public.product_stock_uses
  set quantity = quantity * 2
  where ingredient_product_id = v_egg.id;
  get diagnostics v_recipes_converted = row_count;

  -- ×2 balances + conversion adjustment per branch with non-zero stock or inventory row.
  for v_branch in
    select b.id as branch_id, b.code as branch_code,
           coalesce(bi.quantity_on_hand, 0) as on_hand,
           coalesce(bi.quantity_awaiting_return, 0) as awaiting,
           bi.branch_id is not null as has_row
    from public.branches b
    left join public.branch_inventory bi
      on bi.branch_id = b.id and bi.product_id = v_egg.id
    where bi.branch_id is not null
       or exists (
         select 1 from public.inventory_movements m
         where m.branch_id = b.id and m.product_id = v_egg.id
       )
    order by b.code
  loop
    v_delta := v_branch.on_hand; -- add the same count again → ×2
    if v_delta = 0 and not v_branch.has_row then
      continue;
    end if;

    if v_branch.has_row then
      update public.branch_inventory
      set quantity_on_hand = quantity_on_hand * 2,
          quantity_awaiting_return = quantity_awaiting_return * 2
      where branch_id = v_branch.branch_id and product_id = v_egg.id;
    end if;

    if v_delta > 0 then
      insert into public.inventory_movements(
        branch_id, product_id, movement_type, quantity,
        reference_type, reference_id, created_by, notes, created_at
      ) values (
        v_branch.branch_id, v_egg.id, 'adjustment', v_delta,
        'unit_conversion', v_ref, v_actor,
        'Egg unit cutover: whole-egg → half-egg internal units (×2). '
          || 'Pre-cutover quantities were whole eggs; post-cutover quantities are half-egg units. '
          || 'Not a purchase, opening stock, waste, or manual add.',
        v_cutover_at
      );
      v_branches_converted := v_branches_converted + 1;
    end if;
  end loop;

  insert into public.stock_unit_cutovers(
    product_id, from_stock_unit_code, to_stock_unit_code, factor,
    cutover_at, conversion_reference_id, applied_by, notes
  ) values (
    v_egg.id, null, 'half_egg', 2,
    v_cutover_at, v_ref, v_actor,
    'Approach C′ Egg single-inventory cutover. Historical movements not rewritten. '
      || 'Use cutover_at to interpret pre/post unit meaning in reports. '
      || 'Applied by privileged database operator (not via app).'
  );

  -- Final recon check: every branch variance 0.
  for v_branch in
    select b.id as branch_id, b.code as branch_code
    from public.branches b
    order by b.code
  loop
    select coalesce(bi.quantity_on_hand, 0) into v_on_hand
    from public.branch_inventory bi
    where bi.branch_id = v_branch.branch_id and bi.product_id = v_egg.id;
    if not found then
      v_on_hand := 0;
    end if;

    select coalesce(sum(m.quantity), 0) into v_movements
    from public.inventory_movements m
    where m.branch_id = v_branch.branch_id and m.product_id = v_egg.id;

    if v_on_hand <> v_movements then
      raise exception
        'Post-cutover recon failed at %: on_hand=% movements=%',
        v_branch.branch_code, v_on_hand, v_movements
        using errcode = '55000';
    end if;
  end loop;

  -- HALF-EGG unchanged.
  if v_half.id is not null then
    if (select stock_unit_code from public.products where id = v_half.id)
         is distinct from v_half.stock_unit_code then
      raise exception 'HALF-EGG product was modified; aborting.' using errcode = '55000';
    end if;
  end if;

  return jsonb_build_object(
    'status', 'applied',
    'product_id', v_egg.id,
    'conversion_reference_id', v_ref,
    'cutover_at', v_cutover_at,
    'branches_with_conversion_adjustment', v_branches_converted,
    'recipes_converted', v_recipes_converted,
    'to_stock_unit_code', 'half_egg',
    'factor', 2
  );
end;
$$;

revoke all on function public.apply_egg_half_unit_cutover() from public, anon, authenticated;
grant execute on function public.apply_egg_half_unit_cutover() to service_role;

comment on function public.apply_egg_half_unit_cutover() is
  'Operator-only Approach C′ cutover. Not invoked by migrations. Convert legacy Egg (NULL unit) to half_egg with recon-safe unit_conversion adjustments. Non-repeatable. Does not rewrite historical movements.';

-- ---------------------------------------------------------------------------
-- 4) Rollback (ONLY before any post-cutover Egg activity)
-- ---------------------------------------------------------------------------
create or replace function public.rollback_egg_half_unit_cutover()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_egg public.products%rowtype;
  v_cutover public.stock_unit_cutovers%rowtype;
  v_post_activity integer;
  v_odd_recipe integer;
  v_branch record;
  v_on_hand numeric(14,3);
  v_movements numeric(14,3);
begin
  if auth.uid() is not null then
    raise exception
      'Egg unit cutover rollback is restricted to a privileged database operator session (no app login).'
      using errcode = '42501';
  end if;

  select * into v_egg from public.products where sku = 'EGG' for update;
  if not found then
    raise exception 'EGG product not found.' using errcode = '22023';
  end if;

  select * into v_cutover
  from public.stock_unit_cutovers
  where product_id = v_egg.id and rolled_back_at is null
  for update;
  if not found then
    raise exception 'No active Egg half-unit cutover to roll back.' using errcode = '55000';
  end if;

  -- Any Egg movement after cutover that is not the conversion batch → refuse.
  select count(*)::int into v_post_activity
  from public.inventory_movements m
  where m.product_id = v_egg.id
    and m.created_at >= v_cutover.cutover_at
    and not (
      m.movement_type = 'adjustment'
      and m.reference_type = 'unit_conversion'
      and m.reference_id = v_cutover.conversion_reference_id
    );
  if v_post_activity > 0 then
    raise exception
      'Rollback refused: % Egg movement(s) after cutover. Rollback is only valid before post-cutover Egg activity.',
      v_post_activity
      using errcode = '55000';
  end if;

  if exists (select 1 from public.shifts where status = 'open') then
    raise exception 'Close all open shifts before Egg cutover rollback.' using errcode = '55000';
  end if;

  select count(*)::int into v_odd_recipe
  from public.product_stock_uses u
  where u.ingredient_product_id = v_egg.id
    and (u.quantity < 2 or u.quantity % 2 <> 0);
  if v_odd_recipe > 0 then
    raise exception 'Egg recipes are not even half-egg quantities; refuse rollback.'
      using errcode = '55000';
  end if;

  -- Reverse recipes.
  update public.product_stock_uses
  set quantity = quantity / 2
  where ingredient_product_id = v_egg.id;

  -- Reverse balances and remove conversion movements (narrow immutability bypass).
  for v_branch in
    select bi.branch_id, bi.quantity_on_hand, bi.quantity_awaiting_return
    from public.branch_inventory bi
    where bi.product_id = v_egg.id
  loop
    if v_branch.quantity_on_hand % 2 <> 0 or v_branch.quantity_awaiting_return % 2 <> 0 then
      raise exception 'Odd Egg balance at branch %; refuse rollback.', v_branch.branch_id
        using errcode = '55000';
    end if;
    update public.branch_inventory
    set quantity_on_hand = quantity_on_hand / 2,
        quantity_awaiting_return = quantity_awaiting_return / 2
    where branch_id = v_branch.branch_id and product_id = v_egg.id;
  end loop;

  perform set_config('app.allow_unit_conversion_rollback', 'on', true);
  delete from public.inventory_movements
  where product_id = v_egg.id
    and movement_type = 'adjustment'
    and reference_type = 'unit_conversion'
    and reference_id = v_cutover.conversion_reference_id;
  perform set_config('app.allow_unit_conversion_rollback', 'off', true);

  perform set_config('app.allow_stock_unit_cutover', 'on', true);
  update public.products
  set stock_unit_code = null
  where id = v_egg.id and stock_unit_code = 'half_egg';
  perform set_config('app.allow_stock_unit_cutover', 'off', true);

  update public.stock_unit_cutovers
  set rolled_back_at = clock_timestamp()
  where id = v_cutover.id;

  -- Recon check after rollback.
  for v_branch in
    select b.id as branch_id, b.code as branch_code from public.branches b
  loop
    select coalesce(bi.quantity_on_hand, 0) into v_on_hand
    from public.branch_inventory bi
    where bi.branch_id = v_branch.branch_id and bi.product_id = v_egg.id;
    if not found then v_on_hand := 0; end if;

    select coalesce(sum(m.quantity), 0) into v_movements
    from public.inventory_movements m
    where m.branch_id = v_branch.branch_id and m.product_id = v_egg.id;

    if v_on_hand <> v_movements then
      raise exception
        'Post-rollback recon failed at %: on_hand=% movements=%',
        v_branch.branch_code, v_on_hand, v_movements
        using errcode = '55000';
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'rolled_back',
    'product_id', v_egg.id,
    'conversion_reference_id', v_cutover.conversion_reference_id
  );
end;
$$;

revoke all on function public.rollback_egg_half_unit_cutover() from public, anon, authenticated;
grant execute on function public.rollback_egg_half_unit_cutover() to service_role;

comment on function public.rollback_egg_half_unit_cutover() is
  'Operator-only. Reverses apply_egg_half_unit_cutover only when no post-cutover Egg movements exist besides the conversion batch.';

-- ---------------------------------------------------------------------------
-- 5) Today Log: unit_conversion must NOT appear as opening_stock_set.
--     opening_stock_set already matches reference_type = 'adjustment' only;
--     reaffirm that filter so local_purchase / unit_conversion stay excluded.
-- ---------------------------------------------------------------------------
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
        -- unit_conversion / local_purchase adjustments are intentionally excluded.
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
  'Owner-only, read-only. Today''s (Asia/Manila) employee activity derived from existing operation records, newest first. unit_conversion adjustments are not opening stock.';

-- ---------------------------------------------------------------------------
-- 6) After cutover: refuse Egg quantity writes from outdated app clients.
--     Current app builds send header x-gr-half-egg: 1 via createClient global
--     headers (PostgREST exposes them as request.headers JSON, lowercased).
--     sale / unit_conversion are allowed (server-computed recipe deductions or
--     operator cutover). That means an outdated build can still sell Extra Egg
--     / recipe items and deduct correctly, but may mis-display Egg on-hand and
--     is blocked from opening/transfer/correction/waste counts of Egg itself.
--     Install-only: this trigger is inert until an active cutover row exists.
-- ---------------------------------------------------------------------------
create or replace function public.guard_post_cutover_egg_client()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_capable text;
begin
  -- Operator sessions (no JWT) may insert, including the cutover itself.
  if auth.uid() is null then
    return new;
  end if;

  -- Server-side sale deductions and the conversion batch are not client Egg counts.
  if new.reference_type in ('sale', 'unit_conversion') then
    return new;
  end if;

  if not exists (
    select 1
    from public.stock_unit_cutovers c
    where c.product_id = new.product_id
      and c.rolled_back_at is null
      and c.to_stock_unit_code = 'half_egg'
  ) then
    return new;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  v_capable := coalesce(
    v_headers->>'x-gr-half-egg',
    v_headers->>'X-Gr-Half-Egg'
  );

  if v_capable is distinct from '1' then
    raise exception
      'Update Golden Ribbon to a build that supports half-egg units before changing Egg stock.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_movements_egg_half_unit_client on public.inventory_movements;
create trigger inventory_movements_egg_half_unit_client
  before insert on public.inventory_movements
  for each row execute function public.guard_post_cutover_egg_client();

revoke all on function public.guard_post_cutover_egg_client() from public, anon, authenticated;

comment on function public.guard_post_cutover_egg_client() is
  'After Egg half-unit cutover, requires client header x-gr-half-egg:1 for authenticated Egg stock writes other than sale/unit_conversion.';

-- ---------------------------------------------------------------------------
-- 7) No automatic cutover. Operators run apply_egg_half_unit_cutover() explicitly.
-- ---------------------------------------------------------------------------

commit;
