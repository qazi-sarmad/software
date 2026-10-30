-- 0191 (D16): standards distribution — the Super Admin rolls a signed standards update out to the
-- tenants that pay for it.
--
-- Spec: docs/STANDARDS-DISTRIBUTION.md (owner instruction 2026-10-30). Every rule base the product
-- ships — the forensic core, the ICFR/SOX controls, the AAOIFI Shari'ah Standards, the SBP
-- Compendium overlay, the SGF governance rules, the PwC risk taxonomy — becomes a versioned, signed,
-- distributable **standards pack**. The platform publishes a pack version; the Super Admin rolls it
-- out; a tenant only receives the versions it is entitled to, and a sealed report keeps the version it
-- sealed against.
--
-- The gap this closes (verified in the spec §1): a pack could be signed and released *for the
-- releasing org*, and a feature could be switched per tenant, but there was no path that takes a new
-- standards update and rolls it out through the Super Admin to the tenants that pay for it.
--
-- Laws unchanged. L1: no model, no free text — a rollout is a signature check and a set of rows.
-- L2: the catalogue carries platform metadata only; a tenant reads its own subscriptions through
-- jwt_org_id() and never another org's. L3: config-as-ledger — every rollout appends an append-only
-- subscription row and a platform-trail row. L5: the catalogue is append-only; a new edition is a new
-- (pack_id, version), never an edit.
--
-- M1: grepped migrations and tests for every name below; all are new. Reuse (grep first):
--     feature_catalogue / tenant_entitlements / has_feature (0051/0052/0084/0086) for the paying
--     gate; require_platform_admin + platform_log (0031) for the platform action; append_ledger_entry
--     (0073) for the tenant ledger; orgs (0003). Nothing is redefined.
-- M2: create table if not exists / create or replace; no seed. M6: applied twice by the harness.

-- ---------------------------------------------------------------------------
-- 1. The platform standards catalogue. Append-only: (pack_id, version) is the identity and a shipped
--    version is immutable. The signature is produced client-side (signPack, src/lib/systeligon/ota.ts)
--    over the canonical content hash; the server re-checks the hash shape and the signature shape and
--    records the pack, exactly as rule_packs (0117/0128) does for a per-org pack.
-- ---------------------------------------------------------------------------
create table if not exists standards_packs (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null,
  version int not null check (version > 0),
  title text not null,
  discipline text not null,
  /** The document + edition each rule cites (spec §2): [{doc, edition, standard}]. */
  sources jsonb not null default '[]'::jsonb,
  /** The scopes this pack covers (spec §5): a subset of the rule target vocabulary. */
  scopes text[] not null default '{}',
  /** The rules as data: [{id, version, kind, params, severity, status}]. The engine reads this. */
  rules jsonb not null default '[]'::jsonb,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  signature text not null check (signature ~ '^[0-9a-f]{128}$'),
  /** The registered platform key that signed this pack (signing_keys, scope = 'super_admin'). */
  key_id text not null,
  released_at timestamptz not null,
  released_by uuid,
  created_at timestamptz not null default now(),
  unique (pack_id, version)
);
alter table standards_packs enable row level security;

-- Read: the catalogue is platform metadata (no tenant data, L2), so any signed-in caller may read it,
-- like feature_catalogue. There is no direct write policy: publishing goes through the RPC, which
-- re-checks the platform role and the signature.
drop policy if exists standards_packs_select on standards_packs;
create policy standards_packs_select on standards_packs for select to authenticated
  using (auth.uid() is not null);

-- Append-only: a shipped (pack_id, version) is never edited; a change is a new version (L5).
create or replace function public.standards_pack_append_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'standards_packs is append-only: pack % version % is immutable; publish a new version',
    old.pack_id, old.version;
end $$;

drop trigger if exists standards_packs_no_change on standards_packs;
create trigger standards_packs_no_change before update or delete on standards_packs
  for each row execute function public.standards_pack_append_only();

-- ---------------------------------------------------------------------------
-- 2. Per-tenant subscriptions. Append-only: moving to a new version appends a row. `pinned` freezes a
--    tenant on a version (a bank under audit stays mid-engagement, spec §3.3).
-- ---------------------------------------------------------------------------
create table if not exists org_standards_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  pack_id text not null,
  subscribed_version int not null check (subscribed_version > 0),
  /** True when the tenant chose to stay on this version rather than follow the latest. */
  pinned boolean not null default false,
  reason text,
  applied_at timestamptz not null default now(),
  applied_by uuid
);
alter table org_standards_subscriptions enable row level security;

drop policy if exists org_standards_subscriptions_select on org_standards_subscriptions;
create policy org_standards_subscriptions_select on org_standards_subscriptions for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. The rollout ledger. One row per (rollout, tenant) with the outcome, so a skipped tenant is
--    visible and never silent (spec §3.4, honest states).
-- ---------------------------------------------------------------------------
create table if not exists standards_rollout_log (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null,
  version int not null,
  org_id uuid not null references orgs(id) on delete cascade,
  /** applied | skipped-not-entitled | skipped-pinned */
  outcome text not null check (outcome in ('applied','skipped-not-entitled','skipped-pinned')),
  detail text,
  rolled_out_at timestamptz not null default now(),
  rolled_out_by uuid
);
alter table standards_rollout_log enable row level security;

drop policy if exists standards_rollout_log_select on standards_rollout_log;
create policy standards_rollout_log_select on standards_rollout_log for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 4. standards_pack_publish — the platform registers a signed standards pack version. The client has
--    already produced the content hash and the signature; the server re-checks the shapes and that
--    the signing key belongs to the platform. A refusal is RETURNED as {ok:false, reason}, never
--    raised, so the caller stops without a partial write (the honest-failure rule).
-- ---------------------------------------------------------------------------
create or replace function public.standards_pack_publish(
  p_pack_id text, p_version int, p_title text, p_discipline text,
  p_sources jsonb, p_scopes text[], p_rules jsonb,
  p_content_hash text, p_key_id text, p_signature text, p_released_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key public.signing_keys;
begin
  if not public.is_platform_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_platform_admin');
  end if;
  if p_pack_id is null or btrim(p_pack_id) = '' or p_version is null or p_version < 1 then
    return jsonb_build_object('ok', false, 'reason', 'a pack id and a positive version are required');
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'content_hash_malformed');
  end if;
  if p_signature is null or p_signature !~ '^[0-9a-f]{128}$' then
    return jsonb_build_object('ok', false, 'reason', 'signature_malformed');
  end if;
  -- The signing key must be the platform's live key. A tenant key cannot sign a standards update.
  select * into v_key from signing_keys k
   where k.key_id = p_key_id and k.scope = 'platform' and k.retired_at is null limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_platform_key',
      'detail', 'the pack must be signed with a registered platform key');
  end if;
  if exists (select 1 from standards_packs p where p.pack_id = p_pack_id and p.version = p_version) then
    return jsonb_build_object('ok', false, 'reason', 'version_exists',
      'detail', 'a shipped version is immutable; publish a higher version');
  end if;

  insert into standards_packs (pack_id, version, title, discipline, sources, scopes, rules,
    content_hash, signature, key_id, released_at, released_by)
  values (p_pack_id, p_version, p_title, p_discipline, coalesce(p_sources, '[]'::jsonb),
    coalesce(p_scopes, '{}'), coalesce(p_rules, '[]'::jsonb), p_content_hash, p_signature,
    p_key_id, p_released_at, auth.uid());

  -- The pack is a distributable feature: the paying gate (spec §3.2). A pack that already exists as
  -- a feature keeps its price class; a new pack is an add-on by default.
  insert into feature_catalogue (key, label, description, group_name, price_class, default_on, status)
  values (p_pack_id, p_title, 'Signed standards pack ' || p_pack_id, 'Standards', 'add_on', false, 'live')
  on conflict (key) do nothing;

  perform public.platform_log('standards_pack_published', null, 'standards_pack', null,
    jsonb_build_object('pack_id', p_pack_id, 'version', p_version, 'discipline', p_discipline));
  return jsonb_build_object('ok', true, 'pack_id', p_pack_id, 'version', p_version);
end $$;

-- ---------------------------------------------------------------------------
-- 5. standards_rollout — the Super Admin rolls a pack version out to a set of tenants. For each
--    tenant: not entitled -> skipped and recorded (never applied); pinned on another version ->
--    skipped-pinned; otherwise the subscription is appended and the effective version moves.
--    Returns the per-tenant outcome so the surface can show it, never a green tick that is not true.
-- ---------------------------------------------------------------------------
create or replace function public.standards_rollout(
  p_pack_id text, p_version int, p_org_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pack public.standards_packs;
  v_org uuid;
  v_cur public.org_standards_subscriptions;
  v_outcome text;
  v_results jsonb := '[]'::jsonb;
  v_applied int := 0;
begin
  if not public.is_platform_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_platform_admin');
  end if;
  select * into v_pack from standards_packs p
   where p.pack_id = p_pack_id and p.version = p_version;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_pack');
  end if;

  foreach v_org in array coalesce(p_org_ids, '{}'::uuid[]) loop
    -- The paying gate (spec §3.2). The pack key is the tenant's entitlement key, so the check is the
    -- internal entitlement question (0084 §3 / 0094): this is a platform RPC asking about another
    -- org, and `has_feature` is the request-scoped wrapper around exactly this function.
    if not public.feature_enabled_internal(v_org, p_pack_id) then
      v_outcome := 'skipped-not-entitled';
    else
      select * into v_cur from org_standards_subscriptions s
       where s.org_id = v_org and s.pack_id = p_pack_id
       order by s.applied_at desc, s.id desc limit 1;
      if found and v_cur.pinned and v_cur.subscribed_version <> p_version then
        v_outcome := 'skipped-pinned';
      else
        v_outcome := 'applied';
        insert into org_standards_subscriptions (org_id, pack_id, subscribed_version, pinned, reason, applied_by)
        values (v_org, p_pack_id, p_version, false, 'rolled out by the platform', auth.uid());
        v_applied := v_applied + 1;
        perform public.append_ledger_entry(v_org, 'standards_pack_applied',
          jsonb_build_object('pack_id', p_pack_id, 'version', p_version), auth.uid());
      end if;
    end if;
    insert into standards_rollout_log (pack_id, version, org_id, outcome, rolled_out_by)
    values (p_pack_id, p_version, v_org, v_outcome, auth.uid());
    v_results := v_results || jsonb_build_object('org_id', v_org, 'outcome', v_outcome);
  end loop;

  perform public.platform_log('standards_pack_rolled_out', null, 'standards_pack', null,
    jsonb_build_object('pack_id', p_pack_id, 'version', p_version, 'applied', v_applied));
  return jsonb_build_object('ok', true, 'pack_id', p_pack_id, 'version', p_version,
    'applied', v_applied, 'results', v_results);
end $$;


-- ---------------------------------------------------------------------------
-- 6a. platform_signing_key_register — the platform registers its public signing key, so a standards
--     pack can be signed with a key the server recognises as the platform's. Only the public half is
--     sent (the private key never leaves the browser, the 0128 precedent); scope = 'platform'.
-- ---------------------------------------------------------------------------
create or replace function public.platform_signing_key_register(p_key_id text, p_public_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
begin
  if not public.is_platform_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_platform_admin');
  end if;
  if p_key_id is null or btrim(p_key_id) = '' then
    return jsonb_build_object('ok', false, 'reason', 'a key id is required');
  end if;
  if p_public_key is null or btrim(p_public_key) = '' then
    return jsonb_build_object('ok', false, 'reason', 'a public key is required');
  end if;
  -- Retire the current live platform key so the one-live-key-per-scope index holds.
  select id into v_existing from signing_keys
    where scope = 'platform' and retired_at is null limit 1;
  if v_existing is not null then
    update signing_keys set retired_at = now(),
      retired_reason = 'superseded by a platform key registered from the client'
      where id = v_existing;
  end if;
  insert into signing_keys (org_id, scope, key_id, algorithm, public_key, created_by)
  values (null, 'platform', p_key_id, 'Ed25519', p_public_key, auth.uid());
  perform public.platform_log('platform_signing_key_registered', null, 'signing_key', null,
    jsonb_build_object('key_id', p_key_id, 'superseded', v_existing is not null));
  return jsonb_build_object('ok', true, 'key_id', p_key_id);
end $$;


-- ---------------------------------------------------------------------------
-- 6. standards_pin — a tenant freezes on the version it currently runs, with a reason (spec §3.3).
-- ---------------------------------------------------------------------------
create or replace function public.standards_pin(p_pack_id text, p_version int, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'not signed in');
  end if;
  if not (public.caller_has_right('edit_config') or public.caller_head_level() >= 1) then
    return jsonb_build_object('ok', false, 'reason', 'edit_config or a Head is required to pin a standards version');
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'reason', 'a reason is required to pin a standards version');
  end if;
  if not exists (select 1 from standards_packs p where p.pack_id = p_pack_id and p.version = p_version) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_pack');
  end if;
  insert into org_standards_subscriptions (org_id, pack_id, subscribed_version, pinned, reason, applied_by)
  values (v_org, p_pack_id, p_version, true, p_reason, auth.uid());
  perform public.append_ledger_entry(v_org, 'standards_pack_pinned',
    jsonb_build_object('pack_id', p_pack_id, 'version', p_version, 'reason', p_reason), auth.uid());
  return jsonb_build_object('ok', true, 'pack_id', p_pack_id, 'version', p_version, 'pinned', true);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Reads. The catalogue for the platform surface, the tenant's own subscriptions for the tenant
--    surface (the version it is on, pinned or following, and the history).
-- ---------------------------------------------------------------------------
create or replace function public.standards_catalogue_list()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'pack_id', p.pack_id, 'version', p.version, 'title', p.title, 'discipline', p.discipline,
    'sources', p.sources, 'scopes', to_jsonb(p.scopes), 'content_hash', p.content_hash,
    'key_id', p.key_id, 'released_at', p.released_at
  ) order by p.pack_id, p.version desc), '[]'::jsonb)
  from standards_packs p;
$$;

create or replace function public.standards_subscriptions_get()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'pack_id', s.pack_id, 'version', s.subscribed_version, 'pinned', s.pinned,
    'reason', s.reason, 'applied_at', s.applied_at,
    'title', p.title, 'discipline', p.discipline
  ) order by s.pack_id), '[]'::jsonb)
  from (
    select distinct on (pack_id) *
    from org_standards_subscriptions
    where org_id = public.jwt_org_id()
    order by pack_id, applied_at desc, id desc
  ) s
  left join standards_packs p on p.pack_id = s.pack_id and p.version = s.subscribed_version;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants. Reads and writes through the RPCs; nothing direct. The platform RPCs are granted to
--    authenticated and re-check the platform role inside (the 0052 precedent).
-- ---------------------------------------------------------------------------
grant execute on function public.standards_pack_publish(text, int, text, text, jsonb, text[], jsonb, text, text, text, timestamptz) to authenticated;
grant execute on function public.standards_rollout(text, int, uuid[]) to authenticated;
grant execute on function public.standards_pin(text, int, text) to authenticated;
grant execute on function public.standards_catalogue_list() to authenticated;
grant execute on function public.standards_subscriptions_get() to authenticated;
grant execute on function public.platform_signing_key_register(text, text) to authenticated;
