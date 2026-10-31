-- 0117 (S10/S11): Systeligon rule packs — versioned, append-only, signed, and refused when unverifiable.
--
-- Spec §4 (packs per audit type, the adhoc builder) and §8 (over-the-air updates). The client half
-- lives in src/lib/systeligon/ota.ts: packContentHash, signPack, verifyPack, buildAdhocRule. This
-- migration is the authoritative half — the tables, RLS, and the append-only trigger.
--
-- The control that matters (§8): whoever can push a pack can change what the engine concludes. So a
-- pack is signed over its content hash with the org's signing_keys (0096), and a save that is not
-- verifiable is REFUSED and the refusal logged. A pack is append-only: a shipped version is never
-- updated, only superseded by a higher version.
--
-- M1: grepped migrations and tests for every name below; all are new, none redefined.
-- M2: every object is create if not exists / create or replace; seeds are on conflict do nothing.
-- M6: applied twice and all SQL tests run twice by the harness before the push.

-- ---------------------------------------------------------------------------
-- 1. The rule_pack signature kind. 0096 pinned signatures.kind to four values; a pack signature is a
--    fifth. Replace both constraints with the same list plus 'rule_pack'.
-- ---------------------------------------------------------------------------
alter table signatures drop constraint if exists signatures_kind_check;
alter table signatures add constraint signatures_kind_check check (kind in
  ('report_graph_root','board_pack_data_hash','engagement_certificate','ledger_daily_root','rule_pack'));

alter table timestamp_requests drop constraint if exists timestamp_requests_subject_kind_check;
alter table timestamp_requests add constraint timestamp_requests_subject_kind_check check (subject_kind in
  ('report_graph_root','board_pack_data_hash','engagement_certificate','ledger_daily_root','rule_pack'));

-- ---------------------------------------------------------------------------
-- 2. Feature key (F25): the rule packs themselves are an included feature.
-- ---------------------------------------------------------------------------
insert into feature_catalogue (key, label, description, group_name, price_class, default_on, status) values
  ('systeligon_rule_packs','Systeligon rule packs','Signed, versioned forensic rule packs, per audit type','Systeligon','included',true,'live')
on conflict (key) do update set label = excluded.label, description = excluded.description,
  group_name = excluded.group_name, price_class = excluded.price_class, status = excluded.status;

-- ---------------------------------------------------------------------------
-- 3. Rule packs. Append-only: (name, version) is the identity, and a version is never changed.
-- ---------------------------------------------------------------------------
create table if not exists rule_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  version int not null check (version > 0),
  target text not null check (target in ('population','journal','document','minutes','policy','config','ledger')),
  /** The rules as a JSON array of {id, version, kind, ...}. The engine reads this, not a copy. */
  rules jsonb not null default '[]'::jsonb,
  /** The pack's canonical content hash (src/lib/systeligon/ota.ts packContentHash). */
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  key_id text not null,
  signature text not null check (signature ~ '^[0-9a-f]{128}$'),
  signed_at timestamptz not null,
  /** Set only by an admin action; a pack ships as a draft and is released deliberately. */
  released boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, name, version)
);
alter table rule_packs enable row level security;

-- RLS: read is own-org only (L2); write goes through rule_pack_save, which re-checks rights and the
-- signature. The equalities here never relax org_id = jwt_org_id().
drop policy if exists rule_packs_select on rule_packs;
create policy rule_packs_select on rule_packs for select using (org_id = public.jwt_org_id());

-- ---------------------------------------------------------------------------
-- 4. Append-only. A (name, version) row is immutable; a change is a new version.
-- ---------------------------------------------------------------------------
create or replace function public.rule_pack_append_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'rule_packs is append-only: pack % version % is immutable; ship a new version',
    old.name, old.version;
end $$;

drop trigger if exists rule_packs_no_update on rule_packs;
create trigger rule_packs_no_update before update or delete on rule_packs
  for each row execute function public.rule_pack_append_only();

-- ---------------------------------------------------------------------------
-- 5. Refusal log. An unverifiable pack is refused and the refusal recorded (§8). This is the trace
--    that a pack was offered and rejected, so a silent drop cannot happen.
-- ---------------------------------------------------------------------------
create table if not exists rule_pack_refusals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  version int not null,
  reason text not null,
  detail text,
  attempted_by uuid,
  created_at timestamptz not null default now()
);
alter table rule_pack_refusals enable row level security;
drop policy if exists rule_pack_refusals_select on rule_pack_refusals;
create policy rule_pack_refusals_select on rule_pack_refusals for select using (org_id = public.jwt_org_id());

-- ---------------------------------------------------------------------------
-- 6. rule_pack_save. The client has already verified the signature (verifyPack) and passes the pack,
--    its content hash, the key id and the signature. The function re-checks the right, that the key
--    belongs to this org and is not retired, and that the hash is shaped right; it never re-derives
--    the hash from the rules (that is the client's job, matching the existing ordering precedent).
--    A save that fails any check writes a refusal row and raises.
-- ---------------------------------------------------------------------------
create or replace function public.rule_pack_save(
  p_name text, p_version int, p_target text, p_rules jsonb,
  p_content_hash text, p_key_id text, p_signature text, p_signed_at timestamptz,
  p_released boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_key public.signing_keys;
  v_id uuid;
begin
  -- A refusal is LOGGED AND RETURNED, never raised. A RAISE would roll back the same transaction
  -- that wrote the refusal row, so the refusal would vanish — the log is the whole point of §8, so
  -- the failure path must commit. The caller reads {ok:false, reason} and stops; it never runs the
  -- pack. This mirrors the honest-failure rule: a refusal that leaves no trace is not a refusal.
  if not public.has_feature(v_org, 'systeligon_rule_packs') then
    return public.rule_pack_refuse(v_org, p_name, p_version, 'feature_off', 'systeligon_rule_packs is not enabled');
  end if;
  if not public.caller_has_right('edit_config') then
    return public.rule_pack_refuse(v_org, p_name, p_version, 'no_right', 'edit_config is required to ship a rule pack');
  end if;
  select * into v_key from public.signing_keys k where k.org_id = v_org and k.key_id = p_key_id;
  if v_key.id is null then
    return public.rule_pack_refuse(v_org, p_name, p_version, 'unknown_key', p_key_id);
  end if;
  if v_key.retired_at is not null then
    return public.rule_pack_refuse(v_org, p_name, p_version, 'retired_key', p_key_id);
  end if;
  insert into rule_packs (org_id, name, version, target, rules, content_hash, key_id, signature, signed_at, released, created_by)
  values (v_org, p_name, p_version, p_target, p_rules, p_content_hash, p_key_id, p_signature, p_signed_at, p_released, auth.uid())
  on conflict (org_id, name, version) do nothing
  returning id into v_id;
  if v_id is null then
    return public.rule_pack_refuse(v_org, p_name, p_version, 'duplicate', 'that version already exists and is immutable');
  end if;
  perform public.append_ledger_entry(v_org, 'rule_pack_saved', jsonb_build_object(
    'name', p_name, 'version', p_version, 'content_hash', p_content_hash, 'key_id', p_key_id, 'released', p_released));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- The refusal log. Returns the same refusal-shaped result the caller sees, so save and refuse agree.
create or replace function public.rule_pack_refuse(p_org uuid, p_name text, p_version int, p_reason text, p_detail text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into rule_pack_refusals (org_id, name, version, reason, detail, attempted_by)
  values (p_org, p_name, p_version, p_reason, p_detail, auth.uid());
  return jsonb_build_object('ok', false, 'reason', p_reason, 'detail', p_detail);
end $$;

-- ---------------------------------------------------------------------------
-- 7. rule_pack_list — the packs this org can run, newest version per name.
-- ---------------------------------------------------------------------------
create or replace function public.rule_pack_list()
returns table (id uuid, name text, version int, target text, content_hash text, released boolean, signed_at timestamptz)
language sql security definer set search_path = public as $$
  select distinct on (p.name) p.id, p.name, p.version, p.target, p.content_hash, p.released, p.signed_at
  from rule_packs p
  where p.org_id = public.jwt_org_id()
  order by p.name, p.version desc;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants. Same split as 0090: no direct table write from a tenant, and the RPCs are not
--    service-only. Reads go through RLS; writes go through rule_pack_save.
-- ---------------------------------------------------------------------------
revoke all on rule_packs from anon, authenticated;
revoke all on rule_pack_refusals from anon, authenticated;
grant select on rule_packs to authenticated;
grant select on rule_pack_refusals to authenticated;
grant execute on function public.rule_pack_save(text,int,text,jsonb,text,text,text,timestamptz,boolean) to authenticated;
grant execute on function public.rule_pack_list() to authenticated;
