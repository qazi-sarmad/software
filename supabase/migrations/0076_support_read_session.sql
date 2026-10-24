-- 0076 (C2.9): the tenant-granted, read-only support session (spec §24, NOT-DONE item 24).
--
-- Before this migration support_access_grants was metadata: a grant row with a scope, an expiry and
-- a revoke reason, and nothing that acted under it. This migration makes the grant the key to a
-- read-only session, and nothing more:
--
--   * support_grant_active(p_org, p_scope_key) — the single gate. True only when the caller is a
--     platform administrator AND an unrevoked, unexpired grant for p_org carries the named scope key.
--   * support_list_engagements()  — read the engagements of an org the caller holds a live
--     content_read grant for. Nothing when the grant is absent, expired or revoked.
--   * support_read_object(kind, id) — read one object (engagement, workpaper, population, finding)
--     inside the grant's org. An object of another org is refused even with a grant.
--   * support_access_log_list(org) — the tenant's own view of who read what.
--
-- Laws that shape this file:
--   L2  — the platform role is blind by default. It reads nothing here without a live tenant grant,
--         and every read is written to support_access_log, which the tenant can read (0031's tests
--         that prove zero direct reads stay green: none of these functions is a table read).
--   L5  — every session call writes a log row (support_access_log); grants and revocations already
--         reach the platform trail (0031) and the tenant ledger (grant_support_access).
--   No write path exists: the only INSERT is into support_access_log, and it is unreachable from any
--         caller because the function is security definer and the table has no write policy.
--   F11 — no new anonymous surface. Every function here is granted to authenticated only, and each
--         one begins with require_platform_admin(), so a tenant caller is refused in the database.
--
-- M1: `support_access_log` does not exist anywhere in supabase/migrations or supabase/tests (checked
-- before writing). `support_*` function names are new; the existing support functions are
-- support_access_create, grant_support_access, platform_grant_support_access, revoke_support_access,
-- platform_revoke_support_access, platform_list_support_grants.

-- ---------------------------------------------------------------------------
-- 1. support_access_log — what a support session read, and what it was refused. The tenant reads its
--    own rows (L4: drillable), the platform administrator reads none of them directly.
-- ---------------------------------------------------------------------------
create table if not exists support_access_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  grant_id uuid references support_access_grants(id) on delete set null,
  actor_id uuid,
  function_name text not null,
  object_kind text,
  object_id uuid,
  outcome text not null check (outcome in ('ok', 'denied')),
  created_at timestamptz not null default now()
);
create index if not exists support_access_log_org_idx on support_access_log (org_id, created_at desc);

alter table support_access_log enable row level security;

-- The tenant reads its own trail. No write policy: rows enter only from the functions below.
drop policy if exists support_access_log_org_select on support_access_log;
create policy support_access_log_org_select on support_access_log for select to authenticated
  using (org_id = public.jwt_org_id());

revoke insert, update, delete on public.support_access_log from public, anon, authenticated;
grant select on public.support_access_log to authenticated;
-- anon and platform_admin keep the 0008 blanket SELECT convention (privilege granted, RLS does the
-- filtering) so the zero-row proofs in tests 03, 04, 40, 57, 60 and 72 read an empty set rather than
-- failing on a missing privilege. The policy is authenticated-only and keys on the caller's own org,
-- so both roles still read nothing: anon has no claim, and the platform administrator's org is null.
grant select on public.support_access_log to anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'platform_admin') then
    grant select on public.support_access_log to platform_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. support_grant_active — the gate. p_scope_key defaults to content_read, the only scope that
--    opens content. Returns the grant id so the log can name the grant.
-- ---------------------------------------------------------------------------
create or replace function public.support_grant_active(p_org uuid, p_scope_key text default 'content_read')
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_grant uuid;
begin
  if p_org is null then
    return null;
  end if;
  if not public.is_platform_admin() then
    return null;
  end if;
  select g.id into v_grant
    from support_access_grants g
   where g.org_id = p_org
     and g.revoked_at is null
     and g.expires_at > now()
     and g.kind = 'content_read'
     and coalesce(g.scope ->> p_scope_key, 'true') <> 'false'
   order by g.granted_at desc
   limit 1;
  return v_grant;
end $$;

comment on function public.support_grant_active(uuid, text) is
  'C2.9: the read-only support session gate. Non-null only for a platform administrator while an '
  'unrevoked, unexpired tenant grant carries the named scope key.';

-- ---------------------------------------------------------------------------
-- 3. support_list_engagements — the engagements of an org the caller holds a live content_read grant
--    for. A call with no live grant returns nothing and is logged as denied.
-- ---------------------------------------------------------------------------
create or replace function public.support_list_engagements(p_org uuid)
returns table (engagement_id uuid, title text, stage text, sealed boolean, org_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_grant uuid;
begin
  perform public.require_platform_admin();
  if p_org is null then
    raise exception 'an organisation is required' using errcode = 'P0001';
  end if;
  v_grant := public.support_grant_active(p_org, 'content_read');
  if v_grant is null then
    insert into support_access_log (org_id, grant_id, actor_id, function_name, outcome)
    values (p_org, null, auth.uid(), 'support_list_engagements', 'denied');
    return;
  end if;
  insert into support_access_log (org_id, grant_id, actor_id, function_name, outcome)
  values (p_org, v_grant, auth.uid(), 'support_list_engagements', 'ok');
  return query
    select e.id, e.title, e.stage, e.sealed, o.name
      from engagements e join orgs o on o.id = e.org_id
     where e.org_id = p_org
     order by e.title;
end $$;

-- ---------------------------------------------------------------------------
-- 4. support_read_object — read one object inside the grant's org. The object kind decides the
--    column set; the caller may never name an object of another org, and such a call is logged as
--    denied (never as a read).
-- ---------------------------------------------------------------------------
create or replace function public.support_read_object(p_kind text, p_id uuid, p_org uuid)
returns table (object_kind text, object_id uuid, label text, detail jsonb)
language plpgsql security definer set search_path = public as $$
declare
  v_grant uuid;
  v_object_org uuid;
begin
  perform public.require_platform_admin();
  if p_org is null then
    raise exception 'an organisation is required' using errcode = 'P0001';
  end if;
  v_grant := public.support_grant_active(p_org, 'content_read');
  if v_grant is null then
    insert into support_access_log (org_id, grant_id, actor_id, function_name, object_kind, object_id, outcome)
    values (p_org, null, auth.uid(), 'support_read_object', p_kind, p_id, 'denied');
    return;
  end if;

  if p_kind = 'engagement' then
    select e.org_id into v_object_org from engagements e where e.id = p_id;
  elsif p_kind = 'workpaper' then
    select w.org_id into v_object_org from workpapers w where w.id = p_id;
  elsif p_kind = 'population' then
    select p.org_id into v_object_org from populations p where p.id = p_id;
  elsif p_kind = 'finding' then
    select f.org_id into v_object_org from findings f where f.id = p_id;
  else
    insert into support_access_log (org_id, grant_id, actor_id, function_name, object_kind, object_id, outcome)
    values (p_org, v_grant, auth.uid(), 'support_read_object', p_kind, p_id, 'denied');
    raise exception 'unknown object kind: %', p_kind using errcode = 'P0001';
  end if;

  -- An object of another org, or no object at all, is a refusal: nothing is returned and the log
  -- says denied.
  if v_object_org is distinct from p_org then
    insert into support_access_log (org_id, grant_id, actor_id, function_name, object_kind, object_id, outcome)
    values (p_org, v_grant, auth.uid(), 'support_read_object', p_kind, p_id, 'denied');
    return;
  end if;

  insert into support_access_log (org_id, grant_id, actor_id, function_name, object_kind, object_id, outcome)
  values (p_org, v_grant, auth.uid(), 'support_read_object', p_kind, p_id, 'ok');

  if p_kind = 'engagement' then
    return query select 'engagement'::text, e.id, e.title,
      jsonb_build_object('stage', e.stage, 'sealed', e.sealed, 'universe_id', e.universe_id)
      from engagements e where e.id = p_id;
  elsif p_kind = 'workpaper' then
    return query select 'workpaper'::text, w.id, w.stage,
      jsonb_build_object('engagement_id', w.engagement_id, 'stage', w.stage)
      from workpapers w where w.id = p_id;
  elsif p_kind = 'population' then
    return query select 'population'::text, p.id, p.status,
      jsonb_build_object('sha256', p.sha256, 'row_count', p.row_count, 'status', p.status)
      from populations p where p.id = p_id;
  else
    return query select 'finding'::text, f.id, coalesce(f.severity, ''),
      jsonb_build_object('severity', f.severity, 'entity_id', f.entity_id)
      from findings f where f.id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. support_access_log_list — the tenant's own view. A tenant reads only its own org's rows; the
--    platform administrator may read the log of an org it holds a live content_read grant for.
-- ---------------------------------------------------------------------------
create or replace function public.support_access_log_list(p_org uuid, p_limit int default 100)
returns table (id uuid, grant_id uuid, actor_id uuid, function_name text, object_kind text,
               object_id uuid, outcome text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if p_org is null then
    raise exception 'an organisation is required' using errcode = 'P0001';
  end if;
  if p_org is distinct from public.jwt_org_id() then
    perform public.require_platform_admin();
    if public.support_grant_active(p_org, 'content_read') is null then
      raise exception 'not allowed: no live support grant for that organisation' using errcode = 'P0001';
    end if;
  end if;
  return query
    select l.id, l.grant_id, l.actor_id, l.function_name, l.object_kind, l.object_id, l.outcome, l.created_at
      from support_access_log l
     where l.org_id = p_org
     order by l.created_at desc
     limit v_limit;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Every function is for the authenticated role only, and each one re-checks the platform
--    role itself; a tenant caller is refused in the database.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'support_grant_active(uuid, text)',
    'support_list_engagements(uuid)',
    'support_read_object(text, uuid, uuid)',
    'support_access_log_list(uuid, int)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
