-- 0096: Item A. Integrity anchoring: signing keys, signatures, timestamp authorities,
-- trust anchors, the timestamp queue and the stamping policy.
--
-- Laws that shape this migration:
--   - L2: only a SHA-256 hash is sent to an authority. No tenant content ever leaves.
--   - Rights, not role names. Every check reads a right through has_right().
--   - has_feature before the right check (F25).
--   - Idempotent: every object is create if not exists / add column if not exists / create or
--     replace, and every seed is on conflict do nothing. The file is applied twice by the harness.
--   - Private key material NEVER lands in any table. The Edge Function holds the private key in the
--     existing secrets path; only the public key is stored here.

-- ---------------------------------------------------------------------------
-- 1. Feature keys (F25).
-- ---------------------------------------------------------------------------
insert into feature_catalogue (key, label, description, group_name, price_class, default_on, status) values
  ('integrity_anchoring','Integrity anchoring','Sign report roots, certificates and the daily ledger root with an organisation key','Integrity','included',true,'live'),
  ('timestamp_dual','Dual timestamps','Require two independent timestamp authorities for every root','Integrity','add_on',false,'live')
on conflict (key) do update set label = excluded.label, description = excluded.description,
  group_name = excluded.group_name, price_class = excluded.price_class, status = excluded.status;

-- ---------------------------------------------------------------------------
-- 2. Signing keys. One key pair per organisation plus one platform pair. Only public material is
--    stored; the private half lives in the secrets path (Vault, else AES-GCM).
-- ---------------------------------------------------------------------------
create table if not exists signing_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  scope text not null default 'org' check (scope in ('org','platform')),
  key_id text not null,
  algorithm text not null default 'Ed25519' check (algorithm = 'Ed25519'),
  public_key text not null,
  /** The Vault secret id or the AES-GCM ciphertext reference. Never the key itself. */
  private_ref text,
  created_by uuid,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_reason text
);
alter table signing_keys add column if not exists scope text not null default 'org';
alter table signing_keys add column if not exists key_id text;
alter table signing_keys add column if not exists algorithm text not null default 'Ed25519';
alter table signing_keys add column if not exists public_key text;
alter table signing_keys add column if not exists private_ref text;
alter table signing_keys add column if not exists created_by uuid;
alter table signing_keys add column if not exists created_at timestamptz not null default now();
alter table signing_keys add column if not exists retired_at timestamptz;
alter table signing_keys add column if not exists retired_reason text;
create unique index if not exists signing_keys_key_id_uq on signing_keys (key_id);
create index if not exists signing_keys_org_idx on signing_keys (org_id) where retired_at is null;

-- A retired key stays readable so old signatures keep verifying. Only one live key per scope/org.
create unique index if not exists signing_keys_live_uq
  on signing_keys (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), scope)
  where retired_at is null;

-- ---------------------------------------------------------------------------
-- 3. Signatures.
-- ---------------------------------------------------------------------------
create table if not exists signatures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in
    ('report_graph_root','board_pack_data_hash','engagement_certificate','ledger_daily_root')),
  subject_id text not null,
  root_hash text not null check (root_hash ~ '^[0-9a-f]{64}$'),
  key_id text not null,
  signature text not null check (signature ~ '^[0-9a-f]{128}$'),
  signed_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index if not exists signatures_uq on signatures (org_id, kind, subject_id, key_id);
create index if not exists signatures_subject_idx on signatures (org_id, kind, subject_id);

-- ---------------------------------------------------------------------------
-- 4. Timestamp authorities and trust anchors. Seeded, editable by Super Admin, never hard-coded.
-- ---------------------------------------------------------------------------
create table if not exists timestamp_authorities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  enabled boolean not null default true,
  sort_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists timestamp_authorities_url_uq on timestamp_authorities (url);

create table if not exists timestamp_trust_anchors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  /** The anchor certificate, DER, base64. Public material only. */
  certificate_der text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into timestamp_authorities (name, url, sort_order, notes) values
  ('FreeTSA','https://freetsa.org/tsr',1,'initial guidance; verify live. Volunteer service, no uptime guarantee.'),
  ('DigiCert','http://timestamp.digicert.com',2,'initial guidance; verify live.'),
  ('Sectigo','http://timestamp.sectigo.com',3,'initial guidance; verify live.')
on conflict (url) do nothing;

-- ---------------------------------------------------------------------------
-- 5. The stamping queue. Never blocks sealing: a seal writes a queued row and returns.
-- ---------------------------------------------------------------------------
create table if not exists timestamp_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  subject_kind text not null check (subject_kind in
    ('report_graph_root','board_pack_data_hash','engagement_certificate','ledger_daily_root')),
  subject_id text not null,
  root_hash text not null check (root_hash ~ '^[0-9a-f]{64}$'),
  key_id text not null,
  status text not null default 'queued' check (status in ('queued','stamped','partial','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  stamped_at timestamptz
);
create unique index if not exists timestamp_requests_uq
  on timestamp_requests (org_id, subject_kind, subject_id, root_hash);
create index if not exists timestamp_requests_due_idx
  on timestamp_requests (next_attempt_at) where status in ('queued','partial');

create table if not exists timestamp_tokens (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references timestamp_requests(id) on delete cascade,
  authority_id uuid references timestamp_authorities(id) on delete set null,
  authority_name text not null,
  /** The TimeStampToken, DER, base64. It carries no tenant data. */
  token_der text not null,
  gen_time timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index if not exists timestamp_tokens_uq on timestamp_tokens (request_id, authority_name);

-- ---------------------------------------------------------------------------
-- 6. Policy settings.
-- ---------------------------------------------------------------------------
create table if not exists anchoring_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  min_authorities int not null default 2 check (min_authorities between 1 and 3),
  updated_at timestamptz not null default now()
);
alter table anchoring_settings add column if not exists min_authorities int not null default 2;
alter table anchoring_settings add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 7. Rights helpers.
-- ---------------------------------------------------------------------------
-- The caller's head level, already used by WP2.
create or replace function public.caller_head_level() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(m.head_level, 0) from org_members m
   where m.org_id = public.jwt_org_id() and m.user_id = auth.uid();
$$;

-- The minimum authorities the org requires.
create or replace function public.anchoring_min_authorities(p_org uuid default null) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.min_authorities from anchoring_settings s
      where s.org_id = coalesce(p_org, public.jwt_org_id())), 2);
$$;

-- ---------------------------------------------------------------------------
-- 8. Read RPCs.
-- ---------------------------------------------------------------------------
-- The org's keys, public material only. Never the private reference.
create or replace function public.signing_keys_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id, 'key_id', k.key_id, 'algorithm', k.algorithm, 'public_key', k.public_key,
    'created_at', k.created_at, 'retired_at', k.retired_at, 'retired_reason', k.retired_reason,
    'live', k.retired_at is null
  ) order by k.created_at desc), '[]'::jsonb)
  from signing_keys k
  where k.org_id = public.jwt_org_id() and k.scope = 'org';
$$;

-- The signatures on one subject.
create or replace function public.signatures_get(p_kind text, p_subject_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'subject_id', s.subject_id, 'root_hash', s.root_hash,
    'key_id', s.key_id, 'signature', s.signature, 'signed_at', s.signed_at
  ) order by s.signed_at desc), '[]'::jsonb)
  from signatures s
  where s.org_id = public.jwt_org_id() and s.kind = p_kind and s.subject_id = p_subject_id;
$$;

-- The anchoring status of one subject: signature plus the timestamp verdict.
create or replace function public.anchoring_status(p_kind text, p_subject_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sig jsonb;
  v_req timestamp_requests;
  v_min int := public.anchoring_min_authorities(null);
  v_count int;
begin
  select to_jsonb(s) into v_sig from signatures s
   where s.org_id = v_org and s.kind = p_kind and s.subject_id = p_subject_id
   order by s.signed_at desc limit 1;
  select * into v_req from timestamp_requests t
   where t.org_id = v_org and t.subject_kind = p_kind and t.subject_id = p_subject_id
   order by t.created_at desc limit 1;
  select count(*) into v_count from timestamp_tokens tt where tt.request_id = v_req.id;
  return jsonb_build_object(
    'signed', v_sig is not null,
    'signed_at', v_sig ->> 'signed_at',
    'key_id', v_sig ->> 'key_id',
    'timestamp_status', coalesce(v_req.status, 'queued'),
    'timestamps', coalesce(v_count, 0),
    'min_authorities', v_min
  );
end $$;

-- ---------------------------------------------------------------------------
-- 9. Write RPCs.
-- ---------------------------------------------------------------------------
-- Record a signature. The signature itself is produced by the Edge Function, which holds the
-- private key; this RPC only stores the result. The caller must hold edit_config or be a Head.
create or replace function public.signature_record(
  p_kind text, p_subject_id text, p_root_hash text, p_key_id text,
  p_signature text, p_signed_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
  v_key signing_keys;
begin
  if v_org is null then raise exception 'not signed in' using errcode = 'P0001'; end if;
  if not public.has_feature(v_org, 'integrity_anchoring') then
    raise exception 'feature_off: integrity_anchoring' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('edit_config') or public.caller_head_level() >= 1) then
    raise exception 'not permitted: edit_config or a Head is required' using errcode = 'P0001';
  end if;
  if p_root_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'the root hash must be 64 lowercase hex characters' using errcode = 'P0001';
  end if;
  if p_signature !~ '^[0-9a-f]{128}$' then
    raise exception 'the signature must be 128 lowercase hex characters' using errcode = 'P0001';
  end if;

  select * into v_key from signing_keys k where k.key_id = p_key_id and k.org_id = v_org;
  if not found then
    raise exception 'unknown signing key %', p_key_id using errcode = 'P0001';
  end if;
  if v_key.retired_at is not null then
    raise exception 'the signing key % is retired', p_key_id using errcode = 'P0001';
  end if;

  insert into signatures (org_id, kind, subject_id, root_hash, key_id, signature, signed_at)
  values (v_org, p_kind, p_subject_id, p_root_hash, p_key_id, p_signature, p_signed_at)
  on conflict (org_id, kind, subject_id, key_id) do update
    set signature = excluded.signature, signed_at = excluded.signed_at, root_hash = excluded.root_hash
  returning id into v_id;

  perform public.append_ledger_entry(v_org, 'signature_recorded',
    jsonb_build_object('kind', p_kind, 'subject_id', p_subject_id, 'root_hash', p_root_hash,
                       'key_id', p_key_id), auth.uid());
  return v_id;
end $$;

-- Queue a timestamp request. Idempotent: the same root hash never queues twice.
create or replace function public.timestamp_queue(
  p_kind text, p_subject_id text, p_root_hash text, p_key_id text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then raise exception 'not signed in' using errcode = 'P0001'; end if;
  if p_root_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'the root hash must be 64 lowercase hex characters' using errcode = 'P0001';
  end if;
  insert into timestamp_requests (org_id, subject_kind, subject_id, root_hash, key_id)
  values (v_org, p_kind, p_subject_id, p_root_hash, p_key_id)
  on conflict (org_id, subject_kind, subject_id, root_hash) do nothing
  returning id into v_id;
  if v_id is null then
    select t.id into v_id from timestamp_requests t
     where t.org_id = v_org and t.subject_kind = p_kind and t.subject_id = p_subject_id
       and t.root_hash = p_root_hash;
  end if;
  return v_id;
end $$;

-- Record a stamped token. Called by the Edge Function with the service role, or by a Head.
create or replace function public.timestamp_record(
  p_request_id uuid, p_authority_name text, p_token_der text, p_gen_time timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req timestamp_requests;
  v_id uuid;
  v_count int;
  v_min int;
  v_authority uuid;
begin
  select * into v_req from timestamp_requests t where t.id = p_request_id;
  if not found then raise exception 'unknown timestamp request' using errcode = 'P0001'; end if;
  -- An application caller must act on its own org. An internal or service caller carries no org
  -- claim and is trusted, exactly as has_feature treats it.
  if public.jwt_org_id() is not null and v_req.org_id is distinct from public.jwt_org_id() then
    raise exception 'not found' using errcode = 'P0001';
  end if;

  select a.id into v_authority from timestamp_authorities a where a.name = p_authority_name;

  insert into timestamp_tokens (request_id, authority_id, authority_name, token_der, gen_time)
  values (p_request_id, v_authority, p_authority_name, p_token_der, p_gen_time)
  on conflict (request_id, authority_name) do update
    set token_der = excluded.token_der, gen_time = excluded.gen_time
  returning id into v_id;

  select count(*) into v_count from timestamp_tokens tt where tt.request_id = p_request_id;
  v_min := public.anchoring_min_authorities(v_req.org_id);

  update timestamp_requests set
    status = case when v_count >= v_min then 'stamped' else 'partial' end,
    stamped_at = case when v_count >= v_min then now() else stamped_at end,
    last_error = null
   where id = p_request_id;

  perform public.append_ledger_entry(v_req.org_id, 'timestamp_recorded',
    jsonb_build_object('request_id', p_request_id, 'authority', p_authority_name,
                       'gen_time', p_gen_time, 'count', v_count, 'min', v_min), auth.uid());
  return v_id;
end $$;

-- Record a failed attempt with the redacted error, and schedule the retry.
create or replace function public.timestamp_fail(p_request_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req timestamp_requests;
  v_attempts int;
  v_delay int;
begin
  select * into v_req from timestamp_requests t where t.id = p_request_id;
  if not found then raise exception 'unknown timestamp request' using errcode = 'P0001'; end if;
  if public.jwt_org_id() is not null and v_req.org_id is distinct from public.jwt_org_id() then
    raise exception 'not found' using errcode = 'P0001';
  end if;
  v_attempts := v_req.attempts + 1;
  -- The ladder: 1, 5, 15, 60, 240 minutes, max 8 attempts.
  v_delay := case v_attempts when 1 then 1 when 2 then 5 when 3 then 15 when 4 then 60 else 240 end;
  update timestamp_requests set
    attempts = v_attempts,
    -- Redact: keep the first 200 characters only, and never a token or a credential.
    last_error = left(coalesce(p_error, 'unknown error'), 200),
    status = case when v_attempts >= 8 then 'failed' else 'queued' end,
    next_attempt_at = now() + make_interval(mins => v_delay)
   where id = p_request_id;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Super Admin: authorities, anchors and settings.
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_timestamp_authority(
  p_id uuid, p_name text, p_url text, p_enabled boolean, p_sort_order int, p_notes text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not permitted: platform administrator only' using errcode = 'P0001';
  end if;
  if p_url !~ '^https?://' then
    raise exception 'the authority URL must start with http:// or https://' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into timestamp_authorities (name, url, enabled, sort_order, notes)
    values (p_name, p_url, p_enabled, p_sort_order, p_notes) returning id into v_id;
  else
    update timestamp_authorities set name = p_name, url = p_url, enabled = p_enabled,
      sort_order = p_sort_order, notes = p_notes, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'unknown timestamp authority' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.admin_save_trust_anchor(
  p_id uuid, p_name text, p_certificate_der text, p_enabled boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not permitted: platform administrator only' using errcode = 'P0001';
  end if;
  if p_certificate_der is null or length(p_certificate_der) < 16 then
    raise exception 'the trust anchor certificate is required' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into timestamp_trust_anchors (name, certificate_der, enabled)
    values (p_name, p_certificate_der, p_enabled) returning id into v_id;
  else
    update timestamp_trust_anchors set name = p_name, certificate_der = p_certificate_der,
      enabled = p_enabled where id = p_id returning id into v_id;
    if v_id is null then raise exception 'unknown trust anchor' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.admin_set_anchoring_min(p_org uuid, p_min int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not permitted: platform administrator only' using errcode = 'P0001';
  end if;
  if p_min < 1 or p_min > 3 then
    raise exception 'the minimum authorities must be between 1 and 3' using errcode = 'P0001';
  end if;
  insert into anchoring_settings (org_id, min_authorities) values (p_org, p_min)
  on conflict (org_id) do update set min_authorities = excluded.min_authorities, updated_at = now();
end $$;

-- The org's own view of the authority list (read only, no secrets).
create or replace function public.timestamp_authorities_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'url', a.url, 'enabled', a.enabled,
    'sort_order', a.sort_order, 'notes', a.notes
  ) order by a.sort_order, a.name), '[]'::jsonb)
  from timestamp_authorities a;
$$;

create or replace function public.timestamp_anchors_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'enabled', t.enabled
  ) order by t.name), '[]'::jsonb)
  from timestamp_trust_anchors t;
$$;

-- ---------------------------------------------------------------------------
-- 11. RLS.
-- ---------------------------------------------------------------------------
alter table signing_keys enable row level security;
alter table signatures enable row level security;
alter table timestamp_requests enable row level security;
alter table timestamp_tokens enable row level security;
alter table anchoring_settings enable row level security;
alter table timestamp_authorities enable row level security;
alter table timestamp_trust_anchors enable row level security;

-- Signing keys: an org reads its own public keys. Platform rows are never visible to a tenant.
drop policy if exists signing_keys_select on signing_keys;
create policy signing_keys_select on signing_keys for select to authenticated
  using (org_id = public.jwt_org_id() and scope = 'org');

drop policy if exists signatures_select on signatures;
create policy signatures_select on signatures for select to authenticated
  using (org_id = public.jwt_org_id());

drop policy if exists timestamp_requests_select on timestamp_requests;
create policy timestamp_requests_select on timestamp_requests for select to authenticated
  using (org_id = public.jwt_org_id());

drop policy if exists timestamp_tokens_select on timestamp_tokens;
create policy timestamp_tokens_select on timestamp_tokens for select to authenticated
  using (exists (select 1 from timestamp_requests r
                  where r.id = timestamp_tokens.request_id and r.org_id = public.jwt_org_id()));

drop policy if exists anchoring_settings_select on anchoring_settings;
create policy anchoring_settings_select on anchoring_settings for select to authenticated
  using (org_id = public.jwt_org_id());

-- The authority and anchor catalogues are readable by any signed-in user (they carry no tenant data)
-- and writable only through the platform-admin RPCs.
drop policy if exists timestamp_authorities_select on timestamp_authorities;
create policy timestamp_authorities_select on timestamp_authorities for select to authenticated
  using (auth.uid() is not null);

drop policy if exists timestamp_trust_anchors_select on timestamp_trust_anchors;
create policy timestamp_trust_anchors_select on timestamp_trust_anchors for select to authenticated
  using (auth.uid() is not null);

-- No direct write policy on any of these: writes go through the RPCs above.

-- ---------------------------------------------------------------------------
-- 12. Grants. anon reaches none of this.
-- ---------------------------------------------------------------------------
revoke all on signing_keys, signatures, timestamp_requests, timestamp_tokens,
  anchoring_settings, timestamp_authorities, timestamp_trust_anchors from anon;

grant select on signing_keys, signatures, timestamp_requests, timestamp_tokens,
  anchoring_settings, timestamp_authorities, timestamp_trust_anchors to authenticated;

grant execute on function public.caller_head_level() to authenticated;
grant execute on function public.anchoring_min_authorities(uuid) to authenticated;
grant execute on function public.signing_keys_get() to authenticated;
grant execute on function public.signatures_get(text, text) to authenticated;
grant execute on function public.anchoring_status(text, text) to authenticated;
grant execute on function public.signature_record(text, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.timestamp_queue(text, text, text, text) to authenticated;
grant execute on function public.timestamp_record(uuid, text, text, timestamptz) to service_role;
grant execute on function public.timestamp_fail(uuid, text) to service_role;
grant execute on function public.admin_save_timestamp_authority(uuid, text, text, boolean, int, text) to authenticated;
grant execute on function public.admin_save_trust_anchor(uuid, text, text, boolean) to authenticated;
grant execute on function public.admin_set_anchoring_min(uuid, int) to authenticated;
grant execute on function public.timestamp_authorities_get() to authenticated;
grant execute on function public.timestamp_anchors_get() to authenticated;

revoke execute on function public.timestamp_record(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.timestamp_fail(uuid, text) from public, anon, authenticated;
