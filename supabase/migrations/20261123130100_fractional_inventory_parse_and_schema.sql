-- Phase 4A: half-step parse_inventory_quantity + schema/constraints for ops.
-- Historical quantity values are cast in place (whole numbers stay identical).
-- No Egg cutover dependency.

begin;

-- ---------------------------------------------------------------------------
-- parse_inventory_quantity: exact 0.5 for piece_stock; reject 0.3 before coerce
-- ---------------------------------------------------------------------------
create or replace function public.parse_inventory_quantity(
  p_raw text,
  p_mode public.inventory_mode,
  p_allow_zero boolean
)
returns numeric(14,3)
language plpgsql
immutable
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
  -- Intermediate safety: accept whole numbers only here. Half-step ops parsing is
  -- installed later by 20261123150000 behind fractional_piece_ops_enabled (default OFF).
  -- Schema CHECKs below still allow storing half-steps created by sales deductions.
  if v_text !~ '^(0|[1-9][0-9]{0,5})$' then
    raise exception 'Piece quantities must be whole numbers.'
      using errcode = '22023';
  end if;
  v_value := v_text::numeric(14,3);
  if v_value <> trunc(v_value) then
    raise exception 'Piece quantities must be whole numbers.'
      using errcode = '22023';
  end if;
  if (not p_allow_zero and v_value = 0) or v_value > 999999 then
    raise exception 'Quantity is out of range.' using errcode = '22023';
  end if;
  return v_value;
end;
$$;

revoke all on function public.parse_inventory_quantity(text, public.inventory_mode, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Transfer / return item CHECKs → half-step (portion units still guarded by trigger)
-- ---------------------------------------------------------------------------
alter table public.stock_transfer_items
  drop constraint if exists stock_transfer_items_piece_whole_chk;
alter table public.stock_transfer_items
  add constraint stock_transfer_items_piece_half_step_chk
  check (
    inventory_mode <> 'piece_stock'
    or (
      public.is_piece_half_step(quantity_sent)
      and (quantity_received is null or public.is_piece_half_step(quantity_received))
    )
  );

alter table public.stock_return_items
  alter column quantity_returned type numeric(14,3)
  using quantity_returned::numeric(14,3);
alter table public.stock_return_items
  alter column quantity_received type numeric(14,3)
  using quantity_received::numeric(14,3);

alter table public.stock_return_items
  drop constraint if exists stock_return_items_piece_whole_chk;
alter table public.stock_return_items
  add constraint stock_return_items_piece_half_step_chk
  check (
    inventory_mode <> 'piece_stock'
    or (
      public.is_piece_half_step(quantity_returned)
      and (quantity_received is null or public.is_piece_half_step(quantity_received))
    )
  );

-- Portion-coded products remain whole on transfer/return lines.
create or replace function public.guard_transfer_return_item_portion_qty()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_unit text;
  v_sent numeric;
  v_recv numeric;
begin
  if new.inventory_mode is distinct from 'piece_stock' then
    return new;
  end if;
  select p.stock_unit_code into v_unit from public.products p where p.id = new.product_id;
  if v_unit is null or v_unit not in ('half_egg', 'half_serving', 'quarter_serving') then
    return new;
  end if;
  if tg_table_name = 'stock_transfer_items' then
    v_sent := new.quantity_sent;
    v_recv := new.quantity_received;
  else
    v_sent := new.quantity_returned;
    v_recv := new.quantity_received;
  end if;
  if v_sent <> trunc(v_sent) or (v_recv is not null and v_recv <> trunc(v_recv)) then
    raise exception 'Portion-unit transfer/return quantities must be whole numbers.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_transfer_items_guard_portion_qty on public.stock_transfer_items;
create trigger stock_transfer_items_guard_portion_qty
before insert or update on public.stock_transfer_items
for each row execute function public.guard_transfer_return_item_portion_qty();

drop trigger if exists stock_return_items_guard_portion_qty on public.stock_return_items;
create trigger stock_return_items_guard_portion_qty
before insert or update on public.stock_return_items
for each row execute function public.guard_transfer_return_item_portion_qty();

revoke all on function public.guard_transfer_return_item_portion_qty() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Discrepancy quantity columns → numeric (values unchanged)
-- ---------------------------------------------------------------------------
alter table public.transfer_discrepancies
  alter column quantity_expected type numeric(14,3) using quantity_expected::numeric(14,3);
alter table public.transfer_discrepancies
  alter column quantity_received type numeric(14,3) using quantity_received::numeric(14,3);
alter table public.transfer_discrepancies
  alter column difference type numeric(14,3) using difference::numeric(14,3);

alter table public.return_discrepancies
  alter column quantity_expected type numeric(14,3) using quantity_expected::numeric(14,3);
alter table public.return_discrepancies
  alter column quantity_received type numeric(14,3) using quantity_received::numeric(14,3);
alter table public.return_discrepancies
  alter column difference type numeric(14,3) using difference::numeric(14,3);

-- ---------------------------------------------------------------------------
-- Shift snapshot / reconciliation quantity columns → numeric
-- ---------------------------------------------------------------------------
alter table public.shift_product_opening_stock
  alter column opening_quantity type numeric(14,3)
  using opening_quantity::numeric(14,3);

alter table public.shift_product_close_baselines
  alter column opening_quantity type numeric(14,3)
  using opening_quantity::numeric(14,3);

alter table public.shift_product_reconciliations
  alter column opening_quantity type numeric(14,3) using opening_quantity::numeric(14,3),
  alter column received_quantity type numeric(14,3) using received_quantity::numeric(14,3),
  alter column outgoing_quantity type numeric(14,3) using outgoing_quantity::numeric(14,3),
  alter column sold_quantity type numeric(14,3) using sold_quantity::numeric(14,3),
  alter column waste_quantity type numeric(14,3) using waste_quantity::numeric(14,3),
  alter column adjustment_quantity type numeric(14,3) using adjustment_quantity::numeric(14,3),
  alter column net_other_movement_quantity type numeric(14,3) using net_other_movement_quantity::numeric(14,3),
  alter column expected_remaining type numeric(14,3) using expected_remaining::numeric(14,3),
  alter column actual_remaining type numeric(14,3) using actual_remaining::numeric(14,3),
  alter column discrepancy type numeric(14,3) using discrepancy::numeric(14,3),
  alter column unsold_quantity type numeric(14,3) using unsold_quantity::numeric(14,3),
  alter column carried_quantity type numeric(14,3) using carried_quantity::numeric(14,3);

commit;
