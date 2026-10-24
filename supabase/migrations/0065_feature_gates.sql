-- 0065_feature_gates.sql — M-4b: retrofit the feature gate (F25) into the feature RPCs that were
-- built before has_feature existed, and into the ones whose gate was missed.
--
-- F25 enforcement rule 2: "Existing RPCs for features that already exist ... are retrofitted to call
-- has_feature." Rule 1: "Every new feature RPC calls it before its right check." Each function below
-- is reproduced verbatim from its original migration with one added block at the top of its body (or,
-- where the organisation id is only known after a lookup, immediately after that lookup). Nothing else
-- changes, so `create or replace` keeps the same signature, volatility, security and grants.
--
-- M2: `create or replace function` is idempotent, so this file is safe to apply repeatedly. No object
-- is created that a prior migration could have defined with a different shape (M4).
--
-- M1: every name below was grepped in supabase/migrations and supabase/tests. All nine exist; each is
-- extended here, not created. See docs/ACP-DECISIONS.md D-M4b-M1.

-- ---------------------------------------------------------------------------
-- board_pack (F10): the snapshot and the section save. board_pack_generate already gated.
-- ---------------------------------------------------------------------------

create or replace function public.board_pack_snapshot(
  p_org uuid, p_scope_key text default 'org',
  p_from timestamptz default null, p_to timestamptz default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := coalesce(p_from, '1970-01-01'::timestamptz);
  v_to timestamptz := coalesce(p_to, now());
  v_sira jsonb;
  v_plan jsonb;
  v_cap jsonb;
  v_sealed jsonb;
  v_responses jsonb;
  v_excluded jsonb;
begin
  if not public.has_feature(p_org, 'board_pack') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  -- SIRA residual risk by band, with the score rows behind each band as refs.
  select coalesce(jsonb_agg(fig order by fig ->> 'band'), '[]'::jsonb) into v_sira
    from (
      select jsonb_build_object(
               'band', public.sira_band_for(p_org, s.score),
               'value', count(*),
               'refs', jsonb_agg(jsonb_build_object('type', 'sira_score', 'id', s.id))
             ) as fig
        from sira_scores s
       where s.org_id = p_org
       group by public.sira_band_for(p_org, s.score)
    ) t;

  -- Audit plan progress: counts by plan_item.status, with the items behind each count as refs.
  select jsonb_build_object(
           'value', count(*),
           'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'plan_item', 'id', i.id)), '[]'::jsonb),
           'by_status', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'status', i2.status, 'value', cnt,
                      'refs', refs) order by i2.status)
               from (
                 select i2.status, count(*) as cnt,
                        jsonb_agg(jsonb_build_object('type', 'plan_item', 'id', i2.id)) as refs
                   from plan_items i2
                  where i2.org_id = p_org
                  group by i2.status
               ) i2
           ), '[]'::jsonb)
         ) into v_plan
    from plan_items i
   where i.org_id = p_org;

  -- CAP aging by severity band (0-30, 31-60, 61-90, 90+ days past due), with the caps as refs.
  select jsonb_object_agg(band, fig) into v_cap
    from (
      select case
               when c.due_date is null then 'no_due_date'
               when c.due_date >= current_date then 'not_due'
               when current_date - c.due_date <= 30 then '0-30'
               when current_date - c.due_date <= 60 then '31-60'
               when current_date - c.due_date <= 90 then '61-90'
               else '90+'
             end as band,
             jsonb_build_object(
               'value', count(*),
               'refs', jsonb_agg(jsonb_build_object('type', 'cap', 'id', c.id))
             ) as fig
        from caps c
       where c.org_id = p_org
         and c.status <> 'verified_closed'
       group by 1
    ) t;
  v_cap := coalesce(v_cap, '{}'::jsonb);

  -- Sealed work and integrity: signed-off workpapers and sealed engagements, with root hashes.
  select jsonb_build_object(
           'value', count(*),
           'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'workpaper', 'id', w.id)), '[]'::jsonb)
         ) into v_sealed
    from workpapers w
   where w.org_id = p_org and w.status = 'signed_off';
  v_sealed := coalesce(v_sealed, jsonb_build_object('value', 0, 'refs', '[]'::jsonb));
  v_sealed := v_sealed || jsonb_build_object(
    'sealed_engagements', coalesce((
      select jsonb_build_object(
               'value', count(*),
               'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'engagement', 'id', e.id)), '[]'::jsonb))
        from engagements e where e.org_id = p_org and e.sealed), jsonb_build_object('value', 0, 'refs', '[]'::jsonb)),
    'root_hashes', coalesce((
      select jsonb_agg(jsonb_build_object('engagement_id', cr.engagement_id, 'row_hash', cr.row_hash))
        from conclusion_records cr join engagements e2 on e2.id = cr.engagement_id
       where e2.org_id = p_org and e2.sealed), '[]'::jsonb));

  -- Management responses: report text blocks carrying a management response section.
  select jsonb_build_object(
           'value', count(*),
           'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'report_block', 'id', b.id)), '[]'::jsonb)
         ) into v_responses
    from report_blocks b
   where b.org_id = p_org and b.section_type = 'management_response';
  v_responses := coalesce(v_responses, jsonb_build_object('value', 0, 'refs', '[]'::jsonb));

  -- The honest footnote: how many items are NOT yet sealed, so they are not counted above.
  select jsonb_build_object(
           'unsealed_workpapers', (
             select count(*) from workpapers w2
              where w2.org_id = p_org and w2.status <> 'signed_off'),
           'unsealed_engagements', (
             select count(*) from engagements e3
              where e3.org_id = p_org and not e3.sealed),
           'note', 'Items not yet sealed are not included.'
         ) into v_excluded;

  return jsonb_build_object(
    'scope_key', p_scope_key,
    'org_id', p_org,
    'from_ts', v_from,
    'to_ts', v_to,
    'sira', jsonb_build_object('bands', v_sira),
    'plan', v_plan,
    'cap', v_cap,
    'sealed_work', v_sealed,
    'management_responses', v_responses,
    'excluded', v_excluded
  );
end $$;

create or replace function public.board_pack_sections_save(p_org uuid, p_sections jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
begin
  if not public.has_feature(p_org, 'board_pack') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if not public.config_actor_ok(p_org, 'edit_config') then
    raise exception 'not allowed: the caller cannot edit the Board Pack sections' using errcode = 'P0001';
  end if;
  perform public.board_pack_sections_seed(p_org);
  for v_item in select * from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) loop
    update board_pack_sections
       set ordinal = coalesce((v_item ->> 'ordinal')::int, ordinal),
           enabled = coalesce((v_item ->> 'enabled')::boolean, enabled),
           visible_roles = coalesce(
             (select array_agg(value::text) from jsonb_array_elements_text(v_item -> 'visible_roles')),
             visible_roles),
           label = coalesce(v_item ->> 'label', label)
     where org_id = p_org and section_key = v_item ->> 'section_key';
  end loop;
  perform public.append_ledger_entry(p_org, 'board_pack_sections_saved',
    jsonb_build_object('sections', p_sections), auth.uid());
end $$;

create or replace function public.certificate_config_save(p_org uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  f jsonb;
  i int := 0;
begin
  if not public.has_feature(p_org, 'certificates') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if not public.config_actor_ok(p_org, 'edit_config') then
    raise exception 'not allowed: the caller cannot edit the certificate configuration' using errcode = 'P0001';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'certificate_config_save: fields must be an array' using errcode = 'P0001';
  end if;
  perform public.certificate_config_seed(p_org);
  for f in select * from jsonb_array_elements(p_fields) loop
    i := i + 1;
    update certificate_config
       set ordinal = i,
           enabled = coalesce((f ->> 'enabled')::boolean, enabled)
     where org_id = p_org and field_key = (f ->> 'field_key');
  end loop;
  perform public.append_ledger_entry(p_org, 'certificate_config_saved',
    jsonb_build_object('fields', p_fields), auth.uid());
end $$;

create or replace function public.certificate_revoke(p_certificate_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select c.org_id into v_org from engagement_certificates c where c.id = p_certificate_id;
  if not public.has_feature(v_org, 'certificates') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;

  if v_org is null then
    raise exception 'certificate_revoke: certificate % not found', p_certificate_id using errcode = 'P0001';
  end if;
  if not public.caller_has_right('can_reopen') then
    raise exception 'not allowed: the caller cannot revoke a certificate' using errcode = 'P0001';
  end if;
  if length(v_reason) < 5 then
    raise exception 'certificate_revoke: a reason is required' using errcode = 'P0001';
  end if;

  update engagement_certificates
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = v_reason
   where id = p_certificate_id;

  perform public.append_ledger_entry(v_org, 'certificate_revoked',
    jsonb_build_object('certificate_id', p_certificate_id, 'reason', v_reason), auth.uid());
end $$;

create or replace function public.verify_certificate(p_id uuid)
returns table (status text, issued_at timestamptz, cert_hash text, sealed_workpapers int,
               findings_count int, organisation text, engagement_title text)
language plpgsql security definer set search_path = public as $$
declare
  v_row engagement_certificates;
  v_show boolean;
begin
  if not public.verify_rate_ok('certificate', p_id) then
    return query select 'rate_limited'::text, null::timestamptz, null::text, null::int, null::int,
                        null::text, null::text;
    return;
  end if;
  select c.* into v_row from engagement_certificates c where c.id = p_id;
  if not found then
    return query select 'not_found'::text, null::timestamptz, null::text, null::int, null::int,
                        null::text, null::text;
    return;
  end if;
  if not public.has_feature(v_row.org_id, 'public_verification') then
    return query select 'not_found'::text, null::timestamptz, null::text, null::int, null::int,
                        null::text, null::text;
    return;
  end if;
  select coalesce(e.public_verify_show_title, false) into v_show
    from org_settings_extra e where e.org_id = v_row.org_id;
  return query select
    v_row.status,
    v_row.issued_at,
    v_row.cert_hash,
    (v_row.canonical ->> 'sealed_workpapers')::int,
    (v_row.canonical ->> 'findings_count')::int,
    case when coalesce(v_show, false) then (select o.name from orgs o where o.id = v_row.org_id) end,
    case when coalesce(v_show, false) then (v_row.canonical ->> 'engagement_title') end;
end $$;

create or replace function public.ai_call_log(
  p_org uuid, p_use_case text, p_model_name text, p_model_digest text,
  p_prompt_hash text, p_response_hash text, p_access_mode text, p_flags jsonb default '{}'::jsonb,
  p_prompt_text text default null, p_response_text text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_retention int;
begin
  if not public.has_feature(p_org, 'ai_assist') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if not public.config_actor_ok(p_org, 'edit_config') and not public.is_platform_admin() then
    raise exception 'not allowed: the caller cannot log an AI call for this organisation'
      using errcode = 'P0001';
  end if;
  v_retention := coalesce((select ose.ai_retention_days from org_settings_extra ose where ose.org_id = p_org), 30);
  insert into ai_calls (org_id, use_case, model_name, model_digest, prompt_hash, response_hash,
                        prompt_text, response_text, access_mode, flags, actor)
  values (p_org, p_use_case, p_model_name, p_model_digest, p_prompt_hash, p_response_hash,
          case when v_retention = 0 then null else p_prompt_text end,
          case when v_retention = 0 then null else p_response_text end,
          p_access_mode, coalesce(p_flags,'{}'::jsonb), auth.uid())
  returning id into v_id;
  -- The ledger keeps hashes forever (F8, F20).
  perform public.append_ledger_entry(p_org, 'ai_call',
    jsonb_build_object('use_case', p_use_case, 'model', p_model_name, 'model_digest', p_model_digest,
                       'prompt_hash', p_prompt_hash, 'response_hash', p_response_hash,
                       'access_mode', p_access_mode, 'flags', coalesce(p_flags,'{}'::jsonb)), auth.uid());
  return v_id;
end $$;

create or replace function public.automation_rule_save(
  p_org uuid, p_rule_key text, p_name text, p_event_key text,
  p_conditions jsonb, p_actions jsonb, p_enabled boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_feature(p_org, 'automation_rules') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  perform public.require_config_actor(p_org, 'edit_config');
  insert into automation_rules (org_id, rule_key, name, event_key, conditions, actions, enabled, created_by)
  values (p_org, p_rule_key, p_name, p_event_key, coalesce(p_conditions,'[]'::jsonb),
          coalesce(p_actions,'[]'::jsonb), coalesce(p_enabled, true), auth.uid())
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_key)
  do update set name = excluded.name, event_key = excluded.event_key,
                conditions = excluded.conditions, actions = excluded.actions,
                enabled = excluded.enabled, paused_at = null, pause_reason = null,
                updated_at = now()
  returning id into v_id;

  perform public.automation_rule_version_write(p_org, v_id, 'save',
    jsonb_build_object('rule_key', p_rule_key, 'event_key', p_event_key,
                       'enabled', p_enabled, 'conditions', p_conditions, 'actions', p_actions));
  return v_id;
end $$;

create or replace function public.automation_rule_test(p_rule_id uuid, p_sample jsonb)
returns table (recipients text[], subject text, body_text text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_rule automation_rules;
  v_action jsonb;
  v_addrs text[] := '{}';
  v_render record;
begin
  select * into v_rule from automation_rules where id = p_rule_id;
  if not found then
    raise exception 'no such rule' using errcode = 'P0001';
  end if;
  if not public.has_feature(v_rule.org_id, 'automation_rules') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if v_rule.org_id is not null then
    perform public.require_config_actor(v_rule.org_id, 'edit_config');
  elsif not public.is_platform_admin() then
    raise exception 'not allowed: only the platform admin edits a platform rule' using errcode = 'P0001';
  end if;

  for v_action in select * from jsonb_array_elements(v_rule.actions) loop
    if v_action ->> 'type' = 'notify' then
      v_addrs := v_addrs || public.rule_recipients(v_rule.org_id, v_action);
    end if;
  end loop;

  select * into v_render from public.render_notification(v_rule.org_id, v_rule.event_key, p_sample);
  return query select
    (select coalesce(array_agg(distinct a), '{}') from unnest(v_addrs) a),
    coalesce(v_render.subject, ''), coalesce(v_render.body_text, '');
end $$;

create or replace function public.escalation_evaluate(p_event_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_event automation_events;
  v_rule record;
  v_action jsonb;
  v_rec record;
  v_fired int := 0;
  v_proposal_id uuid;
  v_escalation_id uuid;
  v_title text;
  v_roles text[];
begin
  select * into v_event from automation_events where id = p_event_id;
  if not found then
    return 0;
  end if;
  if not public.has_feature(v_event.org_id, 'escalation') then
    return 0;
  end if;

  for v_rule in
    select r.* from automation_rules r
     where r.enabled and r.paused_at is null
       and r.event_key = v_event.event_key
       and (r.actions @> '[{"type":"escalate"}]'::jsonb)
       and (r.org_id = v_event.org_id
            or (r.org_id is null and not exists (
                  select 1 from automation_rules t
                   where t.org_id = v_event.org_id and t.rule_key = r.rule_key)))
     order by r.org_id nulls last, r.rule_key
  loop
    -- Idempotent per event: this rule has already escalated this event.
    if exists (select 1 from escalation_events
                where source_event_id = p_event_id and rule_id = v_rule.id) then
      continue;
    end if;
    if not public.rule_conditions_ok(v_event.payload, v_rule.conditions) then
      continue;
    end if;
    if not public.rule_loop_guard(v_rule.id) then
      continue;
    end if;

    for v_action in select * from jsonb_array_elements(v_rule.actions)
    loop
      if v_action ->> 'type' <> 'escalate' then
        continue;
      end if;

      select * into v_rec from public.escalation_recommendation(v_event.payload, v_action -> 'recommendation');

      v_roles := coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(v_action -> 'to_roles')), '{}');

      insert into escalation_events (org_id, rule_id, rule_key, source_event_key, source_event_id,
                                     severity, recommendation, reason, target_roles, payload, actor_id)
      values (v_event.org_id, v_rule.id, v_rule.rule_key, v_event.event_key, p_event_id,
              coalesce(v_event.payload ->> 'severity', v_action ->> 'severity'),
              v_rec.recommendation, v_rec.reason, v_roles, v_event.payload, auth.uid())
      returning id into v_escalation_id;

      insert into notifications (org_id, user_id, kind, body, event_key, payload, role_target)
      values (v_event.org_id, null, 'escalation.triggered',
              format('%s — %s', v_rec.recommendation, v_rec.reason),
              'escalation.triggered',
              jsonb_build_object('escalation_id', v_escalation_id, 'recommendation', v_rec.recommendation,
                                 'reason', v_rec.reason, 'payload', v_event.payload),
              coalesce(v_action ->> 'role_target', v_roles[1], 'all'));

      if coalesce((v_action ->> 'create_proposal')::boolean, false) then
        v_title := coalesce(v_action ->> 'proposal_title', 'Mini-engagement draft');
        insert into work_queue_proposals (org_id, kind, title, body, status, target_roles,
                                          source_escalation_id, created_by)
        values (v_event.org_id, 'mini_engagement_draft', v_title,
                format('%s — %s', v_rec.recommendation, v_rec.reason),
                'proposed', v_roles, v_escalation_id, auth.uid())
        returning id into v_proposal_id;
      end if;

      -- The escalation is logged to the ledger too (L5).
      perform public.append_ledger_entry(v_event.org_id, 'escalation_triggered',
        jsonb_build_object('rule_key', v_rule.rule_key, 'recommendation', v_rec.recommendation,
                           'reason', v_rec.reason, 'source_event', v_event.event_key), auth.uid());
      v_fired := v_fired + 1;
    end loop;
  end loop;

  return v_fired;
end $$;
