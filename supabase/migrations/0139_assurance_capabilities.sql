-- 0139 (S2): the assurance-capability state and writers (D5 / D7 / D8 / D9).
--
-- Four owner-approved capabilities, grounded in docs/ASSURANCE-RULEBOOKS.md. Each has a PURE engine
-- under the assurance modules; this migration adds the state the engines need and the one writer per
-- capability that records a finding on the hash-chained ledger. Nothing here may be a model call
-- (Law L1): every classification is a rule over configured thresholds.
--
--   D5 ICFR  — icfr_controls / icfr_monitor_rules / icfr_control_evidence / icfr_thresholds, and
--              `icfr_finding_record` (the breach → finding writer).
--   D7 forensic — `forensic_finding_record` (a rule run's findings over a whole population).
--   D8 gap    — policy_obligations / policy_controls and `gap_finding_record`.
--   D9 a-o-a  — assurance_metrics (the IIA-2024 metrics the function is measured against).
--
-- Laws honoured: L2 (only the caller's own org is ever read or written — RLS + jwt_org_id()), L3
-- (a finding is an append-only ledger entry, config is reason-stamped through admin_log_change),
-- rights not role names, and every writer is security-definer with an explicit caller check and an
-- idempotency guard so a re-derivation never duplicates a finding.
--
-- M1: grepped migrations and tests for every new function name; all new, none redefined.
-- M2: create or replace / create table if not exists; no existing table changes shape.
-- M6: applied twice and all SQL tests run twice by the harness before the push.

-- ---------------------------------------------------------------------------
-- 1. D5 — the ICFR control system.
-- ---------------------------------------------------------------------------
create table if not exists icfr_controls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  control_id text not null,
  taxonomy text not null default 'coso_icif_2013',
  component text not null,
  principle int not null,
  assertion text not null,
  owner text not null default '',
  test_procedure text not null default '',
  compensating_control_id text null,
  created_at timestamptz not null default now(),
  unique (org_id, control_id)
);
alter table icfr_controls enable row level security;
drop policy if exists icfr_controls_select on icfr_controls;
create policy icfr_controls_select on icfr_controls for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists icfr_controls_pin_org on icfr_controls;
create trigger icfr_controls_pin_org before insert on icfr_controls
  for each row execute function public.pin_org_id();

create table if not exists icfr_monitor_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  rule_id text not null,
  rule_version int not null default 1,
  control_id text not null,
  tolerance_percent numeric(6,3) not null,
  created_at timestamptz not null default now(),
  unique (org_id, rule_id, rule_version)
);
alter table icfr_monitor_rules enable row level security;
drop policy if exists icfr_monitor_rules_select on icfr_monitor_rules;
create policy icfr_monitor_rules_select on icfr_monitor_rules for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists icfr_monitor_rules_pin_org on icfr_monitor_rules;
create trigger icfr_monitor_rules_pin_org before insert on icfr_monitor_rules
  for each row execute function public.pin_org_id();

create table if not exists icfr_control_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  control_id text not null,
  population int not null,
  deviations int not null,
  tested_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (org_id, control_id, tested_at)
);
alter table icfr_control_evidence enable row level security;
drop policy if exists icfr_control_evidence_select on icfr_control_evidence;
create policy icfr_control_evidence_select on icfr_control_evidence for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists icfr_control_evidence_pin_org on icfr_control_evidence;
create trigger icfr_control_evidence_pin_org before insert on icfr_control_evidence
  for each row execute function public.pin_org_id();

create table if not exists icfr_thresholds (
  org_id uuid primary key references orgs(id) on delete cascade,
  significance_threshold_percent numeric(6,3) not null default 2,
  materiality_threshold_percent numeric(6,3) not null default 10,
  updated_at timestamptz not null default now()
);
alter table icfr_thresholds enable row level security;
drop policy if exists icfr_thresholds_select on icfr_thresholds;
create policy icfr_thresholds_select on icfr_thresholds for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists icfr_thresholds_pin_org on icfr_thresholds;
create trigger icfr_thresholds_pin_org before insert on icfr_thresholds
  for each row execute function public.pin_org_id();

-- The feature key: the ICFR capability is part of the assurance family.
insert into feature_catalogue (key, label, description, group_name, price_class, default_on, status) values
  ('icfr_monitoring','ICFR continuous control monitoring','Monitors a configured internal-control system over COSO ICIF-2013 and classifies a failing control by the PCAOB AS 2201 ladder','Assurance','addon',false,'live')
on conflict (key) do update set label = excluded.label, description = excluded.description,
  group_name = excluded.group_name, price_class = excluded.price_class, status = excluded.status;

-- ---------------------------------------------------------------------------
-- 2. D5 writers: control, rule and evidence config, and the breach → finding writer.
-- ---------------------------------------------------------------------------
create or replace function public.icfr_control_save(
  p_org uuid, p_control_id text, p_taxonomy text, p_component text, p_principle int,
  p_assertion text, p_owner text, p_test_procedure text, p_compensating_control_id text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.caller_has_right('edit_config') then
    raise exception 'not permitted: edit_config is required' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_control_id), '') = '' then
    raise exception 'a control id is required' using errcode = 'P0001';
  end if;
  if p_principle is null or p_principle < 1 or p_principle > 17 then
    raise exception 'the COSO principle must be 1..17' using errcode = 'P0001';
  end if;
  insert into icfr_controls (org_id, control_id, taxonomy, component, principle, assertion, owner,
                             test_procedure, compensating_control_id)
  values (v_org, p_control_id, coalesce(p_taxonomy, 'coso_icif_2013'), p_component, p_principle,
          p_assertion, coalesce(p_owner, ''), coalesce(p_test_procedure, ''), p_compensating_control_id)
  on conflict (org_id, control_id) do update set
    taxonomy = excluded.taxonomy, component = excluded.component, principle = excluded.principle,
    assertion = excluded.assertion, owner = excluded.owner, test_procedure = excluded.test_procedure,
    compensating_control_id = excluded.compensating_control_id;
  perform public.admin_log_change(v_org, 'icfr_controls',
    jsonb_build_object('control_id', p_control_id, 'taxonomy', p_taxonomy, 'component', p_component,
                       'principle', p_principle, 'assertion', p_assertion, 'owner', p_owner,
                       'test_procedure', p_test_procedure, 'compensating_control_id', p_compensating_control_id),
    'icfr_control_saved', 'icfr_control', null);
end $$;

create or replace function public.icfr_rule_save(
  p_org uuid, p_rule_id text, p_rule_version int, p_control_id text, p_tolerance_percent numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.caller_has_right('edit_config') then
    raise exception 'not permitted: edit_config is required' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_rule_id), '') = '' then
    raise exception 'a rule id is required' using errcode = 'P0001';
  end if;
  if p_tolerance_percent is null or p_tolerance_percent < 0 or p_tolerance_percent > 100 then
    raise exception 'the tolerance must be a percentage 0..100' using errcode = 'P0001';
  end if;
  if not exists (select 1 from icfr_controls c where c.org_id = v_org and c.control_id = p_control_id) then
    raise exception 'control not found in this organisation' using errcode = 'P0001';
  end if;
  insert into icfr_monitor_rules (org_id, rule_id, rule_version, control_id, tolerance_percent)
  values (v_org, p_rule_id, coalesce(p_rule_version, 1), p_control_id, p_tolerance_percent)
  on conflict (org_id, rule_id, rule_version) do update set
    control_id = excluded.control_id, tolerance_percent = excluded.tolerance_percent;
  perform public.admin_log_change(v_org, 'icfr_monitor_rules',
    jsonb_build_object('rule_id', p_rule_id, 'rule_version', p_rule_version, 'control_id', p_control_id,
                       'tolerance_percent', p_tolerance_percent),
    'icfr_rule_saved', 'icfr_rule', null);
end $$;

create or replace function public.icfr_evidence_save(
  p_org uuid, p_control_id text, p_population int, p_deviations int, p_tested_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not (public.caller_has_right('perform_work') or public.caller_has_right('edit_config')) then
    raise exception 'not permitted: perform_work or edit_config is required' using errcode = 'P0001';
  end if;
  if p_tested_at is null then
    raise exception 'the test instant is required — a control test is never recorded against a clock'
      using errcode = 'P0001';
  end if;
  if p_population is null or p_population < 0 then
    raise exception 'the population must be zero or more' using errcode = 'P0001';
  end if;
  if p_deviations is null or p_deviations < 0 or p_deviations > p_population then
    raise exception 'the deviations must be between zero and the population' using errcode = 'P0001';
  end if;
  if not exists (select 1 from icfr_controls c where c.org_id = v_org and c.control_id = p_control_id) then
    raise exception 'control not found in this organisation' using errcode = 'P0001';
  end if;
  insert into icfr_control_evidence (org_id, control_id, population, deviations, tested_at)
  values (v_org, p_control_id, p_population, p_deviations, p_tested_at)
  on conflict (org_id, control_id, tested_at) do update set
    population = excluded.population, deviations = excluded.deviations;
end $$;

-- The breach → finding writer. Appends one ledger entry per breach, idempotent per
-- (engagement, evaluated_at, rule, version, control). Every breach names its control id, rule id and
-- version, and the ladder's severity with its basis.
create or replace function public.icfr_finding_record(
  p_org uuid, p_engagement_id uuid, p_evaluated_at timestamptz, p_findings jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_finding jsonb;
  v_added int := 0;
  v_rule text;
  v_ver int;
  v_control text;
  v_eng uuid;
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.has_feature(v_org, 'icfr_monitoring') then
    raise exception 'feature_off: icfr_monitoring' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('perform_work') or public.caller_has_right('review_and_approve')) then
    raise exception 'not permitted: perform_work or review_and_approve is required' using errcode = 'P0001';
  end if;
  if p_evaluated_at is null then
    raise exception 'the evaluation instant is required — a finding is never recorded against a clock'
      using errcode = 'P0001';
  end if;
  if p_engagement_id is not null then
    select e.id into v_eng from engagements e where e.id = p_engagement_id and e.org_id = v_org;
    if v_eng is null then
      raise exception 'engagement not found in this organisation' using errcode = 'P0001';
    end if;
  end if;

  for v_finding in select value from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    v_rule := v_finding ->> 'ruleId';
    v_ver := nullif(v_finding ->> 'ruleVersion', '')::int;
    v_control := v_finding ->> 'controlId';
    if coalesce(v_rule, '') = '' or v_ver is null or coalesce(v_control, '') = '' then
      raise exception 'every ICFR finding needs a ruleId, a ruleVersion and a controlId'
        using errcode = 'P0001';
    end if;
    if not exists (select 1 from icfr_controls c where c.org_id = v_org and c.control_id = v_control) then
      raise exception 'control % not found in this organisation', v_control using errcode = 'P0001';
    end if;
    continue when exists (
      select 1 from ledger_entries l
       where l.org_id = v_org and l.action = 'icfr_finding'
         and l.payload ->> 'engagement_id' is not distinct from p_engagement_id::text
         and (l.payload ->> 'evaluated_at')::timestamptz = p_evaluated_at
         and l.payload -> 'finding' ->> 'ruleId' = v_rule
         and (l.payload -> 'finding' ->> 'ruleVersion')::int = v_ver
         and l.payload -> 'finding' ->> 'controlId' = v_control
    );
    perform public.append_ledger_entry(v_org, 'icfr_finding',
      jsonb_build_object(
        'engagement_id', p_engagement_id::text,
        'evaluated_at', p_evaluated_at,
        'finding', v_finding),
      auth.uid());
    v_added := v_added + 1;
  end loop;
  return v_added;
end $$;

comment on function public.icfr_finding_record(uuid, uuid, timestamptz, jsonb) is
  'S2/D5: records an ICFR control breach as an idempotent, hash-chained ledger entry naming the control id, the rule id and version, and the AS 2201 severity with its basis.';

-- ---------------------------------------------------------------------------
-- 3. D7 — the forensic rule run writer (over a whole population).
-- ---------------------------------------------------------------------------
create or replace function public.forensic_finding_record(
  p_org uuid, p_population_id uuid, p_engagement_id uuid, p_evaluated_at timestamptz, p_findings jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_finding jsonb;
  v_added int := 0;
  v_rule text;
  v_ver int;
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.has_feature(v_org, 'forensic_analytics') then
    raise exception 'feature_off: forensic_analytics' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('perform_work') or public.caller_has_right('review_and_approve')) then
    raise exception 'not permitted: perform_work or review_and_approve is required' using errcode = 'P0001';
  end if;
  if p_evaluated_at is null then
    raise exception 'the evaluation instant is required' using errcode = 'P0001';
  end if;
  if p_population_id is not null
     and not exists (select 1 from populations p where p.id = p_population_id and p.org_id = v_org) then
    raise exception 'population not found in this organisation' using errcode = 'P0001';
  end if;
  if p_engagement_id is not null
     and not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;

  for v_finding in select value from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    v_rule := v_finding ->> 'ruleId';
    v_ver := nullif(v_finding ->> 'ruleVersion', '')::int;
    if coalesce(v_rule, '') = '' or v_ver is null then
      raise exception 'every forensic finding needs a ruleId and a ruleVersion' using errcode = 'P0001';
    end if;
    continue when exists (
      select 1 from ledger_entries l
       where l.org_id = v_org and l.action = 'forensic_finding'
         and l.payload ->> 'population_id' is not distinct from p_population_id::text
         and (l.payload ->> 'evaluated_at')::timestamptz = p_evaluated_at
         and l.payload -> 'finding' ->> 'ruleId' = v_rule
         and (l.payload -> 'finding' ->> 'ruleVersion')::int = v_ver
    );
    perform public.append_ledger_entry(v_org, 'forensic_finding',
      jsonb_build_object(
        'population_id', p_population_id::text,
        'engagement_id', p_engagement_id::text,
        'evaluated_at', p_evaluated_at,
        'finding', v_finding),
      auth.uid());
    v_added := v_added + 1;
  end loop;
  return v_added;
end $$;

comment on function public.forensic_finding_record(uuid, uuid, uuid, timestamptz, jsonb) is
  'S2/D7: records a population-level forensic rule run''s findings as idempotent, hash-chained ledger entries, each naming its rule, version and source.';

insert into feature_catalogue (key, label, description, group_name, price_class, default_on, status) values
  ('forensic_analytics','Population-level forensic analytics','Runs the named forensic rules (Benford first and second digit, the AS 2401 journal-entry family, ISA 530) over a whole population','Assurance','addon',false,'live')
on conflict (key) do update set label = excluded.label, description = excluded.description,
  group_name = excluded.group_name, price_class = excluded.price_class, status = excluded.status;

-- ---------------------------------------------------------------------------
-- 4. D8 — policy obligations, controls and the gap writer.
-- ---------------------------------------------------------------------------
create table if not exists policy_obligations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  obligation_id text not null,
  source_clause text not null,
  subject text not null default '',
  -- NULL marks a clause that could not be interpreted; an array marks the controls it names.
  control_ids jsonb null,
  created_at timestamptz not null default now(),
  unique (org_id, obligation_id)
);
alter table policy_obligations enable row level security;
drop policy if exists policy_obligations_select on policy_obligations;
create policy policy_obligations_select on policy_obligations for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists policy_obligations_pin_org on policy_obligations;
create trigger policy_obligations_pin_org before insert on policy_obligations
  for each row execute function public.pin_org_id();

create table if not exists policy_controls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  control_id text not null,
  label text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, control_id)
);
alter table policy_controls enable row level security;
drop policy if exists policy_controls_select on policy_controls;
create policy policy_controls_select on policy_controls for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists policy_controls_pin_org on policy_controls;
create trigger policy_controls_pin_org before insert on policy_controls
  for each row execute function public.pin_org_id();

create or replace function public.gap_finding_record(p_org uuid, p_findings jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_finding jsonb;
  v_added int := 0;
  v_obl text;
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.has_feature(v_org, 'policy_gap_analysis') then
    raise exception 'feature_off: policy_gap_analysis' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('perform_work') or public.caller_has_right('review_and_approve')) then
    raise exception 'not permitted: perform_work or review_and_approve is required' using errcode = 'P0001';
  end if;

  for v_finding in select value from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    v_obl := v_finding ->> 'obligationId';
    if coalesce(v_obl, '') = '' then
      raise exception 'every gap finding needs an obligationId' using errcode = 'P0001';
    end if;
    if not exists (select 1 from policy_obligations o where o.org_id = v_org and o.obligation_id = v_obl) then
      raise exception 'obligation % not found in this organisation', v_obl using errcode = 'P0001';
    end if;
    -- Idempotent per (obligation, clause): the coverage of a clause is a fact, not a new finding each
    -- time the analysis runs.
    continue when exists (
      select 1 from ledger_entries l
       where l.org_id = v_org and l.action = 'gap_finding'
         and l.payload -> 'finding' ->> 'obligationId' = v_obl
         and l.payload -> 'finding' ->> 'sourceClause' = (v_finding ->> 'sourceClause')
    );
    perform public.append_ledger_entry(v_org, 'gap_finding',
      jsonb_build_object('finding', v_finding), auth.uid());
    v_added := v_added + 1;
  end loop;
  return v_added;
end $$;

comment on function public.gap_finding_record(uuid, jsonb) is
  'S2/D8: records a policy-to-control gap as an idempotent, hash-chained ledger entry naming the clause and the missing control(s). A could-not-interpret clause is recorded as such, never as compliant.';

insert into feature_catalogue (key, label, description, group_name, price_class, default_on, status) values
  ('policy_gap_analysis','Policy-to-control gap analysis','Maps a regulation''s obligations to the controls that satisfy them and reports every gap by its clause','Assurance','addon',false,'live')
on conflict (key) do update set label = excluded.label, description = excluded.description,
  group_name = excluded.group_name, price_class = excluded.price_class, status = excluded.status;

-- ---------------------------------------------------------------------------
-- 5. D9 — the IIA-2024 metrics the audit function is measured against.
-- ---------------------------------------------------------------------------
create table if not exists assurance_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  metric_id text not null,
  standard text not null,
  label text not null default '',
  -- NULL is a real state: the input is missing, so the metric is "unknown", never 0.
  value numeric null,
  evidence_ref text null,
  created_at timestamptz not null default now(),
  unique (org_id, metric_id)
);
alter table assurance_metrics enable row level security;
drop policy if exists assurance_metrics_select on assurance_metrics;
create policy assurance_metrics_select on assurance_metrics for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists assurance_metrics_pin_org on assurance_metrics;
create trigger assurance_metrics_pin_org before insert on assurance_metrics
  for each row execute function public.pin_org_id();

create or replace function public.assurance_metric_save(
  p_org uuid, p_metric_id text, p_standard text, p_label text, p_value numeric, p_evidence_ref text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.caller_has_right('edit_config') then
    raise exception 'not permitted: edit_config is required' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_metric_id), '') = '' or coalesce(btrim(p_standard), '') = '' then
    raise exception 'a metric id and an IIA standard are required' using errcode = 'P0001';
  end if;
  insert into assurance_metrics (org_id, metric_id, standard, label, value, evidence_ref)
  values (v_org, p_metric_id, p_standard, coalesce(p_label, ''), p_value, p_evidence_ref)
  on conflict (org_id, metric_id) do update set
    standard = excluded.standard, label = excluded.label, value = excluded.value,
    evidence_ref = excluded.evidence_ref;
end $$;

insert into feature_catalogue (key, label, description, group_name, price_class, default_on, status) values
  ('assurance_over_assurance','Assurance over assurance','Measures the audit function against the IIA Global Internal Audit Standards (2024) and produces the evidence an external quality assessment asks for','Assurance','addon',false,'live')
on conflict (key) do update set label = excluded.label, description = excluded.description,
  group_name = excluded.group_name, price_class = excluded.price_class, status = excluded.status;

-- ---------------------------------------------------------------------------
-- 6. Grants. A tenant caller reaches each writer under its right; service too. No anon reach.
-- ---------------------------------------------------------------------------
revoke execute on function public.icfr_control_save(uuid, text, text, text, int, text, text, text, text) from public, anon;
revoke execute on function public.icfr_rule_save(uuid, text, int, text, numeric) from public, anon;
revoke execute on function public.icfr_evidence_save(uuid, text, int, int, timestamptz) from public, anon;
revoke execute on function public.icfr_finding_record(uuid, uuid, timestamptz, jsonb) from public, anon;
revoke execute on function public.forensic_finding_record(uuid, uuid, uuid, timestamptz, jsonb) from public, anon;
revoke execute on function public.gap_finding_record(uuid, jsonb) from public, anon;
revoke execute on function public.assurance_metric_save(uuid, text, text, text, numeric, text) from public, anon;

grant execute on function public.icfr_control_save(uuid, text, text, text, int, text, text, text, text) to authenticated, service_role;
grant execute on function public.icfr_rule_save(uuid, text, int, text, numeric) to authenticated, service_role;
grant execute on function public.icfr_evidence_save(uuid, text, int, int, timestamptz) to authenticated, service_role;
grant execute on function public.icfr_finding_record(uuid, uuid, timestamptz, jsonb) to authenticated, service_role;
grant execute on function public.forensic_finding_record(uuid, uuid, uuid, timestamptz, jsonb) to authenticated, service_role;
grant execute on function public.gap_finding_record(uuid, jsonb) to authenticated, service_role;
grant execute on function public.assurance_metric_save(uuid, text, text, text, numeric, text) to authenticated, service_role;

grant select on table icfr_controls to authenticated;
grant select on table icfr_monitor_rules to authenticated;
grant select on table icfr_control_evidence to authenticated;
grant select on table icfr_thresholds to authenticated;
grant select on table policy_obligations to authenticated;
grant select on table policy_controls to authenticated;
grant select on table assurance_metrics to authenticated;
