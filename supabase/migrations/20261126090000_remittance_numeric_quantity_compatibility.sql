begin;

-- Numeric stock columns serialize as 3.000 / 0.500. Validate the exact value
-- before applying any scale conversion, and keep the existing activation gate.
create or replace function public.parse_inventory_quantity(
  p_raw text, p_mode public.inventory_mode, p_allow_zero boolean
)
returns numeric(14,3)
language plpgsql stable set search_path = '' as $$
declare
  raw_value text := btrim(coalesce(p_raw, ''));
  quantity numeric;
begin
  if p_mode is distinct from 'piece_stock'::public.inventory_mode then
    raise exception 'KG inventory is retired. Use piece stock for inventory quantities.' using errcode = '22023';
  end if;
  if raw_value !~ '^(0|[1-9][0-9]{0,5})(\.[0-9]{1,3})?$' then
    raise exception 'Enter a valid stock quantity with up to three decimal places.' using errcode = '22023';
  end if;
  quantity := raw_value::numeric;
  perform public.assert_piece_ops_quantity(quantity, coalesce(p_allow_zero, false));
  return quantity;
end;
$$;
revoke all on function public.parse_inventory_quantity(text, public.inventory_mode, boolean)
  from public, anon, authenticated;

-- Preserve the installed payment, authorization, locks and retry handling.
do $patch$
declare
  definition text := pg_get_functiondef('public.close_shift_with_returns(uuid,text,text,uuid[],jsonb)'::regprocedure);
  old_record text := 'as x(product_id uuid,system_balance_before_waste bigint,returnable boolean,previously_held bigint)';
  old_waste text := $old$    if p_waste ? row_data.product_id::text and (jsonb_typeof(p_waste->row_data.product_id::text) <> 'number'
      or (p_waste->>row_data.product_id::text) !~ '^[1-9][0-9]{0,5}$') then raise exception 'Invalid waste quantity.'; end if;
    wasted := coalesce((p_waste->>row_data.product_id::text)::numeric,0);$old$;
  new_waste text := $new$    wasted := 0;
    if p_waste ? row_data.product_id::text then
      if jsonb_typeof(p_waste->row_data.product_id::text) is distinct from 'number' then
        raise exception 'Invalid waste quantity.' using errcode = '22023';
      end if;
      wasted := public.parse_inventory_quantity(p_waste->>row_data.product_id::text, 'piece_stock', false);
    end if;$new$;
begin
  definition := replace(definition, E'\r\n', E'\n');
  if strpos(definition, old_record) = 0 or strpos(definition, old_waste) = 0 then
    raise exception 'Shift close definition changed. Review numeric compatibility before applying.';
  end if;
  definition := replace(definition, old_record,
    'as x(product_id uuid,system_balance_before_waste numeric,returnable boolean,previously_held numeric)');
  definition := replace(definition, old_waste, new_waste);
  execute definition;
end;
$patch$;

-- The generated return payload also carries numeric scale. The existing
-- assert_piece_ops_quantity below this validation enforces positivity, limits,
-- exact half-steps and the feature gate after lexical validation succeeds.
do $patch$
declare
  definition text := pg_get_functiondef('public.create_stock_return(jsonb,text,text)'::regprocedure);
  old_pattern text := '^(0\.5|[1-9][0-9]{0,5}(\.5)?)$';
begin
  if strpos(definition, old_pattern) = 0
     or strpos(definition, 'perform public.assert_piece_ops_quantity') = 0 then
    raise exception 'Return quantity validation changed. Review numeric compatibility before applying.';
  end if;
  execute replace(definition, old_pattern, '^(0|[1-9][0-9]{0,5})(\.[0-9]{1,3})?$');
end;
$patch$;

commit;
