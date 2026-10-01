-- Revision 7 Final Hardening Patch 2
-- Forward-only. Do not edit 7A/7B/7C or 20260928150200.
-- close_overdue_shifts: never swallow unexpected errors (including deadlocks).
begin;

create or replace function public.close_overdue_shifts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now_manila          timestamp;
  v_cutoff_manila_date  date;
  v_cutoff              timestamptz;
  v_rec                 record;
  v_closed_count        integer := 0;
begin
  v_now_manila := timezone('Asia/Manila', now());
  if v_now_manila < (v_now_manila::date + time '21:00') then
    v_cutoff_manila_date := v_now_manila::date - 1;
  else
    v_cutoff_manila_date := v_now_manila::date;
  end if;
  v_cutoff := (v_cutoff_manila_date + time '21:00') at time zone 'Asia/Manila';

  -- Discover candidates without locking. begin_shift_close_core owns:
  -- branch → exact target shift → inventory → writes.
  for v_rec in
    select s.id, s.cashier_id
    from public.shifts s
    where s.status = 'open'
      and s.started_at < v_cutoff
    order by s.started_at, s.id
  loop
    -- Propagate unexpected failures (deadlock, serialization, integrity, etc.).
    -- Idempotent begin_shift_close_core races (already begun/closed) do not raise.
    perform public.begin_shift_close_core(v_rec.id, v_rec.cashier_id);
    v_closed_count := v_closed_count + 1;
  end loop;

  return jsonb_build_object(
    'closed_count', v_closed_count,
    'leftover_return_count', 0,
    'cutoff_at', v_cutoff
  );
end;
$$;

revoke all on function public.close_overdue_shifts() from public, anon, authenticated;

comment on function public.close_overdue_shifts() is
  'Auto-close overdue open shifts via begin_shift_close_core. Candidate discovery is unlocked; unexpected errors propagate.';

commit;
