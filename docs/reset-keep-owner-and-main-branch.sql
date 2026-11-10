-- Golden Ribbons: manual TEST-DATA reset, never a migration.
-- Run the ENTIRE file in Supabase SQL Editor as postgres.
-- Default mode only previews; no application or Auth records are changed.
-- Read docs/reset-data-guide.md first. Verify the project in the dashboard.
-- After reviewing the preview and taking a restorable backup, fill the three
-- exact UUIDs below, change preview_only to false and supply the acknowledgement.
-- Stop all apps, background jobs and employee administration during execution.
-- Storage objects are NOT deleted: a nonempty Storage bucket blocks execution.
-- Database schema, RLS, functions, migration history and kept credentials stay intact.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create temporary table reset_options (
  preview_only boolean not null,
  owner_id uuid,
  manager_id uuid,
  main_branch_id uuid,
  acknowledgement text not null
) on commit drop;
insert into reset_options values (
  true, -- PREVIEW ONLY. Set false only for the approved reset.
  null, -- Owner UUID from preview
  null, -- Main Branch Manager UUID from preview
  null, -- Main Branch UUID from preview
  '' -- For execution: BACKUP VERIFIED - DELETE TEST DATA
);

create temporary table reset_scope (
  table_name text primary key,
  action text not null,
  before_count bigint,
  after_count bigint
) on commit drop;
insert into reset_scope(table_name, action) values
  ('return_discrepancies', 'clear'),
  ('transfer_discrepancies', 'clear'),
  ('sale_items', 'clear'),
  ('stock_transfer_items', 'clear'),
  ('stock_return_items', 'clear'),
  ('inventory_movements', 'clear'),
  ('notifications', 'clear'),
  ('push_devices', 'clear'),
  ('push_deliveries', 'clear'),
  ('shift_waste_occurrences', 'clear'),
  ('shift_product_reconciliations', 'clear'),
  ('shift_product_close_baselines', 'clear'),
  ('shift_product_opening_stock', 'clear'),
  ('shift_reopen_events', 'clear'),
  ('sales', 'clear'),
  ('stock_transfers', 'clear'),
  ('stock_returns', 'clear'),
  ('shift_reconciliations', 'clear'),
  ('shifts', 'clear'),
  ('daily_product_sales_summary', 'clear'),
  ('daily_branch_sales_summary', 'clear'),
  ('data_archives', 'clear'),
  ('pcs_cutover_product_snapshots', 'clear'),
  ('kg_meal_cutover_balance_snapshots', 'clear'),
  ('branch_product_variants', 'clear'),
  ('branch_products', 'clear'),
  ('branch_inventory', 'clear'),
  ('product_drink_choices', 'clear'),
  ('product_stock_uses', 'clear'),
  ('product_variants', 'clear'),
  ('products', 'clear'),
  ('branches', 'keep_main'),
  ('profiles', 'keep_accounts'),
  ('sale_pricing_program_settings', 'keep_all'),
  ('archive_settings', 'keep_all');

create temporary table reset_keep (
  kind text primary key, id uuid not null, label text not null
) on commit drop;
create temporary table reset_preserved (
  table_name text primary key, rows_before jsonb not null
) on commit drop;

-- Validate exact table coverage, lock against concurrent writes on execution,
-- then choose the records to preserve. Never guess between multiple owners/managers.
do $reset_preflight$
declare
  o record;
  t record;
  unexpected text;
  n bigint;
  kept_owner uuid;
  kept_manager uuid;
  kept_branch uuid;
begin
  select * into strict o from reset_options;
  if current_user <> 'postgres' then
    raise exception 'Run this manual script using the SQL Editor postgres role.';
  end if;
  if current_setting('session_replication_role') <> 'origin' then
    raise exception 'Triggers must be enabled (session_replication_role = origin).';
  end if;
  select string_agg(c.relname, ', ' order by c.relname) into unexpected
  from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
  where ns.nspname='public' and c.relkind in ('r','p','f','m')
    and not exists (select 1 from reset_scope s where s.table_name=c.relname);
  if unexpected is not null then
    raise exception 'Unreviewed public tables/materialized views: %. Stop and update the reset review.', unexpected;
  end if;
  for t in select * from reset_scope order by table_name loop
    if to_regclass(format('public.%I',t.table_name)) is null then
      raise exception 'Expected table public.% is missing; schema differs from the reviewed repository.',t.table_name;
    end if;
    if exists (select 1 from pg_inherits where inhparent=to_regclass(format('public.%I',t.table_name))
      or inhrelid=to_regclass(format('public.%I',t.table_name))) then
      raise exception 'Inheritance/partitioning requires a separate review: %',t.table_name;
    end if;
  end loop;
  if not o.preview_only then
    if o.owner_id is null or o.manager_id is null or o.main_branch_id is null
      or o.acknowledgement <> 'BACKUP VERIFIED - DELETE TEST DATA' then
      raise exception 'Execution requires all three reviewed UUIDs and the exact backup acknowledgement.';
    end if;
    lock table auth.users in access exclusive mode;
  end if;
  for t in select * from reset_scope order by table_name loop
    execute format('lock table public.%I in %s mode', t.table_name,
      case when o.preview_only then 'access share' else 'access exclusive' end);
    execute format('select count(*) from public.%I',t.table_name) into n;
    update reset_scope set before_count=n where table_name=t.table_name;
  end loop;
  if (select count(*) from public.branches where is_main_branch) <> 1 then
    raise exception 'Expected exactly one Main Branch.';
  end if;
  select id into kept_branch from public.branches where is_main_branch and is_active;
  if kept_branch is null then raise exception 'Main Branch must be active.'; end if;
  if (select count(*) from public.profiles where role='owner') <> 1 then
    raise exception 'Expected exactly one Owner; review accounts manually.';
  end if;
  select id into kept_owner from public.profiles
    where role='owner' and branch_id=kept_branch and is_active;
  if kept_owner is null then raise exception 'Owner must be active and assigned to Main Branch.'; end if;
  if (select count(*) from public.profiles where role='manager' and branch_id=kept_branch) <> 1 then
    raise exception 'Expected exactly one Main Branch Manager; review accounts manually.';
  end if;
  select id into kept_manager from public.profiles
    where role='manager' and branch_id=kept_branch and is_active;
  if kept_manager is null then raise exception 'Main Branch Manager must be active.'; end if;
  if (select count(*) from auth.users where id in (kept_owner,kept_manager)) <> 2 then
    raise exception 'Both kept profiles must have existing Auth accounts.';
  end if;
  if (o.owner_id is not null and o.owner_id<>kept_owner)
    or (o.manager_id is not null and o.manager_id<>kept_manager)
    or (o.main_branch_id is not null and o.main_branch_id<>kept_branch) then
    raise exception 'Provided UUIDs do not match the current Owner, Main Manager and Main Branch.';
  end if;
  insert into reset_keep select 'owner',id,full_name from public.profiles where id=kept_owner;
  insert into reset_keep select 'main_manager',id,full_name from public.profiles where id=kept_manager;
  insert into reset_keep select 'main_branch',id,name from public.branches where id=kept_branch;
  if not exists(select 1 from public.sale_pricing_program_settings)
    or (select count(*) from public.archive_settings)<>1 then
    raise exception 'Required application settings are missing.';
  end if;
  -- Fail before mutation if a kept or external table references a table to clear.
  select string_agg(conrelid::regclass::text || ' -> ' || confrelid::regclass::text, ', ')
    into unexpected from pg_constraint fk
  where fk.contype='f'
    and fk.confrelid in (select to_regclass(format('public.%I',table_name)) from reset_scope where action='clear')
    and fk.conrelid not in (select to_regclass(format('public.%I',table_name)) from reset_scope where action='clear');
  if unexpected is not null then raise exception 'Unreviewed foreign-key dependencies: %',unexpected; end if;
  -- A new external dependency must not be silently cascaded when deleting accounts/branches.
  select string_agg(conrelid::regclass::text, ', ') into unexpected from pg_constraint fk
  where fk.contype='f'
    and fk.confrelid in ('public.branches'::regclass,'public.profiles'::regclass,'auth.users'::regclass)
    and fk.conrelid not in (select to_regclass(format('public.%I',table_name)) from reset_scope)
    and not (fk.confrelid='auth.users'::regclass and fk.connamespace='auth'::regnamespace);
  if unexpected is not null then raise exception 'Unreviewed account/branch dependencies: %',unexpected; end if;
  -- SQL must not delete Storage metadata without deleting the actual objects via Storage API.
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects' into n;
    insert into reset_scope values ('storage.objects','external_storage_not_deleted',n,n);
    if not o.preview_only and n>0 then
      raise exception 'Storage contains % objects. Review/export and remove test objects through Storage first.',n;
    end if;
  end if;
  insert into reset_scope select 'auth.users','keep_accounts',count(*),null from auth.users;
  insert into reset_preserved
    select 'branches',jsonb_agg(to_jsonb(b) order by b.id) from public.branches b where id=kept_branch;
  insert into reset_preserved
    select 'profiles',jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p where id in (kept_owner,kept_manager);
  -- Kept credentials are compared in-database only, never printed in preview/results.
  insert into reset_preserved
    select 'auth.users',jsonb_agg(to_jsonb(u) order by u.id) from auth.users u where id in (kept_owner,kept_manager);
  for t in select * from reset_scope where action='keep_all' loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from public.%I x',t.table_name)
      into unexpected;
    insert into reset_preserved values(t.table_name,unexpected::jsonb);
  end loop;
end;
$reset_preflight$;

do $reset_execute$
declare
  t record;
  n bigint;
  table_list text;
  actual jsonb;
begin
  if (select preview_only from reset_options) then return; end if;
  select string_agg(format('public.%I',table_name),', ' order by table_name) into table_list
    from reset_scope where action='clear';
  -- Explicit scope, no CASCADE, no trigger disabling, no sequence resets.
  -- TRUNCATE handles immutable transaction rows without firing DELETE triggers.
  execute 'truncate table ' || table_list || ' continue identity restrict';
  delete from public.profiles where id not in (select id from reset_keep where kind in ('owner','main_manager'));
  delete from public.branches where id<>(select id from reset_keep where kind='main_branch');
  -- Auth FK cascades stay enabled for identities, sessions and other Auth dependents.
  delete from auth.users where id not in (select id from reset_keep where kind in ('owner','main_manager'));
  set constraints all immediate;
  for t in select * from reset_scope where action<>'external_storage_not_deleted' loop
    execute format('select count(*) from %s',case when t.table_name='auth.users'
      then 'auth.users' else format('public.%I',t.table_name) end) into n;
    update reset_scope set after_count=n where table_name=t.table_name;
    if (t.action='clear' and n<>0) or (t.action='keep_accounts' and n<>2)
      or (t.action='keep_main' and n<>1) then
      raise exception 'Reset verification failed for %; all changes will roll back.',t.table_name;
    end if;
  end loop;
  for t in select * from reset_preserved loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by %s),''[]''::jsonb) from %s x',
      case when t.table_name in ('branches','profiles','auth.users') then 'x.id' else 'to_jsonb(x)::text' end,
      case when t.table_name='auth.users' then 'auth.users' else format('public.%I',t.table_name) end) into actual;
    if actual is distinct from t.rows_before then
      raise exception 'Preserved records changed in %; all changes will roll back.',t.table_name;
    end if;
  end loop;
end;
$reset_execute$;

-- One result row: expand/copy the JSON fields in the SQL Editor results.
select
  case when o.preview_only then 'PREVIEW ONLY - NO DATA DELETED' else 'RESET COMPLETED' end as result,
  (select jsonb_agg(to_jsonb(k) order by kind) from reset_keep k) as records_to_keep,
  (select jsonb_agg(jsonb_build_object('table',table_name,'action',action,
    'before',before_count,'after',after_count,
    'planned_delete',case when action='clear' then before_count
      when action='keep_accounts' then before_count-2
      when action='keep_main' then before_count-1 else 0 end) order by table_name)
    from reset_scope) as table_summary
from reset_options o;
commit;
