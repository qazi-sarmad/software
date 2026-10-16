-- 4F: Analyst engine — the DB side. The checks themselves are pure TypeScript in
-- src/lib/analyticsEngine.ts. This migration stores a check *result* row and the temporary
-- create_observation_stub that 4F needs before 5A exists (decision D-5A-STUB).
--
-- Security rule (spec §12 "a population check result references only rows from the same org"): a stored
-- result names a population and a set of row references. The stub refuses any reference that is not a
-- row of that population in the caller's own org.

create table if not exists analysis_results (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid null references engagements(id) on delete cascade,
  workpaper_id uuid null references workpapers(id) on delete set null,
  population_id uuid null references populations(id) on delete set null,
  rule_id text not null,
  params jsonb not null default '{}'::jsonb,
  row_refs int[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid null
);
create index if not exists analysis_results_org_idx on analysis_results (org_id, engagement_id);

alter table analysis_results enable row level security;
drop policy if exists analysis_results_select on analysis_results;
create policy analysis_results_select on analysis_results for select to authenticated
  using (org_id = public.jwt_org_id());

-- ---------------------------------------------------------------------------
-- create_observation_stub (D-5A-STUB): record a "Raise finding" intent. Replaced by the real
-- create_observation in 5A. It validates that every row reference belongs to a population in the
-- caller's own org, which is the SQL-level guarantee §12 asks for.
-- ---------------------------------------------------------------------------
create or replace function public.create_observation_stub(
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

-- Pin org_id and route grants.
do $$
begin
  drop trigger if exists analysis_results_pin_org on analysis_results;
  create trigger analysis_results_pin_org before insert on analysis_results
    for each row execute function public.pin_org_id();
end $$;

revoke execute on function public.create_observation_stub(uuid, uuid, text, jsonb, int[]) from public, anon;
grant execute on function public.create_observation_stub(uuid, uuid, text, jsonb, int[]) to authenticated;
