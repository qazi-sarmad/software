-- 0108: Phase 3.4 — make report_templates real (or hide it). We enforce it.
--
-- The audit found report_templates (0088) was fully inert: no writer RPC existed anywhere, no reader
-- existed anywhere, and no screen referenced it. Rows appeared only in a test seed. Meanwhile
-- compose_report (0038) hardcoded the five report sections, so an org could not change what its
-- reports contain.
--
-- This migration gives the table a real effect:
--
--   1. report_template_save(model_id, title, sections) — the missing writer. Requires edit_config,
--      validates the section list against the closed set the report editor understands, inserts a new
--      version and marks it current. The 0088 trigger writes the hash-chained report_template_versions
--      row, so every change is versioned and logged (§23).
--   2. report_template_list() — the reader, for the Org Admin screen.
--   3. compose_report (replaced) reads the org's current template for the engagement's model and
--      creates exactly those sections, in that order. With no template the pre-0108 five-section
--      default is produced unchanged, so an org that never configures a template is unaffected.
--
-- M2: create or replace; the template read is a left join, so a missing template changes nothing.

-- ---------------------------------------------------------------------------
-- 1. report_template_save (3.4). A template is a versioned section plan for a report model.
-- ---------------------------------------------------------------------------
create or replace function public.report_template_save(
  p_model_id text, p_title text, p_sections jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_next int;
  v_id uuid;
  v_sections jsonb;
  v_sec jsonb;
  v_ids text[] := array['executive_summary', 'scope', 'findings', 'opinion', 'appendices'];
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.admin_require_right('edit_config');
  if p_model_id is null or length(btrim(p_model_id)) = 0 then
    raise exception 'a model id is required' using errcode = 'P0001';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) = 0 then
    raise exception 'a template needs a non-empty array of sections' using errcode = 'P0001';
  end if;
  -- Every section id must be one the report editor knows, so a template can never name a section
  -- the product cannot render.
  for v_sec in select value from jsonb_array_elements(p_sections) loop
    if coalesce(v_sec ->> 'id', '') <> all(v_ids) then
      raise exception 'unknown section id: %', coalesce(v_sec ->> 'id', '(none)') using errcode = 'P0001';
    end if;
  end loop;
  -- Normalise the order: 1..n in array order, so the stored plan is unambiguous.
  select coalesce(jsonb_agg(jsonb_build_object('id', s.value ->> 'id', 'order', s.ord) order by s.ord), '[]'::jsonb)
    into v_sections
    from jsonb_array_elements(p_sections) with ordinality as s(value, ord);

  select coalesce(max(t.version), 0) + 1 into v_next
    from report_templates t where t.org_id = v_org and t.model_id = p_model_id;

  -- The previous current version stops being current.
  update report_templates set is_current = false
   where org_id = v_org and model_id = p_model_id and is_current;

  insert into report_templates (org_id, model_id, version, title, plan, is_current, created_by)
  values (v_org, p_model_id, v_next, coalesce(nullif(btrim(coalesce(p_title, '')), ''), p_model_id),
          jsonb_build_object('sections', v_sections), true, auth.uid())
  returning id into v_id;

  perform public.admin_log_change(v_org, 'report_templates',
    jsonb_build_object('model_id', p_model_id, 'version', v_next, 'sections', v_sections),
    'report_template_saved', 'report_template', v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. report_template_list (3.4) — the org's current template per model, for the Org Admin screen.
-- ---------------------------------------------------------------------------
create or replace function public.report_template_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'model_id', t.model_id, 'version', t.version, 'title', t.title,
           'sections', coalesce(t.plan -> 'sections', '[]'::jsonb), 'updated_at', t.created_at)
         order by t.model_id), '[]'::jsonb)
  from report_templates t
  where t.org_id = public.jwt_org_id() and t.is_current;
$$;

-- ---------------------------------------------------------------------------
-- 3. compose_report (3.4, replaced). Body is the 0038 definition; the five fixed sections become a
--    loop over the org's current template (defaulting to the same five when none is configured).
-- ---------------------------------------------------------------------------
create or replace function public.compose_report(p_engagement_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_entity uuid;
  v_version uuid;
  v_next int;
  v_findings int;
  v_scope jsonb;
  v_opinion text;
  v_pos int := 0;
  v_sections jsonb;
  v_sec text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  select e.entity_id into v_entity from engagements e where e.id = p_engagement_id and e.org_id = v_org;
  if v_entity is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from conclusion_records c
                  where c.engagement_id = p_engagement_id and c.org_id = v_org and c.locked_at is not null) then
    raise exception 'conclusion_not_signed_off: the report becomes available only after Conclusion sign-off'
      using errcode = 'P0001';
  end if;

  select coalesce(max(r.version_number), 0) + 1 into v_next
  from report_versions r where r.engagement_id = p_engagement_id and r.org_id = v_org;

  insert into report_versions (org_id, engagement_id, version_number, status, created_by)
  values (v_org, p_engagement_id, v_next, 'draft', auth.uid())
  returning id into v_version;

  select count(*) into v_findings from findings f
   where f.org_id = v_org and f.entity_id = v_entity;

  select content into v_scope from planning_sections s
   where s.engagement_id = p_engagement_id and s.org_id = v_org and s.section_type = 'scope';
  select c.overall_opinion into v_opinion from conclusion_records c
   where c.engagement_id = p_engagement_id and c.org_id = v_org;

  -- The org's current template for the default model M1, else the pre-0108 default section order.
  select coalesce(
           (select t.plan -> 'sections' from report_templates t
             where t.org_id = v_org and t.model_id = 'M1' and t.is_current
             order by t.version desc limit 1),
           jsonb_build_array(
             jsonb_build_object('id', 'executive_summary', 'order', 1),
             jsonb_build_object('id', 'scope', 'order', 2),
             jsonb_build_object('id', 'findings', 'order', 3),
             jsonb_build_object('id', 'opinion', 'order', 4),
             jsonb_build_object('id', 'appendices', 'order', 5)))
    into v_sections;

  for v_sec in select s.value ->> 'id' from jsonb_array_elements(v_sections) s order by (s.value ->> 'order')::int
  loop
    if v_sec = 'scope' then
      insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                                 content, position, is_placeholder)
      values (v_org, p_engagement_id, v_version, 'scope', 'text',
              case when v_scope is null or v_scope = '{}'::jsonb
                   then jsonb_build_object('missing', 'scope')
                   else v_scope end,
              v_pos, v_scope is null or v_scope = '{}'::jsonb);
    elsif v_sec = 'executive_summary' then
      insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                                 content, position, is_placeholder)
      values (v_org, p_engagement_id, v_version, 'executive_summary', 'text',
              jsonb_build_object('findings', v_findings), v_pos, false);
    elsif v_sec = 'findings' then
      insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                                 content, position, is_placeholder)
      select v_org, p_engagement_id, v_version, 'findings', 'table',
             coalesce(jsonb_agg(jsonb_build_object(
               'finding_id', f.id, 'severity', f.severity, 'severity_level_id', f.severity_level_id,
               'due_date', (select c.due_date from caps c
                             where c.org_id = v_org and c.finding_id = f.id
                             order by c.created_at desc limit 1))
               order by f.id), '[]'::jsonb),
             v_pos, v_findings = 0
      from findings f where f.org_id = v_org and f.entity_id = v_entity;
    elsif v_sec = 'opinion' then
      insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                                 content, position, is_placeholder)
      values (v_org, p_engagement_id, v_version, 'opinion', 'text',
              case when nullif(btrim(coalesce(v_opinion, '')), '') is null
                   then jsonb_build_object('missing', 'overall_opinion')
                   else jsonb_build_object('opinion', v_opinion) end,
              v_pos, nullif(btrim(coalesce(v_opinion, '')), '') is null);
    elsif v_sec = 'appendices' then
      insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                                 content, position, is_placeholder)
      select v_org, p_engagement_id, v_version, 'appendices', 'table',
             coalesce(jsonb_agg(jsonb_build_object('workpaper_id', w.id, 'status', w.status) order by w.id), '[]'::jsonb),
             v_pos, count(*) = 0
      from workpapers w where w.org_id = v_org and w.engagement_id = p_engagement_id;
    end if;
    v_pos := v_pos + 1;
  end loop;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'report_composed', 'engagement', p_engagement_id,
          jsonb_build_object('version', v_next, 'sections', v_sections));
  return v_version;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Grants.
-- ---------------------------------------------------------------------------
revoke execute on function public.report_template_save(text, text, jsonb) from public, anon;
revoke execute on function public.report_template_list() from public, anon;
grant execute on function public.report_template_save(text, text, jsonb) to authenticated;
grant execute on function public.report_template_list() to authenticated;
