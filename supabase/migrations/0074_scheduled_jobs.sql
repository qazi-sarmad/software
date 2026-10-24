-- 0074 (C2.2): the scheduled jobs the spec requires but which were never scheduled.
--
-- Only `email-dispatch` and `email-expiry-sweep` existed (0064). This migration adds:
--   1. a daily CAP job that emits `cap.due_soon` and `cap.overdue`;
--   2. a daily `ai_purge_expired()` run;
--   3. an hourly `consultation_sweep()` run;
--   4. an hourly deployment-request escalation run (platform-wide);
--   5. an hourly sweep of expired support and external-auditor grants;
--   6. a daily change-notification digest for recipients who chose the digest;
--   7. monthly activity archival is NOT scheduled: it stays an explicit action (§25.4).
-- Plus SA-02's job-health reader.
--
-- M1: grepped supabase/migrations and supabase/tests for every name below. `ai_purge_expired`
-- (0059), `consultation_sweep` (0052) and `escalate_overdue_deployment_requests` (0023) exist and
-- are reused, not redefined; the platform-wide escalation wrapper, the grant sweep, the CAP job,
-- the digest and the job-health reader are new. `cap_event_log` is new.
-- M2: every object is `if not exists` or `create or replace`; every schedule unschedules first
-- behind an existence check, so a repeat apply never duplicates a job.
-- M6: applied twice and all SQL tests run twice against a local Postgres before the push.

-- ---------------------------------------------------------------------------
-- 0. The organisation's calendar day, written once.
--    The app computes "today" in the organisation's zone (src/lib/orgDate.ts,
--    DEFAULT_ORG_TIME_ZONE = 'Asia/Karachi'); comparing a due date to UTC midnight is wrong. The
--    zone is a configuration value on org_settings_extra so an org can change it, and the CAP job
--    and the app agree by construction (parity test on fixtures: src/lib/capOverdueParity.test.ts
--    and supabase/tests/83_scheduled_jobs.sql share the same cases).
-- ---------------------------------------------------------------------------
alter table org_settings_extra add column if not exists time_zone text not null default 'Asia/Karachi';

create or replace function public.org_local_date(p_org uuid, p_now timestamptz default now())
returns date
language sql stable security definer set search_path = public as $$
  select (p_now at time zone coalesce(
            (select nullif(btrim(ose.time_zone), '') from org_settings_extra ose where ose.org_id = p_org),
            'Asia/Karachi'))::date
$$;

comment on function public.org_local_date(uuid, timestamptz) is
  'C2.2: the organisation-local calendar date, so a CAP due date is never compared to UTC midnight.';

-- The one overdue rule, in the database. It mirrors src/lib/orgDate.ts `isCapOverdue` and
-- src/lib/cap.ts `capStatusToDb` exactly; the parity test proves it.
create or replace function public.cap_is_overdue(p_status text, p_due_date date, p_today date)
returns boolean
language sql immutable as $$
  select p_status = 'overdue_unverified'
      or (p_status is not null
          and p_status not in ('verified_closed', 'verified_closed_delay')
          and p_due_date is not null
          and p_due_date < p_today)
$$;

comment on function public.cap_is_overdue(text, date, date) is
  'C2.2: the single CAP overdue rule. Mirrors src/lib/orgDate.ts isCapOverdue; parity test on fixtures.';

-- A due-soon window, configuration not code. Seven days is the default recorded as D-C2.2-c.
alter table org_settings_extra add column if not exists cap_due_soon_days int not null default 7;

create or replace function public.cap_due_soon_days(p_org uuid)
returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select ose.cap_due_soon_days from org_settings_extra ose where ose.org_id = p_org), 7)
$$;

-- ---------------------------------------------------------------------------
-- 1. cap_event_log — one emission per cap, per event key, per day. The daily job is idempotent: a
--    second run on the same day inserts nothing (M5: the job leaves no residue beyond these rows,
--    which are the audit of what it emitted).
-- ---------------------------------------------------------------------------
create table if not exists cap_event_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  cap_id uuid not null references caps(id) on delete cascade,
  event_key text not null,
  event_date date not null,
  created_at timestamptz not null default now()
);
create unique index if not exists cap_event_log_key_idx on cap_event_log (cap_id, event_key, event_date);
create index if not exists cap_event_log_org_idx on cap_event_log (org_id, event_date);

alter table cap_event_log enable row level security;
drop policy if exists cap_event_log_select on cap_event_log;
create policy cap_event_log_select on cap_event_log for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
-- No write policy: only the SECURITY DEFINER job writes.

-- ---------------------------------------------------------------------------
-- 2. cap_notification_sweep — the daily job. For every organisation it classifies each open CAP and
--    emits `cap.overdue` / `cap.due_soon` exactly once per cap per day, with the fields the rule
--    conditions name (severity, days_overdue, days_due). Returns the number of events emitted.
--    L1: deterministic. No random, no AI; the rule is cap_is_overdue.
-- ---------------------------------------------------------------------------
create or replace function public.cap_notification_sweep(p_today date default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_emitted int := 0;
  r record;
  v_today date;
  v_days int;
  v_due int;
begin
  for r in
    select c.id, c.org_id, c.status, c.due_date, f.severity
      from caps c
      left join findings f on f.id = c.finding_id
     where c.due_date is not null
        or c.status = 'overdue_unverified'
  loop
    v_today := coalesce(p_today, public.org_local_date(r.org_id));

    if public.cap_is_overdue(r.status, r.due_date, v_today) then
      v_days := greatest(v_today - r.due_date, 0);
      insert into cap_event_log (org_id, cap_id, event_key, event_date)
      values (r.org_id, r.id, 'cap.overdue', v_today)
      on conflict (cap_id, event_key, event_date) do nothing;
      if found then
        perform public.emit_event(r.org_id, 'cap.overdue', jsonb_build_object(
          'cap_id', r.id, 'severity', coalesce(r.severity, 'unknown'),
          'days_overdue', v_days, 'due_date', r.due_date));
        v_emitted := v_emitted + 1;
      end if;
    elsif r.due_date is not null
          and r.status not in ('verified_closed', 'verified_closed_delay', 'overdue_unverified') then
      v_due := r.due_date - v_today;
      if v_due >= 0 and v_due <= public.cap_due_soon_days(r.org_id) then
        insert into cap_event_log (org_id, cap_id, event_key, event_date)
        values (r.org_id, r.id, 'cap.due_soon', v_today)
        on conflict (cap_id, event_key, event_date) do nothing;
        if found then
          perform public.emit_event(r.org_id, 'cap.due_soon', jsonb_build_object(
            'cap_id', r.id, 'severity', coalesce(r.severity, 'unknown'),
            'days_due', v_due, 'due_date', r.due_date));
          v_emitted := v_emitted + 1;
        end if;
      end if;
    end if;
  end loop;
  return v_emitted;
end $$;

comment on function public.cap_notification_sweep(date) is
  'C2.2: the daily CAP job. Emits cap.overdue / cap.due_soon once per cap per day.';

-- ---------------------------------------------------------------------------
-- 3. deployment_requests_escalate_all — the platform-wide wrapper. The existing
--    escalate_overdue_deployment_requests() reads the caller's org from the JWT, which a cron run
--    does not have. This wrapper does the same work for every organisation, one org at a time.
-- ---------------------------------------------------------------------------
create or replace function public.deployment_requests_escalate_all()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_esc text;
  v_n int;
  v_total int := 0;
begin
  for v_org in select id from orgs loop
    perform public.seed_engagement_gate_settings(v_org);
    select escalate_right into v_esc from engagement_gate_settings where org_id = v_org;
    update deployment_requests
       set status = 'escalated', escalated_at = now(), escalated_to_right = v_esc
     where org_id = v_org and status = 'pending' and sla_due_at < now();
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into activity_log (org_id, actor_id, action, object_type, detail)
      values (v_org, null, 'deployment_requests_escalated', 'deployment_request',
              jsonb_build_object('count', v_n, 'escalate_right', v_esc));
      perform public.emit_event(v_org, 'escalation.triggered',
        jsonb_build_object('kind', 'deployment_request', 'count', v_n, 'escalate_right', v_esc));
    end if;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 4. grant_expiry_sweep — support grants and external-auditor grants past their expiry stop being
--    usable. Support grants are marked revoked with a system reason; external auditor access is
--    deactivated and its grants revoked, so the next call refuses (§24, test 75's rule).
-- ---------------------------------------------------------------------------
create or replace function public.grant_expiry_sweep()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_support int := 0;
  v_auditor int := 0;
begin
  update support_access_grants
     set revoked_at = now(), revoke_reason = coalesce(revoke_reason, 'expired')
   where revoked_at is null and expires_at <= now();
  get diagnostics v_support = row_count;

  update external_auditor_grants
     set revoked_at = now()
   where revoked_at is null and expires_at is not null and expires_at <= now();
  get diagnostics v_auditor = row_count;

  update external_auditor_access a
     set active = false, revoked_at = coalesce(a.revoked_at, now())
   where a.active and not exists (
     select 1 from external_auditor_grants g
      where g.user_id = a.user_id and g.org_id = a.org_id
        and g.revoked_at is null and (g.expires_at is null or g.expires_at > now()));

  update external_auditor_invites
     set revoked_at = now()
   where accepted_at is null and revoked_at is null and expires_at is not null and expires_at <= now();

  return v_support + v_auditor;
end $$;

comment on function public.grant_expiry_sweep() is
  'C2.2: hourly sweep. An expired support or external-auditor grant stops working on the next call.';

-- ---------------------------------------------------------------------------
-- 5. notification_digest_send — the daily digest. One email per recipient who chose
--    `daily_digest`, listing the day's `config.changed` events for their organisation. Recipients
--    who chose `immediately` are not touched (the engine already emailed them).
-- ---------------------------------------------------------------------------
create or replace function public.notification_digest_send(p_since timestamptz default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_since timestamptz := coalesce(p_since, now() - interval '1 day');
  v_queued int := 0;
  r record;
  v_items text;
begin
  for r in
    select p.org_id, p.user_id, u.email
      from notification_preferences p
      join auth.users u on u.id = p.user_id
     where p.mode = 'daily_digest' and u.email is not null
  loop
    select string_agg(
             coalesce(e.payload ->> 'area_label', e.payload ->> 'area', e.event_key)
             || coalesce(' (' || (e.payload ->> 'summary') || ')', ''),
             E'\n' order by e.created_at)
      into v_items
      from automation_events e
     where e.org_id = r.org_id and e.event_key = 'config.changed' and e.created_at >= v_since;

    if v_items is null then
      continue;
    end if;

    perform public.queue_email(r.org_id, array[r.email],
      'Provio: configuration changes in the last day',
      '<p>The following configuration changes were recorded in the last day:</p><pre>'
        || public.escape_html_text(v_items) || '</pre>',
      'The following configuration changes were recorded in the last day:' || E'\n\n' || v_items,
      jsonb_build_object('digest', true, 'count', array_length(string_to_array(v_items, E'\n'), 1)));
    v_queued := v_queued + 1;
  end loop;
  return v_queued;
end $$;

comment on function public.notification_digest_send(timestamptz) is
  'C2.2: the daily change-notification digest, one email per recipient who chose daily_digest.';

-- escape_html_text: the digest body is built in SQL, so it needs the same escaping the app's
-- notifications.ts uses. Kept tiny and pure.
create or replace function public.escape_html_text(p_text text)
returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(p_text, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

-- ---------------------------------------------------------------------------
-- 6. platform_job_health — SA-02's reader. Platform administrators only. Reads pg_cron's own
--    tables; when pg_cron is absent it returns an empty set rather than failing.
-- ---------------------------------------------------------------------------
create or replace function public.platform_job_health()
returns table (
  job_id bigint, job_name text, schedule text, active boolean, command text,
  last_start timestamptz, last_end timestamptz, last_status text, last_message text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrators only' using errcode = 'P0001';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  return query
    select j.jobid, j.jobname, j.schedule, j.active, j.command,
           d.start_time, d.end_time, d.status, d.return_message
      from cron.job j
      left join lateral (
        select r.start_time, r.end_time, r.status, r.return_message
          from cron.job_run_details r
         where r.jobid = j.jobid
         order by r.start_time desc
         limit 1
      ) d on true
     order by j.jobname;
end $$;

comment on function public.platform_job_health() is
  'C2.2: SA-02 reads each scheduled job and its last run. Platform administrators only.';

-- ---------------------------------------------------------------------------
-- 7. The schedule. Every job is created behind an existence check for pg_cron; the migration still
--    applies on a bare Postgres (M2). Each schedule unschedules first so a repeat apply is safe.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not available; the C2.2 schedules were not created (they remain explicit calls).';
    return;
  end if;

  -- (1) daily CAP events, at 06:00 in the server zone.
  begin perform cron.unschedule('cap-notification-sweep'); exception when others then null; end;
  perform cron.schedule('cap-notification-sweep', '0 6 * * *',
    $job$select public.cap_notification_sweep()$job$);

  -- (2) daily AI retention purge.
  begin perform cron.unschedule('ai-purge-expired'); exception when others then null; end;
  perform cron.schedule('ai-purge-expired', '30 3 * * *',
    $job$select public.ai_purge_expired()$job$);

  -- (3) hourly consultation sweep.
  begin perform cron.unschedule('consultation-sweep'); exception when others then null; end;
  perform cron.schedule('consultation-sweep', '15 * * * *',
    $job$select public.consultation_sweep()$job$);

  -- (4) hourly deployment-request escalation.
  begin perform cron.unschedule('deployment-escalation-sweep'); exception when others then null; end;
  perform cron.schedule('deployment-escalation-sweep', '45 * * * *',
    $job$select public.deployment_requests_escalate_all()$job$);

  -- (5) hourly grant expiry sweep.
  begin perform cron.unschedule('grant-expiry-sweep'); exception when others then null; end;
  perform cron.schedule('grant-expiry-sweep', '20 * * * *',
    $job$select public.grant_expiry_sweep()$job$);

  -- (6) daily change-notification digest.
  begin perform cron.unschedule('notification-digest'); exception when others then null; end;
  perform cron.schedule('notification-digest', '0 7 * * *',
    $job$select public.notification_digest_send()$job$);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants. The sweeps and the job-health reader are platform/service only; no tenant caller needs
--    them. The org-local date and the overdue rule are pure and readable by a signed-in user.
-- ---------------------------------------------------------------------------
revoke execute on function public.cap_notification_sweep(date) from public, anon, authenticated;
revoke execute on function public.deployment_requests_escalate_all() from public, anon, authenticated;
revoke execute on function public.grant_expiry_sweep() from public, anon, authenticated;
revoke execute on function public.notification_digest_send(timestamptz) from public, anon, authenticated;
revoke execute on function public.platform_job_health() from public, anon, authenticated;
grant execute on function public.cap_notification_sweep(date) to service_role;
grant execute on function public.deployment_requests_escalate_all() to service_role;
grant execute on function public.grant_expiry_sweep() to service_role;
grant execute on function public.notification_digest_send(timestamptz) to service_role;
grant execute on function public.platform_job_health() to authenticated, service_role;

revoke execute on function public.org_local_date(uuid, timestamptz) from public, anon;
grant execute on function public.org_local_date(uuid, timestamptz) to authenticated, service_role;
revoke execute on function public.cap_is_overdue(text, date, date) from public, anon;
grant execute on function public.cap_is_overdue(text, date, date) to authenticated, service_role;
revoke execute on function public.cap_due_soon_days(uuid) from public, anon;
grant execute on function public.cap_due_soon_days(uuid) to authenticated, service_role;
revoke execute on function public.escape_html_text(text) from public, anon;
grant execute on function public.escape_html_text(text) to authenticated, service_role;
