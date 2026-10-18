-- D20: email-based admin invite.
--
-- The Org Admin "People" panel asked an administrator to paste a raw account UUID and type a role
-- slug. That is a dead end for a non-technical administrator. This migration gives the invite RPC
-- the two things the panel now collects: an email address and a role, and it queues the invitation
-- email so the invitee is told to expect the account.
--
-- Rules: the invitation cap (§4.1, 0015) is unchanged — same per-user and per-organisation limits,
-- same ledger table. The email is queued through the one helper that may write the queue
-- (`queue_email`, 6E / 0039); dispatch itself stays out of scope (NOT-DONE §email-dispatch), so the
-- row lands `pending` with the copy the invitee will read.
--
-- Reuse (grep first, M1): `invite_user_capped` (0015), `invite_cap_events` (0015), `queue_email`
-- (0039), `roles` (0002) all exist. The only schema change is one nullable column so the ledger
-- records which role the administrator intended.

-- The invite ledger records the intended role. Nullable: an invitation without a role is still a
-- valid cap event, and every row written before this migration stays valid.
alter table invite_cap_events add column if not exists role_slug text;

-- ---------------------------------------------------------------------------
-- invite_user_capped: the one way an invitation is recorded. Replaces the single-argument form
-- (0015) with an optional role, so existing callers keep working.
-- ---------------------------------------------------------------------------
drop function if exists public.invite_user_capped(text);

create or replace function public.invite_user_capped(p_email text, p_role_slug text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_caller uuid := auth.uid();
  v_user_limit int;
  v_user_count int;
  v_org_count int;
  v_role_slug text;
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

  -- A role, when given, must be a role of this organisation. The slug is stored, never the name,
  -- because the slug is what the JWT claim and the rights matrix use (§23).
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

  insert into invite_cap_events (org_id, invited_by, email, role_slug)
  values (v_org, v_caller, lower(p_email), v_role_slug);

  -- Queue the invitation. The address is the only recipient; the body is the copy the invitee reads.
  perform public.queue_email(
    v_org, array[lower(p_email)], 'You have been invited to Provio', null,
    'An invitation to join Provio has been sent to your email. You can sign in once your account is created.',
    jsonb_build_object('kind', 'user_invitation', 'email', lower(p_email), 'role_slug', v_role_slug));
end $$;

revoke execute on function public.invite_user_capped(text, text) from public, anon;
grant execute on function public.invite_user_capped(text, text) to authenticated;
