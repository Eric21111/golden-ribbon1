-- Phase 4A: privileged server gate for fractional recipe saving (default OFF).
-- Client flags/headers cannot enable this. Owner-only setter.
-- Also tightens normalize_product_stock_uses so fractional recipes are rejected while OFF.
-- Does not modify historical product_stock_uses rows or balances.
-- No explicit BEGIN/COMMIT: Supabase CLI wraps each migration file in its own transaction.

create table if not exists public.inventory_feature_settings (
  id boolean primary key default true check (id),
  fractional_recipe_saving_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.inventory_feature_settings (id, fractional_recipe_saving_enabled)
values (true, false)
on conflict (id) do nothing;

alter table public.inventory_feature_settings enable row level security;

drop policy if exists inventory_feature_settings_select on public.inventory_feature_settings;
create policy inventory_feature_settings_select
  on public.inventory_feature_settings
  for select
  to authenticated
  using (public.is_owner() or public.is_main_branch_manager());

revoke all on table public.inventory_feature_settings from public, anon, authenticated;
grant select on table public.inventory_feature_settings to authenticated;

create or replace function public.fractional_recipe_saving_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.fractional_recipe_saving_enabled from public.inventory_feature_settings s where s.id),
    false
  );
$$;

revoke all on function public.fractional_recipe_saving_enabled() from public, anon, authenticated;
-- Callable only from other security definer RPCs (normalize), not from clients.
comment on function public.fractional_recipe_saving_enabled() is
  'Server-side gate for saving 0.5 Stock Used recipes. Default false. Not controllable by client headers.';

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

  insert into public.inventory_feature_settings (id, fractional_recipe_saving_enabled, updated_at, updated_by)
  values (true, p_enabled, now(), auth.uid())
  on conflict (id) do update
    set fractional_recipe_saving_enabled = excluded.fractional_recipe_saving_enabled,
        updated_at = now(),
        updated_by = auth.uid();

  return p_enabled;
end;
$$;

revoke all on function public.set_fractional_recipe_saving_enabled(boolean) from public, anon;
grant execute on function public.set_fractional_recipe_saving_enabled(boolean) to authenticated;

comment on function public.set_fractional_recipe_saving_enabled(boolean) is
  'Owner-only. Turns fractional Stock Used recipe saving on/off. Default remains off until Phase 4B client enable.';

-- ---------------------------------------------------------------------------
-- normalize: integers always OK; half-steps only when server gate is ON
-- ---------------------------------------------------------------------------
create or replace function public.normalize_product_stock_uses(p_stock_uses jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_line jsonb;
  v_out jsonb := '[]'::jsonb;
  v_ingredient text;
  v_quantity text;
  v_qty numeric(14,1);
  v_variant_id text;
  v_variant_name text;
  v_frac boolean := public.fractional_recipe_saving_enabled();
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.'
      using errcode = '42501';
  end if;

  if p_stock_uses is null or jsonb_typeof(p_stock_uses) = 'null' then
    return null;
  end if;

  if jsonb_typeof(p_stock_uses) is distinct from 'array' then
    raise exception 'invalid_stock_use: Stock uses must be a JSON array.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_stock_uses) > 500 then
    raise exception 'invalid_stock_use: Provide at most 500 stock use lines.'
      using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_stock_uses) loop
    if jsonb_typeof(v_line) is distinct from 'object' then
      raise exception 'invalid_stock_use: Each stock use must be an object.'
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_line->'ingredient_product_id') is distinct from 'string' then
      raise exception 'invalid_stock_use: Each stock use needs an ingredient_product_id.'
        using errcode = '22023';
    end if;
    v_ingredient := lower(btrim(v_line->>'ingredient_product_id'));
    if v_ingredient <> 'self' and v_ingredient !~ v_uuid_re then
      raise exception 'invalid_stock_use: ingredient_product_id must be a product id or "self".'
        using errcode = '22023';
    end if;

    v_quantity := btrim(v_line->>'quantity');
    if v_frac then
      if v_quantity is null or v_quantity !~ '^(0\.5|[1-9][0-9]?(\.5)?)$' then
        raise exception 'invalid_stock_use: Quantity must be a half-step from 0.5 to 99 (for example 0.5, 1, 1.5).'
          using errcode = '22023';
      end if;
    else
      if v_quantity is null or v_quantity !~ '^[1-9][0-9]?$' then
        raise exception 'invalid_stock_use: Quantity must be a whole number from 1 to 99.'
          using errcode = '22023';
      end if;
    end if;

    v_qty := v_quantity::numeric(14,1);
    if v_frac then
      if v_qty < 0.5 or v_qty > 99 or not public.is_piece_half_step(v_qty) then
        raise exception 'invalid_stock_use: Quantity must be a half-step from 0.5 to 99 (for example 0.5, 1, 1.5).'
          using errcode = '22023';
      end if;
    else
      if v_qty < 1 or v_qty > 99 or v_qty <> trunc(v_qty) then
        raise exception 'invalid_stock_use: Quantity must be a whole number from 1 to 99.'
          using errcode = '22023';
      end if;
    end if;

    v_variant_id := null;
    v_variant_name := null;
    if v_line->'variant_id' is not null and jsonb_typeof(v_line->'variant_id') <> 'null' then
      if jsonb_typeof(v_line->'variant_id') <> 'string' or lower(btrim(v_line->>'variant_id')) !~ v_uuid_re then
        raise exception 'invalid_stock_use: variant_id must be a variant id.'
          using errcode = '22023';
      end if;
      v_variant_id := lower(btrim(v_line->>'variant_id'));
    end if;
    if v_line->'variant_name' is not null and jsonb_typeof(v_line->'variant_name') <> 'null' then
      if jsonb_typeof(v_line->'variant_name') <> 'string'
         or char_length(btrim(v_line->>'variant_name')) not between 1 and 60 then
        raise exception 'invalid_stock_use: variant_name must be 1 to 60 characters.'
          using errcode = '22023';
      end if;
      v_variant_name := lower(btrim(v_line->>'variant_name'));
    end if;
    if v_variant_id is not null and v_variant_name is not null then
      raise exception 'invalid_stock_use: Use variant_id or variant_name, not both.'
        using errcode = '22023';
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ingredient', v_ingredient,
      'quantity', v_qty,
      'variant_id', v_variant_id,
      'variant_name', v_variant_name
    ));
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(v_out) as l(ingredient text, quantity numeric, variant_id text, variant_name text)
    group by coalesce(l.variant_id, 'n:' || coalesce(l.variant_name, '')), l.ingredient
    having count(*) > 1
  ) then
    raise exception 'duplicate_stock_use: Each ingredient may appear only once per product or variant.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_out) as l(ingredient text, quantity numeric, variant_id text, variant_name text)
    where l.ingredient <> 'self'
      and not exists (select 1 from public.products p where p.id = l.ingredient::uuid)
  ) then
    raise exception 'invalid_stock_use: An ingredient product could not be found.'
      using errcode = '22023';
  end if;

  return v_out;
end;
$$;

comment on function public.normalize_product_stock_uses(jsonb) is
  'Validates Stock Used payloads. Fractional 0.5 quantities require inventory_feature_settings.fractional_recipe_saving_enabled.';
