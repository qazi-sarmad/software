-- 0159 (S4): D11 — the audit-domain axis. Three default universes (Management / Shari'ah / IT),
-- each selectable and configurable, each with its own rule base.
--
-- docs/AUDIT-DOMAINS-MODEL.md is the model. The gap it names: `universes.domain` exists (0003) but NO
-- screen reads or sets it, and no rule pack is keyed to a discipline. This migration is the wiring —
-- it makes the discipline first-class server-side:
--
--   1. `universes.domain` gains a documented closed-but-extensible vocabulary (the three defaults
--      plus org-defined domains). A CHECK is deliberately NOT added: the set is extensible (an org may
--      define a fourth discipline), so the RPC validates membership instead of a table constraint.
--   2. `seed_default_universes(p_org)` — seed the three defaults for one organisation, idempotently.
--      It is an explicit action (the SA-19 button), not an org-insert trigger: an automatic trigger
--      would silently change every existing org-creating test, and the classification (D10) decides
--      which domains are OFFERED, so the org selects and configures (model §5).
--   3. `set_universe_domain(p_universe_id, p_domain)` — set a universe's discipline, validated against
--      the closed set, reason-stamped and ledgered (L3/L5). Never hard-codes exactly three.
--   4. `universe_discipline(p_universe_id)` — read one universe's discipline, org-scoped (L2).
--
-- The rule BASE itself lives in TypeScript (src/lib/systeligon/rules/disciplines.ts) — one source,
-- pure, no drift: the DB stores the universe's discipline and the released pack; the client maps a
-- discipline to its executable rules. This migration never copies a rule's content into SQL.
--
-- Laws honoured: L1 (no model; the discipline is a value, the rules are deterministic), L2 (a read is
-- org-scoped by RLS + jwt_org_id(); the RPCs re-check the right), L3/L5 (a change is ledgered and
-- reason-stamped). M1: every name below is new (grepped migrations and tests). M2: additive only.
-- M6: applied twice and every SQL test runs twice by the harness.

-- ---------------------------------------------------------------------------
-- 1. The vocabulary. Documented on the column; validated by the RPC, not a CHECK (extensible).
-- ---------------------------------------------------------------------------
comment on column universes.domain is
  'The universe''s audit discipline (D11). Closed-but-extensible: management | it | shariah ship as '
  'defaults; an org may define a fourth domain and point it at a rule pack. Validated by '
  'set_universe_domain(); never a table CHECK, because the set is extensible.';

-- ---------------------------------------------------------------------------
-- 2. seed_default_universes — the three defaults for one organisation, idempotent.
--    Requires the platform admin OR an org admin of that org (edit_config on their own org).
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_universes(p_org uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_defaults text[][] := array[
    array['Management Audit', 'management'],
    array['Shari''ah Audit', 'shariah'],
    array['IT Audit', 'it']
  ];
  v_added int := 0;
  v_name text;
  v_domain text;
  v_id uuid;
  i int;
begin
  if p_org is null or not exists (select 1 from orgs where id = p_org) then
    raise exception 'unknown organisation' using errcode = 'P0001';
  end if;
  -- The platform admin may seed any org; an org member needs edit_config on their OWN org.
  if not (public.is_platform_admin() or (public.jwt_org_id() = p_org and public.caller_has_right('edit_config'))) then
    raise exception 'not allowed: seeding the default universes needs the platform admin or edit_config on the organisation'
      using errcode = 'P0001';
  end if;

  for i in 1 .. array_length(v_defaults, 1) loop
    v_name := v_defaults[i][1];
    v_domain := v_defaults[i][2];
    -- Idempotent by discipline: a domain already present for this org is left alone, so a re-run adds
    -- nothing and an org that renamed a universe does not get a duplicate.
    if not exists (select 1 from universes u where u.org_id = p_org and u.domain = v_domain) then
      insert into universes (org_id, name, domain) values (p_org, v_name, v_domain) returning id into v_id;
      v_added := v_added + 1;
      insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
      values (p_org, auth.uid(), 'universe_created', 'universe', v_id,
              jsonb_build_object('name', v_name, 'domain', v_domain, 'seeded', true));
    end if;
  end loop;

  if v_added > 0 then
    perform public.append_ledger_entry(p_org, 'config_changed',
      jsonb_build_object('action', 'seed_default_universes', 'added', v_added), auth.uid());
  end if;

  return jsonb_build_object(
    'ok', true, 'added', v_added,
    'universes', (select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'domain', u.domain) order by u.name)
                  from universes u where u.org_id = p_org));
end $$;

comment on function public.seed_default_universes(uuid) is
  'D11: seed the three default universes (Management / Shari''ah / IT) for one organisation, '
  'idempotently by discipline. Platform admin, or edit_config on that org.';

-- ---------------------------------------------------------------------------
-- 3. set_universe_domain — set a universe''s discipline. Validated, reason-stamped, ledgered.
--    An unknown or blank discipline is REFUSED (the honest path); the three defaults are a seed, not a
--    constraint, so an org-defined fourth domain is accepted when it is a non-empty slug.
-- ---------------------------------------------------------------------------
create or replace function public.set_universe_domain(
  p_universe_id uuid,
  p_domain text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_domain text := lower(btrim(coalesce(p_domain, '')));
  v_universe public.universes;
begin
  if not coalesce(public.caller_has_right('edit_config'), false) then
    return jsonb_build_object('ok', false, 'reason', 'edit_config is required to set a universe discipline');
  end if;
  if v_domain = '' then
    return jsonb_build_object('ok', false, 'reason', 'a discipline is required');
  end if;
  -- A discipline slug: letters, digits, hyphen, underscore. Rejects free text while staying extensible.
  if v_domain !~ '^[a-z][a-z0-9_-]{1,39}$' then
    return jsonb_build_object('ok', false, 'reason', 'a discipline must be a slug of letters, digits, hyphen or underscore');
  end if;

  select * into v_universe from universes where id = p_universe_id and org_id = v_org;
  if v_universe.id is null then
    return jsonb_build_object('ok', false, 'reason', 'that universe does not exist in your organisation');
  end if;
  if v_universe.domain = v_domain then
    return jsonb_build_object('ok', true, 'id', v_universe.id, 'domain', v_domain, 'changed', false);
  end if;

  update universes set domain = v_domain where id = v_universe.id;

  perform public.append_ledger_entry(v_org, 'config_changed',
    jsonb_build_object('universe_id', v_universe.id::text, 'from', v_universe.domain, 'to', v_domain,
                       'reason', nullif(btrim(coalesce(p_reason, '')), '')), auth.uid());

  return jsonb_build_object('ok', true, 'id', v_universe.id, 'domain', v_domain, 'changed', true);
end $$;

comment on function public.set_universe_domain(uuid, text, text) is
  'D11: set a universe''s audit discipline (validated slug; reason-stamped and ledgered). Requires '
  'edit_config. Refuses an unknown universe and a blank/invalid discipline.';

-- ---------------------------------------------------------------------------
-- 4. universe_discipline — read one universe''s discipline. Org-scoped (L2).
-- ---------------------------------------------------------------------------
create or replace function public.universe_discipline(p_universe_id uuid)
returns text
language sql security definer set search_path = public stable as $$
  select u.domain from universes u
  where u.id = p_universe_id and u.org_id = public.jwt_org_id();
$$;

comment on function public.universe_discipline(uuid) is
  'D11: the audit discipline of one universe in the caller''s organisation, or null. Org-scoped read.';

-- ---------------------------------------------------------------------------
-- 5. Grants. Application RPCs to authenticated only; each re-checks the right inside.
-- ---------------------------------------------------------------------------
revoke execute on function public.seed_default_universes(uuid) from public, anon;
grant execute on function public.seed_default_universes(uuid) to authenticated;
revoke execute on function public.set_universe_domain(uuid, text, text) from public, anon;
grant execute on function public.set_universe_domain(uuid, text, text) to authenticated;
revoke execute on function public.universe_discipline(uuid) from public, anon;
grant execute on function public.universe_discipline(uuid) to authenticated;
