begin;
-- Keep the stock snapshot and transaction logic in the installed checkout function.
-- Both pricing sites (receipt total and persisted line) must match the expected previous version.
do $migration$
declare
  definition text := pg_get_functiondef('public.confirm_sale(uuid,jsonb,numeric,text,text,text)'::regprocedure);
  old_price text := 'v_charged_price := public.apply_sale_pricing_program(v_catalog_price, v_program);';
  new_price text := $pricing$v_charged_price := case
      when v_program = 'back_office_guard' and not exists (
        select 1 from public.products p where p.id = v_item.product_id and p.product_category in ('meals','snacks')
      ) then v_catalog_price
      else public.apply_sale_pricing_program(v_catalog_price, v_program)
    end;$pricing$;
begin
  if cardinality(string_to_array(definition, old_price)) <> 3 then
    raise exception 'Checkout pricing definition has changed. Review before applying.';
  end if;
  execute replace(definition, old_price, new_price);
end;
$migration$;
commit;
