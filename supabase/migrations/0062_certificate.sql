-- 0062: Engagement certificate and public verification (S8.a, F11).
--
-- A certificate freezes an engagement's sealing position: its ledger root hash, the sealed workpaper
-- count and the findings count, as a canonical JSON document with a SHA-256 `cert_hash` computed IN
-- THE DATABASE. Issuing and revoking write ledger entries (F20: certificate_issued,
-- certificate_revoked). Reopening a sealed engagement marks its certificate superseded.
--
-- Public verification is the ONLY anonymous surface in the product. Exactly two functions are
-- callable by role anon: verify_certificate(p_id) and verify_board_pack(p_id). Both are security
-- definer, touch no table as anon, and return only status, issued_at, the hash and counts. The
-- organisation name and engagement title are returned only when org setting public_verify_show_title
-- is on (default off). A rate limit counts attempts in a small table; no IP is stored.
--
-- M1: grepped supabase/migrations and supabase/tests for engagement_certificates, certificate_config,
--     verify_certificate, verify_board_pack, verify_attempts, engagement_root_hash,
--     certificate_issue, certificate_revoke, certificate_auto_issue; none existed (certificate_auto_issue
--     lives on org_settings_extra, 0051, and is reused as is). The feature keys `certificates` and
--     `public_verification` (0051), the rights `manage_engagements` and `can_reopen` (0050) and the
--     ledger kinds certificate_issued / certificate_revoked (F20) already exist and are used as is.
-- M2: create table if not exists + add column if not exists; create or replace; drop trigger/policy
--     if exists before create; create index if not exists. Safe to apply repeatedly.

-- ---------------------------------------------------------------------------
-- 1. certificate_config — which certificate fields appear, and in what order (F11: each field
--    toggleable and reorderable). Configurable, so it is versioned and logged (L5).
-- ---------------------------------------------------------------------------
create table if not exists certificate_config (
  id uuid primary key default gen_random_uuid()
);
alter table certificate_config add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table certificate_config add column if not exists field_key text;
alter table certificate_config add column if not exists label text;
alter table certificate_config add column if not exists ordinal int not null default 0;
alter table certificate_config add column if not exists enabled boolean not null default true;
alter table certificate_config add column if not exists created_at timestamptz not null default now();
create unique index if not exists certificate_config_org_key_idx on certificate_config (org_id, field_key);
create index if not exists certificate_config_org_ord_idx on certificate_config (org_id, ordinal);

-- The F11 fields, in order. Seeded for every organisation; a re-run does nothing.
create or replace function public.certificate_config_seed(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into certificate_config (org_id, field_key, label, ordinal)
  select p_org, f.key, f.label, f.ord
    from (values
      ('engagement_id',        'Engagement identifier', 1),
      ('engagement_title',     'Engagement title', 2),
      ('organisation',         'Organisation', 3),
      ('engagement_root_hash', 'Engagement root hash', 4),
      ('issued_at',            'Timestamp', 5),
      ('sealed_workpapers',    'Sealed workpaper count', 6),
      ('findings_count',       'Findings count', 7),
      ('sealing_actors',       'Sealing actors', 8),
      ('verification',         'Verification instructions', 9),
      ('free_text',            'Optional notes', 10)
    ) as f(key, label, ord)
  on conflict (org_id, field_key) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- 2. engagement_root_hash(p_engagement_id) — the engagement's sealing root. The ledger has no
--    engagement-level head, so the root is the SHA-256 of the newline-joined hashes of the
--    engagement's sealing ledger entries in sequence order (recorded decision D-S8-root-hash).
-- ---------------------------------------------------------------------------
create or replace function public.engagement_root_hash(p_engagement_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select encode(extensions.digest(coalesce(string_agg(e.hash, E'\n' order by e.seq), ''), 'sha256'), 'hex')
    from ledger_entries e
   where e.org_id = (select org_id from engagements where id = p_engagement_id)
     and e.payload ->> 'engagement_id' = p_engagement_id::text
$$;

-- ---------------------------------------------------------------------------
-- 3. engagement_certificates — one row per issued certificate. `canonical` is the document; `cert_hash`
--    is the SHA-256 of its canonical JSON, computed IN THE DATABASE. `version` increments per
--    engagement. `status` is valid / superseded / revoked.
-- ---------------------------------------------------------------------------
create table if not exists engagement_certificates (
  id uuid primary key default gen_random_uuid()
);
alter table engagement_certificates add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table engagement_certificates add column if not exists engagement_id uuid;
alter table engagement_certificates add column if not exists version int not null default 1;
alter table engagement_certificates add column if not exists canonical jsonb not null default '{}'::jsonb;
alter table engagement_certificates add column if not exists cert_hash text;
alter table engagement_certificates add column if not exists status text not null default 'valid';
alter table engagement_certificates add column if not exists issued_by uuid;
alter table engagement_certificates add column if not exists issued_at timestamptz not null default now();
alter table engagement_certificates add column if not exists revoked_by uuid;
alter table engagement_certificates add column if not exists revoked_at timestamptz;
alter table engagement_certificates add column if not exists revoke_reason text;
alter table engagement_certificates add column if not exists ledger_entry_id uuid;
create index if not exists engagement_certificates_org_idx on engagement_certificates (org_id);
create index if not exists engagement_certificates_eng_idx on engagement_certificates (engagement_id, version);

-- The FK to orgs makes `truncate orgs cascade` (the SQL-test reset) reach these tables, so a test run
-- leaves no residue (M5) and version numbering starts clean. Dropped and re-added so the migration is
-- safe to re-apply (M2).
alter table certificate_config drop constraint if exists certificate_config_org_fk;
alter table certificate_config add constraint certificate_config_org_fk
  foreign key (org_id) references orgs(id) on delete cascade;
alter table engagement_certificates drop constraint if exists engagement_certificates_org_fk;
alter table engagement_certificates add constraint engagement_certificates_org_fk
  foreign key (org_id) references orgs(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 4. verify_attempts — the rate-limit counter for the two anonymous functions. No IP is stored; a
--    row is a bucket of attempts for one minute. Purged by the hourly sweep.
-- ---------------------------------------------------------------------------
create table if not exists verify_attempts (
  id uuid primary key default gen_random_uuid()
);
alter table verify_attempts add column if not exists bucket text not null default '';
alter table verify_attempts add column if not exists attempt_id uuid;
alter table verify_attempts add column if not exists attempted_at timestamptz not null default now();
create index if not exists verify_attempts_bucket_idx on verify_attempts (bucket, attempted_at);
create index if not exists verify_attempts_attempt_idx on verify_attempts (attempt_id, attempted_at);

-- ---------------------------------------------------------------------------
-- 5. certificate_config_get / certificate_config_save — the Org Admin edits the field list visually.
-- ---------------------------------------------------------------------------
create or replace function public.certificate_config_get(p_org uuid)
returns table (field_key text, label text, ordinal int, enabled boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or p_org = public.jwt_org_id()) then
    raise exception 'not allowed: the organisation is not the caller''s' using errcode = 'P0001';
  end if;
  perform public.certificate_config_seed(p_org);
  return query
    select c.field_key, c.label, c.ordinal, c.enabled
      from certificate_config c where c.org_id = p_org order by c.ordinal;
end $$;

create or replace function public.certificate_config_save(p_org uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  f jsonb;
  i int := 0;
begin
  if not public.config_actor_ok(p_org, 'edit_config') then
    raise exception 'not allowed: the caller cannot edit the certificate configuration' using errcode = 'P0001';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'certificate_config_save: fields must be an array' using errcode = 'P0001';
  end if;
  perform public.certificate_config_seed(p_org);
  for f in select * from jsonb_array_elements(p_fields) loop
    i := i + 1;
    update certificate_config
       set ordinal = i,
           enabled = coalesce((f ->> 'enabled')::boolean, enabled)
     where org_id = p_org and field_key = (f ->> 'field_key');
  end loop;
  perform public.append_ledger_entry(p_org, 'certificate_config_saved',
    jsonb_build_object('fields', p_fields), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 6. certificate_issue(p_engagement_id, p_extra) — issue a certificate. Requires manage_engagements
--    and the `certificates` entitlement. The engagement must be sealed. Writes a ledger entry
--    (certificate_issued, F20).
-- ---------------------------------------------------------------------------
create or replace function public.certificate_issue(p_engagement_id uuid, p_extra jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_title text;
  v_sealed boolean;
  v_wp int;
  v_findings int;
  v_actors jsonb;
  v_root text;
  v_version int;
  v_doc jsonb;
  v_hash text;
  v_id uuid;
  v_ledger uuid;
begin
  select e.org_id, e.title, e.sealed into v_org, v_title, v_sealed
    from engagements e where e.id = p_engagement_id;
  if v_org is null then
    raise exception 'certificate_issue: engagement % not found', p_engagement_id using errcode = 'P0001';
  end if;
  if not public.caller_has_right('manage_engagements') then
    raise exception 'not allowed: the caller cannot issue a certificate' using errcode = 'P0001';
  end if;
  if not public.has_feature(v_org, 'certificates') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if not v_sealed then
    raise exception 'certificate_issue: the engagement is not sealed' using errcode = 'P0001';
  end if;

  select count(*) into v_wp from workpapers where engagement_id = p_engagement_id;
  -- Findings carry no engagement_id; they reach the engagement through their observation.
  select count(*) into v_findings
    from findings f join observations o on o.id = f.observation_id
   where o.engagement_id = p_engagement_id;
  select coalesce(jsonb_agg(distinct e.actor_id), '[]'::jsonb) into v_actors
    from ledger_entries e
   where e.org_id = v_org and e.payload ->> 'engagement_id' = p_engagement_id::text
     and e.actor_id is not null;
  v_root := public.engagement_root_hash(p_engagement_id);

  select coalesce(max(c.version), 0) + 1 into v_version
    from engagement_certificates c where c.engagement_id = p_engagement_id;

  v_doc := jsonb_build_object(
    'engagement_id', p_engagement_id,
    'engagement_title', v_title,
    'organisation_id', v_org,
    'engagement_root_hash', v_root,
    'version', v_version,
    'issued_at', to_jsonb(now()),
    'sealed_workpapers', v_wp,
    'findings_count', v_findings,
    'sealing_actors', v_actors,
    'extra', coalesce(p_extra, '{}'::jsonb)
  );
  v_hash := public.ledger_payload_hash(public.canonical_payload(v_doc));

  insert into engagement_certificates (org_id, engagement_id, version, canonical, cert_hash, status, issued_by)
  values (v_org, p_engagement_id, v_version, v_doc, v_hash, 'valid', auth.uid())
  returning id into v_id;

  v_ledger := (public.append_ledger_entry(v_org, 'certificate_issued',
    jsonb_build_object('certificate_id', v_id, 'engagement_id', p_engagement_id, 'version', v_version,
                       'cert_hash', v_hash, 'engagement_root_hash', v_root), auth.uid())).id;

  update engagement_certificates set ledger_entry_id = v_ledger where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. certificate_revoke(p_certificate_id, p_reason) — revoke with a reason. Requires can_reopen.
--    Writes a ledger entry (certificate_revoked, F20).
-- ---------------------------------------------------------------------------
create or replace function public.certificate_revoke(p_certificate_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select c.org_id into v_org from engagement_certificates c where c.id = p_certificate_id;
  if v_org is null then
    raise exception 'certificate_revoke: certificate % not found', p_certificate_id using errcode = 'P0001';
  end if;
  if not public.caller_has_right('can_reopen') then
    raise exception 'not allowed: the caller cannot revoke a certificate' using errcode = 'P0001';
  end if;
  if length(v_reason) < 5 then
    raise exception 'certificate_revoke: a reason is required' using errcode = 'P0001';
  end if;

  update engagement_certificates
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = v_reason
   where id = p_certificate_id;

  perform public.append_ledger_entry(v_org, 'certificate_revoked',
    jsonb_build_object('certificate_id', p_certificate_id, 'reason', v_reason), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 8. Reopening a sealed engagement supersedes its certificates. A trigger on engagements marks every
--    valid certificate for that engagement superseded when sealed flips true -> false.
-- ---------------------------------------------------------------------------
create or replace function public.supersede_certificates_on_reopen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.sealed and not new.sealed then
    update engagement_certificates
       set status = 'superseded'
     where engagement_id = new.id and status = 'valid';
  end if;
  return new;
end $$;

drop trigger if exists engagements_supersede_certificates on engagements;
create trigger engagements_supersede_certificates after update on engagements
  for each row execute function public.supersede_certificates_on_reopen();

-- ---------------------------------------------------------------------------
-- 9. certificate_list(p_org) / certificate_get(p_certificate_id) — the panels read these.
-- ---------------------------------------------------------------------------
create or replace function public.certificate_list(p_org uuid)
returns table (
  id uuid, engagement_id uuid, version int, cert_hash text, status text,
  issued_by uuid, issued_at timestamptz, revoked_at timestamptz, revoke_reason text
)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or p_org = public.jwt_org_id()) then
    raise exception 'not allowed: the organisation is not the caller''s' using errcode = 'P0001';
  end if;
  return query
    select c.id, c.engagement_id, c.version, c.cert_hash, c.status,
           c.issued_by, c.issued_at, c.revoked_at, c.revoke_reason
      from engagement_certificates c where c.org_id = p_org order by c.issued_at desc;
end $$;

create or replace function public.certificate_get(p_certificate_id uuid)
returns table (
  id uuid, engagement_id uuid, version int, canonical jsonb, cert_hash text, status text,
  issued_by uuid, issued_at timestamptz, revoked_at timestamptz, revoke_reason text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.engagement_id, c.version, c.canonical, c.cert_hash, c.status,
         c.issued_by, c.issued_at, c.revoked_at, c.revoke_reason
    from engagement_certificates c
   where c.id = p_certificate_id
     and (public.is_platform_admin() or c.org_id = public.jwt_org_id())
$$;

-- ---------------------------------------------------------------------------
-- 10. The anonymous verification surface. Exactly two functions are granted to anon. Both are
--     security definer, return only status / issued_at / hash / counts, and never expose a table to
--     anon. Rate limit: 60 attempts per minute globally, 20 per id per minute (F11).
-- ---------------------------------------------------------------------------
create or replace function public.verify_rate_ok(p_scope text, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_global int;
  v_per_id int;
begin
  delete from verify_attempts where attempted_at < now() - interval '10 minutes';
  select count(*) into v_global from verify_attempts where attempted_at > now() - interval '1 minute';
  select count(*) into v_per_id from verify_attempts
   where attempt_id = p_id and attempted_at > now() - interval '1 minute';
  if v_global >= 60 or v_per_id >= 20 then
    return false;
  end if;
  insert into verify_attempts (bucket, attempt_id) values (p_scope, p_id);
  return true;
end $$;

create or replace function public.verify_certificate(p_id uuid)
returns table (status text, issued_at timestamptz, cert_hash text, sealed_workpapers int,
               findings_count int, organisation text, engagement_title text)
language plpgsql security definer set search_path = public as $$
declare
  v_row engagement_certificates;
  v_show boolean;
begin
  if not public.verify_rate_ok('certificate', p_id) then
    return query select 'rate_limited'::text, null::timestamptz, null::text, null::int, null::int,
                        null::text, null::text;
    return;
  end if;
  select c.* into v_row from engagement_certificates c where c.id = p_id;
  if not found then
    return query select 'not_found'::text, null::timestamptz, null::text, null::int, null::int,
                        null::text, null::text;
    return;
  end if;
  select coalesce(e.public_verify_show_title, false) into v_show
    from org_settings_extra e where e.org_id = v_row.org_id;
  return query select
    v_row.status,
    v_row.issued_at,
    v_row.cert_hash,
    (v_row.canonical ->> 'sealed_workpapers')::int,
    (v_row.canonical ->> 'findings_count')::int,
    case when coalesce(v_show, false) then (select o.name from orgs o where o.id = v_row.org_id) end,
    case when coalesce(v_show, false) then (v_row.canonical ->> 'engagement_title') end;
end $$;

create or replace function public.verify_board_pack(p_id uuid)
returns table (status text, issued_at timestamptz, data_hash text, organisation text)
language plpgsql security definer set search_path = public as $$
declare
  v_row board_pack_history;
  v_show boolean;
begin
  if not public.verify_rate_ok('board_pack', p_id) then
    return query select 'rate_limited'::text, null::timestamptz, null::text, null::text;
    return;
  end if;
  select h.* into v_row from board_pack_history h where h.id = p_id;
  if not found then
    return query select 'not_found'::text, null::timestamptz, null::text, null::text;
    return;
  end if;
  if not public.has_feature(v_row.org_id, 'public_verification') then
    return query select 'not_found'::text, null::timestamptz, null::text, null::text;
    return;
  end if;
  select coalesce(e.public_verify_show_title, false) into v_show
    from org_settings_extra e where e.org_id = v_row.org_id;
  return query select
    v_row.status, v_row.generated_at, v_row.data_hash,
    case when coalesce(v_show, false) then (select o.name from orgs o where o.id = v_row.org_id) end;
end $$;

-- ---------------------------------------------------------------------------
-- 11. RLS: every table has RLS enabled. No write policy; every write goes through the RPCs above.
--     verify_attempts and engagement_certificates are read only by their RPCs; no direct read policy
--     for verify_attempts (the anonymous function is security definer).
-- ---------------------------------------------------------------------------
alter table certificate_config enable row level security;
alter table engagement_certificates enable row level security;
alter table verify_attempts enable row level security;

drop policy if exists certificate_config_select on certificate_config;
create policy certificate_config_select on certificate_config for select to authenticated
  using (org_id = public.jwt_org_id());

drop policy if exists engagement_certificates_select on engagement_certificates;
create policy engagement_certificates_select on engagement_certificates for select to authenticated
  using (org_id = public.jwt_org_id());

-- ---------------------------------------------------------------------------
-- 12. Grants. The two anonymous functions are the ONLY execute grants to anon in this migration.
-- ---------------------------------------------------------------------------
grant select on public.certificate_config to authenticated;
grant select on public.engagement_certificates to authenticated;

do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'certificate_config_seed','certificate_config_get','certificate_config_save',
      'engagement_root_hash','certificate_issue','certificate_revoke','certificate_list','certificate_get',
      'supersede_certificates_on_reopen','verify_rate_ok'
    )
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

revoke execute on function public.verify_certificate(uuid) from public;
revoke execute on function public.verify_certificate(uuid) from authenticated;
grant execute on function public.verify_certificate(uuid) to anon, authenticated, service_role;

revoke execute on function public.verify_board_pack(uuid) from public;
revoke execute on function public.verify_board_pack(uuid) from authenticated;
grant execute on function public.verify_board_pack(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. Close the anonymous surface. F11 requires the functions callable by role anon to be EXACTLY
--     verify_certificate and verify_board_pack. Functions created without an explicit ACL carry the
--     default EXECUTE to PUBLIC, which anon inherits, so anon could otherwise reach internal helpers
--     and even append_ledger_entry. For every other function in the public schema, first preserve the
--     access authenticated and service_role already have (re-granted explicitly), then revoke the
--     PUBLIC and anon grants. Trigger execution does not check EXECUTE, so triggers are unaffected.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
  r text;
begin
  for fn in
    select p.oid, p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    where n.nspname = 'public'
      and d.objid is null
      and p.prokind = 'f'
      and p.proname not in ('verify_certificate', 'verify_board_pack')
  loop
    -- Re-grant explicitly to every application role that can reach the function today. Access
    -- inherited from PUBLIC would otherwise disappear when PUBLIC is revoked below. Trigger
    -- execution does not check EXECUTE, so trigger functions keep firing either way.
    foreach r in array array['authenticated', 'service_role', 'supabase_auth_admin'] loop
      if exists (select 1 from pg_roles where rolname = r)
         and has_function_privilege(r, fn.oid, 'execute') then
        execute format('grant execute on function public.%I(%s) to %I', fn.name, fn.args, r);
      end if;
    end loop;
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
  end loop;

  -- Extension members (dblink and friends) also need their anon grant closed. The hosted project
  -- sets default privileges that grant EXECUTE explicitly to anon at creation time, so these carry a
  -- real anon grant that test 72 sees. The migration role may not own an extension member, so this is
  -- best-effort: a refusal here cannot widen the anonymous surface, it only leaves it unchanged.
  for fn in
    select p.oid, p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    begin
      execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    exception when insufficient_privilege then
      null;  -- not the owner of the extension member; nothing we are permitted to change
    end;
  end loop;
end $$;
