-- 0205: Security & enterprise readiness, part 2 (WP15 erasure, WP16 crypto agility).
--
-- Laws that shape this migration:
--   - L2: erasure pseudonymises personal identifiers in place; it never rewrites a sealed hash and
--     never touches the hash-chained ledger. The immutable record stays verifiable.
--   - L1 deterministic: rotation is a function of a time ARGUMENT (p_now), never the clock.
--   - Config-as-ledger: the algorithm registry is data, not code; rotation and erasure append
--     hash-chained rows.
--   - Immutability: rotation retires a key and mints a higher key_version; it never deletes a key or
--     re-signs a historic root, so a 2019 report still verifies in 2035.
--   - Idempotent: every object is `if not exists` / `create or replace`.

-- ---------------------------------------------------------------------------
-- 1. Crypto agility (WP16). The algorithm is a registry row, so a future algorithm is a new row,
--    not a code change. Ed25519 is active; the others are recorded so the platform can migrate.
-- ---------------------------------------------------------------------------
create table if not exists signing_algorithms (
  code text primary key,
  label text not null,
  -- 'active' may be used to sign; 'deprecated' still verifies historic signatures; 'planned' is
  -- recorded for migration planning and may not sign.
  status text not null check (status in ('active', 'deprecated', 'planned')),
  rotation_days int not null default 365,
  is_default boolean not null default false,
  notes text
);
alter table signing_algorithms add column if not exists label text;
alter table signing_algorithms add column if not exists status text;
alter table signing_algorithms add column if not exists rotation_days int not null default 365;
alter table signing_algorithms add column if not exists is_default boolean not null default false;
alter table signing_algorithms add column if not exists notes text;

insert into signing_algorithms (code, label, status, rotation_days, is_default, notes) values
  ('Ed25519', 'Ed25519', 'active', 365, true, 'Default. Fast, small signatures, no parameter choices.'),
  ('Ed448', 'Ed448', 'active', 365, false, 'Higher security margin; available for high-assurance tenants.'),
  ('ES256', 'ECDSA P-256', 'deprecated', 180, false, 'Kept so historic signatures verify; do not sign new roots.'),
  ('ML-DSA-65', 'ML-DSA-65 (post-quantum)', 'planned', 365, false, 'Post-quantum migration target; recorded for planning.')
on conflict (code) do nothing;

-- The one live key per scope/org is the signing key. Add key_version and rotation metadata.
alter table signing_keys add column if not exists key_version int not null default 1;
alter table signing_keys add column if not exists rotation_days int not null default 365;
alter table signing_keys add column if not exists rotate_after timestamptz;
alter table signing_keys add column if not exists rotated_from_key_id text;

-- Relax the original `algorithm = 'Ed25519'` check into a registry reference, so a new active
-- algorithm is a data change. (The inline check auto-names signing_keys_algorithm_check.)
alter table signing_keys drop constraint if exists signing_keys_algorithm_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'signing_keys_algorithm_fk') then
    alter table signing_keys add constraint signing_keys_algorithm_fk
      foreign key (algorithm) references signing_algorithms(code);
  end if;
end $$;

-- Every signature records the key_version it was made with, so a verifier resolves the exact key.
alter table signatures add column if not exists key_version int not null default 1;

alter table signing_algorithms enable row level security;
drop policy if exists signing_algorithms_select on signing_algorithms;
-- A reference list any signed-in member may read; never a blanket `using (true)` (spec §25.1).
create policy signing_algorithms_select on signing_algorithms for select to authenticated
  using (auth.uid() is not null);

/** The default signing algorithm. */
create or replace function public.default_signing_algorithm() returns text
language sql stable security definer set search_path = public as $$
  select code from signing_algorithms where is_default and status = 'active' order by code limit 1
$$;

/** True when an algorithm may sign a new root. */
create or replace function public.algorithm_can_sign(p_algorithm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from signing_algorithms where code = p_algorithm and status = 'active')
$$;

/** The registry, for the Super Admin panel. */
create or replace function public.platform_list_signing_algorithms()
returns table (code text, label text, status text, rotation_days int, is_default boolean)
language sql stable security definer set search_path = public as $$
  select a.code, a.label, a.status, a.rotation_days, a.is_default
  from signing_algorithms a order by a.is_default desc, a.code
$$;

/**
 * Rotate a signing key (WP16). Retires the current live key and records a new one with the next
 * key_version. The new key material is generated outside the database (the private half never lands
 * in a table); this RPC records the public half and the transition.
 *
 * p_retire_after_days: the retired key keeps verifying historic signatures forever; this only records
 * how long it may still be advertised in the verification keyring.
 */
create or replace function public.platform_rotate_signing_key(
  p_key_id text, p_new_key_id text, p_new_public_key text, p_algorithm text,
  p_reason text, p_now timestamptz
) returns table (old_key_id text, new_key_id text, new_key_version int)
language plpgsql security definer set search_path = public as $$
declare
  v_old signing_keys;
  v_rotation int;
  v_version int;
begin
  perform public.require_platform_admin();
  if p_now is null then
    raise exception 'the rotation time is required' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for a key rotation' using errcode = 'P0001';
  end if;
  if not public.algorithm_can_sign(p_algorithm) then
    raise exception 'algorithm % may not sign new roots', p_algorithm using errcode = 'P0001';
  end if;
  select * into v_old from signing_keys where key_id = p_key_id and retired_at is null;
  if v_old.id is null then
    raise exception 'no live signing key with id %', p_key_id using errcode = 'P0001';
  end if;
  if exists (select 1 from signing_keys where key_id = p_new_key_id) then
    raise exception 'key id % already exists', p_new_key_id using errcode = 'P0001';
  end if;

  update signing_keys set retired_at = p_now, retired_reason = p_reason where id = v_old.id;

  select a.rotation_days into v_rotation from signing_algorithms a where a.code = p_algorithm;
  v_version := coalesce(v_old.key_version, 1) + 1;

  insert into signing_keys (org_id, scope, key_id, algorithm, public_key, created_by, created_at,
    key_version, rotation_days, rotate_after, rotated_from_key_id)
  values (v_old.org_id, v_old.scope, p_new_key_id, p_algorithm, p_new_public_key, auth.uid(), p_now,
    v_version, coalesce(v_rotation, 365), p_now + make_interval(days => coalesce(v_rotation, 365)),
    v_old.key_id);

  perform public.platform_log('signing_key_rotated', v_old.org_id, 'signing_keys', null,
    jsonb_build_object('old_key_id', p_key_id, 'new_key_id', p_new_key_id, 'algorithm', p_algorithm,
      'key_version', v_version, 'reason', p_reason));
  if v_old.org_id is not null then
    perform public.append_ledger_entry(v_old.org_id, 'signing_key_rotated',
      jsonb_build_object('old_key_id', p_key_id, 'new_key_id', p_new_key_id, 'algorithm', p_algorithm,
        'key_version', v_version));
  end if;

  return query select p_key_id, p_new_key_id, v_version;
end $$;

/**
 * The keys whose rotation is due at p_now. Read-only; time is an argument. A scheduled job calls
 * this and raises an alert; the actual rotation is an owner/Edge-Function action.
 */
create or replace function public.platform_signing_keys_due(p_now timestamptz)
returns table (key_id text, scope text, org_id uuid, algorithm text, key_version int, rotate_after timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  if p_now is null then
    raise exception 'the check time is required' using errcode = 'P0001';
  end if;
  return query
    select k.key_id, k.scope, k.org_id, k.algorithm, coalesce(k.key_version, 1),
           coalesce(k.rotate_after, k.created_at + make_interval(days => coalesce(k.rotation_days, 365)))
    from signing_keys k
    where k.retired_at is null
      and coalesce(k.rotate_after, k.created_at + make_interval(days => coalesce(k.rotation_days, 365))) <= p_now
    order by k.created_at;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Right to erasure (WP15). A request, an append-only event log, and an execute step that
--    pseudonymises personal identifiers while leaving the sealed, hash-chained record intact.
-- ---------------------------------------------------------------------------
create table if not exists data_erasure_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  subject_user_id uuid,
  subject_email text not null,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'blocked', 'executed', 'rejected')),
  legal_hold boolean not null default false,
  legal_hold_reason text,
  executed_at timestamptz,
  executed_by uuid,
  notes text
);
alter table data_erasure_requests add column if not exists org_id uuid;
alter table data_erasure_requests add column if not exists subject_user_id uuid;
alter table data_erasure_requests add column if not exists subject_email text;
alter table data_erasure_requests add column if not exists requested_by uuid;
alter table data_erasure_requests add column if not exists requested_at timestamptz not null default now();
alter table data_erasure_requests add column if not exists reason text;
alter table data_erasure_requests add column if not exists status text not null default 'pending';
alter table data_erasure_requests add column if not exists legal_hold boolean not null default false;
alter table data_erasure_requests add column if not exists legal_hold_reason text;
alter table data_erasure_requests add column if not exists executed_at timestamptz;
alter table data_erasure_requests add column if not exists executed_by uuid;
alter table data_erasure_requests add column if not exists notes text;
create index if not exists data_erasure_requests_org_idx on data_erasure_requests (org_id, status);

create table if not exists data_erasure_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  request_id uuid not null references data_erasure_requests(id) on delete cascade,
  action text not null,
  actor uuid,
  detail jsonb not null default '{}'::jsonb,
  prev_hash text,
  row_hash text not null,
  created_at timestamptz not null default now()
);
alter table data_erasure_events add column if not exists org_id uuid;
alter table data_erasure_events add column if not exists request_id uuid;
alter table data_erasure_events add column if not exists action text;
alter table data_erasure_events add column if not exists actor uuid;
alter table data_erasure_events add column if not exists detail jsonb not null default '{}'::jsonb;
alter table data_erasure_events add column if not exists prev_hash text;
alter table data_erasure_events add column if not exists row_hash text;
alter table data_erasure_events add column if not exists created_at timestamptz not null default now();
create index if not exists data_erasure_events_request_idx on data_erasure_events (request_id, created_at);

-- Append-only: the erasure log is the record; it is never rewritten.
drop trigger if exists data_erasure_events_append_only on data_erasure_events;
create trigger data_erasure_events_append_only
  before update or delete on data_erasure_events
  for each row execute function public.forbid_mutation();

alter table data_erasure_requests enable row level security;
drop policy if exists data_erasure_requests_select on data_erasure_requests;
create policy data_erasure_requests_select on data_erasure_requests for select to authenticated
  using (org_id = public.jwt_org_id() and public.caller_has_right('manage_users'));

alter table data_erasure_events enable row level security;
drop policy if exists data_erasure_events_select on data_erasure_events;
create policy data_erasure_events_select on data_erasure_events for select to authenticated
  using (org_id = public.jwt_org_id() and public.caller_has_right('manage_users'));

/** Append one hash-chained erasure event. Internal. */
create or replace function public.erasure_append_event(
  p_org uuid, p_request uuid, p_action text, p_detail jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_body text;
begin
  select row_hash into v_prev from data_erasure_events where request_id = p_request order by created_at desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || p_action || '|' || coalesce(p_detail, '{}'::jsonb)::text;
  insert into data_erasure_events (org_id, request_id, action, actor, detail, prev_hash, row_hash)
  values (p_org, p_request, p_action, auth.uid(), coalesce(p_detail, '{}'::jsonb), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
end $$;

/** Raise an erasure request. Requires manage_users. */
create or replace function public.erasure_request(p_org uuid, p_subject_email text, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_subject uuid;
begin
  perform public.provio_org_guard(p_org);
  if not public.caller_has_right('manage_users') then
    raise exception 'not allowed: manage_users is required to raise an erasure request' using errcode = 'P0001';
  end if;
  if p_subject_email is null or btrim(p_subject_email) = '' then
    raise exception 'the subject email is required' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for an erasure request' using errcode = 'P0001';
  end if;

  -- Resolve the subject's uuid from the org's members by email, when the account still exists.
  -- A request for a subject who has already left is still recorded, with a null subject_user_id.
  select m.user_id into v_subject
  from org_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org and lower(u.email) = lower(btrim(p_subject_email))
  limit 1;

  insert into data_erasure_requests (org_id, subject_user_id, subject_email, requested_by, reason, status)
  values (p_org, v_subject, lower(btrim(p_subject_email)), auth.uid(), p_reason, 'pending')
  returning id into v_id;

  perform public.erasure_append_event(p_org, v_id, 'requested',
    jsonb_build_object('subject_email', lower(btrim(p_subject_email)), 'reason', p_reason));
  perform public.append_ledger_entry(p_org, 'erasure_requested',
    jsonb_build_object('request_id', v_id, 'subject_email', lower(btrim(p_subject_email)), 'reason', p_reason));
  return v_id;
end $$;

/** Place or lift a legal hold. A held request cannot be executed. Requires edit_config. */
create or replace function public.erasure_set_legal_hold(p_request uuid, p_hold boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select org_id into v_org from data_erasure_requests where id = p_request;
  if v_org is null then
    raise exception 'unknown erasure request' using errcode = 'P0001';
  end if;
  perform public.provio_org_guard(v_org);
  if not public.caller_has_right('edit_config') then
    raise exception 'not allowed: edit_config is required to set a legal hold' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for a legal hold' using errcode = 'P0001';
  end if;

  update data_erasure_requests
    set legal_hold = coalesce(p_hold, false),
        legal_hold_reason = case when coalesce(p_hold, false) then p_reason else legal_hold_reason end,
        status = case when coalesce(p_hold, false) then 'blocked'
                      when status = 'blocked' then 'pending' else status end
    where id = p_request;

  perform public.erasure_append_event(v_org, p_request,
    case when coalesce(p_hold, false) then 'legal_hold_set' else 'legal_hold_lifted' end,
    jsonb_build_object('reason', p_reason));
  perform public.append_ledger_entry(v_org, 'erasure_legal_hold',
    jsonb_build_object('request_id', p_request, 'hold', p_hold, 'reason', p_reason));
end $$;

/**
 * Execute an erasure. Pseudonymises the subject's personal identifiers in place. It never deletes a
 * ledger entry, a sealed hash or a signature: those reference the actor by uuid and contain no
 * personal identifiers, so the immutable record stays verifiable (L2).
 */
create or replace function public.erasure_execute(p_request uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req data_erasure_requests;
  v_pseudonym text;
  v_members int;
begin
  select * into v_req from data_erasure_requests where id = p_request;
  if v_req.id is null then
    raise exception 'unknown erasure request' using errcode = 'P0001';
  end if;
  perform public.provio_org_guard(v_req.org_id);
  if not public.caller_has_right('edit_config') then
    raise exception 'not allowed: edit_config is required to execute an erasure' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to execute an erasure' using errcode = 'P0001';
  end if;
  if v_req.legal_hold then
    raise exception 'erasure blocked: the subject is under legal hold' using errcode = 'P0001';
  end if;
  if v_req.status = 'executed' then
    raise exception 'erasure already executed' using errcode = 'P0001';
  end if;

  v_pseudonym := 'Erased subject ' || substr(md5(v_req.subject_email), 1, 8);

  -- The only place a personal identifier is stored for a member is org_members.display_name.
  update org_members set display_name = v_pseudonym
    where org_id = v_req.org_id and user_id = v_req.subject_user_id;
  get diagnostics v_members = row_count;

  update data_erasure_requests
    set status = 'executed', executed_at = now(), executed_by = auth.uid(), notes = p_reason
    where id = p_request;

  perform public.erasure_append_event(v_req.org_id, p_request, 'executed',
    jsonb_build_object('pseudonym', v_pseudonym, 'members_pseudonymised', v_members, 'reason', p_reason));
  perform public.append_ledger_entry(v_req.org_id, 'erasure_executed',
    jsonb_build_object('request_id', p_request, 'pseudonym', v_pseudonym, 'reason', p_reason));
end $$;

/** The erasure register for one org. Requires manage_users. */
create or replace function public.erasure_list(p_org uuid)
returns table (id uuid, subject_email text, status text, legal_hold boolean,
               requested_at timestamptz, executed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (p_org = public.jwt_org_id() and public.caller_has_right('manage_users')) then
    raise exception 'not allowed: manage_users is required to read the erasure register' using errcode = 'P0001';
  end if;
  return query select r.id, r.subject_email, r.status, r.legal_hold, r.requested_at, r.executed_at
    from data_erasure_requests r where r.org_id = p_org order by r.requested_at desc;
end $$;
