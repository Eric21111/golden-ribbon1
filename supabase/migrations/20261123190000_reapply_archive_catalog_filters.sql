-- Re-apply archive catalog filters after the unfinished fractional migrations.
-- 20261123140000 drops and recreates list_return_inventory, which removes
-- "archived_at is null" if 20261118000000 already ran.
-- This file does not change half-step quantities, gates, or reports.
-- Do not apply it to production until 20261123120000–20261123150000 are intentionally deployed.
-- Applying only 20261118000000 does not apply this file or the fractional files.
-- No explicit BEGIN/COMMIT: the Supabase CLI wraps this file in one transaction.

do $patch$
declare
  def text;
begin
  if to_regprocedure('public.pos_inventory_for_branch(uuid)') is not null then
    def := pg_get_functiondef('public.pos_inventory_for_branch(uuid)'::regprocedure);
    if position('p.archived_at is null' in def) = 0 then
      if def !~ 'and p\.is_active[[:space:]]+and p\.sell_in_pos' then
        raise exception 'pos_inventory_for_branch archive patch point was not found: %', substring(def from 'is_active.{0,40}');
      end if;
      def := regexp_replace(
        def,
        'and p\.is_active[[:space:]]+and p\.sell_in_pos',
        E'and p.is_active\n      and p.archived_at is null\n      and p.sell_in_pos'
      );
      execute def;
    end if;
  end if;

  if to_regprocedure('public.list_return_inventory()') is not null then
    def := pg_get_functiondef('public.list_return_inventory()'::regprocedure);
    if position('p.archived_at is null' in def) = 0 then
      if position('and not p.is_non_returnable' in def) = 0 then
        raise exception 'list_return_inventory archive patch point was not found.';
      end if;
      def := replace(
        def,
        'and not p.is_non_returnable',
        E'and p.archived_at is null\n    and not p.is_non_returnable'
      );
      execute def;
    end if;
  end if;

  if to_regprocedure('public.list_cashier_local_purchase_catalog()') is not null then
    def := pg_get_functiondef('public.list_cashier_local_purchase_catalog()'::regprocedure);
    if position('p.archived_at is null' in def) = 0 then
      if def !~ 'and p\.is_active[[:space:]]+and p\.is_non_returnable' then
        raise exception 'list_cashier_local_purchase_catalog archive patch point was not found: %', substring(def from 'is_active.{0,40}');
      end if;
      def := regexp_replace(
        def,
        'and p\.is_active[[:space:]]+and p\.is_non_returnable',
        E'and p.is_active\n    and p.archived_at is null\n    and p.is_non_returnable'
      );
      execute def;
    end if;
  end if;

  if to_regprocedure('public.list_cashier_correction_stock()') is not null then
    def := pg_get_functiondef('public.list_cashier_correction_stock()'::regprocedure);
    if position('p.archived_at is null' in def) = 0 then
      if position('and p.inventory_mode=''piece_stock'' and p.is_active' in def) = 0 then
        raise exception 'list_cashier_correction_stock archive patch point was not found.';
      end if;
      def := replace(
        def,
        'and p.inventory_mode=''piece_stock'' and p.is_active',
        'and p.inventory_mode=''piece_stock'' and p.is_active and p.archived_at is null'
      );
      execute def;
    end if;
  end if;

  if to_regprocedure('public.list_cashier_day_stock()') is not null then
    def := pg_get_functiondef('public.list_cashier_day_stock()'::regprocedure);
    if position('p.archived_at is null' in def) = 0 then
      if def !~ 'p\.inventory_mode=''piece_stock''' then
        raise exception 'list_cashier_day_stock archive patch point was not found: %', substring(def from 'piece_stock.{0,60}');
      end if;
      def := replace(
        def,
        'p.inventory_mode=''piece_stock''',
        'p.inventory_mode=''piece_stock'' and p.archived_at is null'
      );
      execute def;
    end if;
  end if;

  if to_regprocedure('public.manager_branch_stock(uuid)') is not null then
    def := pg_get_functiondef('public.manager_branch_stock(uuid)'::regprocedure);
    if position('pr.archived_at is null' in def) = 0 then
      if position('from (select * from public.branch_inventory where branch_id=p_branch) i' in def) = 0 then
        raise exception 'manager_branch_stock archive patch point was not found.';
      end if;
      def := replace(
        def,
        'from (select * from public.branch_inventory where branch_id=p_branch) i',
        'from (select i.* from public.branch_inventory i join public.products pr on pr.id=i.product_id where i.branch_id=p_branch and pr.archived_at is null) i'
      );
      execute def;
    end if;
  end if;
end
$patch$;
