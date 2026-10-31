-- 0160 (S4): D12 — the readiness signal set. A deterministic verdict (green / amber / red) with a
-- reason in words, a "Fix this" deep-link and a seeded remediation, for both the platform and an org.
--
-- docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md D12 is the specification. `platform_provisioning_status`
-- (0097) returned a handful of counts and booleans; this migration turns that into a full signal set
-- that a non-technical administrator can read at a glance, and — the owner's second instruction — that
-- ACTS: every non-green signal carries the fix.
--
-- What this adds:
--   1. readiness_signals — the seeded catalogue: one row per signal, its layer, its severity when it
--      fails, the plain-English remediation and the screen that resolves it (the "Fix this" target).
--   2. platform_readiness_signals(p_org) — the platform view (require_platform_admin), every signal
--      with its verdict and reason. Counts and booleans only cross to the platform role (L2).
--   3. org_readiness_signals() — the same verdicts for the caller's own organisation (jwt_org_id()),
--      org-level signals only; the environment signals are not readable by a tenant (L2).
--   4. run_readiness_diagnostic / org_run_readiness_diagnostic — one signal in isolation, its
--      evidence and its remediation recorded; a diagnostic NEVER mutates the thing it inspects.
--
-- The honest rule (A-U2, the R3 config-honesty rule applied to readiness): a check that cannot be
-- evaluated is AMBER with "not evaluated" named — never green by default. Nothing here is a wall of
-- green, and no signal is green on a value the database cannot actually read.
--
-- Laws honoured: L1 (deterministic; no model, no learned threshold — every verdict is a comparison),
-- L2 (RLS + jwt_org_id() is the read path; the platform view is platform-only and returns no tenant
-- row), L3/L5 (the catalogue is seeded config; a diagnostic is append-only evidence). M1: every name
-- below is new. M2: additive only. M6: applied twice and every SQL test runs twice by the harness.

-- ---------------------------------------------------------------------------
-- 1. The catalogue. One row per signal: what it is, where it lives, how serious a failure is, how to
--    fix it and which screen resolves it. Seeded, never a CHECK on the live path (extensible).
-- ---------------------------------------------------------------------------
create table if not exists readiness_signals (
  id text primary key,
  label text not null,
  layer text not null check (layer in ('platform', 'environment', 'organisation')),
  severity text not null check (severity in ('critical', 'warning')),
  remediation text not null,
  fix_target text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table readiness_signals is
  'D12: the readiness-signal catalogue. Seeded config: label, layer, severity, remediation, fix target.';

-- Read: the catalogue is platform metadata (no tenant data, L2), so any signed-in caller may read it,
-- like feature_catalogue. There is no direct write policy: the seed owns the rows and the migration
-- re-applies it in place.
alter table readiness_signals enable row level security;
drop policy if exists readiness_signals_select on readiness_signals;
create policy readiness_signals_select on readiness_signals for select to authenticated
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 2. The seed. Idempotent: a re-apply updates the wording in place, so a fix to a remediation string
--    ships without a delete. The environment rows are honest by construction — a check with no
--    readable source is worded as "not evaluated", never as a pass.
-- ---------------------------------------------------------------------------
insert into readiness_signals (id, label, layer, severity, remediation, fix_target, sort_order) values
  ('platform_sender', 'Platform email sender', 'platform', 'critical',
   'Configure a default platform email sender with a verified from-address.',
   'sa-email', 10),
  ('signing_key', 'Signing key registered', 'platform', 'critical',
   'Generate a signing key in the browser and register its public half.',
   'sa-integrity', 20),
  ('classification', 'Client classification set', 'organisation', 'critical',
   'Set the organisation classification on the onboarding picker.',
   'sa-domains', 30),
  ('roles_seeded', 'Role catalogue seeded', 'organisation', 'critical',
   'Run the guided provisioning repair step to seed the seven roles.',
   'sa-provisioning', 40),
  ('tenant_status', 'Organisation active', 'organisation', 'critical',
   'Activate the organisation; a suspended organisation cannot create an engagement.',
   'sa-provisioning', 50),
  ('first_invite', 'First administrator invited', 'organisation', 'warning',
   'Invite the initial administrator and have them accept the invitation.',
   'sa-provisioning', 60),
  ('engagement_creatable', 'Engagement creatable', 'organisation', 'critical',
   'Resolve the signals above; an engagement needs the roles and an active organisation.',
   'sa-provisioning', 70),
  ('storage_buckets', 'Evidence storage buckets', 'environment', 'critical',
   'Create the four private buckets and their org-scoped policies.',
   'runbook', 80),
  ('edge_functions', 'Edge Functions deployed', 'environment', 'warning',
   'Deploy the Edge Functions from the deployment runbook, then re-check.',
   'runbook', 90),
  ('migrations_applied', 'Migrations applied', 'environment', 'critical',
   'Apply the migrations with supabase db push against the target project.',
   'sa-migration', 100),
  ('build_env', 'App build environment', 'environment', 'critical',
   'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY at build time.',
   'runbook', 110)
on conflict (id) do update set
  label = excluded.label, layer = excluded.layer, severity = excluded.severity,
  remediation = excluded.remediation, fix_target = excluded.fix_target, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 3. The catalogue reader. Stable, deterministic, no clock, no client (L4 in spirit).
-- ---------------------------------------------------------------------------
create or replace function public.readiness_signal_catalogue()
returns table (id text, label text, layer text, severity text, remediation text, fix_target text, sort_order int)
language sql stable security definer set search_path = public as $$
  select s.id, s.label, s.layer, s.severity, s.remediation, s.fix_target, s.sort_order
    from readiness_signals s order by s.sort_order, s.id;
$$;

comment on function public.readiness_signal_catalogue() is
  'D12: the seeded readiness-signal catalogue, in display order.';

-- ---------------------------------------------------------------------------
-- 4. The verdict vocabulary. One place builds a signal's jsonb so every signal has the same shape.
--    `p_ok` null means "not evaluated": AMBER with the reason named, never green (the honest rule).
-- ---------------------------------------------------------------------------
create or replace function public.readiness_verdict(p_ok boolean, p_reason text, p_not_evaluated boolean default false)
returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'verdict', case when p_not_evaluated then 'amber' when p_ok is null then 'amber'
                    when p_ok then 'green' else 'red' end,
    'reason', coalesce(p_reason, '')
  );
$$;

comment on function public.readiness_verdict(boolean, text, boolean) is
  'D12: green/red from a boolean, amber when a check is not evaluated. Null is never green.';

-- ---------------------------------------------------------------------------
-- 5. The platform view. Every signal for one organisation, with its verdict, reason, remediation and
--    fix target. Platform administrators only; the environment signals are evaluated here because
--    only the platform role may read them (L2).
-- ---------------------------------------------------------------------------
create or replace function public.platform_readiness_signals(p_org uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_roles int;
  v_status text;
  v_invites int;
  v_sender boolean;
  v_key boolean;
  v_classified boolean;
  v_buckets_ok boolean := false;
  v_buckets_readable boolean;
  v_bucket_count int;
  v_expected text[] := array['evidence', 'reports', 'archives', 'org-branding'];
  v_signals jsonb := '[]'::jsonb;
  v_green int := 0;
  v_amber int := 0;
  v_red int := 0;
  v_row record;
  v_v jsonb;
  v_verdict text;
begin
  perform public.require_platform_admin();
  if p_org is null or not exists (select 1 from orgs where id = p_org) then
    raise exception 'unknown organisation' using errcode = 'P0001';
  end if;

  select count(*) into v_roles from roles r where r.org_id = p_org;
  select ts.status into v_status from tenant_settings ts where ts.org_id = p_org;
  select count(*) into v_invites from invite_cap_events e where e.org_id = p_org;
  select exists (select 1 from email_sender_profiles p where p.scope = 'platform' and p.enabled and p.is_default)
    into v_sender;
  select exists (select 1 from signing_keys k where k.scope = 'platform' and k.retired_at is null)
    into v_key;
  select exists (select 1 from org_classification c where c.org_id = p_org) into v_classified;

  -- The storage buckets. When the storage schema is absent the check is not evaluated (amber), and
  -- when it is present a bucket that is missing or public is a real red. The relation is read
  -- dynamically so a database without the storage schema still applies and still answers honestly.
  v_buckets_readable := to_regclass('storage.buckets') is not null;
  if v_buckets_readable then
    execute 'select count(*) from storage.buckets b where b.id = any($1) and b.public = false'
      into v_bucket_count using v_expected;
    v_buckets_ok := v_bucket_count = array_length(v_expected, 1);
  end if;

  for v_row in select * from public.readiness_signal_catalogue() loop
    v_v := case v_row.id
      when 'platform_sender' then public.readiness_verdict(v_sender,
        case when v_sender then 'a default platform sender is enabled' else 'no default platform sender is enabled' end)
      when 'signing_key' then public.readiness_verdict(v_key,
        case when v_key then 'a platform signing key is registered' else 'no platform signing key is registered' end)
      when 'classification' then public.readiness_verdict(v_classified,
        case when v_classified then 'the organisation has a classification' else 'no classification is set' end)
      when 'roles_seeded' then public.readiness_verdict(v_roles >= 7,
        v_roles::text || ' of 7 roles seeded')
      when 'tenant_status' then public.readiness_verdict(coalesce(v_status, 'active') = 'active',
        'organisation status is ' || coalesce(v_status, 'active'))
      when 'first_invite' then public.readiness_verdict(v_invites > 0,
        case when v_invites > 0 then v_invites::text || ' invitation(s) sent' else 'no invitation has been sent' end)
      when 'engagement_creatable' then public.readiness_verdict(
        (v_roles >= 7 and coalesce(v_status, 'active') = 'active'),
        case when v_roles >= 7 and coalesce(v_status, 'active') = 'active'
             then 'an engagement can be created' else 'roles or organisation status block engagement creation' end)
      when 'storage_buckets' then public.readiness_verdict(v_buckets_ok,
        case when not v_buckets_readable then 'not evaluated: the storage schema is not present'
             when v_buckets_ok then 'all four private buckets are present'
             else 'one or more of the four private buckets is missing or public' end,
        not v_buckets_readable)
      when 'edge_functions' then public.readiness_verdict(null,
        'not evaluated: the deployment list is not readable from the database', true)
      when 'migrations_applied' then public.readiness_verdict(null,
        'not evaluated: apply and confirm with supabase db push', true)
      when 'build_env' then public.readiness_verdict(null,
        'not evaluated: verify at the host', true)
      else public.readiness_verdict(null, 'not evaluated: no check is wired for this signal', true)
    end;
    v_verdict := v_v ->> 'verdict';
    if v_verdict = 'green' then v_green := v_green + 1;
    elsif v_verdict = 'red' then v_red := v_red + 1;
    else v_amber := v_amber + 1;
    end if;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'signal_id', v_row.id, 'label', v_row.label, 'layer', v_row.layer, 'severity', v_row.severity,
      'verdict', v_verdict, 'reason', v_v ->> 'reason',
      'remediation', v_row.remediation, 'fix_target', v_row.fix_target));
  end loop;

  return jsonb_build_object(
    'org_id', p_org, 'scope', 'platform', 'signals', v_signals,
    'summary', jsonb_build_object('green', v_green, 'amber', v_amber, 'red', v_red));
end $$;

comment on function public.platform_readiness_signals(uuid) is
  'D12: the full readiness signal set for one organisation. Platform administrators only; counts and booleans only (L2).';

-- ---------------------------------------------------------------------------
-- 6. The org view. The organisation-level signals only, for the caller's own org. The environment
--    signals are not readable by a tenant and are omitted rather than faked (L2, the honest rule).
-- ---------------------------------------------------------------------------
create or replace function public.org_readiness_signals()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_roles int;
  v_status text;
  v_invites int;
  v_key boolean;
  v_classified boolean;
  v_signals jsonb := '[]'::jsonb;
  v_green int := 0;
  v_amber int := 0;
  v_red int := 0;
  v_row record;
  v_v jsonb;
  v_verdict text;
begin
  if v_org is null then
    raise exception 'no organisation in session' using errcode = 'P0001';
  end if;

  select count(*) into v_roles from roles r where r.org_id = v_org;
  select ts.status into v_status from tenant_settings ts where ts.org_id = v_org;
  select count(*) into v_invites from invite_cap_events e where e.org_id = v_org;
  select exists (select 1 from signing_keys k where k.org_id = v_org and k.retired_at is null) into v_key;
  select exists (select 1 from org_classification c where c.org_id = v_org) into v_classified;

  for v_row in select * from public.readiness_signal_catalogue() where layer = 'organisation' loop
    v_v := case v_row.id
      when 'classification' then public.readiness_verdict(v_classified,
        case when v_classified then 'the organisation has a classification' else 'no classification is set' end)
      when 'roles_seeded' then public.readiness_verdict(v_roles >= 7, v_roles::text || ' of 7 roles seeded')
      when 'tenant_status' then public.readiness_verdict(coalesce(v_status, 'active') = 'active',
        'organisation status is ' || coalesce(v_status, 'active'))
      when 'first_invite' then public.readiness_verdict(v_invites > 0,
        case when v_invites > 0 then v_invites::text || ' invitation(s) sent' else 'no invitation has been sent' end)
      when 'engagement_creatable' then public.readiness_verdict(
        (v_roles >= 7 and coalesce(v_status, 'active') = 'active'),
        case when v_roles >= 7 and coalesce(v_status, 'active') = 'active'
             then 'an engagement can be created' else 'roles or organisation status block engagement creation' end)
      else public.readiness_verdict(null, 'not evaluated', true)
    end;
    v_verdict := v_v ->> 'verdict';
    if v_verdict = 'green' then v_green := v_green + 1;
    elsif v_verdict = 'red' then v_red := v_red + 1;
    else v_amber := v_amber + 1;
    end if;
    v_signals := v_signals || jsonb_build_array(jsonb_build_object(
      'signal_id', v_row.id, 'label', v_row.label, 'layer', v_row.layer, 'severity', v_row.severity,
      'verdict', v_verdict, 'reason', v_v ->> 'reason',
      'remediation', v_row.remediation, 'fix_target', v_row.fix_target));
  end loop;

  return jsonb_build_object(
    'org_id', v_org, 'scope', 'organisation', 'signals', v_signals,
    'summary', jsonb_build_object('green', v_green, 'amber', v_amber, 'red', v_red));
end $$;

comment on function public.org_readiness_signals() is
  'D12: the organisation-level readiness signals for the caller''s own org. Environment signals are omitted (L2).';

-- ---------------------------------------------------------------------------
-- 7. The self-diagnostic. One signal, in isolation, with its evidence and its remediation. It reads
--    and records; it never writes to the thing it inspects (a diagnostic that changes state is not a
--    diagnostic). The result is appended to the ledger so a later reviewer sees the history.
-- ---------------------------------------------------------------------------
create or replace function public.run_readiness_diagnostic(p_org uuid, p_signal text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_catalogue readiness_signals%rowtype;
  v_all jsonb;
  v_found jsonb;
begin
  perform public.require_platform_admin();
  if p_org is null or not exists (select 1 from orgs where id = p_org) then
    raise exception 'unknown organisation' using errcode = 'P0001';
  end if;
  select * into v_catalogue from readiness_signals where id = p_signal;
  if not found then
    raise exception 'unknown signal: %', p_signal using errcode = 'P0001';
  end if;

  -- Re-evaluate the whole set (the signals share inputs) and take the one signal in isolation.
  v_all := public.platform_readiness_signals(p_org);
  select s into v_found from jsonb_array_elements(v_all -> 'signals') s where s ->> 'signal_id' = p_signal;
  if v_found is null then
    raise exception 'signal % is not evaluated for this organisation', p_signal using errcode = 'P0001';
  end if;

  perform public.append_ledger_entry(p_org, 'readiness_diagnostic', jsonb_build_object(
    'signal_id', p_signal, 'verdict', v_found ->> 'verdict', 'reason', v_found ->> 'reason',
    'layer', v_catalogue.layer, 'ran_by', auth.uid()::text), auth.uid());

  return jsonb_build_object(
    'signal_id', p_signal, 'label', v_catalogue.label, 'layer', v_catalogue.layer,
    'verdict', v_found ->> 'verdict', 'reason', v_found ->> 'reason',
    'evidence', v_found ->> 'reason',
    'remediation', v_catalogue.remediation, 'fix_target', v_catalogue.fix_target,
    'recorded', true);
end $$;

comment on function public.run_readiness_diagnostic(uuid, text) is
  'D12: re-run one signal in isolation and record the result. Platform administrators only; mutates no inspected state.';

create or replace function public.org_run_readiness_diagnostic(p_signal text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_catalogue readiness_signals%rowtype;
  v_all jsonb;
  v_found jsonb;
begin
  if v_org is null then
    raise exception 'no organisation in session' using errcode = 'P0001';
  end if;
  if not public.caller_has_right('edit_config') then
    raise exception 'not allowed: the edit_config right is required' using errcode = 'P0001';
  end if;
  select * into v_catalogue from readiness_signals where id = p_signal and layer = 'organisation';
  if not found then
    raise exception 'unknown organisation signal: %', p_signal using errcode = 'P0001';
  end if;

  v_all := public.org_readiness_signals();
  select s into v_found from jsonb_array_elements(v_all -> 'signals') s where s ->> 'signal_id' = p_signal;
  if v_found is null then
    raise exception 'signal % is not evaluated for this organisation', p_signal using errcode = 'P0001';
  end if;

  perform public.append_ledger_entry(v_org, 'readiness_diagnostic', jsonb_build_object(
    'signal_id', p_signal, 'verdict', v_found ->> 'verdict', 'reason', v_found ->> 'reason',
    'layer', v_catalogue.layer, 'ran_by', auth.uid()::text), auth.uid());

  return jsonb_build_object(
    'signal_id', p_signal, 'label', v_catalogue.label, 'layer', v_catalogue.layer,
    'verdict', v_found ->> 'verdict', 'reason', v_found ->> 'reason',
    'evidence', v_found ->> 'reason',
    'remediation', v_catalogue.remediation, 'fix_target', v_catalogue.fix_target,
    'recorded', true);
end $$;

comment on function public.org_run_readiness_diagnostic(text) is
  'D12: re-run one organisation signal in isolation for the caller''s org and record the result.';

-- ---------------------------------------------------------------------------
-- 8. Grants. Application RPCs to authenticated only; each re-checks the right inside.
-- ---------------------------------------------------------------------------
revoke execute on function public.readiness_signal_catalogue() from public, anon;
grant execute on function public.readiness_signal_catalogue() to authenticated;
revoke execute on function public.readiness_verdict(boolean, text, boolean) from public, anon;
grant execute on function public.readiness_verdict(boolean, text, boolean) to authenticated;
revoke execute on function public.platform_readiness_signals(uuid) from public, anon;
grant execute on function public.platform_readiness_signals(uuid) to authenticated;
revoke execute on function public.org_readiness_signals() from public, anon;
grant execute on function public.org_readiness_signals() to authenticated;
revoke execute on function public.run_readiness_diagnostic(uuid, text) from public, anon;
grant execute on function public.run_readiness_diagnostic(uuid, text) to authenticated;
revoke execute on function public.org_run_readiness_diagnostic(text) from public, anon;
grant execute on function public.org_run_readiness_diagnostic(text) to authenticated;
