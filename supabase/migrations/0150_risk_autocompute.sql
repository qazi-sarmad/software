-- 0150 (S3): D14 — the auto-compute normalisation, the derived-factor write path, and the manual
-- override, on top of 0149.
--
-- Owner instruction 2026-10-30: "Risks autocompute means that total factors and mathematical formula
-- to stay at 100."
--
-- What this migration adds:
--   1. sira_normalize_weights  — deterministic largest-remainder normalisation of the factor weights
--                                so they sum to exactly 100 (parity with src/lib/siraEngine.ts).
--   2. sira_scores gains auto_values, overrides and method (docs/RISK-ASSESSMENT-MODEL.md §7).
--   3. risk_factor_write       — write the derived (auto) factor values for a cycle/entity/risk, and
--                                normalise the model's weights in the same transaction.
--   4. risk_override_set       — record a manual override (mandatory reason, auto value kept).
--   5. risk_override_revert    — revert an override, recording the revert.
--
-- Laws: L1 (a rule over configured data), L2 (RLS + jwt_org_id()), L3 (the override never destroys
-- the auto value; the normalised weights are appended to the model version), L5 (logged).
--
-- M1/M2/M6: new names only; ALTERs the existing sira_scores; applied twice by the harness.

-- ---------------------------------------------------------------------------
-- 1. The normalisation. Largest remainder, ties broken by factor key, sum exactly 100.
-- ---------------------------------------------------------------------------
create or replace function public.sira_normalize_weights(p_weights jsonb)
returns jsonb
language plpgsql immutable as $$
declare
  v_total numeric := 0;
  v_deficit int;
  r record;
  v_out jsonb := '{}'::jsonb;
  v_exact numeric;
  v_floor int;
  v_rem numeric;
  v_rows jsonb := '[]'::jsonb;
begin
  if p_weights is null or jsonb_typeof(p_weights) <> 'object' then
    raise exception 'sira_normalize_weights: weights must be a JSON object' using errcode = 'P0001';
  end if;

  -- Zero every key first, so a key with a non-positive weight is present but 0.
  for r in select key, (value #>> '{}')::numeric as w from jsonb_each(p_weights) loop
    v_out := v_out || jsonb_build_object(r.key, 0);
    if r.w is not null and r.w > 0 then v_total := v_total + r.w; end if;
  end loop;
  if v_total <= 0 then return v_out; end if;

  for r in
    select key, (value #>> '{}')::numeric as w from jsonb_each(p_weights)
    where (value #>> '{}')::numeric > 0
    order by key
  loop
    v_exact := (r.w / v_total) * 100;
    v_floor := floor(v_exact);
    v_rem := v_exact - v_floor;
    v_rows := v_rows || jsonb_build_object('key', r.key, 'floor', v_floor, 'rem', v_rem);
  end loop;

  v_deficit := 100 - (select coalesce(sum((e ->> 'floor')::int), 0) from jsonb_array_elements(v_rows) e);

  for r in
    select e ->> 'key' as key, (e ->> 'floor')::int as floor, (e ->> 'rem')::numeric as rem
    from jsonb_array_elements(v_rows) e
    order by (e ->> 'rem')::numeric desc, (e ->> 'key') asc
  loop
    if v_deficit > 0 then
      v_out := jsonb_set(v_out, array[r.key], to_jsonb(r.floor + 1));
      v_deficit := v_deficit - 1;
    else
      v_out := jsonb_set(v_out, array[r.key], to_jsonb(r.floor));
    end if;
  end loop;

  return v_out;
end $$;

comment on function public.sira_normalize_weights(jsonb) is
  'S3/D14: normalises factor weights to integers summing to exactly 100 (largest remainder, ties by key). Mirrors normalizeWeights in src/lib/siraEngine.ts.';

-- ---------------------------------------------------------------------------
-- 2. sira_scores gains the auto/override/method columns the model names (§7).
-- ---------------------------------------------------------------------------
alter table sira_scores add column if not exists auto_values jsonb not null default '{}'::jsonb;
alter table sira_scores add column if not exists overrides jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 3. risk_factor_write: store the auto-derived proposals and the resolved factor values for one
--    cycle/entity/risk, and normalise the model weights in the same action. Requires manage_engagements.
-- ---------------------------------------------------------------------------
create or replace function public.risk_factor_write(
  p_org uuid, p_cycle uuid, p_entity uuid, p_risk uuid, p_auto_values jsonb, p_overrides jsonb default '[]'::jsonb
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
  v_weights jsonb;
  v_norm jsonb;
  v_factor_values jsonb := '{}'::jsonb;
  v_method text;
  v_score numeric;
  r record;
  o jsonb;
  v_override jsonb;
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.caller_has_right('manage_engagements') then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sira_cycles c where c.id = p_cycle and c.org_id = v_org) then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from entities e where e.id = p_entity and e.org_id = v_org) then
    raise exception 'entity not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from risks_library l where l.id = p_risk and l.org_id = v_org) then
    raise exception 'risk not found in this organisation' using errcode = 'P0001';
  end if;

  -- The model's weights, normalised to 100 (the auto-compute guarantee).
  select coalesce(jsonb_object_agg(f.key, f.weight), '{}'::jsonb) into v_weights
    from sira_factors f where f.org_id = v_org;
  v_norm := public.sira_normalize_weights(v_weights);
  select coalesce(m.aggregation, 'weighted_sum') into v_method from sira_models m where m.org_id = v_org;

  -- p_auto_values is the array of proposals ({factorKey, proposedValue, ...}). The resolved value per
  -- factor: an override wins; an unknown proposal (proposedValue null) is omitted (never 0).
  for r in select (value ->> 'factorKey') as key, (value ->> 'proposedValue')::numeric as v
             from jsonb_array_elements(coalesce(p_auto_values, '[]'::jsonb)) loop
    if r.v is not null then v_factor_values := v_factor_values || jsonb_build_object(r.key, r.v); end if;
  end loop;
  for v_override in select value from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) loop
    if (v_override ->> 'overrideValue') is not null then
      v_factor_values := jsonb_set(v_factor_values, array[v_override ->> 'factorKey'],
        to_jsonb((v_override ->> 'overrideValue')::numeric));
    end if;
  end loop;

  v_score := public.sira_compute(v_factor_values, v_norm, 5, v_method);

  insert into sira_scores (org_id, cycle_id, entity_id, risk_id, score, factor_values, method, auto_values, overrides)
  values (v_org, p_cycle, p_entity, p_risk, v_score, v_factor_values, v_method,
          coalesce(p_auto_values, '{}'::jsonb), coalesce(p_overrides, '[]'::jsonb))
  on conflict (org_id, cycle_id, entity_id, risk_id) do update set
    score = excluded.score, factor_values = excluded.factor_values, method = excluded.method,
    auto_values = excluded.auto_values, overrides = excluded.overrides;

  perform public.append_ledger_entry(v_org, 'risk_factor_write',
    jsonb_build_object('cycle_id', p_cycle::text, 'entity_id', p_entity::text, 'risk_id', p_risk::text,
                       'score', v_score, 'normalised_weights', v_norm), auth.uid());
  return v_score;
end $$;

comment on function public.risk_factor_write(uuid, uuid, uuid, uuid, jsonb, jsonb) is
  'S3/D14: writes the auto-derived factor values (and any override) for one cycle/entity/risk, normalising the model weights to 100 and recomputing the score. An unknown value is omitted, never 0.';

-- ---------------------------------------------------------------------------
-- 4. risk_override_set: record a manual override. The reason is mandatory and the auto value is kept.
-- ---------------------------------------------------------------------------
create or replace function public.risk_override_set(
  p_org uuid, p_cycle uuid, p_entity uuid, p_risk uuid,
  p_factor_key text, p_override_value numeric, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
  v_auto jsonb;
  v_overrides jsonb;
  v_auto_value numeric;
  v_rule text;
  v_ver int;
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not (public.caller_has_right('edit_config') or public.caller_has_right('manage_engagements')) then
    raise exception 'not permitted: edit_config or manage_engagements is required' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'an override requires a reason — an empty reason is refused' using errcode = 'P0001';
  end if;
  if p_override_value is null or p_override_value < 1 or p_override_value > 5 then
    raise exception 'override value % is outside 1..5', p_override_value using errcode = 'P0001';
  end if;

  select auto_values, overrides into v_auto, v_overrides
  from sira_scores where org_id = v_org and cycle_id = p_cycle and entity_id = p_entity and risk_id = p_risk;
  if v_auto is null then
    raise exception 'no derived factors exist for this cycle/entity/risk yet' using errcode = 'P0001';
  end if;

  -- The automatic value at the moment of override: from the proposal's proposedValue, or its value.
  select (value ->> 'proposedValue')::numeric, value ->> 'ruleId', (value ->> 'ruleVersion')::int
    into v_auto_value, v_rule, v_ver
  from jsonb_array_elements(v_auto) where value ->> 'factorKey' = p_factor_key;
  if v_auto_value is null then
    -- A proposal whose proposedValue is null is an unknown input; keep the null, never coerce to 0.
    v_auto_value := null;
  end if;

  v_overrides := coalesce(v_overrides, '[]'::jsonb) || jsonb_build_object(
    'factorKey', p_factor_key, 'overrideValue', p_override_value, 'overrideReason', btrim(p_reason),
    'overrideBy', auth.uid()::text, 'overrideAt', now(), 'autoValueAtOverride', v_auto_value,
    'ruleId', v_rule, 'ruleVersion', v_ver);

  update sira_scores set overrides = v_overrides
   where org_id = v_org and cycle_id = p_cycle and entity_id = p_entity and risk_id = p_risk;

  perform public.admin_log_change(v_org, 'risk_override',
    jsonb_build_object('factor_key', p_factor_key, 'override_value', p_override_value, 'reason', btrim(p_reason)),
    'risk_override_set', 'config', null);
  perform public.append_ledger_entry(v_org, 'risk_override_set',
    jsonb_build_object('cycle_id', p_cycle::text, 'entity_id', p_entity::text, 'risk_id', p_risk::text,
                       'factor_key', p_factor_key, 'override_value', p_override_value,
                       'auto_value_at_override', v_auto_value), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 5. risk_override_revert: revert an override, recording the revert in the reason trail.
-- ---------------------------------------------------------------------------
create or replace function public.risk_override_revert(
  p_org uuid, p_cycle uuid, p_entity uuid, p_risk uuid, p_factor_key text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
  v_overrides jsonb;
  v_kept jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_found boolean := false;
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not (public.caller_has_right('edit_config') or public.caller_has_right('manage_engagements')) then
    raise exception 'not permitted: edit_config or manage_engagements is required' using errcode = 'P0001';
  end if;

  select overrides into v_overrides from sira_scores
   where org_id = v_org and cycle_id = p_cycle and entity_id = p_entity and risk_id = p_risk;
  if v_overrides is null then
    raise exception 'no override set exists for this cycle/entity/risk' using errcode = 'P0001';
  end if;

  for v_elem in select value from jsonb_array_elements(v_overrides) loop
    if v_elem ->> 'factorKey' = p_factor_key then
      v_found := true;
      v_elem := jsonb_set(v_elem, '{overrideReason}',
        to_jsonb((v_elem ->> 'overrideReason') || ' [reverted by ' || auth.uid()::text || ' at ' || now() || ']'));
      v_elem := jsonb_set(v_elem, '{reverted}', 'true'::jsonb);
    end if;
    v_kept := v_kept || v_elem;
  end loop;
  if not v_found then
    raise exception 'factor % has no override to revert', p_factor_key using errcode = 'P0001';
  end if;

  update sira_scores set overrides = v_kept
   where org_id = v_org and cycle_id = p_cycle and entity_id = p_entity and risk_id = p_risk;

  perform public.admin_log_change(v_org, 'risk_override_revert',
    jsonb_build_object('factor_key', p_factor_key), 'risk_override_revert', 'config', null);
  perform public.append_ledger_entry(v_org, 'risk_override_revert',
    jsonb_build_object('cycle_id', p_cycle::text, 'entity_id', p_entity::text, 'risk_id', p_risk::text,
                       'factor_key', p_factor_key), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants.
-- ---------------------------------------------------------------------------
revoke execute on function public.sira_normalize_weights(jsonb) from public, anon;
revoke execute on function public.risk_factor_write(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.risk_override_set(uuid, uuid, uuid, uuid, text, numeric, text) from public, anon;
revoke execute on function public.risk_override_revert(uuid, uuid, uuid, uuid, text) from public, anon;

grant execute on function public.sira_normalize_weights(jsonb) to authenticated;
grant execute on function public.risk_factor_write(uuid, uuid, uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.risk_override_set(uuid, uuid, uuid, uuid, text, numeric, text) to authenticated;
grant execute on function public.risk_override_revert(uuid, uuid, uuid, uuid, text) to authenticated;
