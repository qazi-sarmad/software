-- 0053: the read path for configuration history (OA-17, F4, L5). One uniform view over the
-- registered history tables so the Org Admin can see every configuration change, including the ones
-- a QSCorp consultant made during a Dual Session, with a plain "platform consultant" flag.
--
-- M1: grepped supabase/migrations and supabase/tests for config_history_list; none existed.
-- M2: create or replace only; no table, trigger or policy is created here, so a second apply is a
--     no-op.

-- config_history_list(p_limit): the caller's organisation configuration history, newest first.
-- A tenant member needs edit_config; a platform admin sees it only while it has an active session
-- for that org (the consultation path), never otherwise.
create or replace function public.config_history_list(p_limit int default 100)
returns table (
  area text,
  area_label text,
  entity text,
  entity_id text,
  action text,
  summary text,
  actor uuid,
  actor_is_platform boolean,
  prev_hash text,
  row_hash text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
begin
  -- A tenant member with edit_config reads its own history; a platform admin reads it through the
  -- consultation path only (config_write_mode denies everything else).
  if public.jwt_org_id() is not null and coalesce(public.caller_has_right('edit_config'), false) then
    v_org := public.jwt_org_id();
  elsif public.is_platform_admin() then
    select s.org_id into v_org
      from consultation_sessions s
     where s.status = 'active' and (s.expires_at is null or s.expires_at > now())
     order by s.started_at desc nulls last
     limit 1;
    if v_org is null then
      return;
    end if;
  else
    return;
  end if;

  return query
  with rows as (
    select 'roles'::text as area, l.entity, l.entity_id::text as entity_id, l.action,
           coalesce(l.payload->>'summary', l.entity) as summary,
           l.actor, l.prev_hash, l.row_hash, l.created_at
      from role_config_log l where l.org_id = v_org
    union all
    select 'ai_models', m.entity, m.entity_id, m.action,
           coalesce(m.payload->>'summary', m.entity),
           m.actor, m.prev_hash, m.row_hash, m.created_at
      from ai_model_versions m where m.org_id = v_org
    union all
    select 'tenant_entitlements', e.entity, e.entity_id, e.action,
           coalesce(e.payload->>'summary', e.entity),
           e.actor, e.prev_hash, e.row_hash, e.created_at
      from tenant_entitlement_versions e where e.org_id = v_org
    union all
    select 'org_settings', c.key, c.key, 'update',
           c.key || ' v' || c.version::text,
           c.actor_id, null::text, null::text, c.ts
      from config_versions c where c.org_id = v_org
  )
  select r.area,
         coalesce(a.label, r.area),
         r.entity,
         r.entity_id,
         r.action,
         r.summary,
         r.actor,
         (r.actor is not null and exists (select 1 from platform_admins p where p.user_id = r.actor)),
         r.prev_hash,
         r.row_hash,
         r.created_at
    from rows r
    left join config_areas a on a.key = r.area
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

do $$
begin
  execute 'revoke execute on function public.config_history_list(int) from public';
  execute 'revoke execute on function public.config_history_list(int) from anon';
  execute 'grant execute on function public.config_history_list(int) to authenticated';
end $$;
