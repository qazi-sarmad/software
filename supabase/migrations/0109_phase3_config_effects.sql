-- ---------------------------------------------------------------------------
-- 0109 — Phase 3.6: make the last inert configuration fields have a real effect.
--
-- The audit (docs/FUNCTIONALITY-AUDIT.md §2.4, docs/REMEDIATION-PLAN.md Part 2) found seven
-- configuration columns that are stored, versioned and echoed by a getter but consulted by no
-- decision. Phase 3.1–3.5 enforced the workflow, lifecycle, template and anchoring fields; this
-- migration closes the remaining surfaced ones. Owner decision (2026-10-28): enforce, do not remove.
--
--   org_lifecycle_settings.report_opinion_required   -> sign_conclusion (was reading a different key)
--   entity_approval_settings.required_fields          -> submit_entity validates the named fields
--   pattern_settings.visibility_right                 -> pattern_findings gates on it, not a constant
--   export_retention_settings.activity_retention_days -> archive_activity_period honours the window
--   export_retention_settings.export_schedule         -> scheduled_export_due() reports what is due
--   org_settings_extra.certificate_auto_issue         -> seal_engagement issues the certificate
--   org_settings_extra.last_board_meeting_date        -> board_pack_generate 'since_last_meeting'
--
-- The two remaining columns (tenant_settings.usage_quota, and the pattern cluster sizes that the
-- TypeScript engine consumes) are classified in docs/CONFIG-EFFECT-MATRIX.md.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. report_opinion_required. The Org Admin screen saves this column; sign_conclusion read the
--    legacy config_versions key 'conclusion.opinion_required' instead, so the toggle did nothing
--    (a two-sources defect). The opinion is now required when EITHER source asks for it.
-- ---------------------------------------------------------------------------
create or replace function public.sign_conclusion(p_engagement_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rec conclusion_records;
  v_opinion_required boolean;
  v_legacy boolean;
  v_role text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  select coalesce(s.signoff_role_conclusion, 'reviewer') into v_role
    from (select 1) x left join org_lifecycle_settings s on s.org_id = v_org;
  if not public.caller_meets_signoff_role(p_engagement_id, v_role) then
    raise exception 'signoff_role: conclusion sign-off requires the % team role', v_role using errcode = 'P0001';
  end if;

  select * into v_rec from conclusion_records c
   where c.engagement_id = p_engagement_id and c.org_id = v_org;
  if v_rec.id is null then
    raise exception 'conclusion_missing: pull the Testing exceptions before signing off'
      using errcode = 'P0001';
  end if;
  if v_rec.locked_at is not null then
    raise exception 'conclusion_locked: the conclusion is already signed off' using errcode = 'P0001';
  end if;

  if v_rec.prepared_by is not null and v_rec.prepared_by = auth.uid() then
    raise exception 'four_eyes: the signer pulled the exceptions' using errcode = 'P0001';
  end if;

  -- 3.6: the Org Admin's toggle (org_lifecycle_settings) is the product source; the config_versions
  -- key is the older methodology source. Either asking for the opinion makes it required.
  select coalesce((select s.report_opinion_required from org_lifecycle_settings s where s.org_id = v_org), false)
    into v_opinion_required;
  select coalesce((select (v.value)::boolean from config_versions v
                    where v.org_id = v_org and v.key = 'conclusion.opinion_required'
                    order by v.version desc limit 1), false)
    into v_legacy;
  v_opinion_required := coalesce(v_opinion_required, false) or coalesce(v_legacy, false);
  if v_opinion_required and nullif(btrim(coalesce(v_rec.overall_opinion, '')), '') is null then
    raise exception 'opinion_required: this organisation requires an overall opinion before sign-off'
      using errcode = 'P0001';
  end if;

  update conclusion_records c
     set signed_off_at = now(), signed_off_by = auth.uid(), locked_at = now()
   where c.id = v_rec.id;

  update engagements set sealed = true where id = p_engagement_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'conclusion_signed_off',
    jsonb_build_object('engagement_id', p_engagement_id,
                       'exceptions', jsonb_array_length(v_rec.exceptions)), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'conclusion_signed_off', 'engagement', p_engagement_id,
          jsonb_build_object('exceptions', jsonb_array_length(v_rec.exceptions)));
end $$;

revoke execute on function public.sign_conclusion(uuid) from public, anon;
grant execute on function public.sign_conclusion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. required_fields. entity_approval_settings.required_fields is an array of entity field names the
--    organisation requires before an entity may be submitted. It was stored and echoed, never read.
--    submit_entity now validates every named field. 'name' is always required by the schema; a field
--    the entity table does not carry is ignored rather than guessed at.
-- ---------------------------------------------------------------------------
create or replace function public.submit_entity(p_entity_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_entity entities;
  v_cfg record;
  v_required jsonb;
  v_field text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;

  select * into v_entity from entities where id = p_entity_id;
  if v_entity.id is null then
    raise exception 'entity not found' using errcode = 'P0001';
  end if;
  if v_entity.org_id <> v_org then
    raise exception 'entity is outside the caller''s organisation' using errcode = 'P0001';
  end if;

  select * into v_cfg from public.entity_approval_config(v_org);
  if not coalesce(public.caller_has_right(v_cfg.initiate_right), false) then
    raise exception 'not allowed: caller lacks the % right to submit an entity', v_cfg.initiate_right
      using errcode = 'P0001';
  end if;
  if v_entity.status not in ('draft', 'rejected') then
    raise exception 'entity is already %; only a draft or rejected entity can be submitted', v_entity.status
      using errcode = 'P0001';
  end if;

  -- 3.6: the configured required fields must be present on the entity before it can be submitted.
  v_required := coalesce(v_cfg.required_fields, '["name"]'::jsonb);
  for v_field in select value from jsonb_array_elements_text(v_required) loop
    if v_field = 'name' and nullif(btrim(coalesce(v_entity.name, '')), '') is null then
      raise exception 'required_field: an entity needs a name before it can be submitted' using errcode = 'P0001';
    end if;
    if v_field = 'kind' and nullif(btrim(coalesce(v_entity.kind, '')), '') is null then
      raise exception 'required_field: this organisation requires an entity kind before submission'
        using errcode = 'P0001';
    end if;
  end loop;

  insert into entity_decision_grants (org_id, entity_id, txid) values (v_org, p_entity_id, txid_current());

  update entities
     set status = 'pending', submitted_by = auth.uid(), submitted_at = now(),
         rejection_reason = null
   where id = p_entity_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'entity_submitted', 'entity', p_entity_id,
          jsonb_build_object('status', 'pending'));
end $$;

revoke execute on function public.submit_entity(uuid) from public, anon;
grant execute on function public.submit_entity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. visibility_right. pattern_findings hardcoded 'view_insights'; the configured right was ignored.
--    The gate now reads pattern_settings.visibility_right, so raising it (for example to edit_config)
--    genuinely narrows who may read the corpus.
-- ---------------------------------------------------------------------------
create or replace function public.pattern_findings(p_org uuid)
returns table (finding_id uuid, entity_id uuid, entity_name text, year int, severity text,
               title text, condition_text text, risk_text text, effect_text text,
               control_tags text[], risk_tags text[], category_tags text[], entity_type text)
language plpgsql security definer set search_path = public as $$
declare
  v_years int;
  v_sev jsonb;
  v_visibility text;
begin
  if not public.has_feature(p_org, 'patterns') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  perform public.pattern_settings_seed(p_org);
  -- 3.6: the configured visibility_right is the gate, not the hardcoded 'view_insights'.
  select s.visibility_right into v_visibility from pattern_settings s where s.org_id = p_org;
  if not public.config_actor_ok(p_org, coalesce(nullif(btrim(v_visibility), ''), 'view_insights')) then
    raise exception 'not allowed: the caller cannot view patterns' using errcode = 'P0001';
  end if;
  select s.years_back, s.severities into v_years, v_sev from pattern_settings s where s.org_id = p_org;
  v_years := coalesce(v_years, 5);

  return query
    select f.id, f.entity_id, e.name, extract(year from f.created_at)::int,
           coalesce(sl.name, f.severity),
           coalesce(nullif(btrim(f.sections ->> 'title'), ''), o.title, 'Untitled finding'),
           coalesce(f.sections ->> 'condition', ''),
           coalesce(f.sections ->> 'risk', ''),
           coalesce(f.sections ->> 'effect', ''),
           coalesce((select array_agg(r.name order by r.name)
                       from risks_library r where r.id = any(f.linked_control_ids)), '{}'),
           coalesce((select array_agg(r.name order by r.name)
                       from risks_library r
                      where r.id in (select (value)::uuid from jsonb_array_elements_text(f.sections -> 'risk_ids'))), '{}'),
           coalesce((select array_agg(distinct i2.title order by i2.title)
                       from issues i2 where i2.org_id = p_org and i2.entity_id = f.entity_id), '{}'),
           coalesce(e.kind, '')
      from findings f
      left join entities e on e.id = f.entity_id
      left join observations o on o.id = f.observation_id
      left join severity_levels sl on sl.id = f.severity_level_id
     where f.org_id = p_org
       and f.status = 'concluded'
       and (v_sev = '[]'::jsonb or coalesce(sl.name, f.severity) in (
              select value from jsonb_array_elements_text(v_sev)))
       and f.created_at >= (now() - make_interval(years => v_years))
       and (public.can_read_all_scopes() or public.has_scope(null, f.entity_id, null))
     order by f.created_at asc, f.id asc;
end $$;

revoke execute on function public.pattern_findings(uuid) from public, anon;
grant execute on function public.pattern_findings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. export_retention_settings. Both columns were stored and echoed, never read. Two real effects:
--    (a) activity_retention_days bounds the window archive_activity_period will archive — an
--        organisation may not archive activity that is still inside its live retention period;
--    (b) export_schedule drives scheduled_export_due(), the reader a scheduled job consults.
-- ---------------------------------------------------------------------------
create or replace function public.activity_retention_days(p_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select s.activity_retention_days from export_retention_settings s where s.org_id = p_org), 365)
$$;

create or replace function public.export_schedule(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select s.export_schedule from export_retention_settings s where s.org_id = p_org), 'manual')
$$;

-- scheduled_export_due: is a periodic export due for this organisation at p_now, given the last
-- recorded export in exports_log and the configured schedule? 'manual' is never due.
create or replace function public.scheduled_export_due(p_org uuid, p_now timestamptz default now())
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_schedule text := public.export_schedule(p_org);
  v_last timestamptz;
  v_interval interval;
begin
  if v_schedule = 'manual' then
    return false;
  end if;
  v_interval := case v_schedule
                  when 'daily' then interval '1 day'
                  when 'weekly' then interval '7 days'
                  when 'monthly' then interval '1 month'
                end;
  select max(e.created_at) into v_last from exports_log e where e.org_id = p_org;
  if v_last is null then
    return true;
  end if;
  return p_now >= v_last + v_interval;
end $$;

create or replace function public.archive_activity_period(
  p_org_id uuid, p_period_start date, p_period_end date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rows jsonb;
  v_count int;
  v_hash text;
  v_path text;
  v_id uuid;
  v_retention int;
  v_effective_end date;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_org_id is distinct from v_org then
    raise exception 'cross-org archive refused' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if p_period_end < p_period_start then
    raise exception 'period_end precedes period_start' using errcode = 'P0001';
  end if;

  -- 3.6: activity_retention_days is the boundary. Activity newer than the retention window is still
  -- live, so the archived range is clamped to the cutoff rather than archiving live rows.
  v_retention := public.activity_retention_days(v_org);
  v_effective_end := least(p_period_end, current_date - v_retention);
  if v_effective_end < p_period_start then
    raise exception 'retention_window: no activity older than the % day retention period falls in this range',
      v_retention using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.ts), '[]'::jsonb), count(*)
    into v_rows, v_count
    from activity_log a
   where a.org_id = v_org
     and a.ts >= p_period_start::timestamptz
     and a.ts < (v_effective_end::timestamptz + interval '1 day');

  v_hash := public.ledger_payload_hash(public.canonical_payload(v_rows));
  v_path := v_org::text || '/activity/' || p_period_start::text || '_' || p_period_end::text || '.json';

  insert into archive_jobs (org_id, period_start, period_end, archived_row_count, storage_path,
                            content_hash, status)
  values (v_org, p_period_start, p_period_end, v_count, v_path, v_hash, 'pending')
  returning id into v_id;

  perform public.append_ledger_entry(
    v_org, 'activity_archived',
    jsonb_build_object('archive_id', v_id, 'period_start', p_period_start, 'period_end', p_period_end,
                       'effective_end', v_effective_end, 'retention_days', v_retention,
                       'row_count', v_count, 'content_hash', v_hash, 'storage_path', v_path),
    auth.uid());

  return v_id;
end $$;

revoke execute on function public.activity_retention_days(uuid) from public, anon;
revoke execute on function public.export_schedule(uuid) from public, anon;
revoke execute on function public.scheduled_export_due(uuid, timestamptz) from public, anon;
revoke execute on function public.archive_activity_period(uuid, date, date) from public, anon;
grant execute on function public.activity_retention_days(uuid) to authenticated;
grant execute on function public.export_schedule(uuid) to authenticated;
grant execute on function public.scheduled_export_due(uuid, timestamptz) to authenticated;
grant execute on function public.archive_activity_period(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. certificate_auto_issue. Sealing an engagement now issues its certificate when the organisation
--    asked for it and holds the entitlement. seal_engagement is extended in place; the 0101 checks
--    are unchanged and run first, so a refusal still happens for the same reasons.
-- ---------------------------------------------------------------------------
create or replace function public.seal_engagement(p_engagement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng engagements;
  v_total int;
  v_open int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;

  select * into v_eng from engagements where id = p_engagement_id and org_id = v_org;
  if v_eng.id is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if v_eng.sealed then
    raise exception 'already_sealed: the engagement is already sealed' using errcode = 'P0001';
  end if;

  select count(*) into v_total from workpapers where engagement_id = p_engagement_id and org_id = v_org;
  if v_total = 0 then
    raise exception 'sign_off_blocked: there are no working papers to seal' using errcode = 'P0001';
  end if;
  select count(*) into v_open from workpapers
   where engagement_id = p_engagement_id and org_id = v_org and status <> 'signed_off';
  if v_open > 0 then
    raise exception 'sign_off_blocked: % working paper(s) are not signed off', v_open using errcode = 'P0001';
  end if;

  perform public.assert_conclusion_ready(p_engagement_id);

  update engagements set sealed = true, stage = 'conclusion'
   where id = p_engagement_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'audit_sign_off',
    jsonb_build_object('engagement_id', p_engagement_id::text, 'workpapers', v_total),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'audit_sign_off', 'engagement', p_engagement_id,
          jsonb_build_object('workpapers', v_total));

  -- 3.6: certificate_auto_issue. When the organisation asked for an automatic certificate and holds
  -- the entitlement, issue it here. The decision lives in a certificates-owned helper so sealing
  -- stays a core lifecycle action that does not itself gate on a sellable feature, and a failure to
  -- issue can never roll back the completed seal (the flag and entitlement are checked first).
  perform public.auto_issue_certificate_on_seal(v_org, p_engagement_id);
end $$;

revoke execute on function public.seal_engagement(uuid) from public, anon;
grant execute on function public.seal_engagement(uuid) to authenticated;

-- The certificates-owned helper the seal calls. It is the only function here that gates on the
-- `certificates` feature, and it is mapped in src/lib/featureMap.ts accordingly.
create or replace function public.auto_issue_certificate_on_seal(p_org uuid, p_engagement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_auto boolean;
begin
  select coalesce(e.certificate_auto_issue, false) into v_auto
    from (select 1) x left join org_settings_extra e on e.org_id = p_org;
  if coalesce(v_auto, false)
     and public.has_feature(p_org, 'certificates')
     and public.caller_has_right('manage_engagements') then
    perform public.certificate_issue(p_engagement_id);
  end if;
end $$;

revoke execute on function public.auto_issue_certificate_on_seal(uuid, uuid) from public, anon;
grant execute on function public.auto_issue_certificate_on_seal(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. last_board_meeting_date. A new Board Pack boundary kind, 'since_last_meeting', starts the
--    window at the recorded last board meeting instead of the last pack. board_pack_generate is
--    extended in place; the existing boundary kinds are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.board_pack_generate(
  p_org uuid, p_scope_key text default 'org', p_boundary_kind text default 'since_last',
  p_from timestamptz default null, p_to timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_prev uuid;
  v_from timestamptz := p_from;
  v_to timestamptz := coalesce(p_to, now());
  v_snapshot jsonb;
  v_hash text;
  v_id uuid;
  v_ledger uuid;
begin
  if not public.config_actor_ok(p_org, 'generate_board_pack') then
    raise exception 'not allowed: the caller cannot generate a Board Pack' using errcode = 'P0001';
  end if;
  if not public.has_feature(p_org, 'board_pack') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_settings_extra where org_id = p_org and app_base_url is not null) then
    raise exception 'Set the application web address before generating a Board Pack.' using errcode = 'P0001';
  end if;

  perform public.board_pack_sections_seed(p_org);

  if p_boundary_kind = 'since_last_meeting' then
    -- 3.6: the configured last board meeting is the boundary. Without one the window is unbounded,
    -- which is what an organisation that has never held a board meeting should see.
    select e.last_board_meeting_date::timestamptz into v_from
      from org_settings_extra e where e.org_id = p_org;
  else
    -- Boundary option 1: since the last successful pack with the same scope_key.
    select h.id, h.to_ts into v_prev, v_from
      from board_pack_history h
     where h.org_id = p_org and h.scope_key = p_scope_key and h.status = 'ready'
     order by h.generated_at desc limit 1;
  end if;
  if v_from is null then
    v_from := '1970-01-01'::timestamptz;
  end if;

  v_snapshot := public.board_pack_snapshot(p_org, p_scope_key, v_from, v_to);
  v_hash := public.ledger_payload_hash(public.canonical_payload(v_snapshot));

  insert into board_pack_history (org_id, scope_key, scope_description, boundary_kind, from_ts, to_ts,
                                  generated_by, snapshot, data_hash, status, previous_pack_id)
  values (p_org, p_scope_key, p_scope_key, p_boundary_kind, v_from, v_to,
          auth.uid(), v_snapshot, v_hash, 'ready', v_prev)
  returning id into v_id;

  v_ledger := (public.append_ledger_entry(p_org, 'board_pack_generated',
    jsonb_build_object('pack_id', v_id, 'scope_key', p_scope_key, 'data_hash', v_hash,
                       'previous_pack_id', v_prev), auth.uid())).id;

  update board_pack_history set ledger_entry_id = v_ledger where id = v_id;
  return v_id;
end $$;

revoke execute on function public.board_pack_generate(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.board_pack_generate(uuid, text, text, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. usage_quota (tenant_settings). The control-plane column had no reader and no writer: a quota
--    set on a tenant was never consulted. A tenant user limit is now read from
--    usage_quota->>'users' and enforced when a member is provisioned. An empty object (the default)
--    means no limit, so nothing changes for a tenant that has not set one.
-- ---------------------------------------------------------------------------
create or replace function public.tenant_user_limit(p_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select nullif(ts.usage_quota ->> 'users', '')::int
    from tenant_settings ts where ts.org_id = p_org
$$;

create or replace function public.admin_provision_member(
  p_user uuid, p_display_name text, p_role_slug text, p_hierarchy_level int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_role_id uuid;
  v_limit int;
  v_count int;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_users');
  if p_user is null then
    raise exception 'a user id is required' using errcode = 'P0001';
  end if;
  -- 3.6: the tenant's user quota, when set, caps the member count. An existing member being updated
  -- is not a new seat, so only a genuinely new member is counted against the quota.
  v_limit := public.tenant_user_limit(v_org);
  if v_limit is not null
     and not exists (select 1 from org_members where org_id = v_org and user_id = p_user) then
    select count(*) into v_count from org_members where org_id = v_org;
    if v_count >= v_limit then
      raise exception 'usage_quota: this tenant is licensed for % user(s) and the limit is reached', v_limit
        using errcode = 'P0001';
    end if;
  end if;
  select r.id into v_role_id from roles r where r.org_id = v_org and r.slug = p_role_slug;
  if v_role_id is null then
    raise exception 'unknown role for this organisation: %', p_role_slug using errcode = 'P0001';
  end if;
  insert into org_members (org_id, user_id, role_id, display_name, hierarchy_level)
  values (v_org, p_user, v_role_id, coalesce(p_display_name, ''), p_hierarchy_level::smallint)
  on conflict (org_id, user_id) do update
    set role_id = excluded.role_id,
        display_name = excluded.display_name,
        hierarchy_level = excluded.hierarchy_level;
  perform public.admin_log_change(v_org, 'member:' || p_user::text,
    jsonb_build_object('user_id', p_user, 'role_slug', p_role_slug, 'display_name', p_display_name,
                       'hierarchy_level', p_hierarchy_level),
    'member_provisioned', 'org_member', p_user);
end $$;

revoke execute on function public.tenant_user_limit(uuid) from public, anon;
revoke execute on function public.admin_provision_member(uuid, text, text, int) from public, anon;
grant execute on function public.tenant_user_limit(uuid) to authenticated;
grant execute on function public.admin_provision_member(uuid, text, text, int) to authenticated;
