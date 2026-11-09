-- Manual data wipe. Not a migration. Do not db push. Do not deploy.
--
-- Run this yourself in the Supabase SQL editor as the database owner (postgres),
-- after you have taken a backup.
--
-- Keeps:
--   * the single Main Branch (is_main_branch = true)
--   * the single Owner profile and its Auth user
--   * the single Manager assigned to that Main Branch, and that Auth user
--   * sale_pricing_program_settings and archive_settings (app configuration)
--
-- Deletes every other branch, employee, Auth user, product, stock row, sale,
-- shift, transfer, return, and history row.
--
-- Immutability triggers block ordinary DELETEs of completed sales, movements,
-- transfers, and returns. This script sets session_replication_role to replica
-- for this transaction only so those triggers do not fire. It still deletes
-- child rows before parents. It never drops schema, grants, or RLS.
--
-- Dry run: change the final COMMIT to ROLLBACK, run once, and read the notices
-- plus the final result grid. Change it back to COMMIT only after the kept
-- names are the accounts you intend to keep.

begin;

create temp table wipe_keep (
  id uuid primary key,
  kind text not null
) on commit drop;

insert into wipe_keep (id, kind)
select id, 'main_branch'
from public.branches
where is_main_branch;

insert into wipe_keep (id, kind)
select id, 'owner'
from public.profiles
where role = 'owner';

insert into wipe_keep (id, kind)
select p.id, 'main_manager'
from public.profiles p
where p.role = 'manager'
  and p.branch_id = (select id from wipe_keep where kind = 'main_branch');

do $$
declare
  v_main_count integer;
  v_owner_count integer;
  v_manager_count integer;
  v_owner_name text;
  v_manager_name text;
  v_branch_name text;
begin
  select count(*) into v_main_count from wipe_keep where kind = 'main_branch';
  select count(*) into v_owner_count from wipe_keep where kind = 'owner';
  select count(*) into v_manager_count from wipe_keep where kind = 'main_manager';

  if v_main_count <> 1 then
    raise exception 'Refusing to wipe: expected exactly 1 Main Branch, found %.', v_main_count;
  end if;
  if v_owner_count <> 1 then
    raise exception 'Refusing to wipe: expected exactly 1 Owner, found %.', v_owner_count;
  end if;
  if v_manager_count <> 1 then
    raise exception 'Refusing to wipe: expected exactly 1 Main Branch Manager, found %.', v_manager_count;
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.id = (select id from wipe_keep where kind = 'owner')
      and p.branch_id is distinct from (select id from wipe_keep where kind = 'main_branch')
  ) then
    raise exception 'Refusing to wipe: the Owner is not assigned to the Main Branch.';
  end if;

  select p.full_name into v_owner_name
  from public.profiles p
  where p.id = (select id from wipe_keep where kind = 'owner');
  select p.full_name into v_manager_name
  from public.profiles p
  where p.id = (select id from wipe_keep where kind = 'main_manager');
  select b.name into v_branch_name
  from public.branches b
  where b.id = (select id from wipe_keep where kind = 'main_branch');

  raise notice 'KEEP Owner: %', v_owner_name;
  raise notice 'KEEP Main Branch Manager: %', v_manager_name;
  raise notice 'KEEP Main Branch: %', v_branch_name;
end $$;

-- Bypass immutability triggers for this transaction only.
set local session_replication_role = replica;

-- Child tables first. Skip any table this database does not have yet.
do $$
declare
  t text;
  tables text[] := array[
    'public.return_discrepancies',
    'public.transfer_discrepancies',
    'public.sale_items',
    'public.stock_transfer_items',
    'public.stock_return_items',
    'public.inventory_movements',
    'public.shift_waste_occurrences',
    'public.shift_product_reconciliations',
    'public.shift_product_close_baselines',
    'public.shift_product_opening_stock',
    'public.shift_reopen_events',
    'public.sales',
    'public.stock_transfers',
    'public.stock_returns',
    'public.shift_reconciliations',
    'public.shifts',
    'public.daily_product_sales_summary',
    'public.daily_branch_sales_summary',
    'public.data_archives',
    'public.audit_logs',
    'public.pcs_cutover_product_snapshots',
    'public.kg_meal_cutover_balance_snapshots',
    'public.branch_product_variants',
    'public.branch_products',
    'public.branch_inventory',
    'public.product_drink_choices',
    'public.product_stock_uses',
    'public.product_variants',
    'public.products'
  ];
begin
  foreach t in array tables loop
    if to_regclass(t) is null then
      raise notice 'Skipped missing table %', t;
    else
      execute format('delete from %s', t);
      raise notice 'Cleared %', t;
    end if;
  end loop;
end $$;

-- Other employees first. profiles.branch_id blocks deletion of selling branches.
delete from public.profiles
where id not in (
  select id from wipe_keep where kind in ('owner', 'main_manager')
);

delete from public.branches
where id <> (select id from wipe_keep where kind = 'main_branch');

-- Restore triggers before Auth deletes so Supabase cascades (identities,
-- sessions, refresh tokens) still run. Public immutability triggers are
-- no longer involved.
set local session_replication_role = origin;

delete from auth.users
where id not in (
  select id from wipe_keep where kind in ('owner', 'main_manager')
);

do $$
declare
  v_main uuid;
  v_owner uuid;
  v_manager uuid;
begin
  select id into v_main from wipe_keep where kind = 'main_branch';
  select id into v_owner from wipe_keep where kind = 'owner';
  select id into v_manager from wipe_keep where kind = 'main_manager';

  if (select count(*) from public.branches) <> 1
     or not exists (select 1 from public.branches where id = v_main and is_main_branch) then
    raise exception 'Wipe check failed: Main Branch was not the only branch left.';
  end if;

  if (select count(*) from public.profiles) <> 2
     or not exists (select 1 from public.profiles where id = v_owner and role = 'owner')
     or not exists (
       select 1 from public.profiles
       where id = v_manager and role = 'manager' and branch_id = v_main
     ) then
    raise exception 'Wipe check failed: Owner and Main Branch Manager were not the only profiles left.';
  end if;

  if (select count(*) from auth.users) <> 2
     or not exists (select 1 from auth.users where id = v_owner)
     or not exists (select 1 from auth.users where id = v_manager) then
    raise exception 'Wipe check failed: Auth users were not limited to the Owner and Main Branch Manager.';
  end if;

  if to_regclass('public.products') is not null
     and (select count(*) from public.products) <> 0 then
    raise exception 'Wipe check failed: products remain.';
  end if;
  if to_regclass('public.sales') is not null
     and (select count(*) from public.sales) <> 0 then
    raise exception 'Wipe check failed: sales remain.';
  end if;
  if to_regclass('public.shifts') is not null
     and (select count(*) from public.shifts) <> 0 then
    raise exception 'Wipe check failed: shifts remain.';
  end if;
  if to_regclass('public.branch_inventory') is not null
     and (select count(*) from public.branch_inventory) <> 0 then
    raise exception 'Wipe check failed: inventory remains.';
  end if;
  if to_regclass('public.inventory_movements') is not null
     and (select count(*) from public.inventory_movements) <> 0 then
    raise exception 'Wipe check failed: inventory movements remain.';
  end if;

  if to_regclass('public.sale_pricing_program_settings') is not null
     and (select count(*) from public.sale_pricing_program_settings) < 1 then
    raise exception 'Wipe check failed: pricing settings were removed.';
  end if;
  if to_regclass('public.archive_settings') is not null
     and (select count(*) from public.archive_settings) <> 1 then
    raise exception 'Wipe check failed: archive settings were removed.';
  end if;
end $$;

select
  b.name as main_branch,
  p.full_name,
  p.role::text as role
from public.profiles p
join public.branches b on b.id = p.branch_id
order by p.role;

commit;
