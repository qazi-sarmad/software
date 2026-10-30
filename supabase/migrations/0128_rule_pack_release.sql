-- 0128 (L2, S10/S11): the rule-pack management backend the UI needs to be genuinely wired.
--
-- 0117 gave rule packs a save path (rule_pack_save) and a reader (rule_pack_list). Three gaps
-- remained, and each is the reason the pack screen could not be honest:
--
--   1. A pack ships as a draft (`released = false`) and 0117 is append-only, so there was NO way to
--      release one. A pack that can never be released is a pack the engine can never run.
--   2. The refusal log (rule_pack_refusals) had no reader, so a refused save left a trace no human
--      could see. The whole point of §8 is that a refusal is visible.
--   3. A save needs a registered signing key, and nothing in the client could register one. Every
--      test inserted keys directly as the owner; a tenant had no path.
--
-- This migration closes all three, additively. It does NOT weaken the append-only guarantee: a pack's
-- RULES stay immutable forever; only the one-way draft->released flag may be set, once.
--
-- M1: grepped migrations and tests for every name below; all are new or a deliberate replace of a
--     0117 object. M2: every object is create or replace / create table if not exists; the seed is
--     on conflict do nothing. M6: applied twice and all SQL tests run twice by the harness.

-- ---------------------------------------------------------------------------
-- 1. The append-only trigger gains exactly one carve-out: the release flag, false -> true, once.
--    Any other change to a shipped pack still raises. The rules, the signature and the hash are
--    never editable — a behaviour change is a new version, as before.
-- ---------------------------------------------------------------------------
create or replace function public.rule_pack_append_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.id = old.id
     and new.org_id = old.org_id
     and new.name = old.name
     and new.version = old.version
     and new.target = old.target
     and new.rules = old.rules
     and new.content_hash = old.content_hash
     and new.key_id = old.key_id
     and new.signature = old.signature
     and new.signed_at = old.signed_at
     and old.released = false
     and new.released = true
  then
    -- The one permitted transition: a draft pack is released. Nothing else about it changes.
    return new;
  end if;
  raise exception 'rule_packs is append-only: pack % version % is immutable; ship a new version',
    old.name, old.version;
end $$;

-- ---------------------------------------------------------------------------
-- 2. signing_key_register — an org admin registers a public signing key generated in the browser.
--    The private key never leaves the client; only the public key is stored (0096 private_ref stays
--    null for a client-generated key). A live org key already registered is RETIRED first, with a
--    reason, so the one-live-key-per-org index (0096) holds and old signatures keep verifying.
-- ---------------------------------------------------------------------------
create or replace function public.signing_key_register(p_key_id text, p_public_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_existing uuid;
begin
  if v_org is null then raise exception 'not signed in' using errcode = 'P0001'; end if;
  if not (public.caller_has_right('edit_config') or public.caller_head_level() >= 1) then
    return jsonb_build_object('ok', false, 'reason', 'edit_config or a Head is required to register a signing key');
  end if;
  if p_key_id is null or length(trim(p_key_id)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'a key id is required');
  end if;
  if p_public_key is null or length(trim(p_public_key)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'a public key is required');
  end if;

  -- Retire the current live org key, if any, so the new key becomes the one live key.
  select id into v_existing from signing_keys
    where org_id = v_org and scope = 'org' and retired_at is null limit 1;
  if v_existing is not null then
    update signing_keys set retired_at = now(),
      retired_reason = 'superseded by a key registered from the client'
      where id = v_existing;
  end if;

  insert into signing_keys (org_id, scope, key_id, algorithm, public_key, created_by)
  values (v_org, 'org', p_key_id, 'Ed25519', p_public_key, auth.uid());

  perform public.append_ledger_entry(v_org, 'signing_key_registered',
    jsonb_build_object('key_id', p_key_id, 'superseded', v_existing is not null), auth.uid());
  return jsonb_build_object('ok', true, 'key_id', p_key_id);
end $$;

-- ---------------------------------------------------------------------------
-- 3. rule_pack_release — set a draft pack live. Idempotent. Needs edit_config. Logged.
-- ---------------------------------------------------------------------------
create or replace function public.rule_pack_release(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_pack public.rule_packs;
begin
  if not public.caller_has_right('edit_config') then
    return jsonb_build_object('ok', false, 'reason', 'edit_config is required to release a rule pack');
  end if;
  select * into v_pack from rule_packs where id = p_id and org_id = v_org;
  if v_pack.id is null then
    return jsonb_build_object('ok', false, 'reason', 'that pack does not exist in your organisation');
  end if;
  if v_pack.released then
    return jsonb_build_object('ok', true, 'id', v_pack.id, 'already_released', true);
  end if;
  update rule_packs set released = true where id = v_pack.id;
  perform public.append_ledger_entry(v_org, 'rule_pack_released',
    jsonb_build_object('name', v_pack.name, 'version', v_pack.version,
                       'content_hash', v_pack.content_hash, 'key_id', v_pack.key_id), auth.uid());
  return jsonb_build_object('ok', true, 'id', v_pack.id, 'already_released', false);
end $$;

-- ---------------------------------------------------------------------------
-- 4. rule_pack_refusals_list — the reader the refusal log never had. Newest first, own-org only.
-- ---------------------------------------------------------------------------
create or replace function public.rule_pack_refusals_list()
returns table (id uuid, name text, version int, reason text, detail text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.version, r.reason, r.detail, r.created_at
  from rule_pack_refusals r
  where r.org_id = public.jwt_org_id()
  order by r.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- 5. rule_pack_released_rules — the rules of the newest released pack, so the rule-run screen runs
--    what was released rather than the in-code default. Returns the pack identity and the stored
--    rules jsonb (id, version, kind, params, severity, status); the client reconstructs the
--    executable rule by id@version from the shipped library. Null when no pack is released.
-- ---------------------------------------------------------------------------
create or replace function public.rule_pack_released_rules()
returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(t) from (
    select p.name, p.version, p.target, p.content_hash, p.rules
    from rule_packs p
    where p.org_id = public.jwt_org_id() and p.released
    order by p.name, p.version desc
    limit 1
  ) t;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Same split as 0117: reads through the RPCs, writes through the RPCs, nothing direct.
-- ---------------------------------------------------------------------------
grant execute on function public.signing_key_register(text, text) to authenticated;
grant execute on function public.rule_pack_release(uuid) to authenticated;
grant execute on function public.rule_pack_refusals_list() to authenticated;
grant execute on function public.rule_pack_released_rules() to authenticated;
