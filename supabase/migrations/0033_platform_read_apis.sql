-- 0033 (C4/C5): platform read APIs for the Super Admin portal.
--
-- The platform portal is the sole place that may read user_role from the JWT (D-PLATFORM-RIGHTS).
-- These functions are security definer and require_platform_admin(), so they are data-blind for every
-- tenant role: a tenant call is refused in the database, not in the browser.

-- Identity probe: does the signed-in session hold the platform_admin role? Read from the JWT claims.
-- Drop first: this file is replayed (the local harness applies every migration twice) and the shared
-- hosted test project may already carry a wider platform_whoami() written by another branch, so
-- `create or replace` would fail with "cannot change return type of existing function" and abort the
-- whole migration run — which is exactly how migrations 0100+ stopped reaching the database.
drop function if exists public.platform_whoami();
create or replace function public.platform_whoami()
returns table (user_id uuid, is_platform_admin boolean)
language plpgsql security definer set search_path = public as $$
begin
  return query select auth.uid(), public.is_platform_admin();
end $$;

-- Invite-cap overrides the platform has set, for display in the portal.
create or replace function public.platform_get_invite_caps()
returns table (org_id uuid, per_user_daily int)
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  return query
    select ic.org_id, ic.per_user_daily
    from invite_cap_settings ic
    order by ic.org_id;
end $$;

-- Support grants (metadata only; never tenant business content), for display in the portal.
create or replace function public.platform_list_support_grants()
returns table (
  id uuid, org_id uuid, granted_by uuid, granted_at timestamptz, expires_at timestamptz,
  scope jsonb, revoked_at timestamptz, revoke_reason text, platform_actor_id uuid
)
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  return query
    select g.id, g.org_id, g.granted_by, g.granted_at, g.expires_at, g.scope,
           g.revoked_at, g.revoke_reason, g.platform_actor_id
    from support_access_grants g
    order by g.granted_at desc;
end $$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'platform_whoami()',
    'platform_get_invite_caps()',
    'platform_list_support_grants()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
