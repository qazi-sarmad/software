-- 0115: enforce tenant suspension (Phase 3, G3 config-effect).
--
-- Defect this migration fixes. `tenant_settings.status` was settable by the platform admin
-- (`platform_set_tenant_status`, 0031) and shown on the tenant hub, but read by no decision: a
-- suspended tenant's members kept full access. The config-effect matrix claimed it "blocks writes
-- across the product" via "~120 RPCs' status guards" — no such guard existed anywhere in the schema
-- (grepped: the only readers of `tenant_settings.status` are the platform listing RPCs, which echo
-- it). Owner decision 1 (locked): enforce the setting, do not remove it.
--
-- How it is enforced. `custom_access_token_hook` (0010) is the ONLY writer of the `org_id` and
-- `user_role` claims — RLS and every org-scoped RPC resolve identity from those claims, never from a
-- header or body. So the correct chokepoint is the hook: a suspended tenant's member is issued no
-- org claim, and RLS then shows them nothing (no default org, no fallback — spec §4.5) and every RPC
-- that checks `jwt_org_id() is null` raises 'not signed in'. Platform staff carry no org_members row
-- and are unaffected, so the platform can always lift a suspension.
--
-- `tenant_is_active` is the named reader the config-effect matrix points at, so the effect is
-- attributable to one function rather than to a hand-waved "status guard".

create or replace function public.tenant_is_active(p_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ts.status from tenant_settings ts where ts.org_id = p_org) is distinct from 'suspended',
                  true)
$$;

comment on function public.tenant_is_active(uuid) is
  'G3: a tenant is active unless its tenant_settings.status is suspended. Read by '
  'custom_access_token_hook, so a suspended tenant''s members are issued no org claim.';

-- Re-create the access-token hook with the suspension check. The body is the 0066 version (the
-- org_members branch plus the external-auditor branch) with one addition: a suspended org stamps
-- nothing. The claim-stripping and the membership lookups are unchanged.
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

  -- A suspended tenant is issued no org claim and no role: the member is, to RLS, a user with no
  -- membership. Platform staff below are checked independently and are never suspended this way.
  if v_org_id is not null and public.tenant_is_active(v_org_id) then
    v_claims := jsonb_set(v_claims, '{org_id}', to_jsonb(v_org_id::text), true);
    v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_slug), true);
  else
    -- An external auditor: an active external_auditor_access row and no org_members row. A suspended
    -- tenant's external auditors are likewise issued nothing.
    select a.org_id into v_ext_org
      from external_auditor_access a
     where a.user_id = v_user_id and a.active and a.revoked_at is null
     order by a.created_at asc
     limit 1;
    if v_ext_org is not null and public.tenant_is_active(v_ext_org) then
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
    grant select on public.org_members, public.roles, public.platform_admins,
                    public.tenant_settings, public.external_auditor_access to supabase_auth_admin;
  end if;
end $$;

-- tenant_is_active is an internal helper for the hook; the app never calls it directly.
revoke execute on function public.tenant_is_active(uuid) from public, anon, authenticated;
