-- 0210 self-diagnostic snapshots — the counts the self-diagnostic engine reads.
--
-- The owner asked the product to be able to diagnose itself: an org admin and a super admin need one
-- place that says what is wrong, how serious it is, and where to go. The RULES are pure
-- (src/lib/diagnostics.ts) and deterministic; this migration supplies the FACTS.
--
-- Law L2 is the whole design constraint: the snapshot is COUNTS, FLAGS and one broken-ledger
-- sequence number. It is never a row of tenant content, so it may be computed across the tenant and
-- returned to its own integrity owner without widening any read. The functions are security definer
-- and org-scoped by `jwt_org_id()`; the platform function is gated by `is_platform_admin()`.
--
-- Reuse (grep first): `get_org_data_state` (0117), `verify_ledger` (0007), `integrity_alerts` (0112),
-- `integrity_incidents`/`integrity_incident_actions` (0114), `caps` (0038), `sira_emergent_risks`/
-- `sira_cycles` (0020), `sira_acceptances` (0110), `evidence_files` (0035/0111), `connector_instances`
-- (0090), `populations`/`population_rows` (0004), `samples`/`workpapers` (0004/0028),
-- `org_sampling_table` (0027), `roles`/`org_members` (0002/0005), `platform_job_health` (0074).
-- No existing function is replaced.
--
-- M2: create or replace; safe to apply repeatedly. M8: one client. Grants: application roles only.

-- ---------------------------------------------------------------------------
-- org_diagnostic_snapshot — every fact the org rules read, as counts and flags, for the caller's org.
-- Readable by any signed-in member: a brand-new org's member holds no audit right yet and must still
-- be able to run a self-check (it will simply report "the organisation is empty").
-- ---------------------------------------------------------------------------
create or replace function public.org_diagnostic_snapshot()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_state record;
  v_populations int;
  v_populations_without_rows int;
  v_workpapers int;
  v_workpapers_sampled int;
  v_caps_open int;
  v_caps_overdue int;
  v_proposals int;
  v_acceptances int;
  v_cycles int;
  v_cycles_published int;
  v_alerts_incident int;
  v_alerts_warning int;
  v_alerts_unacked int;
  v_incidents_open int;
  v_evidence int;
  v_evidence_without_storage int;
  v_evidence_unverified int;
  v_connectors int;
  v_connectors_failing int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;

  select * into v_state from public.get_org_data_state();

  select count(*) into v_populations from populations where org_id = v_org;
  select count(*) into v_populations_without_rows
    from populations p
   where p.org_id = v_org
     and not exists (select 1 from population_rows r where r.population_id = p.id);

  select count(*) into v_workpapers from workpapers where org_id = v_org;
  select count(distinct s.workpaper_id) into v_workpapers_sampled
    from samples s
   where s.org_id = v_org and s.workpaper_id is not null and s.locked = true;

  select count(*) into v_caps_open from caps where org_id = v_org and status in ('open', 'unverified');
  select count(*) into v_caps_overdue
    from caps
   where org_id = v_org
     and status not in ('verified_closed', 'verified_closed_delay')
     and due_date is not null and due_date < current_date;

  select count(*) into v_proposals from sira_emergent_risks where org_id = v_org and status = 'pending';
  select count(*) into v_acceptances from sira_acceptances
   where org_id = v_org and status = 'awaiting_acceptance';
  select count(*) into v_cycles from sira_cycles where org_id = v_org;
  select count(*) into v_cycles_published from sira_cycles where org_id = v_org and status = 'published';

  select count(*) filter (where public.integrity_alert_severity(kind) = 'incident'),
         count(*) filter (where public.integrity_alert_severity(kind) = 'warning'),
         count(*) filter (where acknowledged_at is null)
    into v_alerts_incident, v_alerts_warning, v_alerts_unacked
    from integrity_alerts where org_id = v_org;

  select count(*) into v_incidents_open from integrity_incidents where org_id = v_org;

  select count(*) into v_evidence from evidence_files where org_id = v_org;
  select count(*) into v_evidence_without_storage
    from evidence_files
   where org_id = v_org and (storage_path is null or btrim(storage_path) = '');
  select count(*) into v_evidence_unverified
    from evidence_files
   where org_id = v_org and coalesce(verify_status, '') <> 'verified';

  select count(*) into v_connectors from connector_instances where org_id = v_org;
  select count(*) into v_connectors_failing
    from connector_instances where org_id = v_org and health = 'failed';

  return jsonb_build_object(
    'universes', v_state.universes,
    'entities', v_state.entities,
    'engagements', v_state.engagements,
    'is_empty', v_state.is_empty,
    'roles_total', (select count(*) from roles where org_id = v_org),
    'members_total', (select count(*) from org_members where org_id = v_org),
    'sampling_rules', (select count(*) from org_sampling_table where org_id = v_org),
    'populations', v_populations,
    'populations_without_rows', v_populations_without_rows,
    'workpapers', v_workpapers,
    'workpapers_sampled', v_workpapers_sampled,
    'caps_open', v_caps_open,
    'caps_overdue', v_caps_overdue,
    'proposals_pending', v_proposals,
    'acceptances_outstanding', v_acceptances,
    'sira_cycles', v_cycles,
    'sira_cycles_published', v_cycles_published,
    'alerts_incident', v_alerts_incident,
    'alerts_warning', v_alerts_warning,
    'alerts_unacknowledged', v_alerts_unacked,
    'incidents_open', v_incidents_open,
    'evidence_rows', v_evidence,
    'evidence_without_storage', v_evidence_without_storage,
    'evidence_unverified', v_evidence_unverified,
    'connectors_total', v_connectors,
    'connectors_failing', v_connectors_failing,
    'ledger_broken_at', public.verify_ledger(v_org),
    'as_of', to_char(current_date, 'YYYY-MM-DD')
  );
end $$;

comment on function public.org_diagnostic_snapshot() is
  'Self-diagnostic facts for the caller''s org: counts, flags and the broken-ledger sequence only. '
  'Never a row of tenant content (Law L2). Any signed-in member may run it.';

-- ---------------------------------------------------------------------------
-- platform_diagnostic_snapshot — the super admin's facts. Platform administrators only.
-- ---------------------------------------------------------------------------
create or replace function public.platform_diagnostic_snapshot()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenants int;
  v_suspended int;
  v_jobs int := 0;
  v_jobs_failing int := 0;
  v_incidents int;
  v_alerts_incident int;
  v_alerts_unacked int;
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrators only' using errcode = 'P0001';
  end if;

  -- Suspension is tenant_settings.status (0031), not orgs: an org row has no status column.
  select count(*), count(*) filter (where coalesce(ts.status, 'active') = 'suspended')
    into v_tenants, v_suspended
    from orgs o
    left join tenant_settings ts on ts.org_id = o.id;

  -- platform_job_health returns nothing when pg_cron is absent; count what it returns.
  begin
    select count(*), count(*) filter (where last_status is not null and last_status <> 'succeeded')
      into v_jobs, v_jobs_failing
      from public.platform_job_health();
  exception when others then
    v_jobs := 0; v_jobs_failing := 0;
  end;

  select count(*) into v_incidents from integrity_incidents;
  select count(*) filter (where public.integrity_alert_severity(kind) = 'incident'),
         count(*) filter (where acknowledged_at is null)
    into v_alerts_incident, v_alerts_unacked
    from integrity_alerts;

  return jsonb_build_object(
    'tenants', v_tenants,
    'tenants_suspended', v_suspended,
    'jobs_total', v_jobs,
    'jobs_failing', v_jobs_failing,
    'incidents_open', v_incidents,
    'alerts_incident', v_alerts_incident,
    'alerts_unacknowledged', v_alerts_unacked,
    'as_of', to_char(current_date, 'YYYY-MM-DD')
  );
end $$;

comment on function public.platform_diagnostic_snapshot() is
  'Self-diagnostic facts across the platform for a platform administrator: counts and flags only.';

-- ---------------------------------------------------------------------------
-- Grants: application roles only (0085 has already revoked the inherited anon grant).
-- ---------------------------------------------------------------------------
revoke execute on function public.org_diagnostic_snapshot() from public, anon;
revoke execute on function public.platform_diagnostic_snapshot() from public, anon;
grant execute on function public.org_diagnostic_snapshot() to authenticated;
grant execute on function public.platform_diagnostic_snapshot() to authenticated;
