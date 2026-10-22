-- 0083 hardening (audit 2026-10-23). Each section closes one finding; tests live in supabase/tests/92_hardening.sql.

-- ---------------------------------------------------------------------------
-- 1. Engagements may only be created through deploy_engagement (spec §6, §7).
--    A direct insert skipped the approved-entity check, the approval steps, the activity log and the
--    ledger entry. The table privilege is removed for end users, and a trigger refuses unapproved
--    entities for any writer that still reaches the table. deploy_engagement runs as the owner, so it
--    is unaffected.
-- ---------------------------------------------------------------------------
revoke insert on engagements from authenticated;

create or replace function public.engagement_entity_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from entities e
     where e.id = new.entity_id
       and e.org_id = new.org_id
       and e.universe_id = new.universe_id
       and e.status = 'approved'
  ) then
    raise exception 'the entity is not approved for this universe; approve it before starting an engagement (spec §6)'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists engagements_entity_gate on engagements;
create trigger engagements_entity_gate before insert on engagements
  for each row execute function public.engagement_entity_gate();

-- ---------------------------------------------------------------------------
-- 2. A secret may only be attached to the organisation that owns it.
--    Without this, an admin of one tenant could point an endpoint or connection at another tenant's
--    stored credential, and the AI gateway would send that credential to the admin's own endpoint.
-- ---------------------------------------------------------------------------
create or replace function public.ai_set_endpoint(p_org uuid, p_url text, p_access_mode text, p_secret_id uuid default null::uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.ai_require_org_actor(p_org, 'ai_assist');
  if p_access_mode not in ('server','browser') then
    raise exception 'unknown access mode: %', p_access_mode using errcode = 'P0001';
  end if;
  if p_secret_id is not null and not exists (
       select 1 from secret_store s where s.id = p_secret_id and s.org_id = p_org) then
    raise exception 'the secret does not belong to this organisation' using errcode = 'P0001';
  end if;
  if p_url is not null and public.ai_endpoint_denied(p_url) then
    raise exception 'This looks like a vendor-hosted AI service. Provio only allows models that run on your own infrastructure (spec L2).'
      using errcode = 'P0001';
  end if;
  insert into tenant_settings (org_id, ai_model_endpoint, ai_access_mode, ai_secret_id, updated_at)
  values (p_org, p_url, p_access_mode, p_secret_id, now())
  on conflict (org_id) do update
    set ai_model_endpoint = excluded.ai_model_endpoint, ai_access_mode = excluded.ai_access_mode,
        ai_secret_id = excluded.ai_secret_id, updated_at = now();
end $$;

create or replace function public.hosting_connection_set_secret(p_connection_id uuid, p_secret_id uuid, p_masked text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from hosting_connections where id = p_connection_id;
  if v_org is null then
    raise exception 'Unknown hosting connection.' using errcode = 'P0001';
  end if;
  perform public.require_config_actor(v_org, 'edit_config');
  if p_secret_id is not null and not exists (
       select 1 from secret_store s where s.id = p_secret_id and s.org_id = v_org) then
    raise exception 'the secret does not belong to this organisation' using errcode = 'P0001';
  end if;
  update hosting_connections set password_secret_id = p_secret_id,
    password_masked = coalesce(p_masked, '•••• set'), updated_at = now()
    where id = p_connection_id;
end $$;

-- Platform app secrets must be platform-scoped (org_id null), never a tenant's secret.
create or replace function public.graph_app_save(p_client_id text, p_tenant_id text, p_redirect_uri text, p_client_secret_id uuid default null::uuid, p_refresh_secret_id uuid default null::uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrator only' using errcode = 'P0001';
  end if;
  if exists (select 1 from secret_store s
              where s.id in (p_client_secret_id, p_refresh_secret_id) and s.org_id is not null) then
    raise exception 'a tenant secret cannot be used as the platform app secret' using errcode = 'P0001';
  end if;
  update platform_email_app
     set client_id = coalesce(p_client_id, client_id),
         tenant_id = coalesce(p_tenant_id, tenant_id),
         redirect_uri = coalesce(p_redirect_uri, redirect_uri),
         client_secret_id = coalesce(p_client_secret_id, client_secret_id),
         refresh_secret_id = coalesce(p_refresh_secret_id, refresh_secret_id),
         updated_at = now()
   where id = true;
end $$;

-- ---------------------------------------------------------------------------
-- 3. anon holds no table privileges at all. RLS was the only control, and the grant was wider than
--    any anonymous path needs. Future tables get no anon grant by default.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;

-- Helper predicates are not anonymous surfaces.
revoke execute on function public.is_cia() from anon;
revoke execute on function public.is_org_admin() from anon;
revoke execute on function public.can_read_all_scopes() from anon;

-- ---------------------------------------------------------------------------
-- 4. dblink was unused by the application and reachable by anon (public-schema extension).
-- ---------------------------------------------------------------------------
drop extension if exists dblink;

-- ---------------------------------------------------------------------------
-- 5. The access-token hook runs for Supabase Auth only. A signed-in user must not be able to read
--    another user's org and role by passing that user's id.
-- ---------------------------------------------------------------------------
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Seed functions write default rows for any org id they are given. Only the database itself
--    (triggers and definer functions, which run as the owner) needs them. The one the app calls,
--    board_pack_sections_seed, stays callable and now checks the caller's org.
-- ---------------------------------------------------------------------------
do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'seed\_%' or p.proname like 'orgs\_seed\_%'
            or p.proname in ('certificate_config_seed', 'change_control_seed', 'pattern_settings_seed'))
       and p.proname <> 'board_pack_sections_seed'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

create or replace function public.board_pack_sections_seed(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  insert into board_pack_sections (org_id, section_key, label, ordinal)
  select p_org, s.key, s.label, s.ord
    from (values
      ('cover',                 'Cover and assurance statement', 1),
      ('changes',               'What changed since the last pack', 2),
      ('sira',                  'SIRA residual risk and heatmap', 3),
      ('plan',                  'Audit plan progress and Gantt', 4),
      ('issues',                'Open issues and CAP aging by severity', 5),
      ('sealed',                'Sealed work and integrity', 6),
      ('management_responses',  'Management responses', 7),
      ('sources',               'Sources index', 8)
    ) as s(key, label, ord)
  on conflict (org_id, section_key) do nothing;
end $$;
