-- 0056: Automation engine, notification and email RPCs (S2.a, F6, F7).
--
-- The engine is deterministic (L1). It reads automation_events (written by the config-area triggers,
-- 0051), matches enabled rules whose conditions pass, and for each action writes in-app
-- notifications (notifications) and queued email (email_queue via queue_email, 0039). It never sends
-- anything itself: the email-dispatch Edge Function (S2.d) does that.
--
-- Loop guard (F7): an action cannot trigger its own rule; more than 20 events per rule per hour
-- auto-pauses the rule with a notice.
--
-- M1: grepped; no name below existed. M2: create or replace throughout.

-- ---------------------------------------------------------------------------
-- 0. email_queue gains the dispatcher columns (F6): attempts, the retry clock, the provider answer
--    and the provider message id. M1: email_queue exists (0039); it is extended, not recreated.
--    M2: add column if not exists, so a second apply is a no-op.
-- ---------------------------------------------------------------------------
alter table email_queue add column if not exists attempts int not null default 0;
alter table email_queue add column if not exists next_attempt_at timestamptz;
alter table email_queue add column if not exists provider text;
alter table email_queue add column if not exists response_code int;
alter table email_queue add column if not exists provider_message_id text;
alter table email_queue add column if not exists accepted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eq_status_check') then
    alter table email_queue drop constraint if exists email_queue_status_check;
    alter table email_queue add constraint eq_status_check
      check (status in ('pending','sent','failed','accepted','expired'));
  end if;
end $$;

create index if not exists email_queue_pending_idx on email_queue (status, next_attempt_at, created_at);

-- ---------------------------------------------------------------------------
-- 1. emit_event — the one way a non-configuration event enters the outbox. Configuration changes
--    arrive through the 0051 trigger; everything else calls this.
-- ---------------------------------------------------------------------------
create or replace function public.emit_event(
  p_org uuid, p_event_key text, p_payload jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into automation_events (org_id, event_key, payload, actor_id)
  values (p_org, p_event_key, public.mask_secrets(coalesce(p_payload, '{}'::jsonb)), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The loop guard. Count events of this rule's event key in the last hour; a rule that has fired
--    more than 20 times pauses itself.
-- ---------------------------------------------------------------------------
create or replace function public.rule_loop_guard(p_rule_id uuid) returns boolean
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
-- 3. Recipient resolution for an action. Roles are matched against the org's role rights, named
--    users by id, fixed addresses by literal. Returns addresses.
-- ---------------------------------------------------------------------------
create or replace function public.rule_recipients(p_org uuid, p_action jsonb)
returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_addresses text[] := '{}';
  v_fixed jsonb := p_action -> 'to_addresses';
  v_roles jsonb := p_action -> 'to_roles';
  v_users jsonb := p_action -> 'to_users';
begin
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
        join auth.users u on u.id = uid::uuid
       where exists (select 1 from org_members m where m.org_id = p_org and m.user_id = u.id));
  end if;

  if v_roles is not null and jsonb_typeof(v_roles) = 'array' then
    v_addresses := v_addresses || (
      select coalesce(array_agg(distinct u.email), '{}')
        from jsonb_array_elements_text(v_roles) slug
        join roles r on r.org_id = p_org and r.slug = slug
        join org_members m on m.org_id = p_org and m.role_id = r.id
        join auth.users u on u.id = m.user_id);
  end if;

  return (select coalesce(array_agg(distinct a), '{}') from unnest(v_addresses) a where a is not null and a <> '');
end $$;

-- ---------------------------------------------------------------------------
-- 4. rule_engine_process — evaluate one event against every matching enabled rule.
--    Returns the number of actions performed. Idempotent per event: an event already processed
--    (recorded in automation_event_processed) is skipped.
-- ---------------------------------------------------------------------------
create table if not exists automation_event_processed (
  event_id bigint primary key,
  processed_at timestamptz not null default now()
);
alter table automation_event_processed enable row level security;
drop policy if exists aep_select on automation_event_processed;
create policy aep_select on automation_event_processed for select to authenticated
  using (public.is_platform_admin());

create or replace function public.rule_engine_process(p_event_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_event automation_events;
  v_rule record;
  v_action jsonb;
  v_addrs text[];
  v_acted int := 0;
  v_role text;
  v_render record;
begin
  select * into v_event from automation_events where id = p_event_id;
  if not found then
    return 0;
  end if;
  if exists (select 1 from automation_event_processed where event_id = p_event_id) then
    return 0;
  end if;

  for v_rule in
    select r.* from automation_rules r
     where r.enabled and r.paused_at is null
       and r.event_key = v_event.event_key
       -- The tenant's own rule overrides the platform template with the same key.
       and (r.org_id = v_event.org_id
            or (r.org_id is null and not exists (
                  select 1 from automation_rules t
                   where t.org_id = v_event.org_id and t.rule_key = r.rule_key)))
     order by r.org_id nulls last, r.rule_key
  loop
    if not public.rule_conditions_ok(v_event.payload, v_rule.conditions) then
      continue;
    end if;
    if not public.rule_loop_guard(v_rule.id) then
      continue;
    end if;

    for v_action in select * from jsonb_array_elements(v_rule.actions)
    loop
      if v_action ->> 'type' = 'notify' then
        v_addrs := public.rule_recipients(v_event.org_id, v_action);
        -- In-app notification per targeted role or the org at large.
        v_role := coalesce(v_action ->> 'role_target', 'all');
        insert into notifications (org_id, user_id, kind, body, event_key, link, payload, role_target)
        values (v_event.org_id, null, v_event.event_key,
                coalesce(v_action ->> 'message', 'Configuration changed'),
                v_event.event_key, v_action ->> 'link', v_event.payload, v_role);

        if array_length(v_addrs, 1) is not null then
          v_render := public.render_notification(v_event.org_id, v_event.event_key, v_event.payload);
          perform public.queue_email(v_event.org_id, v_addrs,
            coalesce(v_render.subject, 'Provio notification'),
            v_render.body_html, v_render.body_text,
            jsonb_build_object('event_key', v_event.event_key, 'rule_key', v_rule.rule_key));
        end if;
        v_acted := v_acted + 1;

      elsif v_action ->> 'type' = 'set_flag' then
        insert into notifications (org_id, kind, body, event_key, payload, role_target)
        values (v_event.org_id, v_event.event_key,
                coalesce(v_action ->> 'message', 'Flag set'), v_event.event_key, v_event.payload,
                coalesce(v_action ->> 'role_target', 'all'));
        v_acted := v_acted + 1;

      elsif v_action ->> 'type' = 'webhook' then
        insert into automation_webhook_outbox (org_id, url, payload, signing_secret_id)
        values (v_event.org_id, v_action ->> 'url',
                public.mask_secrets(v_event.payload), null);
        v_acted := v_acted + 1;
      end if;
    end loop;
  end loop;

  insert into automation_event_processed (event_id) values (p_event_id) on conflict do nothing;
  return v_acted;
end $$;

-- The outbound webhook queue (F7). The payload never contains a secret; the signing key lives in
-- secret_store and is read only by the dispatcher.
create table if not exists automation_webhook_outbox (
  id uuid primary key default gen_random_uuid()
);
alter table automation_webhook_outbox add column if not exists org_id uuid;
alter table automation_webhook_outbox add column if not exists url text;
alter table automation_webhook_outbox add column if not exists payload jsonb not null default '{}'::jsonb;
alter table automation_webhook_outbox add column if not exists signing_secret_id uuid;
alter table automation_webhook_outbox add column if not exists status text not null default 'pending';
alter table automation_webhook_outbox add column if not exists attempts int not null default 0;
alter table automation_webhook_outbox add column if not exists last_error text;
alter table automation_webhook_outbox add column if not exists created_at timestamptz not null default now();

alter table automation_webhook_outbox enable row level security;
drop policy if exists awo_select on automation_webhook_outbox;
create policy awo_select on automation_webhook_outbox for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 5. render_notification — turn an event into a subject and body from the tenant's template, or the
--    platform template, or a plain fallback. Variables are escaped; a secret value never appears
--    (mask_secrets runs on the payload before it is stored, and the renderer escapes).
-- ---------------------------------------------------------------------------
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
    if v_block ->> 'type' = 'heading' then
      v_html := v_html || '<h2>' || replace(coalesce(v_block ->> 'text',''), '<', '&lt;') || '</h2>';
      v_text := v_text || coalesce(v_block ->> 'text','') || E'\n';
    elsif v_block ->> 'type' = 'paragraph' then
      v_html := v_html || '<p>' || replace(coalesce(v_block ->> 'text',''), '<', '&lt;') || '</p>';
      v_text := v_text || coalesce(v_block ->> 'text','') || E'\n';
    elsif v_block ->> 'type' = 'link' then
      v_html := v_html || '<p><a href="' || replace(coalesce(v_block ->> 'href',''), '"', '%22') || '">'
                || replace(coalesce(v_block ->> 'text',''), '<', '&lt;') || '</a></p>';
      v_text := v_text || coalesce(v_block ->> 'text','') || ': ' || coalesce(v_block ->> 'href','') || E'\n';
    elsif v_block ->> 'type' = 'divider' then
      v_html := v_html || '<hr/>';
      v_text := v_text || E'\n';
    end if;
  end loop;

  return query select
    coalesce(nullif(v_tpl.subject, ''), 'Provio notification'),
    v_html, v_text;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Automation rule and template RPCs (F7). Writes require edit_config (or a tier-1 session) and
--    write append-only history.
-- ---------------------------------------------------------------------------
create or replace function public.automation_rule_save(
  p_org uuid, p_rule_key text, p_name text, p_event_key text,
  p_conditions jsonb, p_actions jsonb, p_enabled boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_config_actor(p_org, 'edit_config');
  insert into automation_rules (org_id, rule_key, name, event_key, conditions, actions, enabled, created_by)
  values (p_org, p_rule_key, p_name, p_event_key, coalesce(p_conditions,'[]'::jsonb),
          coalesce(p_actions,'[]'::jsonb), coalesce(p_enabled, true), auth.uid())
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_key)
  do update set name = excluded.name, event_key = excluded.event_key,
                conditions = excluded.conditions, actions = excluded.actions,
                enabled = excluded.enabled, paused_at = null, pause_reason = null,
                updated_at = now()
  returning id into v_id;

  perform public.automation_rule_version_write(p_org, v_id, 'save',
    jsonb_build_object('rule_key', p_rule_key, 'event_key', p_event_key,
                       'enabled', p_enabled, 'conditions', p_conditions, 'actions', p_actions));
  return v_id;
end $$;

create or replace function public.automation_rule_list(p_org uuid)
returns table (
  id uuid, rule_key text, name text, event_key text, conditions jsonb, actions jsonb,
  enabled boolean, is_platform_template boolean, paused_at timestamptz, pause_reason text
)
language sql stable security definer set search_path = public as $$
  select r.id, r.rule_key, r.name, r.event_key, r.conditions, r.actions, r.enabled,
         r.is_platform_template, r.paused_at, r.pause_reason
    from automation_rules r
   where r.org_id = p_org or r.org_id is null
   order by r.org_id nulls last, r.rule_key
$$;

-- Test with a sample event (F7): a dry run that returns the recipients and the rendered message and
-- sends nothing.
create or replace function public.automation_rule_test(p_rule_id uuid, p_sample jsonb)
returns table (recipients text[], subject text, body_text text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_rule automation_rules;
  v_action jsonb;
  v_addrs text[] := '{}';
  v_render record;
begin
  select * into v_rule from automation_rules where id = p_rule_id;
  if not found then
    raise exception 'no such rule' using errcode = 'P0001';
  end if;
  if v_rule.org_id is not null then
    perform public.require_config_actor(v_rule.org_id, 'edit_config');
  elsif not public.is_platform_admin() then
    raise exception 'not allowed: only the platform admin edits a platform rule' using errcode = 'P0001';
  end if;

  for v_action in select * from jsonb_array_elements(v_rule.actions) loop
    if v_action ->> 'type' = 'notify' then
      v_addrs := v_addrs || public.rule_recipients(v_rule.org_id, v_action);
    end if;
  end loop;

  select * into v_render from public.render_notification(v_rule.org_id, v_rule.event_key, p_sample);
  return query select
    (select coalesce(array_agg(distinct a), '{}') from unnest(v_addrs) a),
    coalesce(v_render.subject, ''), coalesce(v_render.body_text, '');
end $$;

create or replace function public.notification_template_save(
  p_org uuid, p_event_key text, p_subject text, p_blocks jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_org is null then
    if not public.is_platform_admin() then
      raise exception 'not allowed: only the platform admin edits a platform template' using errcode = 'P0001';
    end if;
  else
    perform public.require_config_actor(p_org, 'edit_config');
  end if;

  insert into notification_templates (org_id, event_key, locale, subject, blocks, is_platform_template)
  values (p_org, p_event_key, 'en', p_subject, coalesce(p_blocks, '[]'::jsonb), p_org is null)
  on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), event_key, locale)
  do update set subject = excluded.subject, blocks = excluded.blocks, updated_at = now()
  returning id into v_id;

  insert into notification_template_versions (org_id, entity, entity_id, action, payload, actor, actor_id,
                                              prev_hash, row_hash)
  values (p_org, 'notification_template', v_id, 'save',
          jsonb_build_object('event_key', p_event_key, 'subject', p_subject, 'blocks', p_blocks),
          case when public.is_platform_admin() then 'platform' else 'tenant' end, auth.uid(),
          (select row_hash from notification_template_versions where entity_id = v_id order by created_at desc limit 1),
          encode(extensions.digest(coalesce(p_org::text,'') || v_id::text || p_event_key || now()::text, 'sha256'), 'hex'));
  return v_id;
end $$;

create or replace function public.notification_template_list(p_org uuid)
returns table (id uuid, event_key text, subject text, blocks jsonb, is_platform_template boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.event_key, t.subject, t.blocks, t.is_platform_template
    from notification_templates t
   where t.org_id = p_org or t.org_id is null
   order by t.org_id nulls last, t.event_key
$$;

-- ---------------------------------------------------------------------------
-- 7. Email sender profile RPCs and dispatcher state (F6).
-- ---------------------------------------------------------------------------
create or replace function public.email_profile_save(
  p_org uuid, p_scope text, p_provider text, p_display_name text, p_from_address text,
  p_reply_to text, p_provider_config jsonb, p_enabled boolean, p_daily_cap int default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_scope = 'platform' then
    if not public.is_platform_admin() then
      raise exception 'not allowed: only the platform admin edits the platform sender' using errcode = 'P0001';
    end if;
    p_org := null;
  else
    perform public.require_config_actor(p_org, 'edit_config');
  end if;

  select id into v_id from email_sender_profiles
   where coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org, '00000000-0000-0000-0000-000000000000'::uuid)
     and scope = p_scope
   order by created_at limit 1;

  if v_id is null then
    insert into email_sender_profiles (org_id, scope, provider, display_name, from_address, reply_to,
                                       provider_config, enabled, daily_cap, status)
    values (p_org, p_scope, p_provider, p_display_name, p_from_address, p_reply_to,
            coalesce(p_provider_config,'{}'::jsonb), coalesce(p_enabled,false), p_daily_cap, 'untested')
    returning id into v_id;
  else
    update email_sender_profiles
       set provider = p_provider, display_name = p_display_name, from_address = p_from_address,
           reply_to = p_reply_to, provider_config = coalesce(p_provider_config,'{}'::jsonb),
           enabled = coalesce(p_enabled,false), daily_cap = p_daily_cap,
           status = 'untested', updated_at = now()
     where id = v_id;
  end if;

  -- Append-only history (F2, L5). provider_config is masked: it holds no secret, but a caller may
  -- pass one by mistake and mask_secrets is cheap insurance.
  insert into email_profile_versions (org_id, entity, entity_id, action, payload, actor, actor_id,
                                      prev_hash, row_hash)
  values (p_org, 'email_sender_profile', v_id, 'save',
          public.mask_secrets(jsonb_build_object(
            'scope', p_scope, 'provider', p_provider, 'from_address', p_from_address,
            'enabled', p_enabled, 'provider_config', p_provider_config)),
          case when public.is_platform_admin() then 'platform' else 'tenant' end, auth.uid(),
          (select row_hash from email_profile_versions where entity_id = v_id order by created_at desc limit 1),
          encode(extensions.digest(coalesce(p_org::text,'') || v_id::text || p_provider || now()::text, 'sha256'), 'hex'));
  return v_id;
end $$;

-- The profile resolution order for one message (F6). Returns the profile id, or null for stub.
create or replace function public.email_resolve_profile(p_org uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid; v_allow boolean; v_fallback boolean; v_forced uuid;
begin
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
    if v_id is not null then
      return v_id;
    end if;
  end if;

  return null; -- stub: queued, not sent
end $$;

create or replace function public.email_profile_test_result(
  p_id uuid, p_result text, p_status text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from email_sender_profiles where id = p_id;
  if v_org is null and not public.is_platform_admin() then
    raise exception 'not allowed: only the platform admin tests the platform sender' using errcode = 'P0001';
  elsif v_org is not null then
    perform public.require_config_actor(v_org, 'edit_config');
  end if;
  update email_sender_profiles
     set last_test_at = now(), last_test_result = p_result, status = p_status, updated_at = now()
   where id = p_id;
end $$;

create or replace function public.email_sender_profiles_list(p_org uuid)
returns table (
  id uuid, org_id uuid, scope text, provider text, display_name text, from_address text,
  reply_to text, enabled boolean, is_default boolean, forced boolean, allow_tenant_profile boolean,
  fallback_to_platform boolean, daily_cap int, status text, last_test_at timestamptz, last_test_result text,
  credential_secret_id uuid, credential_display text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.org_id, p.scope, p.provider, p.display_name, p.from_address, p.reply_to,
         p.enabled, p.is_default, p.forced, p.allow_tenant_profile, p.fallback_to_platform,
         p.daily_cap, p.status, p.last_test_at, p.last_test_result, p.credential_secret_id,
         public.secret_display(p.credential_secret_id)
    from email_sender_profiles p
   where p.org_id = p_org or p.org_id is null
   order by p.org_id nulls last, p.scope
$$;

create or replace function public.email_set_default_profile(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: only the platform admin sets the platform default' using errcode = 'P0001';
  end if;
  update email_sender_profiles set is_default = false where org_id is null;
  update email_sender_profiles set is_default = true, enabled = true, updated_at = now() where id = p_id;
end $$;

create or replace function public.email_force_profile(
  p_org uuid, p_profile_id uuid, p_allow_tenant boolean, p_fallback boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: only the platform admin forces a sender' using errcode = 'P0001';
  end if;
  update email_sender_profiles
     set forced = (id = p_profile_id), allow_tenant_profile = p_allow_tenant,
         fallback_to_platform = p_fallback, updated_at = now()
   where org_id = p_org;
end $$;

-- The dispatcher claims a batch of pending rows (F6). Batch 10 by default; retry backoff is applied
-- by the dispatcher before it calls this.
create or replace function public.email_dispatch_claim(p_limit int default 10)
returns setof email_queue
language plpgsql security definer set search_path = public as $$
begin
  if current_user <> 'service_role' and not public.is_platform_admin() then
    raise exception 'not allowed: only the dispatcher claims email' using errcode = 'P0001';
  end if;
  return query
    select * from email_queue q
     where q.status = 'pending'
       and (q.next_attempt_at is null or q.next_attempt_at <= now())
       and q.created_at > now() - interval '7 days'
     order by q.created_at
     limit least(coalesce(p_limit, 10), 50);
end $$;

create or replace function public.email_dispatch_complete(
  p_id uuid, p_status text, p_provider text default null, p_response_code int default null,
  p_provider_message_id text default null, p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_attempts int;
begin
  if current_user <> 'service_role' and not public.is_platform_admin() then
    raise exception 'not allowed: only the dispatcher completes email' using errcode = 'P0001';
  end if;

  select attempts + 1 into v_attempts from email_queue where id = p_id;

  if p_status = 'sent' then
    update email_queue
       set status = 'sent', sent_at = now(), attempts = v_attempts, error_text = null,
           provider = p_provider, response_code = p_response_code,
           provider_message_id = p_provider_message_id, next_attempt_at = null
     where id = p_id;
  else
    update email_queue
       set status = case when v_attempts >= 5 then 'failed' else 'pending' end,
           attempts = v_attempts, error_text = public.mask_secrets_text(p_error),
           provider = p_provider, response_code = p_response_code,
           next_attempt_at = case v_attempts
             when 1 then now() + interval '1 minute'
             when 2 then now() + interval '5 minutes'
             when 3 then now() + interval '15 minutes'
             when 4 then now() + interval '60 minutes'
             else now() + interval '240 minutes' end
     where id = p_id;
  end if;
end $$;

-- Redact anything that looks like a credential from a provider error before it is stored (F5).
create or replace function public.mask_secrets_text(p_text text) returns text
language sql immutable as $$
  select case when p_text is null then null else
    regexp_replace(p_text, '(?i)(api[_-]?key|token|password|secret|bearer)\s*[:=]?\s*\S+', '\1 ••••', 'g')
  end
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'automation_rule_save','automation_rule_list','automation_rule_test',
      'notification_template_save','notification_template_list',
      'email_profile_save','email_resolve_profile','email_profile_test_result',
      'email_sender_profiles_list','email_set_default_profile','email_force_profile',
      'emit_event','rule_loop_guard','rule_recipients','render_notification','mask_secrets_text')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

-- The dispatcher's claim/complete and the engine run are service_role surfaces.
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'email_dispatch_claim','email_dispatch_complete','rule_engine_process')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. The config-area notify triggers. 0051 created them for the areas registered at that time; this
--    re-runs the same loop so the areas registered by 0054 also get their trigger. Idempotent:
--    drop trigger if exists, then create (M2). notify_policy = 'none' registers but emits nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  a record;
begin
  for a in select history_table from config_areas where notify_policy <> 'none' loop
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = a.history_table) then
      execute format('drop trigger if exists %I on public.%I',
                     'cfg_notify_' || a.history_table, a.history_table);
      execute format('create trigger %I after insert on public.%I for each row execute function public.config_area_notify()',
                     'cfg_notify_' || a.history_table, a.history_table);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Seeded platform default rules (F7). Enabled, platform-level (org_id null). A tenant copies and
--     edits one; a tenant rule with the same key overrides it.
--     config.changed -> the tenant's Org Admins AND the platform recipients.
--     ai_model.changed -> the platform recipients ONLY.
-- ---------------------------------------------------------------------------
insert into automation_rules (org_id, rule_key, name, event_key, conditions, actions, enabled, is_platform_template)
values
  (null, 'platform.config.changed', 'Tell admins when configuration changes', 'config.changed',
   '[]'::jsonb,
   jsonb_build_array(
     jsonb_build_object('type','notify','role_target','org_admin',
       'to_roles', jsonb_build_array('org_admin'),
       'message','A configuration change was recorded.'),
     jsonb_build_object('type','notify','role_target','platform_recipients',
       'to_platform_recipients', true,
       'message','A tenant configuration changed.')),
   true, true),
  (null, 'platform.ai_model.changed', 'Tell the platform when an AI model changes', 'ai_model.changed',
   '[]'::jsonb,
   jsonb_build_array(
     jsonb_build_object('type','notify','role_target','platform_recipients',
       'to_platform_recipients', true,
       'message','The AI model registry changed.')),
   true, true),
  (null, 'platform.feature.changed', 'Tell both sides when a feature changes', 'feature.changed',
   '[]'::jsonb,
   jsonb_build_array(
     jsonb_build_object('type','notify','role_target','org_admin',
       'to_roles', jsonb_build_array('org_admin'),
       'message','A feature entitlement changed.')),
   true, true)
on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_key) do nothing;

-- A seeded default template for the three events above, so a message reads in plain language even
-- before anyone writes a template (F7).
insert into notification_templates (org_id, event_key, locale, subject, blocks, is_platform_template)
values
  (null, 'config.changed', 'en', 'Provio: a configuration change was recorded',
   jsonb_build_array(
     jsonb_build_object('type','heading','text','A configuration change was recorded'),
     jsonb_build_object('type','paragraph','text','What changed: a setting in this area was updated.'),
     jsonb_build_object('type','paragraph','text','Who: the change is attributed in your configuration history.'),
     jsonb_build_object('type','link','text','Open your configuration history','href','/'),
     jsonb_build_object('type','divider')),
   true),
  (null, 'ai_model.changed', 'en', 'Provio: the AI model registry changed',
   jsonb_build_array(
     jsonb_build_object('type','heading','text','The AI model registry changed'),
     jsonb_build_object('type','paragraph','text','A model was added, changed or removed.'),
     jsonb_build_object('type','link','text','Open the AI model registry','href','/superadmin'),
     jsonb_build_object('type','divider')),
   true),
  (null, 'feature.changed', 'en', 'Provio: a feature entitlement changed',
   jsonb_build_array(
     jsonb_build_object('type','heading','text','A feature entitlement changed'),
     jsonb_build_object('type','paragraph','text','A feature was turned on or off for your organisation.'),
     jsonb_build_object('type','link','text','See your features','href','/'),
     jsonb_build_object('type','divider')),
   true)
on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), event_key, locale) do nothing;

-- ---------------------------------------------------------------------------
-- 11. Feature entitlements for the email adapters (F25). Each adapter belongs to a feature key, so
--     an Org Admin saving a Resend profile is refused when the tenant does not have email_resend.
-- ---------------------------------------------------------------------------
insert into feature_catalogue (key, label, description, group_name, price_class, default_on, requires, status)
values
  ('email_resend', 'Email through Resend', 'Send your own email with a Resend key', 'Email', 'add_on', false, '{}', 'live'),
  ('email_graph',  'Email through Microsoft', 'Send your own email through Microsoft Graph', 'Email', 'add_on', false, '{}', 'live'),
  ('email_smtp',   'Email through SMTP', 'Send your own email through your own mail server', 'Email', 'add_on', false, '{}', 'live')
on conflict (key) do nothing;

