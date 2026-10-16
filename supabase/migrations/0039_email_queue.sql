-- 6E: Email queue DB (spec §15.5 issuance notification, §23 email dispatch).
--
-- The spec:
--   §15.5 "Issue. The report is issued … The email is queued." Dispatch itself is out of scope
--          (NOT-DONE §email-dispatch).
--
-- Reuse (grep first, M1): `email_settings` already exists (0032_org_admin_settings.sql) with
-- `org_id PK, provider, provider_config, from_address, updated_at`, a platform-only policy and a
-- column-level grant that hides `provider_config` from tenant roles. This migration does not touch it.
-- `email_outbox` (0005) is the legacy demo queue; the real queue is created here as `email_queue`.

create table if not exists email_queue (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  to_addresses text[] not null default '{}',
  subject text not null,
  body_html text,
  body_text text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error_text text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists email_queue_org_idx on email_queue (org_id, status, created_at);

-- ---------------------------------------------------------------------------
-- queue_email: the single way a row enters the queue. Security definer so an org RPC (issuance) can
-- queue a message without the caller holding a table privilege. Returns the queue id.
-- ---------------------------------------------------------------------------
create or replace function public.queue_email(
  p_org_id uuid, p_to_addresses text[], p_subject text, p_body_html text,
  p_body_text text, p_metadata jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_org_id is null then
    raise exception 'org is required' using errcode = 'P0001';
  end if;
  insert into email_queue (org_id, to_addresses, subject, body_html, body_text, metadata)
  values (p_org_id, coalesce(p_to_addresses, '{}'), p_subject, p_body_html, p_body_text,
          coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security. An org sees only its own dispatched (sent/failed) rows; pending rows belong to
-- the platform dispatcher and are invisible to the org. The platform role sees every row.
-- ---------------------------------------------------------------------------
alter table email_queue enable row level security;

drop policy if exists email_queue_org_select on email_queue;
create policy email_queue_org_select on email_queue for select to authenticated
  using (org_id = public.jwt_org_id() and status in ('sent', 'failed'));

drop policy if exists email_queue_platform_select on email_queue;
create policy email_queue_platform_select on email_queue for select to authenticated
  using (public.is_platform_admin());

-- No insert/update/delete policy: rows enter through queue_email (definer) and are dispatched by the
-- platform role. Revoke the write privileges outright so nothing can bypass the RPC.
revoke insert, update, delete on public.email_queue from public, anon, authenticated;

drop trigger if exists email_queue_pin_org on email_queue;
create trigger email_queue_pin_org before insert on email_queue
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- Grants: the queue helper is callable by org RPCs (issuance) and by the platform.
-- ---------------------------------------------------------------------------
revoke execute on function public.queue_email(uuid, text[], text, text, text, jsonb) from public, anon;
grant execute on function public.queue_email(uuid, text[], text, text, text, jsonb) to authenticated;
