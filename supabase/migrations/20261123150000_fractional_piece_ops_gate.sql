-- Phase 5: gate half-step inventory OPS behind an owner flag (default OFF).
-- Prevents creating 0.5 balances via transfer/return/waste/correction/opening/close
-- while old clients are still in the field. Enabling recipe saving also enables ops.

begin;

alter table public.inventory_feature_settings
  add column if not exists fractional_piece_ops_enabled boolean not null default false;

comment on column public.inventory_feature_settings.fractional_piece_ops_enabled is
  'When false, piece_stock ops reject non-integer quantities. Default false until all devices run a compatible app.';

create or replace function public.fractional_piece_ops_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.fractional_piece_ops_enabled from public.inventory_feature_settings s where s.id),
    false
  );
$$;

revoke all on function public.fractional_piece_ops_enabled() from public, anon, authenticated;

create or replace function public.set_fractional_piece_ops_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access is required to change inventory feature settings.'
      using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Enabled flag is required.' using errcode = '22023';
  end if;
  if p_enabled is false and public.fractional_recipe_saving_enabled() then
    raise exception
      'Turn off fractional recipe saving before disabling half-step inventory ops.'
      using errcode = '22023';
  end if;

  insert into public.inventory_feature_settings (
    id, fractional_recipe_saving_enabled, fractional_piece_ops_enabled, updated_at, updated_by
  )
  values (
    true,
    coalesce((select fractional_recipe_saving_enabled from public.inventory_feature_settings where id), false),
    p_enabled,
    now(),
    auth.uid()
  )
  on conflict (id) do update
    set fractional_piece_ops_enabled = excluded.fractional_piece_ops_enabled,
        updated_at = now(),
        updated_by = auth.uid();

  return p_enabled;
end;
$$;

revoke all on function public.set_fractional_piece_ops_enabled(boolean) from public, anon;
grant execute on function public.set_fractional_piece_ops_enabled(boolean) to authenticated;

create or replace function public.set_fractional_recipe_saving_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access is required to change inventory feature settings.'
      using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Enabled flag is required.' using errcode = '22023';
  end if;

  insert into public.inventory_feature_settings (
    id, fractional_recipe_saving_enabled, fractional_piece_ops_enabled, updated_at, updated_by
  )
  values (
    true,
    p_enabled,
    case
      when p_enabled then true
      else coalesce(
        (select fractional_piece_ops_enabled from public.inventory_feature_settings where id),
        false
      )
    end,
    now(),
    auth.uid()
  )
  on conflict (id) do update
    set fractional_recipe_saving_enabled = excluded.fractional_recipe_saving_enabled,
        fractional_piece_ops_enabled = case
          when excluded.fractional_recipe_saving_enabled then true
          else public.inventory_feature_settings.fractional_piece_ops_enabled
        end,
        updated_at = now(),
        updated_by = auth.uid();

  return p_enabled;
end;
$$;

create or replace function public.assert_piece_ops_quantity(
  p_quantity numeric,
  p_allow_zero boolean default false
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_quantity is null
     or p_quantity::text in ('NaN', 'Infinity', '-Infinity')
     or p_quantity < 0
     or p_quantity > 999999
     or not public.is_piece_half_step(p_quantity)
  then
    raise exception 'Piece quantities must be whole numbers or exact half-steps (n.0 / n.5).'
      using errcode = '22023';
  end if;
  if not p_allow_zero and p_quantity = 0 then
    raise exception 'Quantity is out of range.' using errcode = '22023';
  end if;
  if p_quantity <> trunc(p_quantity) and not public.fractional_piece_ops_enabled() then
    raise exception
      'Half-step inventory quantities are not enabled yet. Use whole numbers, or ask an owner to enable half-step stock ops after all devices are updated.'
      using errcode = '22023';
  end if;
  return p_quantity;
end;
$$;

revoke all on function public.assert_piece_ops_quantity(numeric, boolean) from public, anon, authenticated;

drop function if exists public.parse_inventory_quantity(text, public.inventory_mode, boolean);
create function public.parse_inventory_quantity(
  p_raw text,
  p_mode public.inventory_mode,
  p_allow_zero boolean
)
returns numeric(14,3)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_raw, ''));
  v_value numeric(14,3);
begin
  if p_mode = 'kg_meal' then
    raise exception 'KG-delivered meal inventory is retired. Use whole PCS quantities.'
      using errcode = '22023';
  end if;
  if v_text = '' then
    raise exception 'Quantity is required.' using errcode = '22023';
  end if;
  if left(v_text, 1) = '-' then
    raise exception 'Quantity cannot be negative.' using errcode = '22023';
  end if;

  if public.fractional_piece_ops_enabled() then
    if v_text !~ '^(0|[1-9][0-9]{0,5})(\.5)?$' then
      raise exception 'Piece quantities must be whole numbers or exact half-steps (n.0 / n.5).'
        using errcode = '22023';
    end if;
  else
    if v_text !~ '^(0|[1-9][0-9]{0,5})$' then
      raise exception 'Piece quantities must be whole numbers until half-step stock ops are enabled.'
        using errcode = '22023';
    end if;
  end if;

  v_value := v_text::numeric(14,3);
  perform public.assert_piece_ops_quantity(v_value, p_allow_zero);
  return v_value;
end;
$$;

revoke all on function public.parse_inventory_quantity(text, public.inventory_mode, boolean)
  from public, anon, authenticated;

-- Patch numeric ops RPCs that do not go through parse_inventory_quantity.
do $patch$
declare
  def text;
  marker text;
  insert_assert text;
begin
  -- correct_cashier_stock_count
  def := pg_get_functiondef(
    'public.correct_cashier_stock_count(uuid,uuid,numeric,timestamptz,numeric,text,text)'::regprocedure
  );
  marker := 'raise exception ''Enter a valid stock count (whole or exact half-step) and select a reason.'' using errcode=''22023'';
  end if;';
  insert_assert := marker || '
  perform public.assert_piece_ops_quantity(p_actual_quantity, true);
  perform public.assert_piece_ops_quantity(p_expected_quantity, true);';
  if position(marker in def) = 0 then
    raise exception 'correct_cashier_stock_count patch marker missing';
  end if;
  if position('assert_piece_ops_quantity(p_actual_quantity' in def) = 0 then
    def := replace(def, marker, insert_assert);
    execute def;
  end if;

  -- record_branch_stock_action
  def := pg_get_functiondef(
    'public.record_branch_stock_action(uuid,uuid,text,numeric,numeric,text,text)'::regprocedure
  );
  marker := 'raise exception ''Enter a quantity and a reason.'' using errcode=''22023'';
  end if;';
  insert_assert := marker || '
  perform public.assert_piece_ops_quantity(p_quantity, false);
  perform public.assert_piece_ops_quantity(p_expected_available, true);';
  if position(marker in def) = 0 then
    raise exception 'record_branch_stock_action patch marker missing';
  end if;
  if position('assert_piece_ops_quantity(p_quantity' in def) = 0 then
    def := replace(def, marker, insert_assert);
    execute def;
  end if;

  -- record_main_inventory_waste
  def := pg_get_functiondef(
    'public.record_main_inventory_waste(uuid,numeric,numeric,text,text)'::regprocedure
  );
  marker := 'raise exception ''Enter a whole or exact half-step quantity and a reason.'' using errcode = ''22023'';
  end if;';
  insert_assert := marker || '
  perform public.assert_piece_ops_quantity(p_quantity, false);
  perform public.assert_piece_ops_quantity(p_expected_on_hand, true);';
  if position(marker in def) = 0 then
    -- spacing variant without spaces around =
    marker := 'raise exception ''Enter a whole or exact half-step quantity and a reason.'' using errcode=''22023'';
  end if;';
    insert_assert := marker || '
  perform public.assert_piece_ops_quantity(p_quantity, false);
  perform public.assert_piece_ops_quantity(p_expected_on_hand, true);';
  end if;
  if position(marker in def) = 0 then
    raise exception 'record_main_inventory_waste patch marker missing';
  end if;
  if position('assert_piece_ops_quantity(p_quantity' in def) = 0 then
    def := replace(def, marker, insert_assert);
    execute def;
  end if;

  -- create_stock_return: widen input regex + gate half-steps (302 kept inputs whole-only)
  def := pg_get_functiondef('public.create_stock_return(jsonb,text,text)'::regprocedure);
  def := replace(
    def,
    'or coalesce(v_item.value->>''quantity_returned'', '''') !~ ''^[1-9][0-9]{0,5}$''',
    'or coalesce(v_item.value->>''quantity_returned'', '''') !~ ''^(0\.5|[1-9][0-9]{0,5}(\.5)?)$'''
  );
  def := replace(
    def,
    'raise exception ''Return quantities must be positive whole numbers (maximum 999999).''',
    'raise exception ''Return quantities must be positive whole numbers or exact half-steps (maximum 999999).'''
  );
  marker := 'raise exception ''Return quantities must be positive whole numbers or exact half-steps (maximum 999999).''
        using errcode = ''22023'';
    end if;';
  insert_assert := marker || '
    perform public.assert_piece_ops_quantity((v_item.value->>''quantity_returned'')::numeric, false);';
  if position(marker in def) = 0 then
    raise exception 'create_stock_return half-step / assert patch marker missing';
  end if;
  if position('assert_piece_ops_quantity((v_item.value' in def) = 0 then
    def := replace(def, marker, insert_assert);
  end if;
  execute def;
end;
$patch$;

do $guard$
begin
  if public.fractional_piece_ops_enabled() then
    raise exception 'fractional_piece_ops_enabled must default false';
  end if;
  if public.fractional_recipe_saving_enabled() then
    raise exception 'fractional_recipe_saving_enabled must default false';
  end if;
end;
$guard$;

commit;
