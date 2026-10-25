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

-- History and line items that reference sales, shifts, products, or profiles.
delete from public.return_discrepancies;
delete from public.transfer_discrepancies;
delete from public.sale_items;
delete from public.stock_transfer_items;
delete from public.stock_return_items;
delete from public.inventory_movements;
delete from public.shift_waste_occurrences;
delete from public.shift_product_reconciliations;
delete from public.shift_product_close_baselines;
delete from public.shift_product_opening_stock;
delete from public.shift_reopen_events;

delete from public.sales;
delete from public.stock_transfers;
delete from public.stock_returns;
delete from public.shift_reconciliations;
delete from public.shifts;

delete from public.daily_product_sales_summary;
delete from public.daily_branch_sales_summary;
delete from public.data_archives;
delete from public.audit_logs;

delete from public.pcs_cutover_product_snapshots;
delete from public.kg_meal_cutover_balance_snapshots;
delete from public.branch_product_variants;
delete from public.branch_products;
delete from public.branch_inventory;
delete from public.product_drink_choices;
delete from public.product_stock_uses;
delete from public.product_variants;
delete from public.products;

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

  if (select count(*) from public.products) <> 0
     or (select count(*) from public.sales) <> 0
     or (select count(*) from public.shifts) <> 0
     or (select count(*) from public.branch_inventory) <> 0
     or (select count(*) from public.inventory_movements) <> 0 then
    raise exception 'Wipe check failed: products, sales, shifts, or inventory remain.';
  end if;

  if (select count(*) from public.sale_pricing_program_settings) < 1
     or (select count(*) from public.archive_settings) <> 1 then
    raise exception 'Wipe check failed: app configuration rows were removed.';
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
