begin;

-- In-app notifications + Expo push delivery queue.
-- Events come from committed stock_transfers / stock_returns status changes (row triggers), never from
-- clients. Notification work is isolated so it can never fail the transfer or return that caused it.

-- ---------------------------------------------------------------------------
-- 1) Notifications (one row per recipient per event)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  -- Role and branch the recipient had when notified; the row is only visible while both still match.
  recipient_role public.user_role not null,
  recipient_branch_id uuid references public.branches(id) on delete cascade,
  kind text not null check (kind in ('transfer_pending', 'return_submitted')),
  entity_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 400),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_one_per_event unique (recipient_id, kind, entity_id)
);

create index notifications_unread_idx on public.notifications (recipient_id, kind) where read_at is null;

create or replace function public.can_see_notification(
  p_recipient_id uuid,
  p_recipient_role public.user_role,
  p_recipient_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_recipient_id = auth.uid() and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.role = p_recipient_role
      and p.branch_id is not distinct from p_recipient_branch_id
  );
$$;

revoke all on function public.can_see_notification(uuid, public.user_role, uuid) from public, anon;
grant execute on function public.can_see_notification(uuid, public.user_role, uuid) to authenticated;

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;

create policy "notifications_select_own_current_assignment"
on public.notifications for select to authenticated
using (public.can_see_notification(recipient_id, recipient_role, recipient_branch_id));

-- ---------------------------------------------------------------------------
-- 2) Push devices (Expo push tokens). No direct client access; RPCs only.
-- ---------------------------------------------------------------------------
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique
    check (expo_push_token ~ '^Expo(nent)?PushToken\[[^\]\s]{10,200}\]$'),
  platform text not null check (platform in ('ios', 'android')),
  enabled boolean not null default true,
  registered_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz not null default now()
);

create index push_devices_enabled_user_idx on public.push_devices (user_id) where enabled;

alter table public.push_devices enable row level security;
revoke all on table public.push_devices from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Delivery queue (one row per notification per device), processed by the push-dispatch function
-- ---------------------------------------------------------------------------
create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  -- pending -> sending -> sent (Expo ticket) -> accepted (receipt ok: handed to FCM/APNs) | failed | skipped
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'accepted', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  ticket_id text,
  sent_at timestamptz,
  receipt_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_deliveries_one_per_device unique (notification_id, device_id)
);

create index push_deliveries_due_idx on public.push_deliveries (status, next_attempt_at);

alter table public.push_deliveries enable row level security;
revoke all on table public.push_deliveries from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Wake the push-dispatch Edge Function (pg_net + Vault). No-op when not configured (and in PGlite).
-- ---------------------------------------------------------------------------
create or replace function public.request_push_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'secret_key' limit 1$q$ into v_key;
  if v_url is null or v_key is null then
    return;
  end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb, timeout_milliseconds := 10000)$q$
    using rtrim(v_url, '/') || '/functions/v1/push-dispatch',
          jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key);
exception when others then
  raise warning 'push-dispatch request was not queued: %', sqlerrm;
end;
$$;

revoke all on function public.request_push_dispatch() from public, anon, authenticated;

create or replace function public.request_push_dispatch_if_due()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.push_deliveries d
    where (d.status = 'pending' and d.next_attempt_at <= now())
       or (d.status = 'sending' and d.locked_at < now() - interval '10 minutes')
       or (d.status = 'sent' and d.receipt_checked_at is null and d.sent_at <= now() - interval '15 minutes')
  ) then
    perform public.request_push_dispatch();
  end if;
end;
$$;

revoke all on function public.request_push_dispatch_if_due() from public, anon, authenticated;

create or replace function public.push_deliveries_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from inserted) then
    perform public.request_push_dispatch();
  end if;
  return null;
end;
$$;

revoke all on function public.push_deliveries_after_insert() from public, anon, authenticated;

create trigger push_deliveries_request_dispatch
after insert on public.push_deliveries
referencing new table as inserted
for each statement execute function public.push_deliveries_after_insert();

create or replace function public.notifications_queue_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.push_deliveries (notification_id, device_id)
  select new.id, d.id
  from public.push_devices d
  where d.user_id = new.recipient_id and d.enabled
  on conflict on constraint push_deliveries_one_per_device do nothing;
  return null;
end;
$$;

revoke all on function public.notifications_queue_push() from public, anon, authenticated;

create trigger notifications_queue_push
after insert on public.notifications
for each row execute function public.notifications_queue_push();

-- ---------------------------------------------------------------------------
-- 5) Event sources: committed transfer / return status changes
-- ---------------------------------------------------------------------------
create or replace function public.notify_transfer_awaiting_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to text;
begin
  if new.status is distinct from 'pending_receipt' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'pending_receipt' then
    return null;
  end if;

  begin
    select b.name into v_from from public.branches b where b.id = new.from_branch_id;
    select b.name into v_to from public.branches b where b.id = new.to_branch_id;

    insert into public.notifications (
      recipient_id, recipient_role, recipient_branch_id, kind, entity_id, title, body
    )
    select
      p.id, p.role, p.branch_id, 'transfer_pending', new.id,
      'Incoming Shipment',
      format('New stocks from %s are awaiting receipt at %s.',
             coalesce(v_from, 'Main Branch'), coalesce(v_to, 'your branch'))
    from public.profiles p
    where p.role = 'cashier'
      and p.is_active
      and p.branch_id = new.to_branch_id
    on conflict on constraint notifications_one_per_event do nothing;
  exception when others then
    raise warning 'Incoming shipment notification skipped for transfer %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notify_transfer_awaiting_receipt() from public, anon, authenticated;

create trigger stock_transfers_notify_awaiting_receipt
after insert or update of status on public.stock_transfers
for each row execute function public.notify_transfer_awaiting_receipt();

create or replace function public.notify_return_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
begin
  if new.status is distinct from 'in_transit' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'in_transit' then
    return null;
  end if;

  begin
    v_from := coalesce(
      nullif(trim(new.from_branch_name), ''),
      (select b.name from public.branches b where b.id = new.from_branch_id),
      'A selling branch'
    );

    insert into public.notifications (
      recipient_id, recipient_role, recipient_branch_id, kind, entity_id, title, body
    )
    select
      p.id, p.role, p.branch_id, 'return_submitted', new.id,
      'Stock Return Submitted',
      case
        when coalesce(new.idempotency_key, '') like 'auto-close-%'
          then format('%s leftover stocks were returned automatically at 9:00 PM for review.', v_from)
        else format('%s has returned leftover stocks for review.', v_from)
      end
    from public.profiles p
    join public.branches b on b.id = p.branch_id
    where p.role = 'manager'
      and p.is_active
      and b.is_main_branch
      and p.branch_id = new.to_branch_id
    on conflict on constraint notifications_one_per_event do nothing;
  exception when others then
    raise warning 'Stock return notification skipped for return %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notify_return_submitted() from public, anon, authenticated;

create trigger stock_returns_notify_submitted
after insert or update of status on public.stock_returns
for each row execute function public.notify_return_submitted();

-- ---------------------------------------------------------------------------
-- 6) Client RPCs (authenticated)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_unread_notification_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'transfer_pending', count(*) filter (where n.kind = 'transfer_pending'),
    'return_submitted', count(*) filter (where n.kind = 'return_submitted')
  )
  from public.notifications n
  where n.recipient_id = auth.uid()
    and n.read_at is null
    and public.can_see_notification(n.recipient_id, n.recipient_role, n.recipient_branch_id);
$$;

revoke all on function public.get_my_unread_notification_counts() from public, anon;
grant execute on function public.get_my_unread_notification_counts() to authenticated;

create or replace function public.mark_notifications_read(p_kind text, p_entity_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('transfer_pending', 'return_submitted') then
    raise exception 'Unknown notification type.' using errcode = '22023';
  end if;

  update public.notifications n
  set read_at = now()
  where n.recipient_id = auth.uid()
    and n.kind = p_kind
    and n.read_at is null
    and (p_entity_id is null or n.entity_id = p_entity_id)
    and public.can_see_notification(n.recipient_id, n.recipient_role, n.recipient_branch_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_notifications_read(text, uuid) from public, anon;
grant execute on function public.mark_notifications_read(text, uuid) to authenticated;

create or replace function public.register_push_device(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active) then
    raise exception 'An active account is required.' using errcode = '42501';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'Unsupported device platform.' using errcode = '22023';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[^\]\s]{10,200}\]$' then
    raise exception 'Invalid push token.' using errcode = '22023';
  end if;

  -- A token identifies one app install; signing in as someone else moves it to that account.
  insert into public.push_devices (user_id, expo_push_token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (expo_push_token) do update
  set user_id = excluded.user_id,
      platform = excluded.platform,
      enabled = true,
      registered_at = now(),
      disabled_at = null,
      disabled_reason = null;
end;
$$;

revoke all on function public.register_push_device(text, text) from public, anon;
grant execute on function public.register_push_device(text, text) to authenticated;

create or replace function public.unregister_push_device(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  update public.push_devices
  set enabled = false, disabled_at = now(), disabled_reason = 'signed_out'
  where expo_push_token = p_token and user_id = auth.uid() and enabled;
end;
$$;

revoke all on function public.unregister_push_device(text) from public, anon;
grant execute on function public.unregister_push_device(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Dispatcher RPCs (service_role only; called by the push-dispatch Edge Function)
-- ---------------------------------------------------------------------------
create or replace function public.claim_push_deliveries(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- Recover batches abandoned mid-send.
  update public.push_deliveries
  set status = 'pending', locked_at = null, updated_at = now()
  where status = 'sending' and locked_at < now() - interval '10 minutes';

  -- Never push to a device that moved accounts, a signed-out device, or a recipient who is no longer
  -- active in the same role/branch; and stop retrying stale events.
  update public.push_deliveries d
  set status = 'skipped',
      locked_at = null,
      updated_at = now(),
      last_error = case
        when not dev.enabled then 'Device disabled'
        when dev.user_id <> n.recipient_id then 'Device moved to another account'
        when d.created_at < now() - interval '24 hours' then 'Expired before delivery'
        else 'Recipient no longer assigned'
      end
  from public.notifications n, public.push_devices dev
  where d.status = 'pending'
    and n.id = d.notification_id
    and dev.id = d.device_id
    and (
      not dev.enabled
      or dev.user_id <> n.recipient_id
      or d.created_at < now() - interval '24 hours'
      or not exists (
        select 1 from public.profiles p
        where p.id = n.recipient_id
          and p.is_active
          and p.role = n.recipient_role
          and p.branch_id is not distinct from n.recipient_branch_id
      )
    );

  with claimed as (
    select d.id
    from public.push_deliveries d
    where d.status = 'pending' and d.next_attempt_at <= now()
    order by d.created_at, d.id
    limit greatest(1, least(coalesce(p_limit, 100), 100))
    for update skip locked
  ),
  updated as (
    update public.push_deliveries d
    set status = 'sending', attempts = d.attempts + 1, locked_at = now(), updated_at = now()
    from claimed c, public.notifications n, public.push_devices dev
    where d.id = c.id and n.id = d.notification_id and dev.id = d.device_id
    returning d.id, dev.expo_push_token, n.id as notification_id, n.recipient_id, n.kind, n.entity_id, n.title, n.body
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', u.id,
    'to', u.expo_push_token,
    'title', u.title,
    'body', u.body,
    'data', jsonb_build_object(
      'notification_id', u.notification_id,
      'recipient_id', u.recipient_id,
      'kind', u.kind,
      'entity_id', u.entity_id,
      'url', case u.kind
        when 'transfer_pending' then '/cashier/incoming'
        else '/manager/returns/' || u.entity_id::text
      end
    )
  )), '[]'::jsonb)
  into v_result
  from updated u;

  return v_result;
end;
$$;

revoke all on function public.claim_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_push_deliveries(integer) to service_role;

-- p_results: [{ delivery_id, ticket_id? , error?, message? }] — one entry per claimed delivery.
create or replace function public.record_push_tickets(p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_attempts integer;
begin
  for r in
    select * from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb))
      as x(delivery_id uuid, ticket_id text, error text, message text)
  loop
    select attempts into v_attempts
    from public.push_deliveries
    where id = r.delivery_id and status = 'sending'
    for update;
    if not found then
      continue;
    end if;

    if r.ticket_id is not null and r.error is null then
      update public.push_deliveries
      set status = 'sent', ticket_id = r.ticket_id, sent_at = now(), locked_at = null,
          last_error = null, updated_at = now()
      where id = r.delivery_id;
    elsif r.error = 'DeviceNotRegistered' then
      update public.push_deliveries
      set status = 'failed', locked_at = null, last_error = r.error, updated_at = now()
      where id = r.delivery_id;
      update public.push_devices
      set enabled = false, disabled_at = now(), disabled_reason = 'DeviceNotRegistered'
      where id = (select device_id from public.push_deliveries where id = r.delivery_id);
    elsif r.error in ('MessageTooBig', 'InvalidProviderToken') or v_attempts >= 5 then
      update public.push_deliveries
      set status = 'failed', locked_at = null,
          last_error = left(concat_ws(': ', coalesce(r.error, 'Error'), r.message), 500), updated_at = now()
      where id = r.delivery_id;
    else
      update public.push_deliveries
      set status = 'pending', locked_at = null,
          next_attempt_at = now() + make_interval(mins => least(power(2, v_attempts)::integer, 60)),
          last_error = left(concat_ws(': ', coalesce(r.error, 'Error'), r.message), 500), updated_at = now()
      where id = r.delivery_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.record_push_tickets(jsonb) from public, anon, authenticated;
grant execute on function public.record_push_tickets(jsonb) to service_role;

create or replace function public.claim_push_receipts(p_limit integer default 300)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- Expo keeps receipts for 24 hours.
  update public.push_deliveries
  set receipt_checked_at = now(), last_error = 'Receipt unavailable after 24 hours', updated_at = now()
  where status = 'sent' and receipt_checked_at is null and sent_at < now() - interval '24 hours';

  select coalesce(jsonb_agg(jsonb_build_object('delivery_id', q.id, 'ticket_id', q.ticket_id)), '[]'::jsonb)
  into v_result
  from (
    select d.id, d.ticket_id
    from public.push_deliveries d
    where d.status = 'sent'
      and d.receipt_checked_at is null
      and d.ticket_id is not null
      and d.sent_at <= now() - interval '15 minutes'
    order by d.sent_at
    limit greatest(1, least(coalesce(p_limit, 300), 1000))
  ) q;
  return v_result;
end;
$$;

revoke all on function public.claim_push_receipts(integer) from public, anon, authenticated;
grant execute on function public.claim_push_receipts(integer) to service_role;

-- p_results: [{ delivery_id, status: 'ok' | 'error', error?, message? }]; omitted ids are retried later.
create or replace function public.record_push_receipts(p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_attempts integer;
begin
  for r in
    select * from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb))
      as x(delivery_id uuid, status text, error text, message text)
  loop
    select attempts into v_attempts
    from public.push_deliveries
    where id = r.delivery_id and status = 'sent'
    for update;
    if not found then
      continue;
    end if;

    if r.status = 'ok' then
      update public.push_deliveries
      set status = 'accepted', receipt_checked_at = now(), updated_at = now()
      where id = r.delivery_id;
    elsif r.error = 'DeviceNotRegistered' then
      update public.push_deliveries
      set status = 'failed', receipt_checked_at = now(), last_error = r.error, updated_at = now()
      where id = r.delivery_id;
      update public.push_devices
      set enabled = false, disabled_at = now(), disabled_reason = 'DeviceNotRegistered'
      where id = (select device_id from public.push_deliveries where id = r.delivery_id);
    elsif r.error = 'MessageRateExceeded' and v_attempts < 5 then
      update public.push_deliveries
      set status = 'pending', ticket_id = null, sent_at = null,
          next_attempt_at = now() + make_interval(mins => least(power(2, v_attempts)::integer, 60)),
          last_error = r.error, updated_at = now()
      where id = r.delivery_id;
    else
      update public.push_deliveries
      set status = 'failed', receipt_checked_at = now(),
          last_error = left(concat_ws(': ', coalesce(r.error, 'Error'), r.message), 500), updated_at = now()
      where id = r.delivery_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.record_push_receipts(jsonb) from public, anon, authenticated;
grant execute on function public.record_push_receipts(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8) Realtime for badge updates (RLS applies to subscribers) and a 1-minute retry/receipt sweep.
-- ---------------------------------------------------------------------------
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when others then
  null;
end;
$realtime$;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'push-dispatch-sweep';
    perform cron.schedule('push-dispatch-sweep', '* * * * *', $job$select public.request_push_dispatch_if_due()$job$);
  end if;
exception when others then
  null;
end;
$cron$;

commit;
