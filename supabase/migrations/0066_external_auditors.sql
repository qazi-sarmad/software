-- 0066: External Auditor Portal (S9, F13).
--
-- An external auditor is a SEPARATE principal type, not an org role: the closed rights list (F3)
-- is unchanged. Such a user has an auth account, carries user_role = 'external_auditor' and an
-- org_id claim stamped by the access-token hook (0010, extended here), and is NOT an org_members
-- row. RLS on every business table already excludes them: those policies key on jwt_org_id() plus a
-- role right or a scope, and an external auditor has neither a role in `roles` nor a user_scopes row.
--
-- They reach data ONLY through SECURITY DEFINER functions prefixed `ext_`. Every ext_ function:
--   1. calls public.external_actor_ok() — the caller must be an external_auditor with an ACTIVE,
--      UNEXPIRED grant for the target engagement (or, for the portal home, for the org);
--   2. returns only the permitted fields;
--   3. writes external_access_log before it returns.
-- There is NO ext_ write RPC. Test 75 enumerates every ext_ function and proves none performs a
-- write, and proves an external auditor reads zero rows from every business table.
--
-- M1: grepped supabase/migrations and supabase/tests for external_auditor_invites, external_auditor_access,
--     external_auditor_grants, external_access_log, external_actor_ok, is_external_auditor, ext_*; none
--     existed. auth_invites (0057) is reused for the invite (kind = 'external_auditor'); the auth hook
--     custom_access_token_hook (0010) is extended, not replaced with a different body (M4).
-- M2: create table if not exists + add column if not exists; create or replace; drop trigger/policy if
--     exists before create; create index if not exists. Safe to apply repeatedly.
-- M3: auth_invites already exists with its 0057 shape; the external-auditor columns are added below.

-- ---------------------------------------------------------------------------
-- 1. external_auditor_invites — a single-use invitation for an external auditor. Only the token hash
--    is stored (never the token), exactly as auth_invites (0057). kind is 'external_auditor'.
--    expiry_kind is time_boxed | permanent.
-- ---------------------------------------------------------------------------
create table if not exists external_auditor_invites (
  id uuid primary key default gen_random_uuid()
);
alter table external_auditor_invites add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table external_auditor_invites add column if not exists email text;
alter table external_auditor_invites add column if not exists token_hash text;
alter table external_auditor_invites add column if not exists expiry_kind text not null default 'time_boxed';
alter table external_auditor_invites add column if not exists access_days int;
alter table external_auditor_invites add column if not exists engagement_ids uuid[] not null default '{}';
alter table external_auditor_invites add column if not exists invited_by uuid;
alter table external_auditor_invites add column if not exists expires_at timestamptz not null default (now() + interval '30 days');
alter table external_auditor_invites add column if not exists accepted_at timestamptz;
alter table external_auditor_invites add column if not exists accepted_by uuid;
alter table external_auditor_invites add column if not exists revoked_at timestamptz;
alter table external_auditor_invites add column if not exists created_at timestamptz not null default now();
create index if not exists external_auditor_invites_token_idx on external_auditor_invites (token_hash);
create index if not exists external_auditor_invites_org_idx on external_auditor_invites (org_id, created_at desc);

alter table external_auditor_invites enable row level security;

-- The Org Admin sees its own invitations; the platform admin sees them. No write policy: rows enter
-- through external_auditor_invite and change through external_auditor_accept.
drop policy if exists external_auditor_invites_org_select on external_auditor_invites;
create policy external_auditor_invites_org_select on external_auditor_invites for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

revoke insert, update, delete on public.external_auditor_invites from public, anon, authenticated;

alter table external_auditor_invites drop constraint if exists external_auditor_invites_org_fk;
alter table external_auditor_invites add constraint external_auditor_invites_org_fk
  foreign key (org_id) references orgs(id) on delete cascade;

drop trigger if exists external_auditor_invites_pin_org on external_auditor_invites;
create trigger external_auditor_invites_pin_org before insert on external_auditor_invites
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 2. external_auditor_access — one row per external auditor account bound to an org. `active` is the
--    account-level switch; the per-engagement permissions live in external_auditor_grants.
-- ---------------------------------------------------------------------------
create table if not exists external_auditor_access (
  id uuid primary key default gen_random_uuid()
);
alter table external_auditor_access add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table external_auditor_access add column if not exists user_id uuid;
alter table external_auditor_access add column if not exists email text;
alter table external_auditor_access add column if not exists active boolean not null default true;
alter table external_auditor_access add column if not exists created_at timestamptz not null default now();
alter table external_auditor_access add column if not exists revoked_at timestamptz;
create unique index if not exists external_auditor_access_user_idx on external_auditor_access (org_id, user_id);
create index if not exists external_auditor_access_org_idx on external_auditor_access (org_id);

alter table external_auditor_access enable row level security;

drop policy if exists external_auditor_access_org_select on external_auditor_access;
create policy external_auditor_access_org_select on external_auditor_access for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

revoke insert, update, delete on public.external_auditor_access from public, anon, authenticated;

alter table external_auditor_access drop constraint if exists external_auditor_access_org_fk;
alter table external_auditor_access add constraint external_auditor_access_org_fk
  foreign key (org_id) references orgs(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 3. external_auditor_grants — per engagement, per permission. expires_at null = permanent.
--    A revoked or expired grant stops access immediately (test 75).
-- ---------------------------------------------------------------------------
create table if not exists external_auditor_grants (
  id uuid primary key default gen_random_uuid()
);
alter table external_auditor_grants add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table external_auditor_grants add column if not exists user_id uuid;
alter table external_auditor_grants add column if not exists engagement_id uuid;
alter table external_auditor_grants add column if not exists can_view_summary boolean not null default true;
alter table external_auditor_grants add column if not exists can_download_pack boolean not null default false;
alter table external_auditor_grants add column if not exists can_download_certificate boolean not null default false;
alter table external_auditor_grants add column if not exists can_verify boolean not null default true;
alter table external_auditor_grants add column if not exists expires_at timestamptz;
alter table external_auditor_grants add column if not exists revoked_at timestamptz;
alter table external_auditor_grants add column if not exists granted_by uuid;
alter table external_auditor_grants add column if not exists granted_at timestamptz not null default now();
create unique index if not exists external_auditor_grants_key_idx on external_auditor_grants (org_id, user_id, engagement_id);
create index if not exists external_auditor_grants_user_idx on external_auditor_grants (user_id, engagement_id);

alter table external_auditor_grants enable row level security;

drop policy if exists external_auditor_grants_org_select on external_auditor_grants;
create policy external_auditor_grants_org_select on external_auditor_grants for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

revoke insert, update, delete on public.external_auditor_grants from public, anon, authenticated;

alter table external_auditor_grants drop constraint if exists external_auditor_grants_org_fk;
alter table external_auditor_grants add constraint external_auditor_grants_org_fk
  foreign key (org_id) references orgs(id) on delete cascade;
alter table external_auditor_grants drop constraint if exists external_auditor_grants_eng_fk;
alter table external_auditor_grants add constraint external_auditor_grants_eng_fk
  foreign key (engagement_id) references engagements(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 4. external_access_log — every ext_ call. Append-only; no update or delete policy.
-- ---------------------------------------------------------------------------
create table if not exists external_access_log (
  id uuid primary key default gen_random_uuid()
);
alter table external_access_log add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table external_access_log add column if not exists user_id uuid;
alter table external_access_log add column if not exists engagement_id uuid;
alter table external_access_log add column if not exists function_name text;
alter table external_access_log add column if not exists outcome text not null default 'ok';
alter table external_access_log add column if not exists detail jsonb not null default '{}'::jsonb;
alter table external_access_log add column if not exists ts timestamptz not null default now();
create index if not exists external_access_log_org_idx on external_access_log (org_id, ts desc);
create index if not exists external_access_log_user_idx on external_access_log (user_id, ts desc);

alter table external_access_log enable row level security;

-- The Org Admin sees its own org's access log; the external auditor sees its own rows.
drop policy if exists external_access_log_org_select on external_access_log;
create policy external_access_log_org_select on external_access_log for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

revoke insert, update, delete on public.external_access_log from public, anon, authenticated;

alter table external_access_log drop constraint if exists external_access_log_org_fk;
alter table external_access_log add constraint external_access_log_org_fk
  foreign key (org_id) references orgs(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 5. is_external_auditor / external_actor_ok — the gate every ext_ function calls.
--    A platform admin is NEVER an external actor and can never be granted one of these rows.
-- ---------------------------------------------------------------------------
create or replace function public.is_external_auditor() returns boolean
language sql stable as $$ select public.jwt_user_role() = 'external_auditor' $$;

-- external_actor_ok(p_org, p_engagement_id):
--   true when the caller is an external_auditor with an ACTIVE account for p_org and, when an
--   engagement is named, an ACTIVE (unrevoked, unexpired) grant for that engagement.
create or replace function public.external_actor_ok(p_org uuid, p_engagement_id uuid default null)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_active boolean;
begin
  if v_user is null or not public.is_external_auditor() then
    return false;
  end if;
  if p_org is null or p_org <> public.jwt_org_id() then
    return false;
  end if;
  select a.active into v_active
    from external_auditor_access a
   where a.org_id = p_org and a.user_id = v_user and a.revoked_at is null;
  if v_active is distinct from true then
    return false;
  end if;
  if p_engagement_id is null then
    return true;
  end if;
  return exists (
    select 1 from external_auditor_grants g
     where g.org_id = p_org and g.user_id = v_user and g.engagement_id = p_engagement_id
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
  );
end $$;

-- The permission variant: the caller must hold a specific permission on the engagement.
create or replace function public.external_has_permission(p_engagement_id uuid, p_permission text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_org uuid := public.jwt_org_id();
  v_grant external_auditor_grants;
begin
  if v_user is null or not public.is_external_auditor() or v_org is null then
    return false;
  end if;
  select * into v_grant from external_auditor_grants g
   where g.org_id = v_org and g.user_id = v_user and g.engagement_id = p_engagement_id
     and g.revoked_at is null and (g.expires_at is null or g.expires_at > now());
  if not found then
    return false;
  end if;
  return case p_permission
    when 'view_summary' then v_grant.can_view_summary
    when 'download_pack' then v_grant.can_download_pack
    when 'download_certificate' then v_grant.can_download_certificate
    when 'verify' then v_grant.can_verify
    else false end;
end $$;

-- ---------------------------------------------------------------------------
-- 6. external_auditor_invite — the Org Admin invites by email (edit_config). Records a single-use
--    invite with a hashed token, and queues the acceptance email (F6). Writes a config-history entry.
-- ---------------------------------------------------------------------------
create or replace function public.external_auditor_invite(
  p_email text,
  p_engagement_ids uuid[] default '{}',
  p_expiry_kind text default 'time_boxed',
  p_access_days int default 30
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_caller uuid := auth.uid();
  v_token text;
  v_id uuid;
  v_days int := coalesce(p_access_days, 30);
  v_kind text := coalesce(p_expiry_kind, 'time_boxed');
  v_queue_id uuid;
begin
  if v_org is null or v_caller is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not public.caller_has_right('edit_config') then
    raise exception 'not allowed: the caller cannot invite external auditors' using errcode = 'P0001';
  end if;
  if not public.has_feature(v_org, 'external_auditors') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if p_email is null or position('@' in p_email) <= 1 then
    raise exception 'invalid email address' using errcode = 'P0001';
  end if;
  if v_kind not in ('time_boxed', 'permanent') then
    raise exception 'expiry_kind must be time_boxed or permanent' using errcode = 'P0001';
  end if;
  if v_kind = 'time_boxed' and (v_days < 1 or v_days > 365) then
    raise exception 'access_days must be between 1 and 365' using errcode = 'P0001';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into external_auditor_invites
    (org_id, email, token_hash, expiry_kind, access_days, engagement_ids, invited_by,
     expires_at)
  values (v_org, lower(p_email), encode(extensions.digest(v_token, 'sha256'), 'hex'),
          v_kind, case when v_kind = 'permanent' then null else v_days end,
          coalesce(p_engagement_ids, '{}'), v_caller, now() + interval '7 days')
  returning id into v_id;

  v_queue_id := public.queue_email(
    v_org, array[lower(p_email)], 'You have been invited to view an engagement', null,
    'You have been invited to view engagement material in Provio as an external auditor. Open this '
    || 'link to accept the invitation and set your password: ' || '/external/accept?token=' || v_token
    || E'\n\nThis link is valid for 7 days and can be used once.',
    jsonb_build_object('kind', 'external_auditor_invitation', 'email', lower(p_email),
                       'invite_id', v_id));

  perform public.admin_log_change(v_org, 'external_auditor_invite:' || v_id::text,
    jsonb_build_object('email', lower(p_email), 'expiry_kind', v_kind, 'access_days',
                       case when v_kind = 'permanent' then null else v_days end,
                       'engagement_ids', to_jsonb(coalesce(p_engagement_ids, '{}')), 'queue_id', v_queue_id),
    'external_auditor_invited', 'external_auditor_invite', v_id);

  perform public.append_ledger_entry(v_org, 'external_access_granted',
    jsonb_build_object('invite_id', v_id, 'email', lower(p_email), 'expiry_kind', v_kind), v_caller);

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. external_auditor_accept — the one function that turns an invite token into access. Executable
--    by service_role only (see grants), reached from the invite-user Edge Function after the caller's
--    JWT is verified and the auth account is created, exactly as admin_accept_invite (0057).
-- ---------------------------------------------------------------------------
drop function if exists public.external_auditor_accept(text, uuid);

create or replace function public.external_auditor_accept(p_token text, p_user uuid)
returns table (out_org_id uuid, out_email text)
language plpgsql security definer set search_path = public as $$
declare
  v_inv external_auditor_invites;
  v_hash text;
  v_days int;
  v_expires timestamptz;
  v_eng uuid;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'an invitation token is required' using errcode = 'P0001';
  end if;
  if p_user is null then
    raise exception 'a user id is required' using errcode = 'P0001';
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');
  select * into v_inv from external_auditor_invites i where i.token_hash = v_hash for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0001';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'this invitation has already been used' using errcode = 'P0001';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'this invitation was revoked' using errcode = 'P0001';
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    raise exception 'this invitation has expired' using errcode = 'P0001';
  end if;

  insert into external_auditor_access (org_id, user_id, email, active)
  values (v_inv.org_id, p_user, v_inv.email, true)
  on conflict (org_id, user_id) do update set active = true, revoked_at = null, email = excluded.email;

  -- Time-boxed: every grant expires after access_days. Permanent: expires_at null.
  v_expires := case when v_inv.expiry_kind = 'permanent' then null
                    else now() + make_interval(days => coalesce(v_inv.access_days, 30)) end;

  foreach v_eng in array coalesce(v_inv.engagement_ids, '{}') loop
    insert into external_auditor_grants
      (org_id, user_id, engagement_id, can_view_summary, can_download_pack,
       can_download_certificate, can_verify, expires_at, granted_by)
    values (v_inv.org_id, p_user, v_eng, true, false, false, true, v_expires, v_inv.invited_by)
    on conflict (org_id, user_id, engagement_id) do update
      set revoked_at = null, expires_at = excluded.expires_at;
  end loop;

  update external_auditor_invites
     set accepted_at = now(), accepted_by = p_user
   where id = v_inv.id;

  perform public.admin_log_change(v_inv.org_id, 'external_auditor_invite:' || v_inv.id::text,
    jsonb_build_object('email', v_inv.email, 'user_id', p_user),
    'external_auditor_accepted', 'external_auditor_invite', v_inv.id);

  return query select v_inv.org_id, v_inv.email;
end $$;

-- ---------------------------------------------------------------------------
-- 8. external_auditor_grants_save — the Org Admin edits the per-engagement permission matrix
--    (edit_config). A change writes config history.
-- ---------------------------------------------------------------------------
create or replace function public.external_auditor_grants_save(p_org uuid, p_grants jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  g jsonb;
begin
  if not public.config_actor_ok(p_org, 'edit_config') then
    raise exception 'not allowed: the caller cannot edit external auditor grants' using errcode = 'P0001';
  end if;
  if not public.has_feature(p_org, 'external_auditors') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if p_grants is null or jsonb_typeof(p_grants) <> 'array' then
    raise exception 'external_auditor_grants_save: grants must be an array' using errcode = 'P0001';
  end if;
  for g in select * from jsonb_array_elements(p_grants) loop
    update external_auditor_grants
       set can_view_summary = coalesce((g ->> 'can_view_summary')::boolean, can_view_summary),
           can_download_pack = coalesce((g ->> 'can_download_pack')::boolean, can_download_pack),
           can_download_certificate = coalesce((g ->> 'can_download_certificate')::boolean, can_download_certificate),
           can_verify = coalesce((g ->> 'can_verify')::boolean, can_verify),
           revoked_at = case when coalesce((g ->> 'revoked')::boolean, false) then now() else revoked_at end
     where org_id = p_org and user_id = (g ->> 'user_id')::uuid
       and engagement_id = (g ->> 'engagement_id')::uuid;
  end loop;
  perform public.admin_log_change(p_org, 'external_auditor_grants',
    jsonb_build_object('grants', p_grants), 'external_auditor_grants_saved',
    'external_auditor_grants', null);
end $$;

-- ---------------------------------------------------------------------------
-- 9. external_auditor_revoke — revoke one grant or the whole account (edit_config). Writes a ledger
--    entry (external_access_revoked, F20).
-- ---------------------------------------------------------------------------
create or replace function public.external_auditor_revoke(
  p_org uuid, p_user_id uuid, p_engagement_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.config_actor_ok(p_org, 'edit_config') then
    raise exception 'not allowed: the caller cannot revoke external auditor access' using errcode = 'P0001';
  end if;
  if p_engagement_id is null then
    update external_auditor_access set active = false, revoked_at = now()
     where org_id = p_org and user_id = p_user_id;
    update external_auditor_grants set revoked_at = now()
     where org_id = p_org and user_id = p_user_id and revoked_at is null;
  else
    update external_auditor_grants set revoked_at = now()
     where org_id = p_org and user_id = p_user_id and engagement_id = p_engagement_id and revoked_at is null;
  end if;
  perform public.append_ledger_entry(p_org, 'external_access_revoked',
    jsonb_build_object('user_id', p_user_id, 'engagement_id', p_engagement_id), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 10. The read-only ext_ surface. Each logs to external_access_log and returns permitted fields only.
--     A refusal does NOT raise: it logs outcome = 'denied' and returns no rows. A raise would roll the
--     log insert back (the caller's transaction aborts), so "every call is logged" would be false
--     (D-S9-denial-no-raise). The portal calls ext_me first to learn whether access is active.
-- ---------------------------------------------------------------------------
create or replace function public.ext_list_engagements()
returns table (engagement_id uuid, title text, org_name text, can_download_pack boolean,
               can_download_certificate boolean, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid := auth.uid();
begin
  if not public.external_actor_ok(v_org, null) then
    insert into external_access_log (org_id, user_id, function_name, outcome)
    values (v_org, v_user, 'ext_list_engagements', 'denied');
    return;
  end if;
  insert into external_access_log (org_id, user_id, function_name, outcome)
  values (v_org, v_user, 'ext_list_engagements', 'ok');
  return query
    select g.engagement_id, e.title, o.name, g.can_download_pack, g.can_download_certificate, g.expires_at
      from external_auditor_grants g
      join engagements e on e.id = g.engagement_id
      join orgs o on o.id = g.org_id
     where g.org_id = v_org and g.user_id = v_user
       and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
     order by e.title;
end $$;

create or replace function public.ext_engagement_summary(p_engagement_id uuid)
returns table (engagement_id uuid, title text, org_name text, stage text, sealed boolean,
               sealed_workpapers int, findings_count int)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid := auth.uid();
begin
  if not public.external_actor_ok(v_org, p_engagement_id)
     or not public.external_has_permission(p_engagement_id, 'view_summary') then
    insert into external_access_log (org_id, user_id, engagement_id, function_name, outcome)
    values (v_org, v_user, p_engagement_id, 'ext_engagement_summary', 'denied');
    return;
  end if;
  insert into external_access_log (org_id, user_id, engagement_id, function_name, outcome)
  values (v_org, v_user, p_engagement_id, 'ext_engagement_summary', 'ok');
  return query
    select e.id, e.title, o.name, e.stage, e.sealed,
           (select count(*)::int from workpapers w where w.engagement_id = e.id),
           (select count(*)::int from findings f join observations ob on ob.id = f.observation_id
             where ob.engagement_id = e.id)
      from engagements e join orgs o on o.id = e.org_id
     where e.id = p_engagement_id;
end $$;

-- Download the latest Board Pack data_hash for a granted engagement. board_pack_history has no
-- engagement_id column: a pack is scoped by a free-text scope_key (0061). The pack that covers an
-- engagement is therefore the latest successful pack whose scope_key is the engagement id, or whose
-- snapshot names the engagement among its figure refs. Only the id and hash are returned; the file is
-- rendered in the browser. Decision D-S9-board-pack-scope.
create or replace function public.ext_latest_board_pack(p_engagement_id uuid)
returns table (pack_id uuid, data_hash text, generated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid := auth.uid();
begin
  if not public.external_actor_ok(v_org, p_engagement_id)
     or not public.external_has_permission(p_engagement_id, 'download_pack') then
    insert into external_access_log (org_id, user_id, engagement_id, function_name, outcome)
    values (v_org, v_user, p_engagement_id, 'ext_latest_board_pack', 'denied');
    return;
  end if;
  insert into external_access_log (org_id, user_id, engagement_id, function_name, outcome)
  values (v_org, v_user, p_engagement_id, 'ext_latest_board_pack', 'ok');
  return query
    select h.id, h.data_hash, h.generated_at
      from board_pack_history h
     where h.org_id = v_org and h.status = 'ready'
       and (h.scope_key = p_engagement_id::text or h.snapshot::text like '%' || p_engagement_id::text || '%')
     order by h.generated_at desc limit 1;
end $$;

create or replace function public.ext_latest_certificate(p_engagement_id uuid)
returns table (certificate_id uuid, cert_hash text, status text, issued_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid := auth.uid();
begin
  if not public.external_actor_ok(v_org, p_engagement_id)
     or not public.external_has_permission(p_engagement_id, 'download_certificate') then
    insert into external_access_log (org_id, user_id, engagement_id, function_name, outcome)
    values (v_org, v_user, p_engagement_id, 'ext_latest_certificate', 'denied');
    return;
  end if;
  insert into external_access_log (org_id, user_id, engagement_id, function_name, outcome)
  values (v_org, v_user, p_engagement_id, 'ext_latest_certificate', 'ok');
  return query
    select c.id, c.cert_hash, c.status, c.issued_at
      from engagement_certificates c
     where c.org_id = v_org and c.engagement_id = p_engagement_id
     order by c.issued_at desc limit 1;
end $$;

-- Hash verification. Returns only the stored hash for a certificate the auditor may verify.
create or replace function public.ext_verify_certificate(p_certificate_id uuid)
returns table (status text, cert_hash text, issued_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid := auth.uid();
  v_cert engagement_certificates;
begin
  select * into v_cert from engagement_certificates c where c.id = p_certificate_id;
  if not found or v_cert.org_id <> v_org then
    insert into external_access_log (org_id, user_id, function_name, outcome)
    values (v_org, v_user, 'ext_verify_certificate', 'not_found');
    return query select 'not_found'::text, null::text, null::timestamptz;
    return;
  end if;
  if not public.external_actor_ok(v_org, v_cert.engagement_id)
     or not public.external_has_permission(v_cert.engagement_id, 'verify') then
    insert into external_access_log (org_id, user_id, engagement_id, function_name, outcome)
    values (v_org, v_user, v_cert.engagement_id, 'ext_verify_certificate', 'denied');
    return;
  end if;
  insert into external_access_log (org_id, user_id, engagement_id, function_name, outcome)
  values (v_org, v_user, v_cert.engagement_id, 'ext_verify_certificate', 'ok');
  return query select v_cert.status, v_cert.cert_hash, v_cert.issued_at;
end $$;

-- The auditor's own account state, for the portal header. Read-only.
create or replace function public.ext_me()
returns table (email text, org_name text, active boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid := auth.uid();
begin
  if not public.external_actor_ok(v_org, null) then
    insert into external_access_log (org_id, user_id, function_name, outcome)
    values (v_org, v_user, 'ext_me', 'denied');
    return;
  end if;
  insert into external_access_log (org_id, user_id, function_name, outcome)
  values (v_org, v_user, 'ext_me', 'ok');
  return query
    select a.email, o.name, a.active
      from external_auditor_access a join orgs o on o.id = a.org_id
     where a.org_id = v_org and a.user_id = v_user;
end $$;

-- ---------------------------------------------------------------------------
-- 11. The Org Admin's read of the access log and the grant list (OA-14). These are NOT ext_ functions
--     (they run for a tenant admin) and they are read-only.
-- ---------------------------------------------------------------------------
create or replace function public.external_auditor_list(p_org uuid)
returns table (user_id uuid, email text, active boolean, engagement_id uuid, title text,
               can_view_summary boolean, can_download_pack boolean, can_download_certificate boolean,
               can_verify boolean, expires_at timestamptz, revoked_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or p_org = public.jwt_org_id()) then
    raise exception 'not allowed: the organisation is not the caller''s' using errcode = 'P0001';
  end if;
  return query
    select a.user_id, a.email, a.active, g.engagement_id, e.title,
           g.can_view_summary, g.can_download_pack, g.can_download_certificate, g.can_verify,
           g.expires_at, g.revoked_at
      from external_auditor_access a
      left join external_auditor_grants g on g.org_id = a.org_id and g.user_id = a.user_id
      left join engagements e on e.id = g.engagement_id
     where a.org_id = p_org
     order by a.email, e.title;
end $$;

create or replace function public.external_access_log_list(p_org uuid, p_limit int default 100)
returns table (id uuid, user_id uuid, engagement_id uuid, function_name text, outcome text,
               detail jsonb, ts timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or p_org = public.jwt_org_id()) then
    raise exception 'not allowed: the organisation is not the caller''s' using errcode = 'P0001';
  end if;
  return query
    select l.id, l.user_id, l.engagement_id, l.function_name, l.outcome, l.detail, l.ts
      from external_access_log l where l.org_id = p_org
     order by l.ts desc limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

-- ---------------------------------------------------------------------------
-- 12. The access-token hook stamps user_role = 'external_auditor' and org_id for such users. The hook
--     body is extended in place (create or replace, same signature) so a user with an active external
--     access row but no org_members row still receives the two claims (M4: same signature, same body
--     plus one branch).
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_org_id uuid;
  v_slug text;
  v_platform boolean;
  v_ext_org uuid;
begin
  -- Strip any pre-existing values first, so a stale or forged claim cannot survive.
  v_claims := coalesce(event -> 'claims', '{}'::jsonb) - 'org_id' - 'user_role';

  select m.org_id, r.slug
    into v_org_id, v_slug
  from org_members m
  join roles r on r.id = m.role_id
  where m.user_id = v_user_id
  order by m.created_at asc
  limit 1;

  if v_org_id is not null then
    v_claims := jsonb_set(v_claims, '{org_id}', to_jsonb(v_org_id::text), true);
    v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_slug), true);
  else
    -- An external auditor: an active external_auditor_access row and no org_members row.
    select a.org_id into v_ext_org
      from external_auditor_access a
     where a.user_id = v_user_id and a.active and a.revoked_at is null
     order by a.created_at asc
     limit 1;
    if v_ext_org is not null then
      v_claims := jsonb_set(v_claims, '{org_id}', to_jsonb(v_ext_org::text), true);
      v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb('external_auditor'::text), true);
    else
      select exists (select 1 from platform_admins p where p.user_id = v_user_id) into v_platform;
      if v_platform then
        -- Platform staff carry no org and no tenant role.
        v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb('platform_admin'::text), true);
      end if;
    end if;
  end if;

  return jsonb_set(event, '{claims}', v_claims, true);
end $$;

-- The hook reads external_auditor_access, so the auth role needs select on it.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant select on public.external_auditor_access to supabase_auth_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 14. Tighten the identity/metadata and a few org-only content policies so an external auditor reads
--     no row at all from them. Several policies (0008, 0030, 0055) key only on jwt_org_id(), so an
--     external auditor — who carries an org_id claim — would otherwise see those rows. F13 requires
--     RLS on every table to exclude them; the portal reads what it needs through ext_* (SECURITY
--     DEFINER), so nothing in the portal needs a direct read. Only the external_auditor role is
--     affected; every other role keeps the existing behaviour (D-S9-metadata).
-- ---------------------------------------------------------------------------
drop policy if exists roles_select on roles;
create policy roles_select on roles for select to authenticated
  using (org_id = public.jwt_org_id() and not public.is_external_auditor());
drop policy if exists orgs_select_member on orgs;
create policy orgs_select_member on orgs for select to authenticated
  using ((id = public.jwt_org_id() or public.jwt_user_role() = 'platform_admin')
         and not public.is_external_auditor());

drop policy if exists findings_select on findings;
create policy findings_select on findings for select to authenticated
  using (org_id = public.jwt_org_id() and not public.is_external_auditor());
drop policy if exists issues_select on issues;
create policy issues_select on issues for select to authenticated
  using (org_id = public.jwt_org_id() and not public.is_external_auditor());
drop policy if exists cap_items_select on cap_items;
create policy cap_items_select on cap_items for select to authenticated
  using (org_id = public.jwt_org_id() and not public.is_external_auditor());
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated
  using (org_id = public.jwt_org_id() and not public.is_external_auditor());
drop policy if exists severity_levels_select on severity_levels;
create policy severity_levels_select on severity_levels for select to authenticated
  using (org_id = public.jwt_org_id() and not public.is_external_auditor());

-- ---------------------------------------------------------------------------
-- 15. Grants. The ext_ read surface and the tenant-admin read surface go to authenticated; the accept
--     function goes to service_role only. Nothing here goes to anon.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('ext_list_engagements','ext_engagement_summary','ext_latest_board_pack',
                        'ext_latest_certificate','ext_verify_certificate','ext_me',
                        'external_auditor_list','external_access_log_list','external_auditor_invite',
                        'external_auditor_grants_save','external_auditor_revoke',
                        'is_external_auditor','external_actor_ok','external_has_permission')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('external_auditor_accept')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from authenticated', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;
end $$;
