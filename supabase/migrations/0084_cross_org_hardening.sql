-- 0084 cross-organisation hardening (audit round 2, 2026-10-23). Tests: supabase/tests/93_cross_org.sql.
-- Each section closes a path that was confirmed by an Org B caller reading or writing Org A data,
-- or by an authenticated caller running a platform-wide sweep.

-- ---------------------------------------------------------------------------
-- 1. Platform-wide sweeps and internal helpers are not end-user functions. They are called by
--    pg_cron, the service-role dispatcher, or other definer functions (which run as the owner and
--    keep execute). No application code calls them directly.
-- ---------------------------------------------------------------------------
revoke execute on function public.consultation_sweep() from public, anon, authenticated;
revoke execute on function public.ai_purge_expired() from public, anon, authenticated;
revoke execute on function public.hosting_fit_seed() from public, anon, authenticated;
revoke execute on function public.email_expire_stale(integer) from public, anon, authenticated;
revoke execute on function public.hosting_connection_test_result(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_snapshot_sira_model(uuid) from public, anon, authenticated;
revoke execute on function public.admin_assert_org(uuid) from public, anon, authenticated;
revoke execute on function public.cap_due_soon_days(uuid) from public, anon, authenticated;
revoke execute on function public.org_local_date(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.population_retention_months(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Readers that filter on an org argument must also be tied to the caller's org.
--    The caller's right alone was not enough: an Org B CIA read Org A's escalation events and
--    proposals. Platform administrators keep their cross-org view.
-- ---------------------------------------------------------------------------
create or replace function public.escalation_event_list(p_org uuid)
returns table(id uuid, rule_key text, source_event_key text, severity text, recommendation text,
              reason text, target_roles text[], payload jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.rule_key, e.source_event_key, e.severity, e.recommendation,
         e.reason, e.target_roles, e.payload, e.created_at
    from escalation_events e
   where e.org_id = p_org
     and (p_org = public.jwt_org_id() or public.is_platform_admin())
     and (public.is_platform_admin() or public.caller_has_right('view_all_scopes')
          or exists (
            select 1 from roles r
             where r.org_id = p_org
               and r.slug = any(e.target_roles)
               and exists (
                 select 1 from org_members m
                  where m.org_id = p_org and m.role_id = r.id and m.user_id = auth.uid())))
   order by e.created_at desc
$$;

create or replace function public.work_queue_proposal_list(p_org uuid)
returns table(id uuid, kind text, title text, body text, status text, target_roles text[],
              source_escalation_id uuid, created_at timestamptz, decided_at timestamptz, engagement_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.kind, p.title, p.body, p.status, p.target_roles,
         p.source_escalation_id, p.created_at, p.decided_at, p.engagement_id
    from work_queue_proposals p
   where p.org_id = p_org
     and (p_org = public.jwt_org_id() or public.is_platform_admin())
     and (public.is_platform_admin() or public.caller_has_right('view_all_scopes')
          or exists (
            select 1 from roles r
             where r.org_id = p_org
               and r.slug = any(p.target_roles)
               and exists (
                 select 1 from org_members m
                  where m.org_id = p_org and m.role_id = r.id and m.user_id = auth.uid())))
   order by p.created_at desc
$$;

-- The platform recipient list is platform-administrator data. Any signed-in user could read it.
create or replace function public.platform_list_recipients()
returns table(id uuid, address text)
language sql stable security definer set search_path = public as $$
  select r.id, r.address from platform_notification_recipients r
   where public.is_platform_admin()
   order by r.address
$$;

-- ---------------------------------------------------------------------------
-- 3. has_feature answers for the caller's own organisation only. Public verification (anonymous
--    callers) needs the feature check for the certificate's org, so it uses the internal function,
--    which end users cannot call.
-- ---------------------------------------------------------------------------
create or replace function public.feature_enabled_internal(p_org uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_default boolean;
  v_enabled boolean;
begin
  select c.default_on into v_default from feature_catalogue c where c.key = p_key;
  if not found then
    return false;
  end if;
  select e.enabled into v_enabled
    from tenant_entitlements e
   where e.org_id = p_org and e.feature_key = p_key
     and e.effective_from <= now() and (e.effective_to is null or e.effective_to > now())
   order by e.effective_from desc
   limit 1;
  if v_enabled is not null then
    return v_enabled;
  end if;
  return coalesce(v_default, false);
end $$;
revoke execute on function public.feature_enabled_internal(uuid, text) from public, anon, authenticated;

create or replace function public.has_feature(p_org uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  -- A signed-in caller asks about its own org (or is a platform administrator). Database-internal
  -- callers (no request claims, or the service role) are not restricted.
  if coalesce(current_setting('request.jwt.claims', true), '') <> ''
     and auth.role() <> 'service_role'
     and p_org is distinct from public.jwt_org_id()
     and not public.is_platform_admin() then
    return false;
  end if;
  return public.feature_enabled_internal(p_org, p_key);
end $$;

-- Point the two public verification functions at the internal check, leaving their behaviour
-- unchanged. The replacement is asserted, so a changed body fails the migration rather than
-- silently keeping the restricted check.
do $$
declare
  fn text;
  def text;
  n_before int;
begin
  foreach fn in array array['verify_certificate', 'verify_board_pack'] loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p where p.proname = fn and p.pronamespace = 'public'::regnamespace;
    n_before := (length(def) - length(replace(def, 'public.has_feature(', ''))) / length('public.has_feature(');
    assert n_before > 0, format('%s no longer calls has_feature; review 0084 section 3', fn);
    execute replace(def, 'public.has_feature(', 'public.feature_enabled_internal(');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Row-level write policies must tie a child row's parent to the same organisation. Each policy
--    checked that the row's own org matched the caller and that the parent existed, but not that
--    the parent belonged to that org. A caller could therefore attach a row to another tenant's
--    parent (for example a sample to another org's population, or a plan version to another org's
--    plan). Each policy below is the existing one with the parent's org tied to the row's org.
-- ---------------------------------------------------------------------------
drop policy if exists cap_items_write on cap_items;
create policy cap_items_write on cap_items for all to authenticated
  using ((org_id = public.jwt_org_id()) and exists (select 1 from issues i where i.id = cap_items.issue_id and i.org_id = cap_items.org_id))
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from issues i where i.id = cap_items.issue_id and i.org_id = cap_items.org_id));

drop policy if exists findings_write on findings;
create policy findings_write on findings for all to authenticated
  using ((org_id = public.jwt_org_id()) and ((exists (select 1 from observations o where o.id = findings.observation_id and o.org_id = findings.org_id))
         or (exists (select 1 from entities en where en.id = findings.entity_id and en.org_id = findings.org_id))))
  with check ((org_id = public.jwt_org_id()) and ((exists (select 1 from observations o where o.id = findings.observation_id and o.org_id = findings.org_id))
         or (exists (select 1 from entities en where en.id = findings.entity_id and en.org_id = findings.org_id))));

drop policy if exists issues_write on issues;
create policy issues_write on issues for all to authenticated
  using ((org_id = public.jwt_org_id()) and exists (select 1 from entities en where en.id = issues.entity_id and en.org_id = issues.org_id))
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from entities en where en.id = issues.entity_id and en.org_id = issues.org_id));

drop policy if exists observations_write on observations;
create policy observations_write on observations for all to authenticated
  using ((org_id = public.jwt_org_id()) and exists (select 1 from engagements e where e.id = observations.engagement_id and e.org_id = observations.org_id))
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from engagements e where e.id = observations.engagement_id and e.org_id = observations.org_id));

drop policy if exists plan_versions_insert on plan_versions;
create policy plan_versions_insert on plan_versions for insert to authenticated
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from plans p where p.id = plan_versions.plan_id and p.org_id = plan_versions.org_id));

drop policy if exists population_rows_write on population_rows;
create policy population_rows_write on population_rows for all to authenticated
  using ((org_id = public.jwt_org_id()) and exists (select 1 from populations p where p.id = population_rows.population_id and p.org_id = population_rows.org_id))
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from populations p where p.id = population_rows.population_id and p.org_id = population_rows.org_id));

drop policy if exists populations_write on populations;
create policy populations_write on populations for all to authenticated
  using ((org_id = public.jwt_org_id()) and exists (select 1 from engagements e where e.id = populations.engagement_id and e.org_id = populations.org_id))
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from engagements e where e.id = populations.engagement_id and e.org_id = populations.org_id));

drop policy if exists sample_rows_write on sample_rows;
create policy sample_rows_write on sample_rows for all to authenticated
  using ((org_id = public.jwt_org_id()) and exists (select 1 from samples s where s.id = sample_rows.sample_id and s.org_id = sample_rows.org_id))
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from samples s where s.id = sample_rows.sample_id and s.org_id = sample_rows.org_id));

drop policy if exists samples_write on samples;
create policy samples_write on samples for all to authenticated
  using ((org_id = public.jwt_org_id()) and exists (select 1 from populations p where p.id = samples.population_id and p.org_id = samples.org_id))
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from populations p where p.id = samples.population_id and p.org_id = samples.org_id));

drop policy if exists sign_offs_insert on sign_offs;
create policy sign_offs_insert on sign_offs for insert to authenticated
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from workpapers w where w.id = sign_offs.workpaper_id and w.org_id = sign_offs.org_id));

drop policy if exists test_rows_write on test_rows;
create policy test_rows_write on test_rows for all to authenticated
  using ((org_id = public.jwt_org_id()) and exists (select 1 from workpapers w where w.id = test_rows.workpaper_id and w.org_id = test_rows.org_id))
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from workpapers w where w.id = test_rows.workpaper_id and w.org_id = test_rows.org_id));

drop policy if exists workpapers_write on workpapers;
create policy workpapers_write on workpapers for all to authenticated
  using ((org_id = public.jwt_org_id()) and exists (select 1 from engagements e where e.id = workpapers.engagement_id and e.org_id = workpapers.org_id))
  with check ((org_id = public.jwt_org_id()) and exists (select 1 from engagements e where e.id = workpapers.engagement_id and e.org_id = workpapers.org_id));

-- ---------------------------------------------------------------------------
-- 5. snapshot_plan_version wrote a version row tagged with the caller's org against another org's
--    plan. It must refuse a plan outside the caller's organisation.
-- ---------------------------------------------------------------------------
do $$
declare def text; n int;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p where p.proname = 'snapshot_plan_version' and p.pronamespace = 'public'::regnamespace;
  n := (length(def) - length(replace(def, E'begin\n  select coalesce(max(version), 0) + 1', ''))) / length(E'begin\n  select coalesce(max(version), 0) + 1');
  assert n = 1, 'snapshot_plan_version body changed; review 0084 section 5';
  execute replace(def, E'begin\n  select coalesce(max(version), 0) + 1',
    E'begin\n  if not exists (select 1 from plans where id = p_plan and org_id = v_org) then\n    raise exception ''plan not found in this organisation'' using errcode = ''P0001'';\n  end if;\n  select coalesce(max(version), 0) + 1');
end $$;
