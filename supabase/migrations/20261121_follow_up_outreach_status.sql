-- ============================================================
-- Lead Atlas — follow-up outreach status
-- Run once in Supabase Dashboard → SQL Editor → New query.
-- Safe to run again; the whole file is idempotent.
-- ============================================================

-- Projects created before the follow-up state only allow three values.
-- Replacing the check lets `follow-up` save natively.
alter table public.leads
  drop constraint if exists leads_outreach_status_check;
alter table public.leads
  add constraint leads_outreach_status_check
  check (outreach_status in ('to-contact', 'contacted', 'follow-up', 'do-not-contact'));

-- Rows written while the old check was still live kept `follow-up` in the
-- payload and wrote `contacted` natively. Promote those rows now that the
-- native column accepts the precise state.
update public.leads
set outreach_status = 'follow-up'
where outreach_status = 'contacted'
  and payload->>'outreachStatus' = 'follow-up';
