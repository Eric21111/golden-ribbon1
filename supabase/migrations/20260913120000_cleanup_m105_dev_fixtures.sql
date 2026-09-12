begin;

create or replace function public.block_immutable_record_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.protect_sale_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.protect_stock_return_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.protect_completed_transfer_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $clean$
begin
  create temporary table m105_users(id uuid primary key) on commit drop;
  insert into m105_users(id)
  select u.id
  from auth.users u
  where u.email ~* '^m105\.[a-z0-9-]+\.[0-9]{8}@example\.com$';

  create temporary table m105_products(id uuid primary key) on commit drop;
  insert into m105_products(id)
  select id from public.products
  where sku ~* '^m105-' or name ~* '^m105 ';

  if exists (
    select 1
    from public.inventory_movements im
    where im.created_by in (select id from m105_users)
      and im.product_id not in (select id from m105_products)
  ) then
    raise exception 'Cleanup blocked: M105 users have inventory movements on non-fixture products.';
  end if;

  if exists (
    select 1
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    where s.cashier_id in (select id from m105_users)
      and si.product_id not in (select id from m105_products)
  ) then
    raise exception 'Cleanup blocked: M105 users have sales on non-fixture products.';
  end if;

  create temporary table m105_transfers(id uuid primary key) on commit drop;
  insert into m105_transfers(id)
  select distinct st.id
  from public.stock_transfers st
  where st.created_by in (select id from m105_users)
     or st.sent_by in (select id from m105_users)
     or st.received_by in (select id from m105_users)
     or exists (
       select 1 from public.stock_transfer_items sti
       where sti.stock_transfer_id = st.id
         and sti.product_id in (select id from m105_products)
     );

  create temporary table m105_returns(id uuid primary key) on commit drop;
  insert into m105_returns(id)
  select distinct sr.id
  from public.stock_returns sr
  where sr.created_by in (select id from m105_users)
     or sr.returned_by in (select id from m105_users)
     or sr.received_by in (select id from m105_users)
     or exists (
       select 1 from public.stock_return_items sri
       where sri.stock_return_id = sr.id
         and sri.product_id in (select id from m105_products)
     );

  create temporary table m105_sales(id uuid primary key) on commit drop;
  insert into m105_sales(id)
  select s.id
  from public.sales s
  where s.cashier_id in (select id from m105_users)
     or exists (
       select 1 from public.sale_items si
       where si.sale_id = s.id
         and si.product_id in (select id from m105_products)
     );

  create temporary table m105_shifts(id uuid primary key) on commit drop;
  insert into m105_shifts(id)
  select s.id
  from public.shifts s
  where s.cashier_id in (select id from m105_users);

  delete from public.transfer_discrepancies
  where stock_transfer_id in (select id from m105_transfers);
  delete from public.stock_transfer_items
  where stock_transfer_id in (select id from m105_transfers);
  delete from public.stock_transfers
  where id in (select id from m105_transfers);

  delete from public.return_discrepancies
  where stock_return_id in (select id from m105_returns);
  delete from public.stock_return_items
  where stock_return_id in (select id from m105_returns);
  delete from public.stock_returns
  where id in (select id from m105_returns);

  delete from public.sale_items
  where sale_id in (select id from m105_sales);
  delete from public.sales
  where id in (select id from m105_sales);
  delete from public.shifts
  where id in (select id from m105_shifts);

  delete from public.inventory_movements
  where product_id in (select id from m105_products)
     or created_by in (select id from m105_users);
  delete from public.branch_inventory
  where product_id in (select id from m105_products);
  delete from public.products
  where id in (select id from m105_products);

  delete from public.profiles
  where id in (select id from m105_users);
  delete from auth.users
  where id in (select id from m105_users);
end
$clean$;

create or replace function public.block_immutable_record_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
end;
$$;

create or replace function public.protect_sale_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Completed sale history is immutable.' using errcode = '55000';
end;
$$;

create or replace function public.protect_stock_return_items()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

create or replace function public.protect_completed_transfer_items()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

create or replace function public.cleanup_isolated_test_products(p_product_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    return 0;
  end if;
  if exists (
    select 1
    from unnest(p_product_ids) as product_id
    where not exists (
      select 1
      from public.products p
      where p.id = product_id
        and (p.sku ~* '^m105-' or p.name ~* '^m105 ')
    )
  ) then
    raise exception 'Only isolated M105 test products can be cleaned.' using errcode = '42501';
  end if;

  execute $sql$
    create or replace function public.block_immutable_record_changes()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_sale_history()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_stock_return_items()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_completed_transfer_items()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $fn$
  $sql$;

  delete from public.transfer_discrepancies
  where stock_transfer_id in (
    select stock_transfer_id from public.stock_transfer_items where product_id = any(p_product_ids)
  );
  delete from public.stock_transfer_items where product_id = any(p_product_ids);
  delete from public.stock_transfers st
  where not exists (select 1 from public.stock_transfer_items sti where sti.stock_transfer_id = st.id)
    and exists (
      select 1 from public.inventory_movements im
      where im.reference_id = st.id and im.product_id = any(p_product_ids)
    );

  delete from public.return_discrepancies
  where stock_return_id in (
    select stock_return_id from public.stock_return_items where product_id = any(p_product_ids)
  );
  delete from public.stock_return_items where product_id = any(p_product_ids);
  delete from public.stock_returns sr
  where not exists (select 1 from public.stock_return_items sri where sri.stock_return_id = sr.id)
    and exists (
      select 1 from public.inventory_movements im
      where im.reference_id = sr.id and im.product_id = any(p_product_ids)
    );

  delete from public.sale_items where product_id = any(p_product_ids);
  delete from public.sales s
  where not exists (select 1 from public.sale_items si where si.sale_id = s.id)
    and (
      s.sale_number like 'SALE-M105-%'
      or exists (
        select 1 from public.inventory_movements im
        where im.reference_id = s.id and im.product_id = any(p_product_ids)
      )
    );

  delete from public.inventory_movements where product_id = any(p_product_ids);
  delete from public.branch_inventory where product_id = any(p_product_ids);
  delete from public.products where id = any(p_product_ids);
  get diagnostics v_count = row_count;

  execute $sql$
    create or replace function public.block_immutable_record_changes()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      raise exception 'Completed inventory audit records are immutable.' using errcode = '55000';
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_sale_history()
    returns trigger language plpgsql set search_path = '' as $fn$
    begin
      raise exception 'Completed sale history is immutable.' using errcode = '55000';
    end;
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_stock_return_items()
    returns trigger language plpgsql set search_path = '' as $fn$
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
    $fn$
  $sql$;
  execute $sql$
    create or replace function public.protect_completed_transfer_items()
    returns trigger language plpgsql set search_path = '' as $fn$
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
    $fn$
  $sql$;

  return v_count;
end;
$$;

revoke all on function public.cleanup_isolated_test_products(uuid[]) from public, anon, authenticated;
grant execute on function public.cleanup_isolated_test_products(uuid[]) to service_role;

commit;
