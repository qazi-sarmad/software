-- S3: real invitations (F6, F13, D20 defect fix).
--
-- The D20 defect: the invitation copy told the invitee "An invitation to join Provio has been sent
-- to your email", which is false while no dispatcher has accepted it and while no auth account
-- exists. Two things change here.
--
--   1. invite_user_capped no longer claims anything was sent. It records a real, single-use
--      invitation (auth_invites below) whose token is hashed, queues an email that carries the
--      acceptance link, and leaves the row in the queue as `pending`. The UI may say "queued"
--      until the queue reports `sent`, never "sent" before.
--   2. admin_accept_invite is the one function that turns a token into an account: it checks the
--      token, its expiry and its single-use flag, provisions the member with the invited role and
--      scope through the existing admin_* helpers, and marks the invitation accepted. It is
--      executable by `service_role` only, so it is reached only from the invite-user Edge Function
--      after the caller's JWT has been verified, and never from the browser.
--
-- M1 (grep first): `invite_user_capped` (0015, replaced in 0048), `invite_cap_events` (0015),
-- `queue_email` (0039), `admin_provision_member` (0017), `user_scopes` (0002), `org_members` (0002).
-- `auth_invites` is new. `invite_cap_events` gains `invite_id` so the cap event and the invitation
-- are one story (L5).
--
-- M2: every statement is repeatable: create table if not exists, add column if not exists,
-- drop function if exists before create or replace where the signature changed, create or replace
-- otherwise, create index if not exists.

-- ---------------------------------------------------------------------------
-- 1. auth_invites — a single-use invitation with a hashed token (F13, F6).
-- ---------------------------------------------------------------------------
create table if not exists auth_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role_slug text null,
  token_hash text not null,
  kind text not null default 'member',
  invited_by uuid null,
  expires_at timestamptz not null,
  accepted_at timestamptz null,
  accepted_by uuid null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);
alter table auth_invites add column if not exists role_slug text;
alter table auth_invites add column if not exists kind text not null default 'member';
alter table auth_invites add column if not exists invited_by uuid;
alter table auth_invites add column if not exists expires_at timestamptz;
alter table auth_invites add column if not exists accepted_at timestamptz;
alter table auth_invites add column if not exists accepted_by uuid;
alter table auth_invites add column if not exists revoked_at timestamptz;

create index if not exists auth_invites_token_idx on auth_invites (token_hash);
create index if not exists auth_invites_org_idx on auth_invites (org_id, created_at desc);

alter table auth_invites enable row level security;

-- An Org Admin sees its own invitations. The platform admin sees them (a platform-level surface).
-- No write policy: rows enter through invite_user_capped and change through admin_accept_invite.
drop policy if exists auth_invites_org_select on auth_invites;
create policy auth_invites_org_select on auth_invites for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

revoke insert, update, delete on public.auth_invites from public, anon, authenticated;

drop trigger if exists auth_invites_pin_org on auth_invites;
create trigger auth_invites_pin_org before insert on auth_invites
  for each row execute function public.pin_org_id();

-- The cap event and the invitation are one story.
alter table invite_cap_events add column if not exists invite_id uuid;

-- ---------------------------------------------------------------------------
-- 2. invite_user_capped — replace the copy, record the invitation, queue the link.
--    The return type changes from void (0048) to uuid, so the old function is dropped first (M4);
--    the drop is idempotent and safe on a project where an earlier run defined the old body.
-- ---------------------------------------------------------------------------
drop function if exists public.invite_user_capped(text, text);
drop function if exists public.invite_user_capped(text);

create or replace function public.invite_user_capped(p_email text, p_role_slug text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_caller uuid := auth.uid();
  v_user_limit int;
  v_user_count int;
  v_org_count int;
  v_role_slug text;
  v_token text;
  v_id uuid;
  v_queue_id uuid;
begin
  if v_org is null or v_caller is null then
    raise exception 'not signed in';
  end if;
  if not coalesce(public.caller_has_right('manage_users'), false) then
    raise exception 'not allowed to invite users';
  end if;
  if p_email is null or position('@' in p_email) <= 1 then
    raise exception 'invalid email address';
  end if;

  if p_role_slug is not null and btrim(p_role_slug) <> '' then
    select r.slug into v_role_slug from roles r where r.org_id = v_org and r.slug = btrim(p_role_slug);
    if v_role_slug is null then
      raise exception 'unknown role: %', p_role_slug;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('invite:' || v_org::text));
  select coalesce(s.per_user_daily, 20) into v_user_limit from invite_cap_settings s where s.org_id = v_org;
  v_user_limit := coalesce(v_user_limit, 20);
  select count(*) into v_user_count from invite_cap_events e
    where e.org_id = v_org and e.invited_by = v_caller and e.created_at > now() - interval '1 day';
  select count(*) into v_org_count from invite_cap_events e
    where e.org_id = v_org and e.created_at > now() - interval '1 day';
  if v_user_count >= v_user_limit then
    raise exception 'daily invitation limit reached for this user';
  end if;
  if v_org_count >= 100 then
    raise exception 'daily invitation limit reached for this organisation';
  end if;

  -- A single-use token. Only its hash is stored; the plaintext exists in the queued email only.
  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into auth_invites (org_id, email, role_slug, token_hash, kind, invited_by, expires_at)
  values (v_org, lower(p_email), v_role_slug,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), 'member', v_caller,
          now() + interval '7 days')
  returning id into v_id;

  insert into invite_cap_events (org_id, invited_by, email, role_slug, invite_id)
  values (v_org, v_caller, lower(p_email), v_role_slug, v_id);

  -- Queue the invitation. The copy is honest: the account does not exist yet, and the email is
  -- queued, not sent. The link carries the token.
  v_queue_id := public.queue_email(
    v_org, array[lower(p_email)], 'You have been invited to Provio', null,
    'You have been invited to join Provio. Open this link to accept the invitation and set your '
    || 'password: ' || '/invite/accept?token=' || v_token
    || E'\n\nThis link is valid for 7 days and can be used once. If you were not expecting this '
    || 'invitation, you can ignore this message.',
    jsonb_build_object('kind', 'user_invitation', 'email', lower(p_email),
                       'role_slug', v_role_slug, 'invite_id', v_id));

  -- The invitation and the queued message are one story.
  perform public.admin_log_change(v_org, 'invite:' || v_id::text,
    jsonb_build_object('email', lower(p_email), 'role_slug', v_role_slug, 'queue_id', v_queue_id,
                       'status', 'queued'),
    'invitation_queued', 'auth_invite', v_id);

  return v_id;
end $$;

revoke execute on function public.invite_user_capped(text, text) from public, anon;
grant execute on function public.invite_user_capped(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_accept_invite — the one function that turns a token into an account. Executable by
--    service_role only (see the grants below), so it is reached only from the invite-user Edge
--    Function after the caller's JWT is verified. The boundary is the grant, exactly as for
--    secret_reveal (0054): a SECURITY DEFINER function sees the owner as current_user, so a body
--    check on current_user would be wrong here.
--
--    The drop precedes the create because an earlier run of this file may have defined the function
--    with a different OUT-parameter row type (M4).
-- ---------------------------------------------------------------------------
drop function if exists public.admin_accept_invite(text, uuid);

create or replace function public.admin_accept_invite(p_token text, p_user uuid)
returns table (out_org_id uuid, out_role_slug text, out_email text)
language plpgsql security definer set search_path = public as $$
declare
  v_inv auth_invites;
  v_hash text;
  v_role_id uuid;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'an invitation token is required' using errcode = 'P0001';
  end if;
  if p_user is null then
    raise exception 'a user id is required' using errcode = 'P0001';
  end if;

  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');
  select * into v_inv from auth_invites i where i.token_hash = v_hash for update;
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

  select r.id into v_role_id from roles r where r.org_id = v_inv.org_id and r.slug = v_inv.role_slug;
  if v_role_id is null then
    raise exception 'the invited role no longer exists' using errcode = 'P0001';
  end if;

  insert into org_members (org_id, user_id, role_id, display_name)
  values (v_inv.org_id, p_user, v_role_id, '')
  on conflict (org_id, user_id) do update set role_id = excluded.role_id;

  -- An invitation with no scope list means "all universes", which is the empty user_scopes path.
  update auth_invites
     set accepted_at = now(), accepted_by = p_user
   where id = v_inv.id;

  perform public.admin_log_change(v_inv.org_id, 'invite:' || v_inv.id::text,
    jsonb_build_object('email', v_inv.email, 'role_slug', v_inv.role_slug, 'user_id', p_user),
    'invitation_accepted', 'auth_invite', v_inv.id);

  return query select v_inv.org_id, v_inv.role_slug, v_inv.email;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants. admin_accept_invite is service_role only: revoked from public, anon and authenticated,
--    granted to service_role. That grant is the boundary (as with secret_reveal in 0054).
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('admin_accept_invite')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from authenticated', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. invite_status — what the UI reads to say "queued" or "sent", never "sent" before it is.
-- ---------------------------------------------------------------------------
create or replace function public.invite_status(p_invite_id uuid)
returns table (invite_id uuid, email text, status text, accepted_at timestamptz, queue_status text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_inv auth_invites;
begin
  select * into v_inv from auth_invites i where i.id = p_invite_id;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0001';
  end if;
  if v_inv.org_id <> v_org and not public.is_platform_admin() then
    raise exception 'not allowed to read that invitation' using errcode = 'P0001';
  end if;

  return query
    select i.id, i.email,
           case when i.accepted_at is not null then 'accepted'
                when i.revoked_at is not null then 'revoked'
                when i.expires_at < now() then 'expired'
                else 'queued' end,
           i.accepted_at,
           coalesce((select q.status from email_queue q
                      where q.metadata ->> 'invite_id' = i.id::text
                      order by q.created_at desc limit 1), 'none')
      from auth_invites i where i.id = p_invite_id;
end $$;

revoke execute on function public.invite_status(uuid) from public, anon;
grant execute on function public.invite_status(uuid) to authenticated;
