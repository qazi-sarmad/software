-- 0151 (S3): D15 — the dynamic risk assessment's persisted inputs: the ERM theme map, the KRIs, and
-- the trigger-based plan-change proposals.
--
-- Sources: docs/RISK-ASSESSMENT-MODEL.md §8 (the five PwC themes), docs/ASSURANCE-RULEBOOKS.md §6.
-- The verdicts, the KRI states and the plan-change rationale are computed by the pure engine
-- (src/lib/risk/dynamicAssessment.ts); this migration stores only the inputs the engine reads.
--
-- Laws: L1 (no model), L2 (RLS + jwt_org_id()), L5 (logged). M1/M2/M6 as usual.

-- The ERM theme map: which auditable entity/topic belongs to which enterprise risk theme, and which
-- themes are top risks. A theme with no row is not mapped; a top risk with no coverage is a gap.
create table if not exists erm_theme_map (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  theme text not null,
  entity_id uuid null references entities(id) on delete set null,
  is_top_risk boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, theme, entity_id)
);
alter table erm_theme_map enable row level security;
drop policy if exists erm_theme_map_select on erm_theme_map;
create policy erm_theme_map_select on erm_theme_map for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists erm_theme_map_pin_org on erm_theme_map;
create trigger erm_theme_map_pin_org before insert on erm_theme_map
  for each row execute function public.pin_org_id();

-- The KRIs a theme carries, with their current value and tolerance. A null value or tolerance is
-- "unknown", never within.
create table if not exists erm_kri (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kri_id text not null,
  theme text not null,
  value numeric null,
  tolerance numeric null,
  updated_at timestamptz not null default now(),
  unique (org_id, kri_id)
);
alter table erm_kri enable row level security;
drop policy if exists erm_kri_select on erm_kri;
create policy erm_kri_select on erm_kri for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists erm_kri_pin_org on erm_kri;
create trigger erm_kri_pin_org before insert on erm_kri
  for each row execute function public.pin_org_id();

-- The plan-change proposals a trigger produces (§8 theme 3).
create table if not exists plan_change_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  trigger_kind text not null check (trigger_kind in ('kri_breach','incident','management_request','strategic_change')),
  entity_id uuid null references entities(id) on delete set null,
  action text not null check (action in ('track','defer','cancel','rescope')),
  rationale text not null,
  status text not null default 'proposed' check (status in ('proposed','accepted','rejected')),
  created_by uuid null,
  created_at timestamptz not null default now()
);
alter table plan_change_proposals enable row level security;
drop policy if exists plan_change_proposals_select on plan_change_proposals;
create policy plan_change_proposals_select on plan_change_proposals for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists plan_change_proposals_pin_org on plan_change_proposals;
create trigger plan_change_proposals_pin_org before insert on plan_change_proposals
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- erm_theme_set: map an auditable entity to an ERM theme, and whether the theme is a top risk.
-- Requires manage_engagements. Reason-stamped.
-- ---------------------------------------------------------------------------
create or replace function public.erm_theme_set(
  p_org uuid, p_theme text, p_entity uuid default null, p_is_top_risk boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.caller_has_right('manage_engagements') then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if p_theme is null or btrim(p_theme) = '' then
    raise exception 'a theme is required' using errcode = 'P0001';
  end if;
  if p_entity is not null and not exists (select 1 from entities e where e.id = p_entity and e.org_id = v_org) then
    raise exception 'entity not found in this organisation' using errcode = 'P0001';
  end if;

  insert into erm_theme_map (org_id, theme, entity_id, is_top_risk)
  values (v_org, btrim(p_theme), p_entity, coalesce(p_is_top_risk, false))
  on conflict (org_id, theme, entity_id) do update set is_top_risk = excluded.is_top_risk;

  perform public.admin_log_change(v_org, 'erm_theme',
    jsonb_build_object('theme', btrim(p_theme), 'entity', p_entity, 'is_top_risk', p_is_top_risk),
    'erm_theme_set', 'config', p_entity);
end $$;

-- ---------------------------------------------------------------------------
-- kri_value_set: record a KRI's value against its tolerance. Requires manage_engagements.
-- ---------------------------------------------------------------------------
create or replace function public.kri_value_set(
  p_org uuid, p_kri_id text, p_theme text, p_value numeric default null, p_tolerance numeric default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.caller_has_right('manage_engagements') then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_kri_id), '') = '' then raise exception 'a KRI id is required' using errcode = 'P0001'; end if;

  insert into erm_kri (org_id, kri_id, theme, value, tolerance, updated_at)
  values (v_org, btrim(p_kri_id), coalesce(nullif(btrim(p_theme), ''), 'cross'), p_value, p_tolerance, now())
  on conflict (org_id, kri_id) do update set
    theme = excluded.theme, value = excluded.value, tolerance = excluded.tolerance, updated_at = now();

  perform public.admin_log_change(v_org, 'erm_kri',
    jsonb_build_object('kri_id', btrim(p_kri_id), 'value', p_value, 'tolerance', p_tolerance),
    'kri_value_set', 'config', null);
end $$;

-- ---------------------------------------------------------------------------
-- plan_change_propose: record a trigger-based plan-change proposal. The rationale is mandatory.
-- ---------------------------------------------------------------------------
create or replace function public.plan_change_propose(
  p_org uuid, p_trigger_kind text, p_entity uuid, p_action text, p_rationale text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
  v_id uuid;
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.caller_has_right('manage_engagements') then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if p_trigger_kind not in ('kri_breach','incident','management_request','strategic_change') then
    raise exception 'unknown trigger kind %', p_trigger_kind using errcode = 'P0001';
  end if;
  if p_action not in ('track','defer','cancel','rescope') then
    raise exception 'unknown plan-change action %', p_action using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_rationale), '') = '' then
    raise exception 'a plan-change proposal requires a rationale' using errcode = 'P0001';
  end if;

  insert into plan_change_proposals (org_id, trigger_kind, entity_id, action, rationale, created_by)
  values (v_org, p_trigger_kind, p_entity, p_action, btrim(p_rationale), auth.uid())
  returning id into v_id;

  perform public.append_ledger_entry(v_org, 'plan_change_proposed',
    jsonb_build_object('trigger', p_trigger_kind, 'action', p_action, 'entity', p_entity, 'proposal_id', v_id),
    auth.uid());
  return v_id;
end $$;

revoke execute on function public.erm_theme_set(uuid, text, uuid, boolean) from public, anon;
revoke execute on function public.kri_value_set(uuid, text, text, numeric, numeric) from public, anon;
revoke execute on function public.plan_change_propose(uuid, text, uuid, text, text) from public, anon;
revoke insert, update, delete on erm_theme_map from public, anon, authenticated;
revoke insert, update, delete on erm_kri from public, anon, authenticated;
revoke insert, update, delete on plan_change_proposals from public, anon, authenticated;

grant execute on function public.erm_theme_set(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.kri_value_set(uuid, text, text, numeric, numeric) to authenticated;
grant execute on function public.plan_change_propose(uuid, text, uuid, text, text) to authenticated;
