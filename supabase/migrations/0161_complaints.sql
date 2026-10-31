-- 0161 (S4): D12 — complaint management. A coded, first-class issue path, not a mailto.
--
-- docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md D12 is the specification. A non-green readiness signal
-- carries a "Contact Super Admin" action that opens this flow with the whole issue auto-generated and
-- attached. The complaint is org-scoped and RLS-guarded, its code is human-readable, and its event log
-- is append-only (L5).
--
-- What this adds:
--   1. complaint_counters — one atomic counter per org, so a code is unique without a global sequence.
--   2. complaints — the issue: a code, a severity, the signal it came from, the auto-generated log
--      bundle, its status and its assignee.
--   3. complaint_events — the append-only trail: created, assigned, commented, resolved, reopened.
--   4. complaint_create / org_complaint_create — mint the code, build the bundle, record the event,
--      and email the platform administrators. The complaint is recorded BEFORE the email is queued, so
--      a failed send never loses the issue.
--   5. complaint_assign / complaint_comment / complaint_resolve — the lifecycle, each with a reason
--      (config-as-ledger) and each recorded.
--   6. complaint_list / complaint_get — the read path, org-scoped for a tenant and platform-wide for
--      the platform role.
--
-- Laws honoured: L1 (deterministic code minting and bundle assembly; no model), L2 (RLS +
-- jwt_org_id(); a tenant reads only its own complaints; the platform role reads all), L5 (the event
-- log is append-only; a resolve carries a reason). M1: every name below is new. M2: additive only.
-- M6: applied twice and every SQL test runs twice by the harness.

-- ---------------------------------------------------------------------------
-- 1. The per-org counter. An atomic increment mints the next number; a global sequence would leak
--    the platform's total issue volume across tenants, which L2 forbids.
-- ---------------------------------------------------------------------------
create table if not exists complaint_counters (
  org_id uuid primary key references orgs(id) on delete cascade,
  n int not null default 0
);
-- Internal only: minted through the security-definer RPC, never read or written directly.
alter table complaint_counters enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The complaint. The bundle is the auto-generated evidence: the failed check, its reason, the
--    environment layer, the readiness output and the relevant state. Never free-text only.
-- ---------------------------------------------------------------------------
create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  code text not null,
  severity text not null default 'warning' check (severity in ('critical', 'warning')),
  source_signal text,
  title text not null,
  body text not null default '',
  bundle jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'assigned', 'resolved')),
  created_by uuid,
  assigned_to uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_reason text,
  unique (org_id, code)
);
create index if not exists complaints_org_idx on complaints (org_id, status, created_at desc);

alter table complaints enable row level security;
drop policy if exists complaints_select on complaints;
create policy complaints_select on complaints for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists complaints_pin_org on complaints;
create trigger complaints_pin_org before insert on complaints
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 3. The event log. Append-only: no update or delete policy, so a written event cannot be rewritten.
-- ---------------------------------------------------------------------------
create table if not exists complaint_events (
  id bigint generated always as identity primary key,
  complaint_id uuid not null references complaints(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('created', 'assigned', 'commented', 'resolved', 'reopened', 'emailed')),
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);
create index if not exists complaint_events_complaint_idx on complaint_events (complaint_id, ts);

alter table complaint_events enable row level security;
drop policy if exists complaint_events_select on complaint_events;
create policy complaint_events_select on complaint_events for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists complaint_events_pin_org on complaint_events;
create trigger complaint_events_pin_org before insert on complaint_events
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 4. The code. PRV-<short>-<NNNN>: deterministic, org-scoped, minted from the org's own counter.
-- ---------------------------------------------------------------------------
create or replace function public.mint_complaint_code(p_org uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
  v_short text;
begin
  insert into complaint_counters (org_id, n) values (p_org, 1)
  on conflict (org_id) do update set n = complaint_counters.n + 1
  returning n into v_n;
  v_short := upper(substring(replace(p_org::text, '-', '') from 1 for 6));
  return 'PRV-' || v_short || '-' || lpad(v_n::text, 4, '0');
end $$;

comment on function public.mint_complaint_code(uuid) is
  'D12: mint the next human-readable complaint code for an organisation. Atomic per org.';

-- ---------------------------------------------------------------------------
-- 5. The bundle. Built from the readiness output so the complaint carries the evidence, not a claim.
-- ---------------------------------------------------------------------------
create or replace function public.build_complaint_bundle(p_org uuid, p_signals text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_all jsonb := public.platform_readiness_signals(p_org);
  v_selected jsonb;
begin
  select coalesce(jsonb_agg(s), '[]'::jsonb) into v_selected
    from jsonb_array_elements(v_all -> 'signals') s
   where s ->> 'signal_id' = any (coalesce(p_signals, array[]::text[]));
  return jsonb_build_object(
    'captured_at_source', 'readiness_signals',
    'summary', v_all -> 'summary',
    'signals', v_selected,
    'all_signals', v_all -> 'signals');
end $$;

comment on function public.build_complaint_bundle(uuid, text[]) is
  'D12: the auto-generated complaint bundle — the failed checks, their reasons and the readiness output.';

-- ---------------------------------------------------------------------------
-- 6. The platform emailer. Resolves the platform administrators' addresses and queues one email
--    through the existing queue_email machinery (no second sender).
-- ---------------------------------------------------------------------------
create or replace function public.queue_complaint_email(p_org uuid, p_code text, p_severity text, p_title text, p_bundle jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emails text[];
  v_body text;
begin
  select array_agg(distinct u.email) into v_emails
    from auth.users u join platform_admins pa on pa.user_id = u.id
   where u.email is not null;
  if v_emails is null or array_length(v_emails, 1) is null then
    return null;
  end if;
  v_body := 'Complaint ' || p_code || ' (' || p_severity || ')' || E'\n\n' || p_title || E'\n\n'
    || jsonb_pretty(p_bundle);
  return public.queue_email(p_org, v_emails, '[' || p_code || '] ' || p_title, null, v_body,
    jsonb_build_object('kind', 'complaint', 'code', p_code, 'severity', p_severity));
end $$;

comment on function public.queue_complaint_email(uuid, text, text, text, jsonb) is
  'D12: queue the complaint email to every platform administrator through the existing email queue.';

-- ---------------------------------------------------------------------------
-- 7. complaint_create — mint the code, build the bundle, record the complaint and its event, then
--    email. The order is complaint -> event -> email, so a failed send never loses the issue.
-- ---------------------------------------------------------------------------
create or replace function public.complaint_create(
  p_org uuid, p_title text, p_signals text[], p_severity text, p_body text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_id uuid;
  v_bundle jsonb;
  v_signal text;
  v_sev text;
begin
  perform public.require_platform_admin();
  if p_org is null or not exists (select 1 from orgs where id = p_org) then
    raise exception 'unknown organisation' using errcode = 'P0001';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'a complaint title is required' using errcode = 'P0001';
  end if;
  v_sev := case when p_severity = 'critical' then 'critical' else 'warning' end;
  v_signal := case when p_signals is null or array_length(p_signals, 1) is null then null else p_signals[1] end;

  v_code := public.mint_complaint_code(p_org);
  v_bundle := public.build_complaint_bundle(p_org, p_signals);

  insert into complaints (org_id, code, severity, source_signal, title, body, bundle, created_by)
  values (p_org, v_code, v_sev, v_signal, btrim(p_title), coalesce(p_body, ''), v_bundle, auth.uid())
  returning id into v_id;

  insert into complaint_events (complaint_id, org_id, kind, actor_id, detail)
  values (v_id, p_org, 'created', auth.uid(),
          jsonb_build_object('code', v_code, 'signals', to_jsonb(coalesce(p_signals, array[]::text[]))));

  perform public.append_ledger_entry(p_org, 'complaint_created', jsonb_build_object(
    'complaint_id', v_id::text, 'code', v_code, 'severity', v_sev,
    'signals', to_jsonb(coalesce(p_signals, array[]::text[]))), auth.uid());

  if public.queue_complaint_email(p_org, v_code, v_sev, btrim(p_title), v_bundle) is not null then
    insert into complaint_events (complaint_id, org_id, kind, actor_id, detail)
    values (v_id, p_org, 'emailed', auth.uid(), jsonb_build_object('to', 'platform administrators'));
  end if;

  return jsonb_build_object('ok', true, 'complaint_id', v_id, 'code', v_code, 'severity', v_sev,
    'bundle', v_bundle);
end $$;

comment on function public.complaint_create(uuid, text, text[], text, text) is
  'D12: create a complaint, mint its code, build the log bundle, record it and email the platform administrators.';

-- ---------------------------------------------------------------------------
-- 8. The tenant path. A member with edit_config raises a complaint about their own organisation.
--    The org is the caller's own (jwt_org_id), never a parameter (L2).
-- ---------------------------------------------------------------------------
create or replace function public.org_complaint_create(
  p_title text, p_signals text[], p_severity text, p_body text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_code text;
  v_id uuid;
  v_bundle jsonb;
  v_sev text;
  v_signal text;
begin
  if v_org is null then
    raise exception 'no organisation in session' using errcode = 'P0001';
  end if;
  if not public.caller_has_right('edit_config') then
    raise exception 'not allowed: the edit_config right is required' using errcode = 'P0001';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'a complaint title is required' using errcode = 'P0001';
  end if;
  v_sev := case when p_severity = 'critical' then 'critical' else 'warning' end;
  v_signal := case when p_signals is null or array_length(p_signals, 1) is null then null else p_signals[1] end;

  v_code := public.mint_complaint_code(v_org);
  v_bundle := public.org_readiness_signals();
  v_bundle := jsonb_build_object('captured_at_source', 'org_readiness_signals',
    'summary', v_bundle -> 'summary', 'signals', v_bundle -> 'signals');

  insert into complaints (org_id, code, severity, source_signal, title, body, bundle, created_by)
  values (v_org, v_code, v_sev, v_signal, btrim(p_title), coalesce(p_body, ''), v_bundle, auth.uid())
  returning id into v_id;

  insert into complaint_events (complaint_id, org_id, kind, actor_id, detail)
  values (v_id, v_org, 'created', auth.uid(),
          jsonb_build_object('code', v_code, 'signals', to_jsonb(coalesce(p_signals, array[]::text[]))));
  perform public.append_ledger_entry(v_org, 'complaint_created', jsonb_build_object(
    'complaint_id', v_id::text, 'code', v_code, 'severity', v_sev), auth.uid());

  if public.queue_complaint_email(v_org, v_code, v_sev, btrim(p_title), v_bundle) is not null then
    insert into complaint_events (complaint_id, org_id, kind, actor_id, detail)
    values (v_id, v_org, 'emailed', auth.uid(), jsonb_build_object('to', 'platform administrators'));
  end if;

  return jsonb_build_object('ok', true, 'complaint_id', v_id, 'code', v_code, 'severity', v_sev);
end $$;

comment on function public.org_complaint_create(text, text[], text, text) is
  'D12: a tenant raises a complaint about its own organisation; the code is minted and the platform administrators emailed.';

-- ---------------------------------------------------------------------------
-- 9. The lifecycle. Each step records an event and needs the platform role (or edit_config for a
--    tenant resolve). A resolve carries a reason (config-as-ledger).
-- ---------------------------------------------------------------------------
create or replace function public.complaint_assign(p_complaint uuid, p_assignee uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c complaints%rowtype;
begin
  perform public.require_platform_admin();
  select * into v_c from complaints where id = p_complaint;
  if not found then
    raise exception 'unknown complaint' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to assign a complaint' using errcode = 'P0001';
  end if;
  update complaints set assigned_to = p_assignee, status = 'assigned' where id = p_complaint;
  insert into complaint_events (complaint_id, org_id, kind, actor_id, detail)
  values (p_complaint, v_c.org_id, 'assigned', auth.uid(),
          jsonb_build_object('assignee', p_assignee::text, 'reason', btrim(p_reason)));
  perform public.append_ledger_entry(v_c.org_id, 'complaint_assigned', jsonb_build_object(
    'complaint_id', p_complaint::text, 'code', v_c.code, 'assignee', p_assignee::text), auth.uid());
  return jsonb_build_object('ok', true);
end $$;

comment on function public.complaint_assign(uuid, uuid, text) is
  'D12: assign a complaint to a platform user; a reason is required and the assignment is recorded.';

create or replace function public.complaint_comment(p_complaint uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c complaints%rowtype;
begin
  select * into v_c from complaints where id = p_complaint;
  if not found then
    raise exception 'unknown complaint' using errcode = 'P0001';
  end if;
  if not (public.is_platform_admin() or v_c.org_id = public.jwt_org_id()) then
    raise exception 'not allowed: this complaint belongs to another organisation' using errcode = 'P0001';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'a comment cannot be empty' using errcode = 'P0001';
  end if;
  insert into complaint_events (complaint_id, org_id, kind, actor_id, detail)
  values (p_complaint, v_c.org_id, 'commented', auth.uid(), jsonb_build_object('body', btrim(p_body)));
  return jsonb_build_object('ok', true);
end $$;

comment on function public.complaint_comment(uuid, text) is
  'D12: append a comment to a complaint the caller may see.';

create or replace function public.complaint_resolve(p_complaint uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c complaints%rowtype;
begin
  select * into v_c from complaints where id = p_complaint;
  if not found then
    raise exception 'unknown complaint' using errcode = 'P0001';
  end if;
  if not (public.is_platform_admin() or (v_c.org_id = public.jwt_org_id() and public.caller_has_right('edit_config'))) then
    raise exception 'not allowed: resolving requires the platform role or edit_config' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to resolve a complaint' using errcode = 'P0001';
  end if;
  if v_c.status = 'resolved' then
    raise exception 'this complaint is already resolved' using errcode = 'P0001';
  end if;
  update complaints set status = 'resolved', resolved_at = now(), resolution_reason = btrim(p_reason)
   where id = p_complaint;
  insert into complaint_events (complaint_id, org_id, kind, actor_id, detail)
  values (p_complaint, v_c.org_id, 'resolved', auth.uid(), jsonb_build_object('reason', btrim(p_reason)));
  perform public.append_ledger_entry(v_c.org_id, 'complaint_resolved', jsonb_build_object(
    'complaint_id', p_complaint::text, 'code', v_c.code, 'reason', btrim(p_reason)), auth.uid());
  return jsonb_build_object('ok', true);
end $$;

comment on function public.complaint_resolve(uuid, text) is
  'D12: resolve a complaint with a reason (config-as-ledger). The resolution is recorded.';

-- ---------------------------------------------------------------------------
-- 10. The read path. org_complaint_list is the caller's org; complaint_list is the platform view.
-- ---------------------------------------------------------------------------
create or replace function public.org_complaint_list()
returns jsonb
language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
    from complaints c where c.org_id = public.jwt_org_id();
$$;

comment on function public.org_complaint_list() is
  'D12: every complaint for the caller''s own organisation, newest first.';

create or replace function public.complaint_list(p_org uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.require_platform_admin();
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb) into v
    from complaints c where p_org is null or c.org_id = p_org;
  return v;
end $$;

comment on function public.complaint_list(uuid) is
  'D12: the platform complaint register, optionally filtered to one organisation. Platform administrators only.';

create or replace function public.complaint_events_list(p_complaint uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from complaints where id = p_complaint;
  if v_org is null then
    raise exception 'unknown complaint' using errcode = 'P0001';
  end if;
  if not (public.is_platform_admin() or v_org = public.jwt_org_id()) then
    raise exception 'not allowed: this complaint belongs to another organisation' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(e) order by e.ts), '[]'::jsonb)
            from complaint_events e where e.complaint_id = p_complaint);
end $$;

comment on function public.complaint_events_list(uuid) is
  'D12: the append-only event trail for one complaint.';

-- ---------------------------------------------------------------------------
-- 11. The platform administrator list. The assignment picker needs a real assignee, and only the
--     platform role may read it (L2): it exposes no tenant data.
-- ---------------------------------------------------------------------------
create or replace function public.platform_list_admins()
returns table (user_id uuid, email text)
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  return query
    select pa.user_id, u.email
      from platform_admins pa
      left join auth.users u on u.id = pa.user_id
     order by u.email;
end $$;

comment on function public.platform_list_admins() is
  'D12: the platform administrators, for the complaint assignment picker. Platform administrators only.';

-- ---------------------------------------------------------------------------
-- 12. Grants. Application RPCs to authenticated only; each re-checks the right inside.
-- ---------------------------------------------------------------------------
revoke execute on function public.mint_complaint_code(uuid) from public, anon;
grant execute on function public.mint_complaint_code(uuid) to authenticated;
revoke execute on function public.build_complaint_bundle(uuid, text[]) from public, anon;
grant execute on function public.build_complaint_bundle(uuid, text[]) to authenticated;
revoke execute on function public.queue_complaint_email(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.queue_complaint_email(uuid, text, text, text, jsonb) to authenticated;
revoke execute on function public.complaint_create(uuid, text, text[], text, text) from public, anon;
grant execute on function public.complaint_create(uuid, text, text[], text, text) to authenticated;
revoke execute on function public.org_complaint_create(text, text[], text, text) from public, anon;
grant execute on function public.org_complaint_create(text, text[], text, text) to authenticated;
revoke execute on function public.complaint_assign(uuid, uuid, text) from public, anon;
grant execute on function public.complaint_assign(uuid, uuid, text) to authenticated;
revoke execute on function public.complaint_comment(uuid, text) from public, anon;
grant execute on function public.complaint_comment(uuid, text) to authenticated;
revoke execute on function public.complaint_resolve(uuid, text) from public, anon;
grant execute on function public.complaint_resolve(uuid, text) to authenticated;
revoke execute on function public.org_complaint_list() from public, anon;
grant execute on function public.org_complaint_list() to authenticated;
revoke execute on function public.complaint_list(uuid) from public, anon;
grant execute on function public.complaint_list(uuid) to authenticated;
revoke execute on function public.complaint_events_list(uuid) from public, anon;
grant execute on function public.complaint_events_list(uuid) to authenticated;
revoke execute on function public.platform_list_admins() from public, anon;
grant execute on function public.platform_list_admins() to authenticated;
