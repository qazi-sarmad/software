-- D21: planning reconciliation detail. check_planning_reconciliation (0025) answers only yes/no, so
-- the Planning screen cannot tell the user *which* risks disagree. This function returns the two
-- mismatching sets, with names, so the screen can show a next action instead of a dead end.
--
-- The definition of a planning risk is copied exactly from check_planning_reconciliation: every
-- risk_id listed in the riskcontrol section's content->'risks' array, whether or not it is selected.
-- A risk matches when the latest published SIRA cycle for the engagement's entity carries a score
-- for it. When no cycle is published, check_planning_reconciliation returns true (no cycle -> nothing
-- to match), so this function returns the empty sets and reconciled = true, to agree with the gate.

create or replace function public.planning_reconciliation_detail(p_engagement_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cycle uuid;
  v_entity uuid;
  v_planning jsonb;
  v_sira jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select en.entity_id into v_entity from engagements en
   where en.id = p_engagement_id and en.org_id = v_org;
  if v_entity is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  v_cycle := public.latest_published_sira_cycle(p_engagement_id);

  -- Risks named in the Planning RCM that the current SIRA does not score for this entity.
  select coalesce(jsonb_agg(distinct jsonb_build_object('risk_id', r ->> 'risk_id',
                                                       'name', coalesce(rl.name, r ->> 'risk_id'))), '[]'::jsonb)
    into v_planning
  from planning_sections s
  cross join lateral jsonb_array_elements(coalesce(s.content -> 'risks', '[]'::jsonb)) r
  left join risks_library rl on rl.id = nullif(r ->> 'risk_id', '')::uuid and rl.org_id = v_org
  where s.engagement_id = p_engagement_id and s.org_id = v_org and s.section_type = 'riskcontrol'
    and not exists (
      select 1 from sira_scores sc
      where sc.cycle_id = v_cycle and sc.entity_id = v_entity
        and sc.risk_id = nullif(r ->> 'risk_id', '')::uuid);

  -- Risks the current SIRA scores for this entity that the Planning RCM does not list.
  select coalesce(jsonb_agg(distinct jsonb_build_object('risk_id', sc.risk_id::text,
                                                       'name', coalesce(rl.name, sc.risk_id::text))), '[]'::jsonb)
    into v_sira
  from sira_scores sc
  left join risks_library rl on rl.id = sc.risk_id and rl.org_id = v_org
  where sc.cycle_id = v_cycle and sc.entity_id = v_entity
    and not exists (
      select 1 from planning_sections s
      cross join lateral jsonb_array_elements(coalesce(s.content -> 'risks', '[]'::jsonb)) r
      where s.engagement_id = p_engagement_id and s.org_id = v_org and s.section_type = 'riskcontrol'
        and nullif(r ->> 'risk_id', '')::uuid = sc.risk_id);

  return jsonb_build_object(
    'reconciled', jsonb_array_length(v_planning) = 0,
    'cycle_id', v_cycle,
    'unmatched_planning', v_planning,
    'unmatched_sira', v_sira);
end $$;

revoke execute on function public.planning_reconciliation_detail(uuid) from public, anon;
grant execute on function public.planning_reconciliation_detail(uuid) to authenticated;
