-- =============================================================================
-- DANGEROUS: wipe all app data except owner account(s)
-- Run in Supabase Dashboard → SQL Editor (as postgres / service role)
-- Keeps: auth.users + public.profiles where role = 'owner'
-- Deletes: branches, products, employees, inventory, transfers, returns,
--          sales, shifts, audits (if present), archives (if present),
--          and all other non-owner auth users
-- Safe on DBs where some milestone tables were never applied.
-- =============================================================================

begin;

-- Require at least one active owner before wiping
do $$
begin
  if not exists (
    select 1 from public.profiles where role = 'owner' and is_active
  ) then
    raise exception 'Abort: no active owner profile found.';
  end if;
end $$;

-- Temporarily allow deletes of immutable audit / sale / transfer / return rows
-- (only replace functions that already exist)
do $$
begin
  if to_regprocedure('public.block_immutable_record_changes()') is not null then
    execute $fn$
      create or replace function public.block_immutable_record_changes()
      returns trigger language plpgsql set search_path = '' as $body$
      begin
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $body$
    $fn$;
  end if;

  if to_regprocedure('public.protect_sale_history()') is not null then
    execute $fn$
      create or replace function public.protect_sale_history()
      returns trigger language plpgsql set search_path = '' as $body$
      begin
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $body$
    $fn$;
  end if;

  if to_regprocedure('public.protect_stock_return_items()') is not null then
    execute $fn$
      create or replace function public.protect_stock_return_items()
      returns trigger language plpgsql set search_path = '' as $body$
      begin
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $body$
    $fn$;
  end if;

  if to_regprocedure('public.protect_completed_transfer_items()') is not null then
    execute $fn$
      create or replace function public.protect_completed_transfer_items()
      returns trigger language plpgsql set search_path = '' as $body$
      begin
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $body$
    $fn$;
  end if;
end $$;

-- Delete from each table only if it exists
do $$
declare
  t text;
  tables text[] := array[
    'transfer_discrepancies',
    'return_discrepancies',
    'stock_transfer_items',
    'stock_return_items',
    'sale_items',
    'inventory_movements',
    'stock_transfers',
    'stock_returns',
    'sales',
    'shifts',
    'branch_inventory',
    'branch_products',
    'products',
    'audit_logs',
    'daily_product_sales_summary',
    'daily_branch_sales_summary',
    'data_archives'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I', t);
      raise notice 'Cleared public.%', t;
    else
      raise notice 'Skipped missing table public.%', t;
    end if;
  end loop;

  if to_regclass('public.archive_settings') is not null then
    update public.archive_settings set remind_after = null where id = 1;
  end if;
end $$;

-- Non-owner staff profiles (must go before branches)
delete from public.profiles where role is distinct from 'owner';

-- All branches (owner has branch_id null)
delete from public.branches;

-- Auth users that are not owners
delete from auth.users
where id not in (select id from public.profiles where role = 'owner');

-- Restore immutability guards (best-effort; skip if types/functions missing)
do $$
begin
  if to_regprocedure('public.block_immutable_record_changes()') is not null then
    execute $fn$
      create or replace function public.block_immutable_record_changes()
      returns trigger language plpgsql set search_path = '' as $body$
      begin
        raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
      end;
      $body$
    $fn$;
  end if;

  if to_regprocedure('public.protect_sale_history()') is not null then
    execute $fn$
      create or replace function public.protect_sale_history()
      returns trigger language plpgsql set search_path = '' as $body$
      begin
        raise exception 'Completed sale history is immutable.' using errcode = '55000';
      end;
      $body$
    $fn$;
  end if;

  if to_regprocedure('public.protect_stock_return_items()') is not null
     and to_regtype('public.stock_return_status') is not null then
    execute $fn$
      create or replace function public.protect_stock_return_items()
      returns trigger language plpgsql set search_path = '' as $body$
      declare
        v_status public.stock_return_status;
      begin
        select sr.status into v_status
        from public.stock_returns sr
        where sr.id = case when tg_op = 'DELETE' then old.stock_return_id else new.stock_return_id end;

        if tg_op = 'DELETE' then
          if v_status <> 'draft' then
            raise exception 'Sent or completed return items are immutable.' using errcode = '55000';
          end if;
          return old;
        end if;

        if v_status = 'in_transit' then
          if new.stock_return_id is distinct from old.stock_return_id
             or new.product_id is distinct from old.product_id
             or new.quantity_returned is distinct from old.quantity_returned
             or new.product_name is distinct from old.product_name
             or new.product_sku is distinct from old.product_sku
             or old.quantity_received is not null
             or new.quantity_received is null then
            raise exception 'Only the one-time received quantity may be recorded for an in-transit return item.' using errcode = '55000';
          end if;
        elsif v_status <> 'draft' then
          raise exception 'Completed return items are immutable.' using errcode = '55000';
        end if;

        return new;
      end;
      $body$
    $fn$;
  end if;

  if to_regprocedure('public.protect_completed_transfer_items()') is not null
     and to_regtype('public.stock_transfer_status') is not null then
    execute $fn$
      create or replace function public.protect_completed_transfer_items()
      returns trigger language plpgsql set search_path = '' as $body$
      declare
        v_status public.stock_transfer_status;
      begin
        select status into v_status
        from public.stock_transfers
        where id = case when tg_op = 'DELETE' then old.stock_transfer_id else new.stock_transfer_id end;

        if v_status in ('received', 'received_with_discrepancy', 'cancelled') then
          raise exception 'Completed transfer items are immutable.' using errcode = '55000';
        end if;
        if tg_op = 'DELETE' then
          return old;
        end if;
        return new;
      end;
      $body$
    $fn$;
  end if;
end $$;

-- Sanity check
do $$
declare
  v_owners int;
  v_others int;
begin
  select count(*) into v_owners from public.profiles where role = 'owner';
  select count(*) into v_others from public.profiles where role is distinct from 'owner';
  if v_owners < 1 then
    raise exception 'Wipe failed: no owner profiles remain.';
  end if;
  if v_others > 0 then
    raise exception 'Wipe failed: non-owner profiles still exist.';
  end if;
  raise notice 'Wipe complete. Owner profiles kept: %', v_owners;
end $$;

commit;
