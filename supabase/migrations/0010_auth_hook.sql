-- 0010: the access-token auth hook (spec §4.5, §25.2).
-- Supabase calls this function when it mints a JWT. It stamps two custom claims:
--   org_id    — the caller's organisation, read from org_members
--   user_role — the caller's role slug, read from roles
-- A user with no membership gets neither claim. RLS then shows them nothing: there is no
-- default role and no fallback org (spec §4.5). This function is the only writer of these
-- claims, so the org a policy sees cannot come from a header or a request body.
--
-- Wire it up with:
--   alter database postgres set "supabase.auth.hook" = 'public.custom_access_token_hook';
-- or in the Supabase dashboard under Authentication → Hooks → Customize Access Token.

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
    select exists (select 1 from platform_admins p where p.user_id = v_user_id) into v_platform;
    if v_platform then
      -- Platform staff carry no org and no tenant role.
      v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb('platform_admin'::text), true);
    end if;
  end if;

  return jsonb_set(event, '{claims}', v_claims, true);
end $$;

-- Supabase Auth calls this function as the `supabase_auth_admin` role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
    grant select on public.org_members, public.roles, public.platform_admins to supabase_auth_admin;
  end if;
end $$;
