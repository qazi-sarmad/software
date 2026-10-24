-- 0073_rpc_authority.sql — C1.3: RPC authority review.
--
-- The review (docs/COMPLETION-RPC-REVIEW.md) found that a number of SECURITY DEFINER functions
-- executable by `authenticated` read or write an organisation named only by a function argument,
-- with no check that the argument is the caller's organisation or that the caller is a platform
-- administrator acting on it. An Org B user could therefore read Org A's configuration, secret mask,
-- entitlements and SIRA model through them, and could write Org A ledger, activity-log,
-- configuration-version, automation-event and email-queue rows.
--
-- The fix is one guard, provio_org_guard(p_org): a tenant member may act only on its own
-- organisation; a platform administrator is unchanged (it is checked later, by the function's own
-- right check or by config_write_mode). Every function below calls it first. `p_org is null` stays
-- legal for the platform-template listing helpers, which then return the platform rows alone.
--
-- M1: every function already exists; each is redefined with `create or replace`. The three helpers
-- whose language changes from SQL to PL/pgSQL are dropped first so no stale overload is left behind.
-- M2: safe to re-apply.

-- ---------------------------------------------------------------------------
-- 1. The guard.
-- ---------------------------------------------------------------------------
create or replace function public.provio_org_guard(p_org uuid)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_org is null then
    return;
  end if;
  -- PostgREST always sets request.jwt.claims. When it is unset or empty the call comes from inside
  -- the database (a trigger, another definer function, a migration, or a test harness) rather than
  -- from a browser request, and that context is already trusted.
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then
    return;
  end if;
  -- The dispatcher and the other Edge Functions run with the service-role key and act on the org
  -- carried by the row they are processing. `current_user` inside a definer function is the owner,
  -- so the JWT claim is the reliable test (the same pattern as email_dispatch_claim in 0064).
  if auth.role() = 'service_role' then
    return;
  end if;
  if public.jwt_user_role() = 'platform_admin' then
    return;
  end if;
  if public.jwt_org_id() is distinct from p_org then
    raise exception 'not allowed: the organisation is not the caller''s' using errcode = 'P0001';
  end if;
end $$;

comment on function public.provio_org_guard(uuid) is
  'C1.3: a SECURITY DEFINER helper may act on an organisation only when it is the caller''s, unless '
  'the caller is a platform administrator (which the function then checks for itself).';

revoke execute on function public.provio_org_guard(uuid) from public, anon;
grant execute on function public.provio_org_guard(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Configuration and settings readers (spec §23).
-- ---------------------------------------------------------------------------

-- get_org_settings_extra: p_org used to default to the caller's org but accepted any org.
drop function if exists public.get_org_settings_extra(uuid);
create or replace function public.get_org_settings_extra(p_org uuid default null)
returns table (app_base_url text, last_board_meeting_date date, certificate_auto_issue boolean,
               public_verify_show_title boolean, ai_retention_days int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  perform public.provio_org_guard(v_org);
  return query
    select e.app_base_url, e.last_board_meeting_date,
           coalesce(e.certificate_auto_issue, false), coalesce(e.public_verify_show_title, false),
           coalesce(e.ai_retention_days, 30)
      from (select v_org as org_id) q
      left join org_settings_extra e on e.org_id = q.org_id;
end $$;

-- entity_approval_config.
drop function if exists public.entity_approval_config(uuid);
create or replace function public.entity_approval_config(p_org uuid)
returns table (initiate_right text, approve_right text, required_fields jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return query
    select coalesce(s.initiate_right, 'edit_config'),
           coalesce(s.approve_right, 'approve_plan'),
           coalesce(s.required_fields, '["name"]'::jsonb)
      from (select 1) one
      left join entity_approval_settings s on s.org_id = p_org;
end $$;

-- plan_approval_config.
drop function if exists public.plan_approval_config(uuid);
create or replace function public.plan_approval_config(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return (select jsonb_build_object('create_right', s.create_right, 'approve_right', s.approve_right)
            from plan_approval_settings s where s.org_id = p_org);
end $$;

-- org_required_sections.
create or replace function public.org_required_sections(p_org_id uuid)
returns text[]
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org_id);
  return coalesce(
    (select array(select jsonb_array_elements_text(v.value))
       from config_versions v
      where v.org_id = p_org_id and v.key = 'methodology.required_sections'
      order by v.version desc limit 1),
    '{}'::text[]);
end $$;

-- sira_band_for: called internally with a trusted org, so it must stay callable for a tenant org
-- (its callers pass the caller's own org) but never for another org.
create or replace function public.sira_band_for(p_org uuid, p_score numeric)
returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return (select b.name from sira_bands b
           where b.org_id = p_org and p_score >= b.min_score and p_score <= b.max_score
           order by b.ordinal desc limit 1);
end $$;

-- sira_model_snapshot.
create or replace function public.sira_model_snapshot(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return (
    select jsonb_build_object(
             'aggregation', m.aggregation,
             'version', m.version,
             'factors', (select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label,
                            'weight', f.weight, 'ordinal', f.ordinal) order by f.ordinal), '[]'::jsonb)
                         from sira_factors f where f.org_id = p_org),
             'scales', (select coalesce(jsonb_agg(jsonb_build_object('point', s.point, 'label', s.label)
                            order by s.point), '[]'::jsonb)
                         from sira_scales s where s.org_id = p_org),
             'bands', (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'min', b.min_score,
                            'max', b.max_score, 'ordinal', b.ordinal) order by b.ordinal), '[]'::jsonb)
                         from sira_bands b where b.org_id = p_org))
           from sira_models m where m.org_id = p_org);
end $$;

-- consultation_active.
drop function if exists public.consultation_active(uuid);
create or replace function public.consultation_active(p_org uuid)
returns table (id uuid, kind text, status text, expires_at timestamptz, initiated_by_side text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return query
    select s.id, s.kind, s.status, s.expires_at, s.initiated_by_side
      from consultation_sessions s
     where s.org_id = p_org and s.status in ('requested','active')
     order by s.requested_at desc
     limit 1;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Secret mask display (spec §24.2, L2). The masked value belongs to one org.
-- ---------------------------------------------------------------------------
create or replace function public.secret_display(p_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_masked text;
begin
  select s.org_id, s.masked into v_org, v_masked from secret_store s where s.id = p_id;
  if not found then
    return null;
  end if;
  -- A platform-scoped secret (org_id null) is platform-admin only.
  if v_org is null then
    if not public.is_platform_admin() then
      raise exception 'not allowed: the caller cannot read that secret' using errcode = 'P0001';
    end if;
    return v_masked;
  end if;
  perform public.provio_org_guard(v_org);
  return v_masked;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Platform-template listings (spec §23). A tenant sees its own rows and the platform templates;
--    the org argument may be null, which returns the platform rows alone.
-- ---------------------------------------------------------------------------
create or replace function public.automation_rule_list(p_org uuid)
returns table (
  id uuid, rule_key text, name text, event_key text, conditions jsonb, actions jsonb,
  enabled boolean, is_platform_template boolean, paused_at timestamptz, pause_reason text
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return query
    select r.id, r.rule_key, r.name, r.event_key, r.conditions, r.actions, r.enabled,
           r.is_platform_template, r.paused_at, r.pause_reason
      from automation_rules r
     where r.org_id = p_org or r.org_id is null
     order by r.org_id nulls last, r.rule_key;
end $$;

create or replace function public.notification_template_list(p_org uuid)
returns table (id uuid, event_key text, subject text, blocks jsonb, is_platform_template boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return query
    select t.id, t.event_key, t.subject, t.blocks, t.is_platform_template
      from notification_templates t
     where t.org_id = p_org or t.org_id is null
     order by t.org_id nulls last, t.event_key;
end $$;

-- email_sender_profiles_list: the credential_display column used to expose any org's secret mask.
create or replace function public.email_sender_profiles_list(p_org uuid)
returns table (
  id uuid, org_id uuid, scope text, provider text, display_name text, from_address text,
  reply_to text, enabled boolean, is_default boolean, forced boolean, allow_tenant_profile boolean,
  fallback_to_platform boolean, daily_cap int, status text, last_test_at timestamptz, last_test_result text,
  credential_secret_id uuid, credential_display text
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return query
    select p.id, p.org_id, p.scope, p.provider, p.display_name, p.from_address, p.reply_to,
           p.enabled, p.is_default, p.forced, p.allow_tenant_profile, p.fallback_to_platform,
           p.daily_cap, p.status, p.last_test_at, p.last_test_result, p.credential_secret_id,
           public.secret_display(p.credential_secret_id)
      from email_sender_profiles p
     where p.org_id = p_org or p.org_id is null
     order by p.org_id nulls last, p.scope;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Ledger readers and the ledger integrity check (L5, spec §25.3).
-- ---------------------------------------------------------------------------
create or replace function public.verify_ledger(p_org_id uuid)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_expected_prev text := repeat('0', 64);
  v_canonical text;
  v_payload_hash text;
  v_expected_hash text;
begin
  perform public.provio_org_guard(p_org_id);
  for r in
    select e.seq, e.prev_hash, e.hash, e.payload_hash, e.payload
    from ledger_entries e where e.org_id = p_org_id order by e.seq asc
  loop
    if r.prev_hash is distinct from v_expected_prev then
      return r.seq;
    end if;
    v_canonical := public.canonical_payload(r.payload);
    v_payload_hash := public.ledger_payload_hash(v_canonical);
    v_expected_hash := public.ledger_entry_hash(r.prev_hash, v_payload_hash, v_canonical);
    if r.payload_hash is distinct from v_payload_hash or r.hash is distinct from v_expected_hash then
      return r.seq;
    end if;
    v_expected_prev := r.hash;
  end loop;
  return null;
end $$;

-- engagement_root_hash: the engagement's org must be the caller's. An unknown id keeps the previous
-- behaviour (the digest of the empty string) so callers do not change.
create or replace function public.engagement_root_hash(p_engagement_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select e.org_id into v_org from engagements e where e.id = p_engagement_id;
  if v_org is null then
    return encode(extensions.digest('', 'sha256'), 'hex');
  end if;
  perform public.provio_org_guard(v_org);
  return (select encode(extensions.digest(coalesce(string_agg(e.hash, E'\n' order by e.seq), ''), 'sha256'), 'hex')
            from ledger_entries e
           where e.org_id = v_org
             and e.payload ->> 'engagement_id' = p_engagement_id::text);
end $$;

-- board_pack_get: p_id is a pack id; its org must be the caller's.
drop function if exists public.board_pack_get(uuid);
create or replace function public.board_pack_get(p_id uuid)
returns table (id uuid, scope_key text, data_hash text, snapshot jsonb, generated_at timestamptz,
               previous_pack_id uuid, ledger_entry_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select h.org_id into v_org from board_pack_history h where h.id = p_id;
  perform public.provio_org_guard(v_org);
  return query
    select h.id, h.scope_key, h.data_hash, h.snapshot, h.generated_at, h.previous_pack_id, h.ledger_entry_id
      from board_pack_history h
     where h.id = p_id
       and (public.is_platform_admin() or public.caller_has_right('view_board_pack'));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Engagement-state helpers. is_engagement_sealed and reopen_granted are called by the pinning
--    trigger on the caller's own engagement, so they must accept the caller's org only.
-- ---------------------------------------------------------------------------
create or replace function public.is_engagement_sealed(p_engagement_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select e.org_id into v_org from engagements e where e.id = p_engagement_id;
  perform public.provio_org_guard(v_org);
  return coalesce((select e.sealed from engagements e where e.id = p_engagement_id), false);
end $$;

create or replace function public.reopen_granted(p_engagement_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select e.org_id into v_org from engagements e where e.id = p_engagement_id;
  perform public.provio_org_guard(v_org);
  return exists (
    select 1 from reopen_grants g
    where g.engagement_id = p_engagement_id and g.txid = txid_current());
end $$;

-- ---------------------------------------------------------------------------
-- 7. Write helpers. These wrote another org's rows with no check at all.
-- ---------------------------------------------------------------------------
create or replace function public.admin_next_version(p_org uuid, p_key text)
returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return (select coalesce(max(version), 0) + 1 from config_versions where org_id = p_org and key = p_key);
end $$;

create or replace function public.admin_log_change(
  p_org uuid, p_key text, p_value jsonb, p_action text, p_object_type text, p_object_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  insert into config_versions (org_id, key, value, version, actor_id)
  values (p_org, p_key, coalesce(p_value, '{}'::jsonb), public.admin_next_version(p_org, p_key), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (p_org, auth.uid(), p_action, p_object_type, p_object_id, coalesce(p_value, '{}'::jsonb));
end $$;

create or replace function public.append_ledger_entry(
  p_org_id uuid, p_action text, p_payload jsonb, p_actor_id uuid default null
) returns ledger_entries
language plpgsql security definer set search_path = public as $$
declare
  e ledger_entries;
begin
  perform public.provio_org_guard(p_org_id);
  insert into ledger_entries (org_id, prev_hash, hash, payload_hash, actor_id, action, payload)
  values (p_org_id, '', '', '', coalesce(p_actor_id, auth.uid()), p_action, coalesce(p_payload, '{}'::jsonb))
  returning * into e;
  return e;
end $$;

create or replace function public.emit_event(p_org uuid, p_event_key text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public.provio_org_guard(p_org);
  insert into automation_events (org_id, event_key, payload, actor_id)
  values (p_org, p_event_key, public.mask_secrets(coalesce(p_payload, '{}'::jsonb)), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.queue_email(
  p_org_id uuid, p_to_addresses text[], p_subject text, p_body_html text, p_body_text text, p_metadata jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_org_id is null then
    raise exception 'org is required' using errcode = 'P0001';
  end if;
  perform public.provio_org_guard(p_org_id);
  insert into email_queue (org_id, to_addresses, subject, body_html, body_text, metadata)
  values (p_org_id, coalesce(p_to_addresses, '{}'), p_subject, p_body_html, p_body_text,
          coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.automation_rule_version_write(
  p_org uuid, p_rule_id uuid, p_action text, p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_id uuid;
  v_hash text;
begin
  perform public.provio_org_guard(p_org);
  select row_hash into v_prev from automation_rule_versions
   where entity_id = p_rule_id
   order by created_at desc, id desc limit 1;

  v_hash := encode(extensions.digest(
    coalesce(v_prev, '') || p_org::text || p_rule_id::text || p_action ||
    coalesce(p_payload, '{}'::jsonb)::text || now()::text, 'sha256'), 'hex');

  insert into automation_rule_versions (org_id, entity, entity_id, action, payload, actor, actor_id, prev_hash, row_hash)
  values (p_org, 'automation_rule', p_rule_id, p_action,
          public.mask_secrets(coalesce(p_payload, '{}'::jsonb)),
          case when public.is_platform_admin() then 'platform' else 'tenant' end,
          auth.uid(), v_prev, v_hash)
  returning id into v_id;
  return v_id;
end $$;

-- hosting_connection_test_result: the connection's org must be the caller's. It is written by the
-- hosting-test Edge Function with the service role, which the guard does not constrain.
create or replace function public.hosting_connection_test_result(
  p_connection_id uuid, p_result text, p_detail text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select c.org_id into v_org from hosting_connections c where c.id = p_connection_id;
  perform public.provio_org_guard(v_org);
  update hosting_connections
     set last_test_at = now(), last_test_result = p_result, last_test_detail = p_detail, updated_at = now()
   where id = p_connection_id;
end $$;

-- ---------------------------------------------------------------------------
-- 8. The second pass. A mechanical probe of every authenticated security-definer function (the
--    generator behind supabase/tests/82) found six more that accepted an Org A handle from an Org B
--    caller after the first pass was written.
-- ---------------------------------------------------------------------------

-- board_pack_list: the org argument was never checked.
drop function if exists public.board_pack_list(uuid, text);
create or replace function public.board_pack_list(p_org uuid, p_scope_key text default null)
returns table (
  id uuid, scope_key text, scope_description text, boundary_kind text, from_ts timestamptz,
  to_ts timestamptz, generated_by uuid, generated_at timestamptz, data_hash text,
  status text, ledger_entry_id uuid, previous_pack_id uuid
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return query
    select h.id, h.scope_key, h.scope_description, h.boundary_kind, h.from_ts, h.to_ts,
           h.generated_by, h.generated_at, h.data_hash, h.status, h.ledger_entry_id, h.previous_pack_id
      from board_pack_history h
     where h.org_id = p_org
       and (p_scope_key is null or h.scope_key = p_scope_key)
       and (public.is_platform_admin() or public.caller_has_right('view_board_pack'))
     order by h.generated_at desc;
end $$;

-- list_tenant_entitlements: it returned another org's plan name and reason.
create or replace function public.list_tenant_entitlements(p_org uuid)
returns table (feature_key text, enabled boolean, plan_name text, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  return query
    select c.key,
           coalesce(e.enabled, c.default_on) as enabled,
           e.plan_name, e.reason
      from feature_catalogue c
      left join tenant_entitlements e on e.org_id = p_org and e.feature_key = c.key
     order by c.group_name, c.key;
end $$;

-- email_resolve_profile: called by the dispatcher (service role, allowed) and by the admin screen
-- for the caller's own org. A tenant must not resolve another org's profile.
create or replace function public.email_resolve_profile(p_org uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid; v_allow boolean; v_fallback boolean; v_forced uuid;
begin
  perform public.provio_org_guard(p_org);
  -- A forced platform profile wins.
  select id into v_forced from email_sender_profiles
   where org_id = p_org and forced and enabled limit 1;
  if v_forced is not null then
    return v_forced;
  end if;

  -- The tenant's own profile if enabled, ok and allowed.
  select allow_tenant_profile, fallback_to_platform into v_allow, v_fallback
    from email_sender_profiles where org_id = p_org and scope = 'tenant' limit 1;
  if coalesce(v_allow, true) then
    select id into v_id from email_sender_profiles
     where org_id = p_org and enabled and status = 'ok' limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- The platform default if the tenant may fall back to it.
  if coalesce(v_fallback, true) then
    select id into v_id from email_sender_profiles
     where org_id is null and is_default and enabled limit 1;
  end if;
  return v_id;
end $$;

-- render_notification: p_org selected another org's template body.
create or replace function public.render_notification(p_org uuid, p_event_key text, p_payload jsonb)
returns table (subject text, body_html text, body_text text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tpl notification_templates;
  v_block jsonb;
  v_html text := '';
  v_text text := '';
  v_what text;
begin
  perform public.provio_org_guard(p_org);
  select * into v_tpl from notification_templates t
   where t.event_key = p_event_key and t.locale = 'en'
     and (t.org_id = p_org or t.org_id is null)
   order by t.org_id nulls last limit 1;

  v_what := coalesce(p_payload ->> 'summary', p_event_key);

  if not found or v_tpl.blocks is null or jsonb_array_length(v_tpl.blocks) = 0 then
    return query select
      ('Provio: ' || replace(p_event_key, '.', ' '))::text,
      ('<p>' || replace(coalesce(v_what, p_event_key), '<', '&lt;') || '</p>')::text,
      coalesce(v_what, p_event_key);
    return;
  end if;

  for v_block in select * from jsonb_array_elements(v_tpl.blocks) loop
    v_html := v_html || coalesce(v_block ->> 'html', '');
    v_text := v_text || coalesce(v_block ->> 'text', '') || E'\n';
  end loop;
  return query select v_tpl.subject, v_html, btrim(v_text);
end $$;

-- rule_recipients: it resolved the org's role members and the platform recipient list.
create or replace function public.rule_recipients(p_org uuid, p_action jsonb)
returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_addresses text[] := '{}';
  v_fixed jsonb := p_action -> 'to_addresses';
  v_roles jsonb := p_action -> 'to_roles';
  v_users jsonb := p_action -> 'to_users';
begin
  perform public.provio_org_guard(p_org);
  -- The platform recipients list (SA-05), when the action targets it.
  if coalesce((p_action ->> 'to_platform_recipients')::boolean, false) then
    v_addresses := v_addresses || (
      select coalesce(array_agg(address), '{}') from platform_notification_recipients);
  end if;

  if v_fixed is not null and jsonb_typeof(v_fixed) = 'array' then
    v_addresses := v_addresses || (select coalesce(array_agg(value::text), '{}') from jsonb_array_elements_text(v_fixed));
  end if;

  if v_users is not null and jsonb_typeof(v_users) = 'array' then
    v_addresses := v_addresses || (
      select coalesce(array_agg(distinct u.email), '{}')
        from jsonb_array_elements_text(v_users) uid
        join auth.users u on u.id = uid::uuid);
  end if;

  if v_roles is not null and jsonb_typeof(v_roles) = 'array' then
    v_addresses := v_addresses || (
      select coalesce(array_agg(distinct u.email), '{}')
        from jsonb_array_elements_text(v_roles) rslug
        join roles r on r.org_id = p_org and r.slug = rslug
        join org_members m on m.org_id = p_org and m.role_id = r.id
        join auth.users u on u.id = m.user_id);
  end if;

  return coalesce(v_addresses, '{}');
end $$;

-- rule_loop_guard: it paused another org's rule when the event count was high.
create or replace function public.rule_loop_guard(p_rule_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_org uuid;
  v_count int;
begin
  select r.event_key, r.org_id into v_key, v_org from automation_rules r where r.id = p_rule_id;
  if v_key is null then
    return true;
  end if;
  perform public.provio_org_guard(v_org);
  select count(*) into v_count from automation_events e
   where e.event_key = v_key
     and coalesce(e.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_org, '00000000-0000-0000-0000-000000000000'::uuid)
     and e.created_at > now() - interval '1 hour';
  if v_count > 20 then
    update automation_rules
       set paused_at = now(), pause_reason = 'paused: more than 20 events in an hour', updated_at = now()
     where id = p_rule_id and paused_at is null;
    return false;
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Grants: keep the existing surface. The helper stays application-callable because the other
--    definer functions call it, and it is inert without a JWT org claim.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
  sigs text[] := array[
    'get_org_settings_extra(uuid)',
    'entity_approval_config(uuid)',
    'plan_approval_config(uuid)',
    'org_required_sections(uuid)',
    'sira_band_for(uuid, numeric)',
    'sira_model_snapshot(uuid)',
    'consultation_active(uuid)',
    'secret_display(uuid)',
    'automation_rule_list(uuid)',
    'notification_template_list(uuid)',
    'email_sender_profiles_list(uuid)',
    'verify_ledger(uuid)',
    'engagement_root_hash(uuid)',
    'board_pack_get(uuid)',
    'is_engagement_sealed(uuid)',
    'reopen_granted(uuid)',
    'admin_next_version(uuid, text)',
    'admin_log_change(uuid, text, jsonb, text, text, uuid)',
    'append_ledger_entry(uuid, text, jsonb, uuid)',
    'emit_event(uuid, text, jsonb)',
    'queue_email(uuid, text[], text, text, text, jsonb)',
    'automation_rule_version_write(uuid, uuid, text, jsonb)',
    'hosting_connection_test_result(uuid, text, text)',
    'board_pack_list(uuid, text)',
    'list_tenant_entitlements(uuid)',
    'email_resolve_profile(uuid)',
    'render_notification(uuid, text, jsonb)',
    'rule_recipients(uuid, jsonb)',
    'rule_loop_guard(uuid)'
  ];
begin
  foreach fn in array sigs loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
