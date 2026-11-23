-- Archive products (separate from Enable/Disable) and delete unused branches.
-- Version 20261118000000 sits before the unfinished fractional migrations (20261123120000–20261123150000)
-- so this file can be applied on its own. It does not enable half-step stock or depend on those files.
-- Forward-only. Does not rewrite deployed migrations, sales, stock movements, or fractional quantity rules.
-- Catalog rows (variants, prices, a product's own recipes) may still cascade when a product row is removed.
-- Historical sales, movements, remittances, and audit rows stay ON DELETE RESTRICT / NO ACTION.
-- No explicit BEGIN/COMMIT: the Supabase CLI wraps this file in one transaction.

alter table public.products
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

comment on column public.products.archived_at is
  'When set, the product is archived. is_active is left as it was so restore puts back the previous Enabled/Disabled status. Hidden from Products, POS, and new stock operations. Stock, recipes, and history stay.';

comment on column public.products.archived_by is
  'Main Branch Manager who archived the product. Cleared on restore. Null if that profile is later removed.';

create index if not exists products_archived_at_idx
  on public.products (archived_at)
  where archived_at is not null;

-- Notifications used ON DELETE CASCADE, which would erase notice history with a branch.
-- Audit rows used ON DELETE SET NULL, which would drop the branch from history.
-- Catalog cascades on products are unchanged so existing product cleanup still removes only that product's own setup rows.
do $fk$
declare
  r record;
  def text;
begin
  for r in
    select con.oid, con.conname, n.nspname as schema_name, c.relname as table_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'public.branches'::regclass
      and n.nspname = 'public'
      and c.relname in ('notifications', 'audit_logs')
      and con.confdeltype in ('c', 'n')
  loop
    def := pg_get_constraintdef(r.oid);
    def := replace(def, 'ON DELETE CASCADE', 'ON DELETE RESTRICT');
    def := replace(def, 'ON DELETE SET NULL', 'ON DELETE RESTRICT');
    execute format('alter table %I.%I drop constraint %I', r.schema_name, r.table_name, r.conname);
    execute format('alter table %I.%I add constraint %I %s', r.schema_name, r.table_name, r.conname, def);
  end loop;
end
$fk$;

create or replace function public.product_is_archived(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.archived_at is not null from public.products p where p.id = p_product_id),
    false
  );
$$;

revoke all on function public.product_is_archived(uuid) from public, anon, authenticated;

-- Names of business records that must be kept. Own catalog rows of a product are not retention:
-- variants, branch prices, and that product's own recipe or drink rows are removed with it.
create or replace function public.retention_reference_summary(p_parent regclass, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_count bigint;
  v_parts text[] := array[]::text[];
  v_label text;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name, a.attname as column_name
    from pg_constraint con
    join lateral unnest(con.conkey, con.confkey) as cols(src_att, dst_att) on true
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = cols.src_att
    join pg_attribute parent_att on parent_att.attrelid = con.confrelid and parent_att.attnum = cols.dst_att
    where con.contype = 'f'
      and con.confrelid = p_parent
      and n.nspname = 'public'
      and parent_att.attname = 'id'
  loop
    if p_parent = 'public.products'::regclass and (r.table_name, r.column_name) in (
      ('product_variants', 'product_id'),
      ('branch_products', 'product_id'),
      ('branch_product_variants', 'product_id'),
      ('product_stock_uses', 'product_id'),
      ('product_drink_choices', 'product_id')
    ) then
      continue;
    end if;

    if p_parent = 'public.products'::regclass
       and r.table_name = 'product_stock_uses'
       and r.column_name = 'ingredient_product_id' then
      select count(*) into v_count
      from public.product_stock_uses u
      where u.ingredient_product_id = p_id
        and u.product_id <> p_id;
    elsif p_parent = 'public.products'::regclass
       and r.table_name = 'product_drink_choices'
       and r.column_name = 'drink_product_id' then
      select count(*) into v_count
      from public.product_drink_choices d
      where d.drink_product_id = p_id
        and d.product_id <> p_id;
    else
      execute format(
        'select count(*) from %I.%I where %I = $1',
        r.schema_name, r.table_name, r.column_name
      ) into v_count using p_id;
    end if;

    if v_count > 0 then
      v_label := case r.table_name
        when 'branch_inventory' then 'inventory balances'
        when 'inventory_movements' then 'inventory movements'
        when 'sale_items' then 'sales'
        when 'sales' then 'sales'
        when 'stock_transfer_items' then 'transfers'
        when 'stock_transfers' then 'transfers'
        when 'stock_return_items' then 'returns'
        when 'stock_returns' then 'returns'
        when 'transfer_discrepancies' then 'discrepancies'
        when 'return_discrepancies' then 'discrepancies'
        when 'profiles' then 'assigned employees'
        when 'shifts' then 'shifts'
        when 'shift_reconciliations' then 'remittances'
        when 'shift_waste_occurrences' then 'waste records'
        when 'shift_product_reconciliations' then 'shift counts'
        when 'shift_product_close_baselines' then 'shift counts'
        when 'product_stock_uses' then 'recipes'
        when 'product_variants' then 'variants'
        when 'product_drink_choices' then 'drink choices'
        when 'branch_products' then 'product catalog'
        when 'branch_product_variants' then 'product catalog'
        when 'daily_product_sales_summary' then 'sales summaries'
        when 'daily_branch_sales_summary' then 'sales summaries'
        when 'notifications' then 'notifications'
        when 'audit_logs' then 'audit history'
        when 'pcs_cutover_product_snapshots' then 'inventory history'
        when 'kg_meal_cutover_balance_snapshots' then 'inventory history'
        else replace(r.table_name, '_', ' ')
      end;
      if not v_label = any (v_parts) then
        v_parts := array_append(v_parts, v_label);
      end if;
    end if;
  end loop;

  if coalesce(array_length(v_parts, 1), 0) = 0 then
    return null;
  end if;
  return array_to_string(v_parts, ', ');
end;
$$;

revoke all on function public.retention_reference_summary(regclass, uuid) from public, anon, authenticated;

create or replace function public.guard_archived_product_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.product_archive_rpc', true) = 'on' then
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at then
    raise exception 'Archive status can only be changed by archive_product or restore_product.'
      using errcode = '42501';
  end if;
  if old.archived_at is not null then
    raise exception 'Archived products cannot be changed. Restore the product first.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists products_guard_archived_update on public.products;
create trigger products_guard_archived_update
before update on public.products
for each row execute function public.guard_archived_product_update();

revoke all on function public.guard_archived_product_update() from public, anon, authenticated;

-- Blocks every delete path when history or another product's recipe must be kept.
-- "violates" stays in the message so existing direct-delete checks still recognize a retention failure.
-- Catalog-only products remain deletable here; the app RPC also requires the product to be archived.
create or replace function public.guard_product_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  v_reason := public.retention_reference_summary('public.products'::regclass, old.id);
  if v_reason is not null then
    raise exception 'Cannot delete this product because records must be kept (%). Restore it instead of deleting it. This violates retention.', v_reason
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists products_guard_delete on public.products;
create trigger products_guard_delete
before delete on public.products
for each row execute function public.guard_product_delete();

revoke all on function public.guard_product_delete() from public, anon, authenticated;

create or replace function public.reject_archived_product_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived boolean := false;
  v_drink_archived boolean := false;
begin
  -- Lock the product so archive (inventory rows first, then the product — same order as
  -- lock_branch_inventory_gate + confirm_sale) cannot commit under an in-flight stock write.
  if new.product_id is not null then
    select p.archived_at is not null into v_archived
    from public.products p
    where p.id = new.product_id
    for update;
  end if;
  if tg_table_name = 'sale_items' then
    if new.drink_product_id is not null then
      select p.archived_at is not null into v_drink_archived
      from public.products p
      where p.id = new.drink_product_id
      for update;
    end if;
  end if;
  v_archived := coalesce(v_archived, false);
  v_drink_archived := coalesce(v_drink_archived, false);

  if tg_table_name = 'sale_items' then
    if tg_op = 'INSERT' and (v_archived or v_drink_archived) then
      raise exception 'Archived products cannot be sold.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'stock_transfer_items' then
    if tg_op = 'INSERT' and v_archived then
      raise exception 'Archived products cannot be added to a transfer.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'stock_return_items' then
    if tg_op = 'INSERT' and v_archived then
      raise exception 'Archived products cannot be added to a return.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'branch_inventory' then
    if tg_op = 'INSERT' and v_archived then
      raise exception 'Archived products cannot be used for new stock operations.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'inventory_movements' and v_archived then
    -- Positive adjustments include item voids. Allowing them would put stock back onto an
    -- archived product that cashier and manager lists hide. Waste / unsold (quantity <= 0) stay allowed.
    if new.movement_type in ('sale', 'opening_stock', 'transfer_in', 'transfer_out', 'return_in', 'return_out')
       or (new.movement_type = 'adjustment' and new.quantity > 0)
       or (new.movement_type = 'adjustment' and new.reference_type = 'local_purchase')
       or (new.movement_type = 'adjustment' and new.stock_count_correction is not null) then
      if new.movement_type = 'adjustment'
         and new.quantity > 0
         and new.reference_type = 'adjustment'
         and coalesce(new.notes, '') like 'Item void%' then
        raise exception 'Restore this product before voiding a sale that returns its stock.'
          using errcode = '42501';
      end if;
      raise exception 'Archived products cannot be used for new stock operations.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sale_items_reject_archived on public.sale_items;
create trigger sale_items_reject_archived
before insert on public.sale_items
for each row execute function public.reject_archived_product_operation();

drop trigger if exists stock_transfer_items_reject_archived on public.stock_transfer_items;
create trigger stock_transfer_items_reject_archived
before insert on public.stock_transfer_items
for each row execute function public.reject_archived_product_operation();

drop trigger if exists stock_return_items_reject_archived on public.stock_return_items;
create trigger stock_return_items_reject_archived
before insert on public.stock_return_items
for each row execute function public.reject_archived_product_operation();

drop trigger if exists branch_inventory_reject_archived_insert on public.branch_inventory;
create trigger branch_inventory_reject_archived_insert
before insert on public.branch_inventory
for each row execute function public.reject_archived_product_operation();

drop trigger if exists inventory_movements_reject_archived on public.inventory_movements;
create trigger inventory_movements_reject_archived
before insert on public.inventory_movements
for each row execute function public.reject_archived_product_operation();

revoke all on function public.reject_archived_product_operation() from public, anon, authenticated;

-- Main Branch is refused with the existing wording. Other branches are refused when history must stay.
create or replace function public.guard_branch_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if old.is_main_branch then
    raise exception 'The Main Branch cannot be deleted.' using errcode = '55000';
  end if;
  v_reason := public.retention_reference_summary('public.branches'::regclass, old.id);
  if v_reason is not null then
    raise exception 'Cannot delete this branch because records must be kept (%). Deactivate the branch instead.', v_reason
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists branches_guard_delete on public.branches;
create trigger branches_guard_delete
before delete on public.branches
for each row execute function public.guard_branch_delete();

revoke all on function public.guard_branch_delete() from public, anon, authenticated;

create or replace function public.archive_product(p_product_id uuid)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_names text;
  v_pending boolean;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  -- Same order as confirm_sale / void / transfer: inventory rows first, then the product.
  -- Product-first would deadlock with lock_branch_inventory_gate. Order by branch for a stable wait graph.
  perform 1
  from public.branch_inventory
  where product_id = p_product_id
  order by branch_id
  for update;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'This product was already deleted or could not be found.' using errcode = 'P0002';
  end if;
  -- Repeated archive is the same product, not a second copy and not a status change.
  if v_product.archived_at is not null then
    return v_product;
  end if;

  select string_agg(distinct parent.name, ', ' order by parent.name)
  into v_names
  from (
    select p.name
    from public.product_stock_uses u
    join public.products p on p.id = u.product_id
    where u.ingredient_product_id = p_product_id
      and u.product_id <> p_product_id
      and p.archived_at is null
    union
    select p.name
    from public.product_drink_choices d
    join public.products p on p.id = d.product_id
    where d.drink_product_id = p_product_id
      and d.product_id <> p_product_id
      and p.archived_at is null
  ) parent;

  if v_names is not null then
    raise exception 'Cannot archive this product while other products still use it in a recipe: %.', v_names
      using errcode = '23503';
  end if;

  -- Read-only. Do not waste, transfer, or delete the balance. The caller has to resolve it.
  select string_agg(label, '; ' order by label)
  into v_names
  from (
    select b.name || ': ' || concat_ws(', ',
      case when i.quantity_on_hand > 0 then
        regexp_replace(regexp_replace(i.quantity_on_hand::text, '0+$', ''), '\.$', '') || ' on hand'
      end,
      case when i.quantity_awaiting_return > 0 then
        regexp_replace(regexp_replace(i.quantity_awaiting_return::text, '0+$', ''), '\.$', '') || ' awaiting return'
      end
    ) as label
    from public.branch_inventory i
    join public.branches b on b.id = i.branch_id
    where i.product_id = p_product_id
      and (i.quantity_on_hand > 0 or i.quantity_awaiting_return > 0)
  ) balances;
  if v_names is not null then
    raise exception 'Cannot archive this product while stock remains. Resolve % before archiving. Stock is not removed automatically.', v_names
      using errcode = '23503';
  end if;

  select exists (
    select 1
    from public.stock_transfer_items i
    join public.stock_transfers t on t.id = i.stock_transfer_id
    where i.product_id = p_product_id
      and t.status in ('draft', 'pending_receipt')
    union all
    select 1
    from public.stock_return_items i
    join public.stock_returns t on t.id = i.stock_return_id
    where i.product_id = p_product_id
      and t.status in ('draft', 'in_transit')
    union all
    select 1
    from public.transfer_discrepancies d
    where d.product_id = p_product_id
      and d.status = 'open'
    union all
    select 1
    from public.return_discrepancies d
    where d.product_id = p_product_id
      and d.status = 'open'
  ) into v_pending;

  if v_pending then
    raise exception 'Cannot archive this product while a transfer, return, held return, or discrepancy is still open.'
      using errcode = '23503';
  end if;

  perform set_config('app.product_archive_rpc', 'on', true);
  update public.products
  set archived_at = now(),
      archived_by = auth.uid()
  where id = p_product_id
  returning * into v_product;
  perform set_config('app.product_archive_rpc', 'off', true);
  return v_product;
end;
$$;

create or replace function public.restore_product(p_product_id uuid)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_names text;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'This product was already deleted or could not be found.' using errcode = 'P0002';
  end if;
  if v_product.archived_at is null then
    return v_product;
  end if;

  -- Enabled products become usable again. Refuse while a recipe still points at an archived item.
  -- A product that was Disabled stays Disabled and is not made sellable.
  if v_product.is_active then
    select string_agg(distinct item.name, ', ' order by item.name)
    into v_names
    from (
      select ingredient.name
      from public.product_stock_uses u
      join public.products ingredient on ingredient.id = u.ingredient_product_id
      where u.product_id = p_product_id
        and ingredient.archived_at is not null
      union
      select drink.name
      from public.product_drink_choices d
      join public.products drink on drink.id = d.drink_product_id
      where d.product_id = p_product_id
        and drink.archived_at is not null
    ) item;
    if v_names is not null then
      raise exception 'Cannot restore this product until archived items it uses are restored: %.', v_names
        using errcode = '23503';
    end if;
  end if;

  perform set_config('app.product_archive_rpc', 'on', true);
  update public.products
  set archived_at = null,
      archived_by = null
  where id = p_product_id
  returning * into v_product;
  perform set_config('app.product_archive_rpc', 'off', true);
  return v_product;
end;
$$;

create or replace function public.delete_archived_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_reason text;
begin
  if not public.is_main_branch_manager() then
    raise exception 'Unauthorized: Main Branch Manager access is required.' using errcode = '42501';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'This product was already deleted.' using errcode = 'P0002';
  end if;
  if v_product.archived_at is null then
    raise exception 'Only archived products can be deleted.' using errcode = '42501';
  end if;

  v_reason := public.retention_reference_summary('public.products'::regclass, p_product_id);
  if v_reason is not null then
    raise exception 'Cannot delete this product because records must be kept (%). Restore it instead of deleting it.', v_reason
      using errcode = '23503';
  end if;

  delete from public.products where id = p_product_id;
end;
$$;

create or replace function public.delete_branch(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_reason text;
begin
  if not public.is_owner() then
    raise exception 'Unauthorized: Owner access is required.' using errcode = '42501';
  end if;

  select * into v_branch
  from public.branches
  where id = p_branch_id
  for update;
  if not found then
    raise exception 'This branch was already deleted.' using errcode = 'P0002';
  end if;
  if v_branch.is_main_branch then
    raise exception 'The Main Branch cannot be deleted.' using errcode = '55000';
  end if;

  v_reason := public.retention_reference_summary('public.branches'::regclass, p_branch_id);
  if v_reason is not null then
    raise exception 'Cannot delete this branch because records must be kept (%). Deactivate the branch instead.', v_reason
      using errcode = '23503';
  end if;

  delete from public.branches where id = p_branch_id;
end;
$$;

revoke all on function public.archive_product(uuid) from public, anon;
revoke all on function public.restore_product(uuid) from public, anon;
revoke all on function public.delete_archived_product(uuid) from public, anon;
revoke all on function public.delete_branch(uuid) from public, anon;
grant execute on function public.archive_product(uuid) to authenticated;
grant execute on function public.restore_product(uuid) to authenticated;
grant execute on function public.delete_archived_product(uuid) to authenticated;
grant execute on function public.delete_branch(uuid) to authenticated;

comment on function public.archive_product(uuid) is
  'Main Branch Manager only. Hides a product without changing is_active, stock, recipes, or history. Refuses while any branch still has stock or a held return, while another live product uses it, or while a transfer, return, or discrepancy is still open.';
comment on function public.restore_product(uuid) is
  'Main Branch Manager only. Clears archive on the same product row and keeps the previous Enabled/Disabled status. Refuses to make an enabled product usable while its recipe items are still archived.';
comment on function public.delete_archived_product(uuid) is
  'Main Branch Manager only. Permanently deletes an archived product with no retained business records. Does not cascade through sales or stock movements.';
comment on function public.delete_branch(uuid) is
  'Owner only. Permanently deletes a selling branch with no retained records. The Main Branch and any branch with employees, stock, sales, or other history cannot be deleted.';

-- Cashiers and selling-branch staff no longer see archived products. Owners and the Main Branch Manager still can,
-- so reports and Archived Products keep the name, SKU, and history.
drop policy if exists "products_select_active_staff" on public.products;
create policy "products_select_active_staff"
on public.products for select
to authenticated
using (
  public.is_owner()
  or public.is_main_branch_manager()
  or (
    archived_at is null
    and public.current_user_role() in ('manager', 'cashier')
    and is_active
  )
);

-- Hide archived products from cashier selling and from pickers for new stock operations.
-- Reporting functions are left unchanged so past sales still resolve.
do $patch$
declare
  def text;
begin
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
end
$patch$;
