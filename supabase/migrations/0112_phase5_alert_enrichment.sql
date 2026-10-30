-- 0112: C2 — enrich a monitor alert with the things a human needs to act on it.
--
-- Before this migration an alert carried only `rule_id`, `rule_version`, `kind`, `reason`, `refs`,
-- `evaluated_at` and the hashes. `docs/SYSTELIGON.md` §11.1 is blunt about why that is not enough:
-- "an alert that says 'this department's residual risk is high and this control just failed' is
-- worth ten alerts that say 'a rule fired.'" This migration resolves the join, and the join is a
-- build over data that already exists — no new engine, no new source of truth.
--
-- What is resolved, and from where (every link is a real column, verified by grep):
--   entity_id      staged_records.population_id -> populations.engagement_id -> engagements.entity_id
--   engagement_id  the same chain
--   universe_id    engagements.universe_id
--   department     entities.kind (the closest label the database records for an entity; there is no
--                  `department` column — entities carries `kind`, and the import wizard maps a
--                  spreadsheet `department` column onto it)
--   sira_risk_id / sira_risk_name / inherent_risk / residual_risk / residual_band
--                  the entity's highest score in its latest PUBLISHED SIRA cycle, banded by the
--                  org's configured bands (`sira_band_for`). The product's own board pack labels the
--                  SIRA score "residual risk" (0061/0099), so that is the name used here. The
--                  "inherent risk" is the SIRA factor of that name on the same score row — a real
--                  column (`sira_scores.factor_values->>'inherent_risk'`, seeded as factor #1 by
--                  0019), labelled from the org's `sira_scales`, so it is read, never invented.
--   control_ids    the workpapers of the resolved engagement. `workpapers` is the only server-side
--                  control record today (`workpapers.control_id`); the UI's AuditControl list is a
--                  demo-seed type with no table behind it, so this is the honest control linkage.
--
-- M2: every statement is `create table if not exists` / `add column if not exists` /
-- `create or replace function` / `drop ... if exists` before create, so a second apply is a no-op.
-- The one place a plain `create or replace` is NOT enough is a changed `returns table` signature
-- (`alert_list`), which needs an explicit `drop function` first — the same trap 0033 hit.
-- M6: applied twice and every SQL test run twice against a local Postgres 17 before the push.

-- ---------------------------------------------------------------------------
-- 1. The enrichment columns. Nullable: an alert whose records are not tied to an engagement (an
--    internal signal, a connector that stages outside a population) is still a valid alert; it just
--    carries no linkage, and every reader must tolerate that.
-- ---------------------------------------------------------------------------
alter table monitor_alerts add column if not exists entity_id uuid;
alter table monitor_alerts add column if not exists department text;
alter table monitor_alerts add column if not exists engagement_id uuid;
alter table monitor_alerts add column if not exists universe_id uuid;
alter table monitor_alerts add column if not exists sira_risk_id uuid;
alter table monitor_alerts add column if not exists sira_risk_name text;
alter table monitor_alerts add column if not exists inherent_risk numeric;
alter table monitor_alerts add column if not exists inherent_risk_label text;
alter table monitor_alerts add column if not exists residual_risk numeric;
alter table monitor_alerts add column if not exists residual_band text;
alter table monitor_alerts add column if not exists control_ids uuid[] not null default '{}';

create index if not exists monitor_alerts_entity_idx on monitor_alerts (org_id, entity_id);
create index if not exists monitor_alerts_department_idx on monitor_alerts (org_id, department);

-- ---------------------------------------------------------------------------
-- 2. alert_enrichment(org, refs) — the resolver. Pure and deterministic: it reads the organisation's
--    own records and never a clock, so two calls over the same refs return the same answer. It
--    returns jsonb so `alert_record` can store the fields and the tests can assert them directly.
-- ---------------------------------------------------------------------------
create or replace function public.alert_enrichment(p_org uuid, p_refs jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_source text;
  v_source_id text;
  v_pop_id uuid;
  v_eng uuid;
  v_entity uuid;
  v_universe uuid;
  v_department text;
  v_cycle uuid;
  v_risk_id uuid;
  v_risk_name text;
  v_score numeric;
  v_inherent numeric;
  v_inherent_label text;
  v_band text;
  v_controls uuid[];
begin
  -- The first referenced staged record, as `source:source_id`. The engine joins the two with a
  -- single ':' (monitors.ts: `${s.source}:${s.id}`); a connector id is a slug, so a single split
  -- on the first ':' is exact.
  select (r->>'id') into v_source_id from jsonb_array_elements(coalesce(p_refs, '[]'::jsonb)) r limit 1;
  if v_source_id is null then
    return jsonb_build_object('control_ids', '[]'::jsonb);
  end if;
  v_source := split_part(v_source_id, ':', 1);
  v_source_id := substr(v_source_id, length(v_source) + 2);

  -- The staged record's population (when it was promoted to one), then its engagement and entity.
  select sr.population_id into v_pop_id
    from staged_records sr
   where sr.org_id = p_org and sr.source = v_source and sr.source_id = v_source_id
   limit 1;

  if v_pop_id is not null then
    select p.engagement_id, en.entity_id, en.universe_id
      into v_eng, v_entity, v_universe
      from populations p
      join engagements en on en.id = p.engagement_id
     where p.id = v_pop_id and p.org_id = p_org;
  end if;

  if v_entity is not null then
    -- The department: the entity's kind, which is the closest recorded label; fall back to the name.
    select coalesce(nullif(btrim(e.kind), ''), e.name) into v_department
      from entities e where e.id = v_entity;

    -- The entity's SIRA position: the highest score in its most recent PUBLISHED cycle. This is the
    -- product's "residual risk" (the board pack labels it so). The cycle is chosen first, the same
    -- way `latest_published_sira_cycle` (0025) chooses it, so the alert and the plan pre-fill agree.
    select c.id into v_cycle
      from sira_cycles c
     where c.org_id = p_org and c.universe_id = v_universe and c.status = 'published'
     order by c.year desc, c.published_at desc
     limit 1;
    if v_cycle is not null then
      select s.risk_id, rl.name, s.score, (s.factor_values->>'inherent_risk')::numeric
        into v_risk_id, v_risk_name, v_score, v_inherent
        from sira_scores s
        left join risks_library rl on rl.id = s.risk_id
       where s.org_id = p_org and s.entity_id = v_entity and s.cycle_id = v_cycle
       order by s.score desc, s.created_at desc
       limit 1;
      if v_score is not null then
        v_band := public.sira_band_for(p_org, v_score);
      end if;
      -- The inherent-risk factor, labelled from the org's own scale. Absent when the score row has
      -- no such factor; the alert then carries the number but no label rather than a guess.
      if v_inherent is not null then
        select sc.label into v_inherent_label
          from sira_scales sc where sc.org_id = p_org and sc.point = v_inherent::int;
      end if;
    end if;

    -- The affected controls: the workpapers of the engagement the records belong to.
    if v_eng is not null then
      select array_agg(w.id order by w.id) into v_controls
        from workpapers w where w.org_id = p_org and w.engagement_id = v_eng;
    end if;
  end if;

  return jsonb_build_object(
    'entity_id', v_entity, 'department', v_department, 'engagement_id', v_eng,
    'universe_id', v_universe, 'sira_risk_id', v_risk_id, 'sira_risk_name', v_risk_name,
    'inherent_risk', v_inherent, 'inherent_risk_label', v_inherent_label,
    'residual_risk', v_score, 'residual_band', v_band,
    'control_ids', to_jsonb(coalesce(v_controls, '{}'::uuid[])));
end $$;

comment on function public.alert_enrichment(uuid, jsonb) is
  'C2: resolves the entity, engagement, universe, department, SIRA inherent + residual risk and affected controls behind a set of alert references. Pure and deterministic.';

-- ---------------------------------------------------------------------------
-- 3. alert_record is extended IN PLACE (same signature) to resolve and store the enrichment. The
--    nine original columns keep their exact values, so every existing caller and test is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.alert_record(
  p_org uuid, p_rule_id text, p_rule_version int, p_kind text, p_reason text,
  p_references jsonb, p_evaluated_at timestamptz, p_window_start timestamptz, p_lineage_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_enr jsonb;
begin
  perform public.provio_org_guard(p_org);
  v_enr := public.alert_enrichment(p_org, p_references);
  insert into monitor_alerts (
    org_id, rule_id, rule_version, kind, reason, refs, evaluated_at, window_start, lineage_hash,
    entity_id, department, engagement_id, universe_id, sira_risk_id, sira_risk_name,
    inherent_risk, inherent_risk_label, residual_risk, residual_band, control_ids)
  values (
    p_org, p_rule_id, p_rule_version, p_kind, p_reason, coalesce(p_references, '[]'::jsonb),
    coalesce(p_evaluated_at, now()), p_window_start, p_lineage_hash,
    (v_enr->>'entity_id')::uuid, v_enr->>'department', (v_enr->>'engagement_id')::uuid,
    (v_enr->>'universe_id')::uuid, (v_enr->>'sira_risk_id')::uuid, v_enr->>'sira_risk_name',
    (v_enr->>'inherent_risk')::numeric, v_enr->>'inherent_risk_label',
    (v_enr->>'residual_risk')::numeric, v_enr->>'residual_band',
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_enr->'control_ids') x), '{}'::uuid[]))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. alert_list now returns the enrichment, so the screen can show it. The return type changes, so
--    the function is dropped first: `create or replace` refuses a changed `returns table` row type
--    ("cannot change return type of existing function"), which is exactly what broke 0033 on replay.
-- ---------------------------------------------------------------------------
drop function if exists public.alert_list(uuid);
create or replace function public.alert_list(p_org uuid)
returns table (alert_id uuid, rule_id text, rule_version int, kind text, reason text,
               evaluated_at timestamptz, disposition text, lineage_hash text, hash text,
               entity_id uuid, department text, engagement_id uuid, sira_risk_id uuid,
               sira_risk_name text, inherent_risk numeric, inherent_risk_label text,
               residual_risk numeric, residual_band text, control_ids uuid[])
language sql stable security definer set search_path = public as $$
  select a.id, a.rule_id, a.rule_version, a.kind, a.reason, a.evaluated_at,
         coalesce(t.disposition, 'open'), a.lineage_hash, a.hash,
         a.entity_id, a.department, a.engagement_id, a.sira_risk_id, a.sira_risk_name,
         a.inherent_risk, a.inherent_risk_label, a.residual_risk, a.residual_band, a.control_ids
    from monitor_alerts a
    left join alert_triage t on t.alert_id = a.id and t.org_id = a.org_id
   where a.org_id = p_org
     and (a.org_id = public.jwt_org_id() or public.is_platform_admin())
   order by a.evaluated_at desc, a.id;
$$;

-- ---------------------------------------------------------------------------
-- 5. The watcher.signal emitter now carries the enrichment, so a notification (C3) and any
--    downstream rule see the same linkage the alert holds. It runs AFTER insert, so the columns are
--    populated.
-- ---------------------------------------------------------------------------
create or replace function public.emit_monitor_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit_catalogue_event(new.org_id, 'watcher.signal', jsonb_build_object(
    'rule_id', new.rule_id, 'rule_version', new.rule_version, 'kind', new.kind,
    'alert_id', new.id, 'reason', new.reason, 'lineage_hash', new.lineage_hash,
    'reference_count', jsonb_array_length(new.refs),
    'entity_id', new.entity_id, 'department', new.department, 'engagement_id', new.engagement_id,
    'sira_risk_id', new.sira_risk_id, 'sira_risk_name', new.sira_risk_name,
    'inherent_risk', new.inherent_risk, 'residual_risk', new.residual_risk,
    'residual_band', new.residual_band,
    'control_count', coalesce(array_length(new.control_ids, 1), 0)));
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants, in the same shape 0090 uses. `alert_enrichment` is a helper called only from inside the
--    security-definer `alert_record`, so no client role needs it; `alert_list` stays a
--    tenant-readable read (scoped to the caller's org inside the body).
-- ---------------------------------------------------------------------------
revoke execute on function public.alert_enrichment(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.alert_list(uuid) from public, anon;
grant execute on function public.alert_list(uuid) to authenticated;
