-- 0067_ai_gateway_authorise.sql (R-1b, F8, F25).
--
-- ai_gateway_authorise(p_org) is the single check the ai-gateway Edge Function makes before it reads
-- any endpoint configuration or credential with the service role. It answers three questions at once:
--   1. is the caller a member of p_org (the org is never taken from the request body as authority)?
--   2. is the ai_assist feature entitled for p_org (F25)?
--   3. does the caller hold the use_ai_assist right (F3)?
-- The caller's org and role come from the JWT through caller_has_right(), which reads jwt_org_id() and
-- auth.uid(); the function therefore takes p_org only to compare against the caller's membership.
--
-- M1: grepped supabase/migrations and supabase/tests for ai_gateway_authorise first; no hit.
-- M2: create or replace, so a second apply on the persistent test project is a no-op.
-- M4: no earlier migration defines this name, so no drop is needed above it.

create or replace function public.ai_gateway_authorise(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null
     and exists (
       select 1 from org_members m
        where m.user_id = auth.uid() and m.org_id = p_org
     )
     and public.has_feature(p_org, 'ai_assist')
     and public.caller_has_right('use_ai_assist')
$$;

-- Executable by a signed-in member only. The service role reaches it through the caller's JWT, and
-- anon must never see it (F11: the anonymous surface is exactly two verification functions).
revoke execute on function public.ai_gateway_authorise(uuid) from public;
revoke execute on function public.ai_gateway_authorise(uuid) from anon;
grant execute on function public.ai_gateway_authorise(uuid) to authenticated;
