-- 0070: Guard engagement_as_of_events against cross-tenant reads (S10-FIX, F14, L2).
--
-- 0068 created engagement_as_of_events as SECURITY DEFINER, granted it to authenticated, and the
-- browser calls it directly (src/data/timeTravel.ts listAsOfEvents) before it calls engagement_as_of.
-- Unlike its sibling engagement_as_of, it performed NO org, scope, right or feature check: it
-- derived the org from the passed engagement id and returned that org's ledger payloads and activity
-- rows. Any authenticated member of org B could therefore pass an org A engagement uuid and read org
-- A's ledger and activity — a cross-tenant leak (L2), reachable straight from the browser.
--
-- This migration replaces the body with the same guard order engagement_as_of uses:
--   1. resolve the engagement's org;
--   2. require the time_travel entitlement for that org (F25);
--   3. require the caller's org to match and the engagement to be in scope (RLS parity);
--   4. require config_actor_ok(org, 'view_insights') (F3, F4).
-- The signature, return shape and grants are unchanged, so the caller is unaffected. Reads only the
-- append-only sources, exactly as before.
--
-- M1: grepped supabase/migrations and supabase/tests for engagement_as_of_events. Found in
--     0068_time_travel_patterns.sql; this file extends it with create or replace (no duplicate).
-- M2: create or replace function is idempotent; the grant block below is re-run safely.
-- M4: the old body is replaced, not shadowed; there is no second definition.

-- ---------------------------------------------------------------------------
-- 1. engagement_as_of_events — same output, now guarded like engagement_as_of.
-- ---------------------------------------------------------------------------
create or replace function public.engagement_as_of_events(p_engagement_id uuid, p_ts timestamptz)
returns table (seq text, kind text, action text, at timestamptz, object_type text, object_id uuid,
               detail jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_scope_ok boolean;
begin
  select e.org_id,
         (e.org_id = public.jwt_org_id()
          and (public.can_read_all_scopes() or public.has_scope(e.universe_id, e.entity_id, e.id)))
    into v_org, v_scope_ok
    from engagements e where e.id = p_engagement_id;
  if v_org is null then
    return;
  end if;
  if not public.has_feature(v_org, 'time_travel') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  -- Scope before right, so a cross-org or out-of-scope read is refused as such rather than as a
  -- rights failure (RLS parity: can_read_all_scopes or a scope on the engagement).
  if not coalesce(v_scope_ok, false) then
    raise exception 'not allowed: the engagement is outside the caller''s scope' using errcode = 'P0001';
  end if;
  if not public.config_actor_ok(v_org, 'view_insights') then
    raise exception 'not allowed: the caller cannot view the engagement timeline' using errcode = 'P0001';
  end if;
  return query
    select l.seq::text, 'ledger'::text, l.action, l.ts, null::text, null::uuid, l.payload
      from ledger_entries l
     where l.org_id = v_org and l.ts <= p_ts
       and (l.payload ->> 'engagement_id')::uuid = p_engagement_id
    union all
    select a.id::text as seq_text, 'activity'::text, a.action, a.ts, a.object_type, a.object_id, a.detail
      from activity_log a
     where a.org_id = v_org and a.ts <= p_ts
       and ((a.object_type = 'engagement' and a.object_id = p_engagement_id)
            or (a.object_type = 'workpaper' and a.object_id in (
                  select w.id from workpapers w where w.engagement_id = p_engagement_id)))
    order by 4 asc, 1 asc;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Grants. Unchanged from 0068: nothing here goes to anon.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'revoke execute on function public.engagement_as_of_events(uuid, timestamptz) from public';
  execute 'revoke execute on function public.engagement_as_of_events(uuid, timestamptz) from anon';
  execute 'grant execute on function public.engagement_as_of_events(uuid, timestamptz) to authenticated';
end $$;
