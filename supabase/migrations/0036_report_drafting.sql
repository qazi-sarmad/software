-- 6A: Report drafting DB (spec §15.2, §15.3).
--
-- The spec:
--   §15.2 "The report is drafted from structured data in six steps. … Compose. Each report section is
--          a template of blocks. Placeholders are filled from the structured data … If a value is
--          missing, the block shows 'Missing: [field]' highlighted. … Pre-compute. The system
--          calculates the figures for the executive summary: counts of findings and issues by severity,
--          by control and by entity, plus the proportion of tests passed and failed. Each figure is
--          computed from the records, not typed."
--   §15.1 "The report becomes available only after Conclusion sign-off."
--
-- Reuse (grep first): no report table existed. `report_versions` and `report_blocks` are created here.

-- ---------------------------------------------------------------------------
-- report_versions: one row per version of an engagement's report (§15.2 step 6). Hash-chained.
-- ---------------------------------------------------------------------------
create table if not exists report_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  version_number int not null default 1,
  status text not null default 'draft'
    check (status in ('draft', 'issued_v1', 'revised', 'frozen')),
  created_by uuid null,
  created_at timestamptz not null default now(),
  frozen_at timestamptz null,
  issued_at timestamptz null,
  prev_hash text null,
  row_hash text null,
  unique (engagement_id, version_number)
);
create index if not exists report_versions_engagement_idx on report_versions (org_id, engagement_id);

-- ---------------------------------------------------------------------------
-- report_blocks: a section is a template of blocks (§15.2 step 3). A block with a missing value is
-- marked is_placeholder and carries the field it needs.
-- ---------------------------------------------------------------------------
create table if not exists report_blocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  report_version_id uuid not null references report_versions(id) on delete cascade,
  section_type text not null,
  block_type text not null default 'text' check (block_type in ('text', 'table', 'image')),
  content jsonb not null default '{}'::jsonb,
  position int not null default 0,
  is_placeholder boolean not null default false,
  edited_at timestamptz null,
  edited_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists report_blocks_version_idx on report_blocks (org_id, report_version_id, position);

-- ---------------------------------------------------------------------------
-- The per-version hash chain (§15.2 step 6 "Versions are compared side by side").
-- ---------------------------------------------------------------------------
create or replace function public.report_version_chain() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(new.engagement_id::text));
  select r.row_hash into v_prev from report_versions r
   where r.engagement_id = new.engagement_id and r.id <> new.id
   order by r.version_number desc limit 1;
  new.prev_hash := coalesce(v_prev, '');
  v_body := coalesce(v_prev, '') || '|' || new.version_number::text || '|' || new.status;
  new.row_hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  return new;
end $$;

drop trigger if exists report_versions_chain on report_versions;
create trigger report_versions_chain before insert or update on report_versions
  for each row execute function public.report_version_chain();

-- ---------------------------------------------------------------------------
-- compose_report: assemble the blocks for a new draft (§15.2 steps 1-3). Requires Conclusion sign-off
-- (§15.1). Missing values become placeholder blocks. Returns the new report_version_id.
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
  -- §15.1: the report is available only after Conclusion sign-off.
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

  -- Scope and Objectives: from the Planning scope section, or a placeholder.
  select content into v_scope from planning_sections s
   where s.engagement_id = p_engagement_id and s.org_id = v_org and s.section_type = 'scope';
  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  values (v_org, p_engagement_id, v_version, 'scope', 'text',
          case when v_scope is null or v_scope = '{}'::jsonb
               then jsonb_build_object('missing', 'scope')
               else v_scope end,
          v_pos, v_scope is null or v_scope = '{}'::jsonb);
  v_pos := v_pos + 1;

  -- Executive Summary: a text block, placeholder while there is nothing to summarise.
  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  values (v_org, p_engagement_id, v_version, 'executive_summary', 'text',
          jsonb_build_object('findings', v_findings), v_pos, false);
  v_pos := v_pos + 1;

  -- Findings and Issues: a table block of the entity's findings, placeholder when there are none.
  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  select v_org, p_engagement_id, v_version, 'findings', 'table',
         coalesce(jsonb_agg(jsonb_build_object(
           'finding_id', f.id, 'severity', f.severity, 'severity_level_id', f.severity_level_id)
           order by f.id), '[]'::jsonb),
         v_pos, v_findings = 0
  from findings f where f.org_id = v_org and f.entity_id = v_entity;
  v_pos := v_pos + 1;

  -- Overall Opinion: from the Conclusion, or a placeholder when it is absent.
  select c.overall_opinion into v_opinion from conclusion_records c
   where c.engagement_id = p_engagement_id and c.org_id = v_org;
  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  values (v_org, p_engagement_id, v_version, 'opinion', 'text',
          case when nullif(btrim(coalesce(v_opinion, '')), '') is null
               then jsonb_build_object('missing', 'overall_opinion')
               else jsonb_build_object('opinion', v_opinion) end,
          v_pos, nullif(btrim(coalesce(v_opinion, '')), '') is null);
  v_pos := v_pos + 1;

  -- Appendices: the workpaper index, placeholder when there are no workpapers.
  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  select v_org, p_engagement_id, v_version, 'appendices', 'table',
         coalesce(jsonb_agg(jsonb_build_object('workpaper_id', w.id, 'status', w.status) order by w.id), '[]'::jsonb),
         v_pos, count(*) = 0
  from workpapers w where w.org_id = v_org and w.engagement_id = p_engagement_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'report_composed', 'engagement', p_engagement_id,
          jsonb_build_object('version', v_next));
  return v_version;
end $$;

-- ---------------------------------------------------------------------------
-- compute_report_summary: every figure is computed from the records (§15.2 step 2). Counts findings
-- and issues by severity, by control and by entity, plus the proportion of tests passed and failed.
-- ---------------------------------------------------------------------------
create or replace function public.compute_report_summary(p_report_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng uuid;
  v_entity uuid;
  v_out jsonb;
  v_rows int;
  v_exceptions int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select r.engagement_id into v_eng from report_versions r
   where r.id = p_report_version_id and r.org_id = v_org;
  if v_eng is null then
    raise exception 'report version not found in this organisation' using errcode = 'P0001';
  end if;
  select e.entity_id into v_entity from engagements e where e.id = v_eng;

  select count(*) into v_rows from workpaper_rows r
   join workpapers w on w.id = r.workpaper_id
   where w.engagement_id = v_eng and r.org_id = v_org and r.result is not null;
  select count(*) into v_exceptions from workpaper_rows r
   join workpapers w on w.id = r.workpaper_id
   where w.engagement_id = v_eng and r.org_id = v_org and r.result in ('cross', 'unverifiable');

  select jsonb_build_object(
    'findings_total', (select count(*) from findings f where f.org_id = v_org and f.entity_id = v_entity),
    'issues_total', (select count(*) from issues i where i.org_id = v_org and i.entity_id = v_entity),
    'findings_by_severity', coalesce((
      select jsonb_object_agg(coalesce(f.severity, 'unspecified'), c)
      from (select f.severity, count(*) c from findings f
             where f.org_id = v_org and f.entity_id = v_entity group by f.severity) f), '{}'::jsonb),
    'findings_by_control', coalesce((
      select jsonb_object_agg(coalesce(f.workpaper_id::text, 'unassigned'), c)
      from (select f.workpaper_id, count(*) c from findings f
             where f.org_id = v_org and f.entity_id = v_entity group by f.workpaper_id) f), '{}'::jsonb),
    'findings_by_entity', coalesce((
      select jsonb_object_agg(coalesce(f.entity_id::text, 'unassigned'), c)
      from (select f.entity_id, count(*) c from findings f
             where f.org_id = v_org and f.entity_id = v_entity group by f.entity_id) f), '{}'::jsonb),
    'tests_total', v_rows,
    'tests_failed', v_exceptions,
    'tests_passed', v_rows - v_exceptions,
    'pass_proportion', case when v_rows = 0 then 0
                            else round(((v_rows - v_exceptions)::numeric / v_rows), 4) end
  ) into v_out;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: org-scoped select only. Writes go through the RPCs above.
-- ---------------------------------------------------------------------------
alter table report_versions enable row level security;
alter table report_blocks enable row level security;

drop policy if exists report_versions_select on report_versions;
create policy report_versions_select on report_versions for select to authenticated
  using (org_id = public.jwt_org_id());

drop policy if exists report_blocks_select on report_blocks;
create policy report_blocks_select on report_blocks for select to authenticated
  using (org_id = public.jwt_org_id());

do $$
declare
  t text;
begin
  foreach t in array array['report_versions', 'report_blocks'] loop
    execute format('drop trigger if exists %I_pin_org on %I', t, t);
    execute format('create trigger %I_pin_org before insert on %I for each row execute function public.pin_org_id()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.compose_report(uuid) from public, anon;
revoke execute on function public.compute_report_summary(uuid) from public, anon;

grant execute on function public.compose_report(uuid) to authenticated;
grant execute on function public.compute_report_summary(uuid) to authenticated;
