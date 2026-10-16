-- 3C: SIRA risk library, per-organisation model, versioned model history, and sira_compute (spec §8.1, §8.2).
--
-- The spec:
--   §8.1 "A universal risk library holds risks reusable across entities and universes. Within a
--         Universe, the organisation selects which risks apply to which Entity."
--   §8.2 "Each organisation uses the QSCorp default model or defines its own" with factors,
--         scales (default 1-5), per-factor weights, bands (default Low/Medium/High/Critical) and an
--         aggregation chosen from a fixed library of named methods. All scores normalise to 0-100
--         and are recorded with the factor values and method used.
--
-- Reuse (grep first): risks_library already exists (0003) and is the universal library, so this
-- migration ALTERs it (code, category, is_universal) rather than creating a second library.
-- sira_scores already exists (0003) with score/factor_values/method, so the computed score is
-- written there and no second score table is created.
--
-- L1: the aggregation is deterministic code (public.sira_compute) with no randomness and no AI, and
-- it is mirrored exactly in src/lib/siraEngine.ts with a parity test.

-- ---------------------------------------------------------------------------
-- Universal risk library.
-- ---------------------------------------------------------------------------
alter table risks_library add column if not exists code text;
alter table risks_library add column if not exists category text;
alter table risks_library add column if not exists is_universal boolean not null default false;
create unique index if not exists risks_library_org_code_idx on risks_library (org_id, code) where code is not null;

-- Within a Universe, which risks apply to which Entity (§8.1). One row per selection.
create table if not exists sira_risk_selection (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  universe_id uuid not null references universes(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  risk_id uuid not null references risks_library(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (org_id, entity_id, risk_id)
);

-- ---------------------------------------------------------------------------
-- Per-organisation model (factors, scales, weights, bands, aggregation). One active model per org;
-- the model is snapshotted into sira_model_versions on every publish so history is immutable.
-- ---------------------------------------------------------------------------
create table if not exists sira_models (
  org_id uuid primary key references orgs(id) on delete cascade,
  version int not null default 1,
  aggregation text not null default 'weighted_sum',
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

alter table sira_models drop constraint if exists sira_models_aggregation_chk;
alter table sira_models add constraint sira_models_aggregation_chk
  check (aggregation in ('weighted_sum', 'maximum', 'weighted_average', 'weighted_average_floor'));

create table if not exists sira_factors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  label text not null,
  weight numeric(8,4) not null default 1,
  ordinal int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists sira_scales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  point int not null check (point between 1 and 10),
  label text not null,
  created_at timestamptz not null default now(),
  unique (org_id, point)
);

create table if not exists sira_bands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  min_score numeric(6,2) not null,
  max_score numeric(6,2) not null,
  ordinal int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

-- Immutable model history (L5). Every publish appends one row; the append-only trigger is in 0020
-- with the other Phase 3 append-only tables, but the table is created here so 0019 is self-contained.
create table if not exists sira_model_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  version int not null,
  snapshot jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, version)
);

-- ---------------------------------------------------------------------------
-- Seed the QSCorp default model for every organisation. Idempotent: only inserts what is missing.
-- Default six factors, 1-5 scale, four bands, weighted_sum aggregation (§8.2).
-- ---------------------------------------------------------------------------
create or replace function public.seed_sira_model(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into sira_models (org_id) values (p_org) on conflict (org_id) do nothing;

  insert into sira_factors (org_id, key, label, weight, ordinal) values
    (p_org, 'inherent_risk',      'Inherent risk',            1.0, 1),
    (p_org, 'complexity',         'Complexity',               1.0, 2),
    (p_org, 'regulatory_exposure','Regulatory exposure',      1.0, 3),
    (p_org, 'prior_findings',     'Prior findings',           1.0, 4),
    (p_org, 'time_since_audit',   'Time since last audit',    1.0, 5),
    (p_org, 'materiality',        'Materiality',              1.0, 6)
  on conflict (org_id, key) do nothing;

  insert into sira_scales (org_id, point, label) values
    (p_org, 1, 'Very low'), (p_org, 2, 'Low'), (p_org, 3, 'Medium'),
    (p_org, 4, 'High'), (p_org, 5, 'Very high')
  on conflict (org_id, point) do nothing;

  insert into sira_bands (org_id, name, min_score, max_score, ordinal) values
    (p_org, 'Low',      0,  25, 1),
    (p_org, 'Medium',  25,  50, 2),
    (p_org, 'High',    50,  75, 3),
    (p_org, 'Critical',75, 100, 4)
  on conflict (org_id, name) do nothing;
end $$;

-- Seed for existing orgs, and for every org created afterwards.
select public.seed_sira_model(id) from orgs;

create or replace function public.orgs_seed_sira_model() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_sira_model(new.id);
  return new;
end $$;

drop trigger if exists orgs_seed_sira_model on orgs;
create trigger orgs_seed_sira_model after insert on orgs
  for each row execute function public.orgs_seed_sira_model();

-- ---------------------------------------------------------------------------
-- sira_compute: deterministic normalisation of factor values to a 0-100 score (L1, §8.2).
-- Inputs: a jsonb object {factor_key: point}, the factor weights, the max scale point, and the
-- named aggregation method. The same algorithm is mirrored in src/lib/siraEngine.ts.
--   weighted_sum          : 100 * sum(weight_i * (v_i - 1)) / sum(weight_i * (max_point - 1))
--   maximum               : 100 * max_i((v_i - 1)) / (max_point - 1)
--   weighted_average      : 100 * sum(weight_i * v_i) / (sum(weight_i) * max_point)
--   weighted_average_floor: weighted_average, but no factor may pull the result below the highest
--                           single factor's share: max(weighted_average, 100 * max_i((v_i-1)) / (max_point-1) * 0.5)
-- ---------------------------------------------------------------------------
create or replace function public.sira_compute(
  p_factor_values jsonb,
  p_weights jsonb,
  p_max_point int,
  p_method text
) returns numeric
language plpgsql immutable as $$
declare
  v_max int := greatest(coalesce(p_max_point, 5), 2);
  v_sum_w_delta numeric := 0;   -- sum(weight * (v-1))
  v_sum_w_span numeric := 0;    -- sum(weight * (max-1))
  v_sum_w numeric := 0;         -- sum(weight)
  v_sum_w_v numeric := 0;       -- sum(weight * v)
  v_max_delta numeric := 0;     -- max(v-1)
  k text;
  v numeric;
  w numeric;
begin
  if p_factor_values is null or jsonb_typeof(p_factor_values) <> 'object' then
    raise exception 'sira_compute: factor values must be a JSON object' using errcode = 'P0001';
  end if;

  for k, v in select key, (value #>> '{}')::numeric from jsonb_each(p_factor_values) loop
    if v is null then
      continue;
    end if;
    if v < 1 or v > v_max then
      raise exception 'sira_compute: factor % value % is outside 1..%', k, v, v_max using errcode = 'P0001';
    end if;
    w := coalesce((p_weights ->> k)::numeric, 1);
    v_sum_w := v_sum_w + w;
    v_sum_w_v := v_sum_w_v + w * v;
    v_sum_w_delta := v_sum_w_delta + w * (v - 1);
    v_sum_w_span := v_sum_w_span + w * (v_max - 1);
    if (v - 1) > v_max_delta then
      v_max_delta := v - 1;
    end if;
  end loop;

  if v_sum_w = 0 then
    return 0;
  end if;

  if p_method = 'maximum' then
    return round(100 * v_max_delta / (v_max - 1), 2);
  elsif p_method = 'weighted_average' then
    return round(100 * v_sum_w_v / (v_sum_w * v_max), 2);
  elsif p_method = 'weighted_average_floor' then
    return round(greatest(100 * v_sum_w_v / (v_sum_w * v_max),
                          100 * v_max_delta / (v_max - 1) * 0.5), 2);
  elsif p_method = 'weighted_sum' then
    if v_sum_w_span = 0 then
      return 0;
    end if;
    return round(100 * v_sum_w_delta / v_sum_w_span, 2);
  else
    raise exception 'sira_compute: unknown aggregation method %', p_method using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- sira_band_for: map a 0-100 score to a band name (§8.2). Highest matching band wins.
-- ---------------------------------------------------------------------------
create or replace function public.sira_band_for(p_org uuid, p_score numeric)
returns text language sql stable security definer set search_path = public as $$
  select b.name from sira_bands b
  where b.org_id = p_org and p_score >= b.min_score and p_score <= b.max_score
  order by b.ordinal desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Model editing. Requires edit_config. Every change bumps the model version and appends a
-- snapshot to sira_model_versions (L5, "configuration changes are versioned and logged").
-- ---------------------------------------------------------------------------
create or replace function public.admin_snapshot_sira_model(p_org uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_version int;
  v_snapshot jsonb;
begin
  update sira_models set version = version + 1, updated_at = now(), updated_by = auth.uid()
   where org_id = p_org
  returning version into v_version;

  select jsonb_build_object(
           'aggregation', m.aggregation,
           'factors', (select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label,
                          'weight', f.weight, 'ordinal', f.ordinal) order by f.ordinal), '[]'::jsonb)
                       from sira_factors f where f.org_id = p_org),
           'scales', (select coalesce(jsonb_agg(jsonb_build_object('point', s.point, 'label', s.label) order by s.point), '[]'::jsonb)
                      from sira_scales s where s.org_id = p_org),
           'bands', (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'min', b.min_score,
                         'max', b.max_score, 'ordinal', b.ordinal) order by b.ordinal), '[]'::jsonb)
                     from sira_bands b where b.org_id = p_org)
         )
    into v_snapshot
    from sira_models m where m.org_id = p_org;

  insert into sira_model_versions (org_id, version, snapshot, actor_id)
  values (p_org, v_version, coalesce(v_snapshot, '{}'::jsonb), auth.uid());

  insert into activity_log (org_id, actor_id, action, object_type, detail)
  values (p_org, auth.uid(), 'sira_model_published', 'config',
          jsonb_build_object('version', v_version));

  return v_version;
end $$;

create or replace function public.admin_set_sira_aggregation(p_method text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  if p_method not in ('weighted_sum', 'maximum', 'weighted_average', 'weighted_average_floor') then
    raise exception 'unknown aggregation method %', p_method using errcode = 'P0001';
  end if;
  perform public.seed_sira_model(v_org);
  update sira_models set aggregation = p_method where org_id = v_org;
  perform public.admin_snapshot_sira_model(v_org);
end $$;

create or replace function public.admin_upsert_sira_factor(
  p_key text, p_label text, p_weight numeric default 1, p_ordinal int default 0
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  if p_key is null or btrim(p_key) = '' then
    raise exception 'a factor key is required' using errcode = 'P0001';
  end if;
  perform public.seed_sira_model(v_org);
  insert into sira_factors (org_id, key, label, weight, ordinal)
  values (v_org, btrim(p_key), coalesce(p_label, p_key), coalesce(p_weight, 1), coalesce(p_ordinal, 0))
  on conflict (org_id, key) do update
    set label = excluded.label, weight = excluded.weight, ordinal = excluded.ordinal;
  perform public.admin_snapshot_sira_model(v_org);
end $$;

create or replace function public.admin_set_sira_band(p_name text, p_min numeric, p_max numeric, p_ordinal int default 0)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'a band name is required' using errcode = 'P0001';
  end if;
  if p_min is null or p_max is null or p_min >= p_max then
    raise exception 'a band needs min < max' using errcode = 'P0001';
  end if;
  perform public.seed_sira_model(v_org);
  insert into sira_bands (org_id, name, min_score, max_score, ordinal)
  values (v_org, btrim(p_name), p_min, p_max, coalesce(p_ordinal, 0))
  on conflict (org_id, name) do update
    set min_score = excluded.min_score, max_score = excluded.max_score, ordinal = excluded.ordinal;
  perform public.admin_snapshot_sira_model(v_org);
end $$;

-- ---------------------------------------------------------------------------
-- Model reads (rights-gated by the table's select policy; helpers add nothing new).
-- ---------------------------------------------------------------------------
create or replace function public.sira_model_snapshot(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'aggregation', m.aggregation,
           'version', m.version,
           'factors', (select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label,
                          'weight', f.weight, 'ordinal', f.ordinal) order by f.ordinal), '[]'::jsonb)
                       from sira_factors f where f.org_id = p_org),
           'scales', (select coalesce(jsonb_agg(jsonb_build_object('point', s.point, 'label', s.label) order by s.point), '[]'::jsonb)
                      from sira_scales s where s.org_id = p_org),
           'bands', (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'min', b.min_score,
                         'max', b.max_score, 'ordinal', b.ordinal) order by b.ordinal), '[]'::jsonb)
                     from sira_bands b where b.org_id = p_org)
         )
  from sira_models m where m.org_id = p_org
$$;

-- ---------------------------------------------------------------------------
-- select_sira_risk: record that a library risk applies to an entity in a universe (§8.1).
-- The table has no write policy (writes go through this function only). The right that governs
-- audit-content setup, manage_engagements, is required.
-- ---------------------------------------------------------------------------
create or replace function public.select_sira_risk(p_universe uuid, p_entity uuid, p_risk uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from universes where id = p_universe and org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from entities where id = p_entity and org_id = v_org and universe_id = p_universe) then
    raise exception 'entity not found in this organisation or not in the universe' using errcode = 'P0001';
  end if;
  if not exists (select 1 from risks_library where id = p_risk and org_id = v_org) then
    raise exception 'risk not found in this organisation' using errcode = 'P0001';
  end if;
  insert into sira_risk_selection (org_id, universe_id, entity_id, risk_id)
  values (v_org, p_universe, p_entity, p_risk)
  returning id into v_id;
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'sira_risk_selected', 'entity', p_entity,
          jsonb_build_object('risk_id', p_risk, 'universe_id', p_universe));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- RLS. Every new table carries org_id, has RLS on, and has a select policy only.
-- ---------------------------------------------------------------------------
alter table sira_risk_selection enable row level security;
alter table sira_models          enable row level security;
alter table sira_factors         enable row level security;
alter table sira_scales          enable row level security;
alter table sira_bands           enable row level security;
alter table sira_model_versions  enable row level security;

drop policy if exists srs_select on sira_risk_selection;
create policy srs_select on sira_risk_selection for select to authenticated
  using (org_id = public.jwt_org_id() and (public.can_read_all_scopes() or public.has_scope(universe_id, entity_id, null)));
drop policy if exists sm_select on sira_models;
create policy sm_select on sira_models for select to authenticated
  using (org_id = public.jwt_org_id());
drop policy if exists sf_select on sira_factors;
create policy sf_select on sira_factors for select to authenticated
  using (org_id = public.jwt_org_id());
drop policy if exists ss_select on sira_scales;
create policy ss_select on sira_scales for select to authenticated
  using (org_id = public.jwt_org_id());
drop policy if exists sb_select on sira_bands;
create policy sb_select on sira_bands for select to authenticated
  using (org_id = public.jwt_org_id());
drop policy if exists smv_select on sira_model_versions;
create policy smv_select on sira_model_versions for select to authenticated
  using (org_id = public.jwt_org_id());

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.seed_sira_model(uuid) from public, anon;
revoke execute on function public.orgs_seed_sira_model() from public, anon;
revoke execute on function public.sira_compute(jsonb, jsonb, int, text) from public, anon;
revoke execute on function public.sira_band_for(uuid, numeric) from public, anon;
revoke execute on function public.admin_snapshot_sira_model(uuid) from public, anon;
revoke execute on function public.admin_set_sira_aggregation(text) from public, anon;
revoke execute on function public.admin_upsert_sira_factor(text, text, numeric, int) from public, anon;
revoke execute on function public.admin_set_sira_band(text, numeric, numeric, int) from public, anon;
revoke execute on function public.sira_model_snapshot(uuid) from public, anon;
revoke execute on function public.select_sira_risk(uuid, uuid, uuid) from public, anon;

grant execute on function public.sira_compute(jsonb, jsonb, int, text) to authenticated;
grant execute on function public.sira_band_for(uuid, numeric) to authenticated;
grant execute on function public.sira_model_snapshot(uuid) to authenticated;
grant execute on function public.select_sira_risk(uuid, uuid, uuid) to authenticated;
grant execute on function public.admin_set_sira_aggregation(text) to authenticated;
grant execute on function public.admin_upsert_sira_factor(text, text, numeric, int) to authenticated;
grant execute on function public.admin_set_sira_band(text, numeric, numeric, int) to authenticated;
