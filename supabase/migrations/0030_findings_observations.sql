-- 5A: Findings, observations and issues DB (spec §14).
--
-- The spec:
--   §14.1 "Observation: a draft … Finding: concluded. An observation becomes a finding only when the
--          readability checks pass."
--   §14.2 "Sections are fully configurable per organisation … Every section carries one role tag."
--   §14.3 "A deterministic completeness check requires Context, Condition, Effect and Risk to be
--          present and filled before an observation can become a finding. Criteria, Cause and
--          Recommendation are required only where the organisation's methodology requires them."
--   §14.4 "Severity levels are organisation-configurable; each level has a colour and is shown with
--          its text label, never by colour alone."
--   §14.5 "Issues group findings."
--
-- Reuse (grep first): `observations`, `findings` and `issues` already exist in 0004 with a thinner
-- shape. They are ALTERed here rather than recreated (Migration Safety Rule M1). This migration also
-- retires the temporary create_observation_stub from 0029, replacing it with the real
-- create_observation (decision D-5A-STUB).

-- ---------------------------------------------------------------------------
-- observations: extend to the configured, role-tagged section shape (§14.2).
-- ---------------------------------------------------------------------------
alter table observations add column if not exists workpaper_id uuid null references workpapers(id) on delete set null;
alter table observations add column if not exists sections jsonb not null default '{}'::jsonb;
alter table observations add column if not exists status text not null default 'draft';
alter table observations add column if not exists submitted_at timestamptz null;
alter table observations add column if not exists submitted_by uuid null;

-- The draft/submitted/finding/issue lifecycle. A row is an observation until promote_to_finding
-- flips it (status 'finding'), which only the readability check permits.
alter table observations drop constraint if exists observations_status_chk;
alter table observations add constraint observations_status_chk check (
  status in ('draft', 'submitted', 'finding', 'issue')
);

-- ---------------------------------------------------------------------------
-- findings: link a concluded finding to its observation, its controls, exceptions and entities
-- (§14.5). The existing 0004 columns (observation_id, entity_id, severity, sections) are reused.
-- ---------------------------------------------------------------------------
alter table findings add column if not exists workpaper_id uuid null references workpapers(id) on delete set null;
alter table findings add column if not exists linked_control_ids uuid[] not null default '{}';
alter table findings add column if not exists linked_sample_exception_ids uuid[] not null default '{}';
alter table findings add column if not exists linked_entity_ids uuid[] not null default '{}';
alter table findings add column if not exists severity_level_id uuid null;
alter table findings add column if not exists status text not null default 'concluded';
alter table findings add column if not exists created_by uuid null;

-- ---------------------------------------------------------------------------
-- severity_levels: organisation-configurable levels, each with a design-token colour (§14.4).
-- Colour is a token name, never a hex value (the design system is the only source of colour).
-- ---------------------------------------------------------------------------
create table if not exists severity_levels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  color_token text not null,
  rank int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create index if not exists severity_levels_org_idx on severity_levels (org_id, rank);

-- The colour must be one of the design system's accent tokens, not a raw colour.
alter table severity_levels drop constraint if exists severity_levels_token_chk;
alter table severity_levels add constraint severity_levels_token_chk check (
  color_token in (
    '--accent-primary', '--accent-primary-subtle', '--accent-cinnabar', '--accent-cinnabar-subtle',
    '--accent-brass', '--accent-brass-subtle', '--accent-verdigris', '--accent-verdigris-subtle',
    '--accent-verdigris-text')
);

-- ---------------------------------------------------------------------------
-- issues: group findings (§14.5). The 0004 table has org_id, entity_id, title, status; extend with a
-- severity level and the list of findings it groups.
-- ---------------------------------------------------------------------------
alter table issues add column if not exists severity_level_id uuid null references severity_levels(id) on delete set null;
alter table issues add column if not exists linked_finding_ids uuid[] not null default '{}';
alter table issues add column if not exists created_by uuid null;

-- ---------------------------------------------------------------------------
-- Row-level security: org-scoped. No direct write policy; writes go through the RPCs below.
-- ---------------------------------------------------------------------------
alter table observations enable row level security;
alter table findings enable row level security;
alter table issues enable row level security;
alter table severity_levels enable row level security;

drop policy if exists severity_levels_select on severity_levels;
create policy severity_levels_select on severity_levels for select to authenticated
  using (org_id = public.jwt_org_id());

drop policy if exists observations_select on observations;
create policy observations_select on observations for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));

drop policy if exists findings_select on findings;
create policy findings_select on findings for select to authenticated
  using (org_id = public.jwt_org_id());

drop policy if exists issues_select on issues;
create policy issues_select on issues for select to authenticated
  using (org_id = public.jwt_org_id());

-- Pin org_id on insert for application roles only (same defence as 0009).
do $$
declare
  t text;
begin
  foreach t in array array['severity_levels', 'observations', 'findings', 'issues'] loop
    execute format('drop trigger if exists %I_pin_org on %I', t, t);
    execute format('create trigger %I_pin_org before insert on %I for each row execute function public.pin_org_id()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- seed_severity_levels: the default High/Medium/Low levels (§14.4 configuration-not-code).
-- ---------------------------------------------------------------------------
create or replace function public.seed_severity_levels(p_org_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into severity_levels (org_id, name, color_token, rank) values
    (p_org_id, 'High',   '--accent-cinnabar',  3),
    (p_org_id, 'Medium', '--accent-brass',     2),
    (p_org_id, 'Low',    '--accent-verdigris', 1)
  on conflict (org_id, name) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- org_required_sections: the optional role tags a methodology requires (§14.3, §14.2). Reads the
-- org's configuration (config_versions key 'methodology.required_sections'); defaults to the four
-- mandatory tags only, which are always checked in code.
-- ---------------------------------------------------------------------------
create or replace function public.org_required_sections(p_org_id uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array(select jsonb_array_elements_text(v.value))
       from config_versions v
      where v.org_id = p_org_id and v.key = 'methodology.required_sections'
      order by v.version desc limit 1),
    '{}'::text[])
$$;

-- ---------------------------------------------------------------------------
-- check_readability: the deterministic completeness check (§14.3). True when the observation's
-- sections carry non-empty content for the four mandatory role tags (context, condition, effect,
-- risk) and for any optional tag the org's methodology requires.
-- ---------------------------------------------------------------------------
create or replace function public.check_readability(p_observation_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sections jsonb;
  v_tag text;
  v_required text[];
begin
  select o.sections into v_sections
  from observations o
  where o.id = p_observation_id and o.org_id = v_org;
  if v_sections is null then
    raise exception 'observation not found in this organisation' using errcode = 'P0001';
  end if;

  -- The four mandatory tags are hard-coded (§14.3).
  foreach v_tag in array array['context', 'condition', 'effect', 'risk'] loop
    if v_sections -> v_tag is null or btrim(v_sections ->> v_tag) = '' then
      return false;
    end if;
  end loop;

  -- Optional tags are checked only where the org requires them (§14.3).
  v_required := public.org_required_sections(v_org);
  foreach v_tag in array v_required loop
    if v_sections -> v_tag is null or btrim(v_sections ->> v_tag) = '' then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- missing_readability_sections: the list of role tags that are not yet filled. Used by
-- promote_to_finding to raise a useful error and by the UI to show what is missing.
create or replace function public.missing_readability_sections(p_observation_id uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sections jsonb;
  v_tag text;
  v_missing text[] := '{}';
begin
  select o.sections into v_sections
  from observations o
  where o.id = p_observation_id and o.org_id = v_org;
  if v_sections is null then
    raise exception 'observation not found in this organisation' using errcode = 'P0001';
  end if;
  foreach v_tag in array array['context', 'condition', 'effect', 'risk'] || public.org_required_sections(v_org) loop
    if v_sections -> v_tag is null or btrim(v_sections ->> v_tag) = '' then
      v_missing := array_append(v_missing, v_tag);
    end if;
  end loop;
  return v_missing;
end $$;

-- ---------------------------------------------------------------------------
-- create_observation: the real observation RPC (§14). perform_work. Replaces the 0029 stub
-- (decision D-5A-STUB).
-- ---------------------------------------------------------------------------
create or replace function public.create_observation(
  p_engagement_id uuid,
  p_workpaper_id uuid default null,
  p_title text default null,
  p_sections jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if p_workpaper_id is not null
     and not exists (select 1 from workpapers w where w.id = p_workpaper_id and w.org_id = v_org) then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;

  insert into observations (org_id, engagement_id, workpaper_id, title, sections, status)
  values (v_org, p_engagement_id, p_workpaper_id, coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Observation'),
          coalesce(p_sections, '{}'::jsonb), 'draft')
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- promote_to_finding: conclude an observation into a finding (§14.1, §14.3). perform_work. Refused
-- when the readability check fails, with the list of missing tags.
-- ---------------------------------------------------------------------------
create or replace function public.promote_to_finding(
  p_observation_id uuid, p_severity_level_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_obs observations;
  v_missing text[];
  v_level_org uuid;
  v_finding_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  select * into v_obs from observations where id = p_observation_id and org_id = v_org;
  if v_obs.id is null then
    raise exception 'observation not found in this organisation' using errcode = 'P0001';
  end if;

  v_missing := public.missing_readability_sections(p_observation_id);
  if array_length(v_missing, 1) is not null and array_length(v_missing, 1) > 0 then
    raise exception 'readability_failed: missing section(s): %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  if p_severity_level_id is not null then
    select org_id into v_level_org from severity_levels where id = p_severity_level_id;
    if v_level_org is null or v_level_org <> v_org then
      raise exception 'severity level not found in this organisation' using errcode = 'P0001';
    end if;
  end if;

  insert into findings (org_id, observation_id, workpaper_id, entity_id, severity_level_id, sections, status, created_by)
  values (v_org, p_observation_id, v_obs.workpaper_id,
          (select entity_id from engagements where id = v_obs.engagement_id),
          p_severity_level_id, coalesce(v_obs.sections, '{}'::jsonb), 'concluded', auth.uid())
  returning id into v_finding_id;

  update observations set status = 'finding', submitted_at = coalesce(submitted_at, now()), submitted_by = coalesce(submitted_by, auth.uid())
  where id = p_observation_id;

  perform public.append_ledger_entry(v_org, 'finding_promoted',
    jsonb_build_object('observation_id', p_observation_id, 'finding_id', v_finding_id), auth.uid());
  return v_finding_id;
end $$;

-- ---------------------------------------------------------------------------
-- link_finding: attach controls, sample exceptions and entities to a finding (§14.5). perform_work.
-- ---------------------------------------------------------------------------
create or replace function public.link_finding(
  p_finding_id uuid, p_control_ids uuid[] default null,
  p_sample_exception_ids uuid[] default null, p_entity_ids uuid[] default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from findings f where f.id = p_finding_id and f.org_id = v_org) then
    raise exception 'finding not found in this organisation' using errcode = 'P0001';
  end if;
  update findings set
    linked_control_ids = coalesce(p_control_ids, linked_control_ids),
    linked_sample_exception_ids = coalesce(p_sample_exception_ids, linked_sample_exception_ids),
    linked_entity_ids = coalesce(p_entity_ids, linked_entity_ids)
  where id = p_finding_id;
end $$;

-- ---------------------------------------------------------------------------
-- create_issue: group findings into an issue (§14.5). perform_work.
-- ---------------------------------------------------------------------------
create or replace function public.create_issue(
  p_title text, p_severity_level_id uuid default null, p_finding_ids uuid[] default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_level_org uuid;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'an issue title is required' using errcode = 'P0001';
  end if;
  if p_severity_level_id is not null then
    select org_id into v_level_org from severity_levels where id = p_severity_level_id;
    if v_level_org is null or v_level_org <> v_org then
      raise exception 'severity level not found in this organisation' using errcode = 'P0001';
    end if;
  end if;
  if p_finding_ids is not null and exists (
    select 1 from unnest(p_finding_ids) fid
    where not exists (select 1 from findings f where f.id = fid and f.org_id = v_org)) then
    raise exception 'a linked finding is not in this organisation' using errcode = 'P0001';
  end if;

  insert into issues (org_id, title, status, severity_level_id, linked_finding_ids, created_by)
  values (v_org, btrim(p_title), 'open', p_severity_level_id, coalesce(p_finding_ids, '{}'), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- record_analysis_result: the real 4F RPC that stores a check result (spec §12). It replaces the
-- 0029 create_observation_stub (decision D-5A-STUB): the name was temporary, the guarantee is not —
-- every row reference must be a row of that population in the caller's own org.
-- ---------------------------------------------------------------------------
create or replace function public.record_analysis_result(
  p_engagement_id uuid, p_population_id uuid, p_rule_id text, p_params jsonb, p_row_refs int[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_pop_org uuid;
  v_bad int[];
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements where id = p_engagement_id and org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  select org_id into v_pop_org from populations where id = p_population_id;
  if v_pop_org is null then
    raise exception 'population not found' using errcode = 'P0001';
  end if;
  if v_pop_org <> v_org then
    raise exception 'cross_org: population % belongs to another organisation', p_population_id
      using errcode = 'P0001';
  end if;

  select array_agg(r) into v_bad
  from unnest(coalesce(p_row_refs, '{}')) as r
  where not exists (
    select 1 from population_rows pr
    where pr.population_id = p_population_id and pr.row_ref = r and pr.org_id = v_org);
  if v_bad is not null and array_length(v_bad, 1) > 0 then
    raise exception 'row_ref_out_of_scope: % reference(s) are not rows of this population in this org: %',
      array_length(v_bad, 1), v_bad using errcode = 'P0001';
  end if;

  insert into analysis_results (org_id, engagement_id, population_id, rule_id, params, row_refs, created_by)
  values (v_org, p_engagement_id, p_population_id, p_rule_id, coalesce(p_params, '{}'::jsonb),
          coalesce(p_row_refs, '{}'), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.record_analysis_result(uuid, uuid, text, jsonb, int[]) from public, anon;
grant execute on function public.record_analysis_result(uuid, uuid, text, jsonb, int[]) to authenticated;

-- Raise a finding from an analysis result: store the result, then open an observation carrying the
-- rule id, its parameters and the row references (§12 "attaches the rule ID, params and input row
-- references to a new finding observation").
create or replace function public.raise_finding_from_result(
  p_engagement_id uuid, p_population_id uuid,
  p_rule_id text, p_params jsonb, p_row_refs int[], p_workpaper_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  v_id := public.record_analysis_result(p_engagement_id, p_population_id, p_rule_id, p_params, p_row_refs);
  return public.create_observation(
    p_engagement_id, p_workpaper_id,
    coalesce(NULLIF(btrim(p_rule_id), ''), 'Analyst result'),
    jsonb_build_object('context', 'Analyst check: ' || coalesce(p_rule_id, ''),
                       'condition', 'Rows flagged by ' || coalesce(p_rule_id, ''),
                       'effect', '', 'risk', '',
                       'rule_id', p_rule_id, 'params', coalesce(p_params, '{}'::jsonb),
                       'row_refs', to_jsonb(coalesce(p_row_refs, '{}'))));
end $$;

revoke execute on function public.raise_finding_from_result(uuid, uuid, text, jsonb, int[], uuid) from public, anon;
grant execute on function public.raise_finding_from_result(uuid, uuid, text, jsonb, int[], uuid) to authenticated;

-- Retire the temporary stub (D-5A-STUB): drop it so nothing can still call it.
drop function if exists public.create_observation_stub(uuid, uuid, text, jsonb, int[]);

-- Route grants.
revoke execute on function public.seed_severity_levels(uuid) from public, anon;
revoke execute on function public.org_required_sections(uuid) from public, anon;
revoke execute on function public.check_readability(uuid) from public, anon;
revoke execute on function public.missing_readability_sections(uuid) from public, anon;
revoke execute on function public.create_observation(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.promote_to_finding(uuid, uuid) from public, anon;
revoke execute on function public.link_finding(uuid, uuid[], uuid[], uuid[]) from public, anon;
revoke execute on function public.create_issue(text, uuid, uuid[]) from public, anon;

grant execute on function public.seed_severity_levels(uuid) to authenticated;
grant execute on function public.org_required_sections(uuid) to authenticated;
grant execute on function public.check_readability(uuid) to authenticated;
grant execute on function public.missing_readability_sections(uuid) to authenticated;
grant execute on function public.create_observation(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.promote_to_finding(uuid, uuid) to authenticated;
grant execute on function public.link_finding(uuid, uuid[], uuid[], uuid[]) to authenticated;
grant execute on function public.create_issue(text, uuid, uuid[]) to authenticated;
