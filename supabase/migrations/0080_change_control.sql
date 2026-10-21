-- 0080: Change control after deployment (C3.2-A, spec §21).
--
-- The spec:
--   §21 "Routine change (applied immediately, with notification): reassigning a workpaper to someone
--        already on the team. Material change (formal approval required): anything meaningfully
--        affecting audit quality. This includes planned dates, adding or removing team members,
--        scope, tested controls, and replacing a locked sample. Approvers are configurable. Every
--        change is logged, and approved changes are hash-chained."
--
-- Design (FIXED by the spec, IMPROVISE-THEN-DOCUMENT elsewhere):
--   * change_requests — one row per proposed change on an engagement, carrying a kind
--     (routine | material), the change class, a payload, a status and the decision.
--   * change_control_settings — one row per org. The approver right is configurable (§21), default
--     approve_plan; the routine classes are configurable (default: the spec's workpaper reassignment).
--   * request_change / decide_change — security-definer RPCs. A routine change applies immediately
--     (status applied) and writes ONE activity row; a material change waits for an approver
--     (approve_right) and, once approved, is written to the business ledger (hash-chained, L5).
--   * A guard trigger makes the ledgered decision immutable (append-only, D7 pattern).
--
-- M1: grepped supabase/migrations and supabase/tests for change_request, change_control_settings,
--     change_requests_guard, change_request_log, request_change, decide_change — none existed.
-- M2: create table if not exists + add column if not exists; create or replace function;
--     drop policy/trigger/constraint if exists before create; create index if not exists.

-- ---------------------------------------------------------------------------
-- 1. change_control_settings — one row per organisation (§21 "Approvers are configurable").
-- ---------------------------------------------------------------------------
create table if not exists change_control_settings (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table change_control_settings add column if not exists approver_right text not null default 'approve_plan';
alter table change_control_settings add column if not exists routine_classes jsonb not null default
  '["workpaper_reassign"]'::jsonb;
alter table change_control_settings add column if not exists sla_hours int not null default 48;
alter table change_control_settings add column if not exists escalate_right text not null default 'view_all_scopes';
alter table change_control_settings add column if not exists updated_at timestamptz not null default now();

alter table change_control_settings drop constraint if exists ccs_approver_right_valid;
alter table change_control_settings add constraint ccs_approver_right_valid
  check (public.rights_keys_valid(jsonb_build_object(approver_right, true)));
alter table change_control_settings drop constraint if exists ccs_escalate_right_valid;
alter table change_control_settings add constraint ccs_escalate_right_valid
  check (public.rights_keys_valid(jsonb_build_object(escalate_right, true)));
alter table change_control_settings drop constraint if exists ccs_sla_hours_chk;
alter table change_control_settings add constraint ccs_sla_hours_chk check (sla_hours between 1 and 720);

alter table change_control_settings enable row level security;
drop policy if exists ccs_select on change_control_settings;
create policy ccs_select on change_control_settings for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

revoke insert, update, delete on public.change_control_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. change_requests — one row per proposed change on an engagement (§21).
-- ---------------------------------------------------------------------------
create table if not exists change_requests (
  id uuid primary key default gen_random_uuid()
);
alter table change_requests add column if not exists org_id uuid;
alter table change_requests add column if not exists engagement_id uuid;
alter table change_requests add column if not exists klass text not null default 'material';
alter table change_requests add column if not exists change_class text not null default 'other';
alter table change_requests add column if not exists title text;
alter table change_requests add column if not exists payload jsonb not null default '{}'::jsonb;
alter table change_requests add column if not exists status text not null default 'pending';
alter table change_requests add column if not exists requested_by uuid;
alter table change_requests add column if not exists requested_at timestamptz not null default now();
alter table change_requests add column if not exists decided_by uuid;
alter table change_requests add column if not exists decided_at timestamptz;
alter table change_requests add column if not exists reject_reason text;
alter table change_requests add column if not exists ledger_seq bigint;

alter table change_requests drop constraint if exists cr_klass_check;
alter table change_requests add constraint cr_klass_check check (klass in ('routine', 'material'));
alter table change_requests drop constraint if exists cr_status_check;
alter table change_requests add constraint cr_status_check
  check (status in ('pending', 'applied', 'approved', 'rejected', 'withdrawn'));

alter table change_requests enable row level security;
drop policy if exists cr_select on change_requests;
create policy cr_select on change_requests for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
create index if not exists cr_org_idx on change_requests (org_id, engagement_id, status, requested_at desc);

revoke insert, update, delete on public.change_requests from public, anon, authenticated;

-- The org FK so `truncate orgs cascade` (the SQL-test reset) reaches the table (M5).
alter table change_requests drop constraint if exists change_requests_org_id_fkey;
alter table change_requests add constraint change_requests_org_id_fkey
  foreign key (org_id) references orgs(id) on delete cascade;
alter table change_requests drop constraint if exists change_requests_engagement_id_fkey;
alter table change_requests add constraint change_requests_engagement_id_fkey
  foreign key (engagement_id) references engagements(id) on delete cascade;

-- The decision row is append-only once it leaves 'pending' (§26, D7 pattern): an approved or
-- rejected change carries a hash-chained ledger entry and must not be silently rewritten.
create or replace function public.change_requests_guard() returns trigger
language plpgsql as $$
begin
  if old.status in ('applied', 'approved') and new.status is distinct from old.status then
    raise exception 'a decided change request is append-only' using errcode = 'P0001';
  end if;
  if old.status in ('applied', 'approved')
     and (new.decided_by is distinct from old.decided_by
          or new.ledger_seq is distinct from old.ledger_seq) then
    raise exception 'a decided change request is append-only' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists change_requests_no_change on change_requests;
create trigger change_requests_no_change before update on change_requests
for each row execute function public.change_requests_guard();

-- ---------------------------------------------------------------------------
-- 3. Seeding and reading the settings.
-- ---------------------------------------------------------------------------
create or replace function public.change_control_seed(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into change_control_settings (org_id) values (p_org) on conflict (org_id) do nothing;
end $$;

create or replace function public.change_control_get(p_org uuid default null)
returns table (approver_right text, routine_classes jsonb, sla_hours int, escalate_right text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  perform public.provio_org_guard(v_org);
  if not public.config_actor_ok(v_org, 'edit_config') then
    raise exception 'not allowed: the caller cannot view change-control settings' using errcode = 'P0001';
  end if;
  perform public.change_control_seed(v_org);
  return query
    select s.approver_right, s.routine_classes, s.sla_hours, s.escalate_right
      from change_control_settings s where s.org_id = v_org;
end $$;

create or replace function public.change_control_save(
  p_org uuid, p_approver_right text default null, p_routine_classes jsonb default null,
  p_sla_hours int default null, p_escalate_right text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  perform public.require_config_actor(p_org, 'edit_config');
  if p_approver_right is not null
     and not public.rights_keys_valid(jsonb_build_object(p_approver_right, true)) then
    raise exception 'unknown right: %', p_approver_right using errcode = 'P0001';
  end if;
  perform public.change_control_seed(p_org);
  update change_control_settings
     set approver_right = coalesce(nullif(btrim(p_approver_right), ''), approver_right),
         routine_classes = coalesce(p_routine_classes, routine_classes),
         sla_hours = coalesce(p_sla_hours, sla_hours),
         escalate_right = coalesce(nullif(btrim(p_escalate_right), ''), escalate_right),
         updated_at = now()
   where org_id = p_org;
  perform public.admin_log_change(p_org, 'change_control.settings',
    jsonb_build_object('approver_right', p_approver_right, 'routine_classes', p_routine_classes,
                       'sla_hours', p_sla_hours, 'escalate_right', p_escalate_right),
    'change_control_saved', 'change_control_settings', null);
end $$;

-- ---------------------------------------------------------------------------
-- 4. request_change — classify and record a change (§21). Routine applies immediately and is
--    notified; material waits for a decision by the configured approver right.
-- ---------------------------------------------------------------------------
create or replace function public.request_change(
  p_engagement_id uuid, p_change_class text, p_title text,
  p_payload jsonb default '{}'::jsonb, p_klass text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_settings change_control_settings;
  v_klass text;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_engagement_id is null or not exists (
    select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('manage_engagements')
          and (public.can_read_all_scopes()
               or public.has_scope((select universe_id from engagements where id = p_engagement_id),
                                   (select entity_id from engagements where id = p_engagement_id),
                                   p_engagement_id))) then
    raise exception 'not allowed: the caller cannot change this engagement' using errcode = 'P0001';
  end if;
  perform public.change_control_seed(v_org);
  select * into v_settings from change_control_settings where org_id = v_org;
  -- Classification: an explicit klass wins; otherwise a class named in routine_classes is routine.
  v_klass := coalesce(p_klass,
    case when coalesce(v_settings.routine_classes, '[]'::jsonb) ? p_change_class
         then 'routine' else 'material' end);
  if v_klass not in ('routine', 'material') then
    raise exception 'unknown change class kind: %', v_klass using errcode = 'P0001';
  end if;

  insert into change_requests (org_id, engagement_id, klass, change_class, title, payload,
                               status, requested_by)
  values (v_org, p_engagement_id, v_klass, p_change_class, p_title, coalesce(p_payload, '{}'::jsonb),
          case when v_klass = 'routine' then 'applied' else 'pending' end, auth.uid())
  returning id into v_id;

  if v_klass = 'routine' then
    insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
    values (v_org, auth.uid(), 'change_routine_applied', 'change_request', v_id,
            jsonb_build_object('change_class', p_change_class, 'title', p_title));
  else
    insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
    values (v_org, auth.uid(), 'change_requested', 'change_request', v_id,
            jsonb_build_object('change_class', p_change_class, 'title', p_title));
  end if;
  insert into automation_events (org_id, event_key, payload, actor_id)
  values (v_org, case when v_klass = 'routine' then 'change.routine_applied' else 'change.requested' end,
          jsonb_build_object('change_request_id', v_id, 'engagement_id', p_engagement_id,
                             'change_class', p_change_class, 'title', p_title),
          auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. decide_change — the approver approves or rejects a material change (§21). Approval writes the
--    hash-chained ledger entry (L5) and applies; rejection returns a reason.
-- ---------------------------------------------------------------------------
create or replace function public.decide_change(
  p_request_id uuid, p_approve boolean, p_reason text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_req change_requests;
  v_right text;
  v_entry ledger_entries;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select * into v_req from change_requests where id = p_request_id and org_id = v_org;
  if not found then
    raise exception 'change request not found in this organisation' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'this change request has already been decided' using errcode = 'P0001';
  end if;
  perform public.change_control_seed(v_org);
  select approver_right into v_right from change_control_settings where org_id = v_org;
  if not public.config_actor_ok(v_org, coalesce(v_right, 'approve_plan')) then
    raise exception 'not allowed: the caller cannot approve this change' using errcode = 'P0001';
  end if;
  if v_req.requested_by = auth.uid() then
    raise exception 'four-eyes: the requester cannot approve their own change' using errcode = 'P0001';
  end if;

  if p_approve then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'an approval needs a short reason' using errcode = 'P0001';
    end if;
    v_entry := public.append_ledger_entry(v_org, 'change_approved',
      jsonb_build_object('change_request_id', p_request_id, 'engagement_id', v_req.engagement_id,
                         'change_class', v_req.change_class, 'title', v_req.title, 'reason', p_reason));
    update change_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           reject_reason = null, ledger_seq = v_entry.seq
     where id = p_request_id;
    insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
    values (v_org, auth.uid(), 'change_approved', 'change_request', p_request_id,
            jsonb_build_object('reason', p_reason, 'ledger_seq', v_entry.seq));
    insert into automation_events (org_id, event_key, payload, actor_id)
    values (v_org, 'change.approved',
            jsonb_build_object('change_request_id', p_request_id, 'engagement_id', v_req.engagement_id,
                               'change_class', v_req.change_class), auth.uid());
    return 'approved';
  else
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'a rejection needs a reason' using errcode = 'P0001';
    end if;
    update change_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), reject_reason = p_reason
     where id = p_request_id;
    insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
    values (v_org, auth.uid(), 'change_rejected', 'change_request', p_request_id,
            jsonb_build_object('reason', p_reason));
    insert into automation_events (org_id, event_key, payload, actor_id)
    values (v_org, 'change.rejected',
            jsonb_build_object('change_request_id', p_request_id, 'engagement_id', v_req.engagement_id,
                               'change_class', v_req.change_class), auth.uid());
    return 'rejected';
  end if;
end $$;

-- List the changes for an engagement (drillable, §L4).
create or replace function public.list_changes(p_engagement_id uuid)
returns table (id uuid, klass text, change_class text, title text, status text,
               requested_by uuid, requested_at timestamptz, decided_by uuid, decided_at timestamptz,
               reject_reason text, ledger_seq bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.provio_org_guard(v_org);
  if p_engagement_id is not null and not exists (
    select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  return query
    select c.id, c.klass, c.change_class, c.title, c.status, c.requested_by, c.requested_at,
           c.decided_by, c.decided_at, c.reject_reason, c.ledger_seq
      from change_requests c
     where c.org_id = v_org and (p_engagement_id is null or c.engagement_id = p_engagement_id)
     order by c.requested_at desc;
end $$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'change_control_get(uuid)',
    'change_control_save(uuid, text, jsonb, int, text)',
    'request_change(uuid, text, text, jsonb, text)',
    'decide_change(uuid, boolean, text)',
    'list_changes(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
