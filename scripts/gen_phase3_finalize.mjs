import { readFileSync, writeFileSync } from 'node:fs';

const phase1 = readFileSync('supabase/migrations/20260928150400_phase1_critical_fixes.sql', 'utf8');
const start = phase1.indexOf('create or replace function public.finalize_cashier_shift_reconciliation');
const end = phase1.indexOf('revoke all on function public.finalize_cashier_shift_reconciliation');
if (start < 0 || end < 0) throw new Error('finalize not found');
let fn = phase1.slice(start, end);

fn = fn.replace(
  "  v_product_summaries jsonb := '[]'::jsonb;\nbegin",
  `  v_product_summaries jsonb := '[]'::jsonb;
  v_note text;
  v_product_mode public.inventory_mode;
begin`,
);

fn = fn.replace(
  `jsonb_build_object(
        'product_id', (value->>'product_id')::uuid,
        'actual_remaining', public.parse_inventory_quantity(value->>'actual_remaining', 'piece_stock', true)::bigint,
        'waste_quantity', public.parse_inventory_quantity(
          coalesce(nullif(btrim(value->>'waste_quantity'), ''), '0'),
          'piece_stock',
          true
        )::bigint
      ) as obj`,
  `jsonb_build_object(
        'product_id', (value->>'product_id')::uuid,
        'actual_remaining', public.parse_inventory_quantity(value->>'actual_remaining', 'piece_stock', true)::bigint,
        'waste_quantity', public.parse_inventory_quantity(
          coalesce(nullif(btrim(value->>'waste_quantity'), ''), '0'),
          'piece_stock',
          true
        )::bigint,
        'discrepancy_note', nullif(btrim(coalesce(value->>'discrepancy_note', '')), '')
      ) as obj`,
);

fn = fn.replace(
  `jsonb_build_object(
          'product_id', r.product_id,
          'actual_remaining', r.actual_remaining,
          'waste_quantity', r.waste_quantity
        )`,
  `jsonb_build_object(
          'product_id', r.product_id,
          'actual_remaining', r.actual_remaining,
          'waste_quantity', r.waste_quantity,
          'discrepancy_note', r.discrepancy_note
        )`,
);

fn = fn.replace(
  'as x(product_id uuid, actual_remaining bigint, waste_quantity bigint)',
  'as x(product_id uuid, actual_remaining bigint, waste_quantity bigint, discrepancy_note text)',
);

fn = fn.replace(
  `if v_base.closing_stock_behavior = 'keep_at_branch' then
        v_carried := v_actual_rem;
        v_unsold := 0;
      else
        v_carried := 0;
        v_unsold := v_actual_rem;
      end if;

      insert into public.shift_product_reconciliations (`,
  `select inventory_mode into v_product_mode from public.products where id = v_base.product_id;
      v_note := nullif(btrim(coalesce(v_item.discrepancy_note, '')), '');
      if v_product_mode = 'kg_meal' and v_discrepancy <> 0 and v_note is null then
        raise exception 'KG discrepancy for % requires a justification note.',
          v_base.product_name_snapshot
          using errcode = '22023';
      end if;
      if v_note is not null and char_length(v_note) > 500 then
        raise exception 'Discrepancy note must be 500 characters or fewer.' using errcode = '22023';
      end if;

      if v_base.closing_stock_behavior = 'keep_at_branch' then
        v_carried := v_actual_rem;
        v_unsold := 0;
      else
        v_carried := 0;
        v_unsold := v_actual_rem;
      end if;

      insert into public.shift_product_reconciliations (`,
);

fn = fn.replace(
  `expected_remaining, actual_remaining, discrepancy,
        unsold_quantity, carried_quantity, result, recorded_by
      ) values (
        v_shift.id, v_shift.branch_id, v_base.product_id,
        v_base.product_name_snapshot, v_base.sku_snapshot, v_base.closing_stock_behavior,
        v_base.opening_quantity, v_agg.received_quantity, v_agg.outgoing_quantity, v_agg.sold_quantity,
        v_waste, v_agg.adjustment_quantity, 0,
        v_expected_rem, v_actual_rem, v_discrepancy,
        v_unsold, v_carried, v_result, v_user.id
      )`,
  `expected_remaining, actual_remaining, discrepancy,
        unsold_quantity, carried_quantity, result, discrepancy_note, recorded_by
      ) values (
        v_shift.id, v_shift.branch_id, v_base.product_id,
        v_base.product_name_snapshot, v_base.sku_snapshot, v_base.closing_stock_behavior,
        v_base.opening_quantity, v_agg.received_quantity, v_agg.outgoing_quantity, v_agg.sold_quantity,
        v_waste, v_agg.adjustment_quantity, 0,
        v_expected_rem, v_actual_rem, v_discrepancy,
        v_unsold, v_carried, v_result, v_note, v_user.id
      )`,
);

fn = fn.replace(
  `'discrepancy', v_discrepancy,
        'result', v_result,
        'unsold_quantity', v_unsold,
        'carried_quantity', v_carried
      ));`,
  `'discrepancy', v_discrepancy,
        'result', v_result,
        'unsold_quantity', v_unsold,
        'carried_quantity', v_carried,
        'discrepancy_note', v_note
      ));`,
);

writeFileSync('supabase/migrations/_phase3_finalize_fragment.sql', fn);
console.log('ok', fn.length);
