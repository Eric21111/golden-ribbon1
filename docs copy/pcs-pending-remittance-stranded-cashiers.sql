-- Read-only preflight: stranded pending remittances
-- Run before production migration / cutover. Do NOT auto-fix.
--
-- Lists closed shifts that still require cash or inventory reconciliation
-- where the recorded cashier can no longer finalize because:
--   - profile is missing
--   - profile is inactive
--   - role is not cashier
--   - current profile.branch_id differs from shift.branch_id
--
-- Resolve manually (restore cashier assignment / complete remittance under
-- an authorized recovery path) before relying on PCS selling sessions.

select
  s.id as shift_id,
  s.branch_id as shift_branch_id,
  b.name as shift_branch_name,
  b.code as shift_branch_code,
  s.cashier_id,
  s.started_at,
  s.ended_at,
  s.sales_cutoff_at,
  s.reconciliation_required,
  s.inventory_reconciliation_required,
  p.id as profile_id,
  p.full_name as profile_name,
  p.role::text as profile_role,
  p.is_active as profile_is_active,
  p.branch_id as profile_branch_id,
  case
    when p.id is null then 'PROFILE_MISSING'
    when not p.is_active then 'PROFILE_INACTIVE'
    when p.role is distinct from 'cashier' then 'ROLE_NOT_CASHIER'
    when p.branch_id is distinct from s.branch_id then 'BRANCH_MISMATCH'
    else 'UNKNOWN'
  end as strand_reason
from public.shifts s
join public.branches b on b.id = s.branch_id
left join public.profiles p on p.id = s.cashier_id
where s.status = 'closed'
  and (
    s.reconciliation_required
    or s.inventory_reconciliation_required
  )
  and (
    p.id is null
    or not p.is_active
    or p.role is distinct from 'cashier'
    or p.branch_id is distinct from s.branch_id
  )
order by s.ended_at nulls last, s.id;
