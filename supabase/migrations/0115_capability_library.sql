-- 0115: the deterministic capability library (D1-D4).
--
-- The five-capability families (risk/control, population/evidence, process/governance, assurance
-- operations) are PURE functions under `src/lib/capabilities/` — they take rows and the day as
-- arguments and produce findings that name the rule and the rows behind them, so a finding re-runs
-- identically forever. That is the product's claim; nothing here may be a model call (Law L1).
--
-- This migration adds the two pieces of state those pure functions need and cannot hold:
--
--   1. `capability_config` — the organisation's thresholds (risk tolerance, stratification sample
--      size, reviewer ageing window). A parameter is config, so it is versioned and reason-stamped
--      through `admin_log_change` (config-as-ledger), never edited in place.
--   2. `capability_runs` — an append-only record of each run: the kind, the hash of the inputs, and
--      the findings. A run is evidence that a capability was exercised over a specific input set at a
--      specific time; it is never updated, only appended. Only the input HASH is stored — never the
--      tenant rows themselves (Law L2).
--
-- Laws honoured: L2 (only hashes and derived findings leave; no tenant content is copied here),
-- rights not role names (`edit_config` to change thresholds, any audit right to read), append-only,
-- idempotent (the harness applies every file twice), and every RPC is security-definer with an
-- explicit caller check.

-- ---------------------------------------------------------------------------
-- 1. capability_config — one row per org: the thresholds the pure functions are handed.
-- ---------------------------------------------------------------------------
create table if not exists capability_config (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table capability_config add column if not exists risk_tolerance text not null default 'high';
alter table capability_config add column if not exists stratification_sample int not null default 25;
alter table capability_config add column if not exists reviewer_ageing_days int not null default 14;
alter table capability_config add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'capability_config_tolerance_chk') then
    alter table capability_config add constraint capability_config_tolerance_chk
      check (risk_tolerance in ('low', 'medium', 'high', 'critical'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'capability_config_sample_chk') then
    alter table capability_config add constraint capability_config_sample_chk
      check (stratification_sample between 1 and 100000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'capability_config_ageing_chk') then
    alter table capability_config add constraint capability_config_ageing_chk
      check (reviewer_ageing_days between 1 and 3650);
  end if;
end $$;

alter table capability_config enable row level security;
drop policy if exists capability_config_select on capability_config;
create policy capability_config_select on capability_config for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

drop trigger if exists capability_config_pin_org on capability_config;
create trigger capability_config_pin_org before insert on capability_config
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 2. capability_runs — the append-only record of each run. Findings are derived, not tenant rows.
-- ---------------------------------------------------------------------------
create table if not exists capability_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('risk_control', 'population_evidence', 'process_governance', 'assurance_ops')),
  inputs_hash text not null,
  findings jsonb not null default '{}'::jsonb,
  finding_count int not null default 0,
  actor_id uuid null,
  created_at timestamptz not null default now()
);
create index if not exists capability_runs_org_idx on capability_runs (org_id, created_at desc);
create index if not exists capability_runs_kind_idx on capability_runs (org_id, kind, created_at desc);

alter table capability_runs enable row level security;
drop policy if exists capability_runs_select on capability_runs;
create policy capability_runs_select on capability_runs for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

drop trigger if exists capability_runs_pin_org on capability_runs;
create trigger capability_runs_pin_org before insert on capability_runs
  for each row execute function public.pin_org_id();

-- A run is append-only: no UPDATE and no DELETE, so a recorded finding cannot be quietly edited.
create or replace function public.capability_runs_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'a capability run is append-only' using errcode = 'P0001';
end $$;

drop trigger if exists capability_runs_no_update on capability_runs;
create trigger capability_runs_no_update before update or delete on capability_runs
  for each row execute function public.capability_runs_immutable();

-- ---------------------------------------------------------------------------
-- 3. RPCs. Reads re-check the caller's org; the write re-checks edit_config.
-- ---------------------------------------------------------------------------

-- The org's capability thresholds, with the defaults materialised when no row exists yet.
create or replace function public.capability_config_get()
returns table (risk_tolerance text, stratification_sample int, reviewer_ageing_days int)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  return query
    select coalesce(c.risk_tolerance, 'high'),
           coalesce(c.stratification_sample, 25),
           coalesce(c.reviewer_ageing_days, 14)
    from (select 1) x
    left join capability_config c on c.org_id = v_org;
end $$;

-- Change the thresholds. Requires edit_config, and every change is versioned and reason-stamped.
create or replace function public.capability_config_save(
  p_risk_tolerance text, p_stratification_sample int, p_reviewer_ageing_days int, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  if not public.caller_has_right('edit_config') then
    raise exception 'edit_config is required to change capability thresholds' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = 'P0001';
  end if;
  if p_risk_tolerance not in ('low', 'medium', 'high', 'critical') then
    raise exception 'the risk tolerance must be low, medium, high or critical' using errcode = 'P0001';
  end if;
  if p_stratification_sample is null or p_stratification_sample < 1 then
    raise exception 'the stratification sample size must be positive' using errcode = 'P0001';
  end if;
  if p_reviewer_ageing_days is null or p_reviewer_ageing_days < 1 then
    raise exception 'the reviewer ageing window must be positive' using errcode = 'P0001';
  end if;

  insert into capability_config (org_id, risk_tolerance, stratification_sample, reviewer_ageing_days, updated_at)
  values (v_org, p_risk_tolerance, p_stratification_sample, p_reviewer_ageing_days, now())
  on conflict (org_id) do update set
    risk_tolerance = excluded.risk_tolerance,
    stratification_sample = excluded.stratification_sample,
    reviewer_ageing_days = excluded.reviewer_ageing_days,
    updated_at = now();

  perform public.admin_log_change(
    v_org, 'capability_config',
    jsonb_build_object('risk_tolerance', p_risk_tolerance,
                       'stratification_sample', p_stratification_sample,
                       'reviewer_ageing_days', p_reviewer_ageing_days,
                       'reason', p_reason),
    'capability_config_saved', 'capability_config', null);
end $$;

-- Record a run. Any audit right may record; the inputs are identified by hash, never copied.
create or replace function public.capability_run_record(
  p_kind text, p_inputs_hash text, p_findings jsonb, p_finding_count int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  if p_kind not in ('risk_control', 'population_evidence', 'process_governance', 'assurance_ops') then
    raise exception 'unknown capability kind: %', p_kind using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('perform_work') or public.caller_has_right('review_and_approve')
          or public.caller_has_right('view_all_scopes') or public.caller_has_right('read_only')) then
    raise exception 'an audit right is required to record a capability run' using errcode = 'P0001';
  end if;
  if p_inputs_hash is null or length(p_inputs_hash) < 8 then
    raise exception 'an inputs hash is required' using errcode = 'P0001';
  end if;

  insert into capability_runs (org_id, kind, inputs_hash, findings, finding_count, actor_id)
  values (v_org, p_kind, p_inputs_hash, coalesce(p_findings, '{}'::jsonb),
          coalesce(p_finding_count, 0), auth.uid())
  returning id into v_id;

  perform public.admin_log_change(
    v_org, 'capability_run',
    jsonb_build_object('kind', p_kind, 'inputs_hash', p_inputs_hash, 'finding_count', coalesce(p_finding_count, 0)),
    'capability_run_recorded', 'capability_run', v_id);
  return v_id;
end $$;

-- List the org's runs, newest first, optionally narrowed to one kind.
create or replace function public.capability_runs_list(p_kind text default null)
returns table (id uuid, kind text, inputs_hash text, finding_count int, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  return query
    select r.id, r.kind, r.inputs_hash, r.finding_count, r.created_at
    from capability_runs r
    where r.org_id = v_org
      and (p_kind is null or r.kind = p_kind)
    order by r.created_at desc
    limit 500;
end $$;

revoke execute on function public.capability_config_get() from public, anon;
revoke execute on function public.capability_config_save(text, int, int, text) from public, anon;
revoke execute on function public.capability_run_record(text, text, jsonb, int) from public, anon;
revoke execute on function public.capability_runs_list(text) from public, anon;
revoke execute on function public.capability_runs_immutable() from public, anon;
grant execute on function public.capability_config_get() to authenticated;
grant execute on function public.capability_config_save(text, int, int, text) to authenticated;
grant execute on function public.capability_run_record(text, text, jsonb, int) to authenticated;
grant execute on function public.capability_runs_list(text) to authenticated;

-- Table grants follow the 0008 convention: authenticated reads (RLS filters), writes only via RPC.
grant select on table capability_config to authenticated;
grant select on table capability_runs to authenticated;
