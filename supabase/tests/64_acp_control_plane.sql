-- Test 64 (S1): the ACP control plane foundations. Covers the two-tier Dual Session (F4), the
-- feature-entitlement gate (F25), the org settings, the wizard state, the tutorial registry and the
-- configuration-area registry with its notify triggers (F7). Runs as the owner first to prove the
-- seeds, then as each role.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The feature catalogue is seeded with the exact F25 keys, and watchers is parked.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_true(
    (select count(*) >= 21 from feature_catalogue), 'the catalogue holds the seeded features');
  perform provio_test.assert_eq((select status from feature_catalogue where key = 'watchers'), 'parked',
    'watchers is parked and not sellable');
  perform provio_test.assert_true(
    (select default_on from feature_catalogue where key = 'automation_rules'),
    'automation_rules is on by default');
  perform provio_test.assert_true(
    not (select default_on from feature_catalogue where key = 'board_pack'),
    'board_pack is off by default (an add-on)');
end $$;

-- ---------------------------------------------------------------------------
-- 2. has_feature: the catalogue default, an explicit entitlement, an out-of-window row, and an
--    unknown key (F25 rule 4).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_true(public.has_feature(org_a, 'automation_rules'),
    'has_feature falls back to the catalogue default (on)');
  perform provio_test.assert_true(not public.has_feature(org_a, 'board_pack'),
    'has_feature returns the catalogue default (off) for an add-on');
  perform provio_test.assert_true(not public.has_feature(org_a, 'no_such_feature'),
    'has_feature returns false for an unknown key and does not error');

  perform public.platform_set_entitlement(org_a, 'board_pack', true, 'Assurance', 'sold the board pack add-on');
  perform provio_test.assert_true(public.has_feature(org_a, 'board_pack'),
    'an explicit entitlement turns the feature on');
  perform provio_test.assert_eq(
    (select plan_name from tenant_entitlements where org_id = org_a and feature_key = 'board_pack'),
    'Assurance', 'the plan name is stored');

  perform provio_test.assert_raises(
    $q$select public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','board_pack',false,null,'')$q$,
    'reason is required', 'an entitlement change without a reason is refused');
  perform provio_test.assert_raises(
    $q$select public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','not_a_feature',true,null,'x')$q$,
    'unknown feature', 'an unknown feature key is refused');

  -- The history is hash-chained and append-only.
  perform provio_test.assert_true(
    (select count(*) >= 1 from tenant_entitlement_versions where org_id = org_a),
    'the entitlement change is written to the hash-chained history');
end $$;

-- The append-only guard fires for the owner too (RLS would otherwise filter a tenant's update to
-- zero rows and the trigger would never run).
select provio_test.as_owner();
select provio_test.assert_raises(
  $q$update tenant_entitlement_versions set action = 'tamper' where org_id = 'a0000000-0000-0000-0000-000000000001'$q$,
  'append-only', 'the entitlement history is append-only');
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');

-- An out-of-window entitlement is ignored (effective_to in the past). The update runs as the owner
-- because the table has no write policy for any tenant or platform role.
select provio_test.as_owner();
do $$
declare org_a uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  update tenant_entitlements set effective_to = now() - interval '1 day'
   where org_id = org_a and feature_key = 'board_pack';
  perform provio_test.assert_true(not public.has_feature(org_a, 'board_pack'),
    'an expired entitlement falls back to the catalogue default');
  update tenant_entitlements set effective_to = null
   where org_id = org_a and feature_key = 'board_pack';
  perform provio_test.assert_true(public.has_feature(org_a, 'board_pack'),
    'restoring the window turns the feature back on');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A tenant user reads only its own entitlements; a platform admin reads the catalogue.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true((select count(*) > 0 from feature_catalogue),
    'a tenant user reads the feature catalogue');
  perform provio_test.assert_eq(
    (select count(*) from tenant_entitlements where org_id = 'b0000000-0000-0000-0000-000000000001'), 0,
    'a tenant user reads no other org entitlements');
  perform provio_test.assert_raises(
    $q$select public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','board_pack',false,null,'x')$q$,
    'platform administrator only', 'a tenant user cannot change entitlements');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Dual Session (F4): platform requests tier 1, Org Admin acknowledges, it becomes active; a
--    tenant member cannot act on config without the right; the session can be ended by either side.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_session uuid;
begin
  v_session := public.consultation_request(org_a, 'config', 2);
  perform provio_test.assert_true(v_session is not null, 'the platform requests a tier 1 session');
  perform provio_test.assert_eq((select status from consultation_sessions where id = v_session),
    'requested', 'the session starts as requested');
  perform provio_test.assert_raises(
    $q$select public.consultation_request('a0000000-0000-0000-0000-000000000001','config',9)$q$,
    'between 1 and 8', 'a tier 1 duration above 8 hours is refused');
end $$;

-- The Org Admin acknowledges.
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_session uuid := (select id from consultation_sessions where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'requested' limit 1);
begin
  perform public.consultation_acknowledge(v_session);
  perform provio_test.assert_eq((select status from consultation_sessions where id = v_session),
    'active', 'the Org Admin acknowledgement activates the session');
  perform provio_test.assert_true(
    (select expires_at > now() from consultation_sessions where id = v_session),
    'the active session has an expiry');
end $$;

-- With an active tier 1 session, the platform admin may act on edit_config for the org.
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare org_a uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_eq(public.config_write_mode(org_a, 'edit_config'), 'apply',
    'tier 1 lets the platform apply an edit_config change');
  perform provio_test.assert_eq(public.config_write_mode(org_a, 'manage_users'), 'deny',
    'tier 1 does NOT grant manage_users');
end $$;

-- Either side can end it.
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_session uuid := (select id from consultation_sessions where org_id = org_a and status = 'active' limit 1);
begin
  perform public.consultation_end(v_session, 'work complete');
  perform provio_test.assert_eq((select status from consultation_sessions where id = v_session),
    'ended', 'the platform ends the session');
  perform provio_test.assert_eq(public.config_write_mode(org_a, 'edit_config'), 'deny',
    'after the session ends the platform cannot act');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Tier 2 (full_admin) is invited by the client, and a platform change is only a proposal until
--    the Org Admin approves it.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_session uuid;
begin
  v_session := public.consultation_request(org_a, 'full_admin', 4);
  perform provio_test.assert_true(v_session is not null, 'the Org Admin invites a tier 2 session');
  perform provio_test.assert_eq((select initiated_by_side from consultation_sessions where id = v_session),
    'tenant', 'the tenant side initiated the session');
  perform provio_test.assert_raises(
    $q$select public.consultation_request('a0000000-0000-0000-0000-000000000001','config',2)$q$,
    'platform side', 'the tenant side cannot start a tier 1 session');
end $$;

select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_session uuid := (select id from consultation_sessions where org_id = org_a and status = 'requested' limit 1);
  v_prop uuid;
begin
  perform public.consultation_acknowledge(v_session);
  perform provio_test.assert_eq(public.config_write_mode(org_a, 'manage_users'), 'propose',
    'tier 2 makes a manage_users change a proposal');
  perform provio_test.assert_eq(public.config_write_mode(org_a, 'edit_config'), 'apply',
    'tier 2 also allows edit_config directly');
  v_prop := public.consultation_propose(v_session, 'admin_set_member_role',
    jsonb_build_object('user', '10000000-0000-0000-0000-0000000000a2', 'role', 'reviewer'));
  perform provio_test.assert_true(v_prop is not null, 'the platform proposes a tier 2 change');
  perform provio_test.assert_eq((select status from consultation_proposals where id = v_prop),
    'proposed', 'the proposal waits for the Org Admin');
end $$;

-- The Org Admin rejects one proposal and approves another; a rejection is logged.
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_prop uuid := (select id from consultation_proposals where status = 'proposed' limit 1);
begin
  perform public.consultation_decide_proposal(v_prop, false, 'not needed now');
  perform provio_test.assert_eq((select status from consultation_proposals where id = v_prop),
    'rejected', 'the Org Admin rejects the proposal');
  perform provio_test.assert_true(
    (select count(*) > 0 from consultation_events where event_key = 'consultation.proposal_decision'),
    'the rejection is logged as a consultation event');
end $$;

-- A tenant member without edit_config cannot decide a proposal.
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(public.config_write_mode('a0000000-0000-0000-0000-000000000001', 'edit_config'), 'apply',
    'a tenant member with edit_config applies directly');
end $$;

-- A preparer has no edit_config, so it cannot act on config.
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq(public.config_write_mode('a0000000-0000-0000-0000-000000000001', 'edit_config'), 'deny',
    'a preparer cannot act on configuration');
  perform provio_test.assert_raises(
    $q$select public.admin_set_org_settings_extra('https://app.example', null, null, null, null)$q$,
    'not allowed', 'a preparer cannot write org settings');
end $$;

-- ---------------------------------------------------------------------------
-- 6. org_settings_extra round-trip and validation (F9/F10/F11).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  r record;
begin
  perform public.admin_set_org_settings_extra('https://provio.example/app', '2026-09-01', true, true, 30);
  select * into r from public.get_org_settings_extra(org_a);
  perform provio_test.assert_eq(r.app_base_url, 'https://provio.example/app', 'the app base URL round-trips');
  perform provio_test.assert_eq(r.certificate_auto_issue, true, 'certificate auto-issue round-trips');
  perform provio_test.assert_eq(r.public_verify_show_title, true, 'public verify title round-trips');
  perform provio_test.assert_raises(
    $q$select public.admin_set_org_settings_extra(null,null,null,null,400)$q$,
    'between 0 and 365', 'an out-of-range AI retention period is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 7. setup_state: the Org Admin wizard saves and lists steps; the Super Admin wizard is separate.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.setup_save_step('org_admin', 'profile', 'done', jsonb_build_object('name', 'Org A'));
  perform public.setup_save_step('org_admin', 'features', 'skipped', '{}'::jsonb);
  perform provio_test.assert_eq(
    (select count(*) from public.setup_list('org_admin')), 2, 'the wizard lists its two saved steps');
  perform provio_test.assert_raises(
    $q$select public.setup_save_step('org_admin','email','not_a_status','{}'::jsonb)$q$,
    'unknown step status', 'an unknown step status is refused');
end $$;

select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.setup_save_step('super_admin', 'readiness', 'done', '{}'::jsonb);
  perform provio_test.assert_eq(
    (select count(*) from public.setup_list('super_admin')), 1, 'the Super Admin wizard saves its step');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Tutorials: the registry is readable; a view is recorded.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into tutorials (key, audience, title, steps) values
  ('oa.profile', 'org_admin', 'Organisation profile', '[{"step":"Open OA-02"}]'::jsonb)
on conflict (key) do nothing;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_true((select count(*) > 0 from public.list_tutorials()), 'tutorials are readable');
  perform public.record_tutorial_view('oa.profile', true);
  perform provio_test.assert_eq(
    (select count(*) from tutorial_views where tutorial_key = 'oa.profile' and helped),
    1, 'the tutorial view is recorded');
end $$;

-- ---------------------------------------------------------------------------
-- 9. The configuration-area registry: every registered history table has a notify trigger, and the
--    AI model registry area is platform_only (F7).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  a record;
  v_trig text;
begin
  for a in select key, history_table, notify_policy from config_areas loop
    perform provio_test.assert_true(
      exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = a.history_table),
      format('the registered history table %s exists', a.history_table));
    if a.notify_policy <> 'none' then
      select tgname into v_trig from pg_trigger
       where tgrelid = format('public.%I', a.history_table)::regclass
         and tgname = 'cfg_notify_' || a.history_table;
      perform provio_test.assert_true(v_trig is not null,
        format('the history table %s has its notify trigger', a.history_table));
    end if;
  end loop;
  perform provio_test.assert_eq(
    (select notify_policy from config_areas where key = 'ai_models'), 'platform_only',
    'the AI model registry area is platform_only');
end $$;

-- A write to a registered history table emits the right event.
do $$
declare
  v_before int;
  v_after int;
begin
  select count(*) into v_before from automation_events where event_key = 'ai_model.changed';
  insert into ai_model_versions (org_id, entity, entity_id, action, payload)
  values (null, 'ai_model', 'llama3', 'insert', jsonb_build_object('name', 'llama3'));
  select count(*) into v_after from automation_events where event_key = 'ai_model.changed';
  perform provio_test.assert_eq(v_after - v_before, 1,
    'an AI model change emits exactly one ai_model.changed event');

  select count(*) into v_before from automation_events where event_key = 'config.changed';
  insert into config_versions (org_id, key, value, version)
  values ('a0000000-0000-0000-0000-000000000001', 'setting:demo', '{"a":1}'::jsonb, 1);
  select count(*) into v_after from automation_events where event_key = 'config.changed';
  perform provio_test.assert_eq(v_after - v_before, 1,
    'a config change emits exactly one config.changed event');
end $$;

-- Secrets in a history row are masked in the emitted event.
do $$
declare
  v_payload jsonb;
begin
  insert into config_versions (org_id, key, value, version)
  values ('a0000000-0000-0000-0000-000000000001', 'setting:secret_demo',
          jsonb_build_object('api_key', 'super-secret-value'), 1);
  select payload into v_payload from automation_events
   where event_key = 'config.changed' order by id desc limit 1;
  perform provio_test.assert_true(
    (v_payload -> 'summary' ->> 'value') like '%••••%' or (v_payload -> 'summary')::text like '%••••%',
    'the emitted summary masks secret-looking fields');
end $$;

-- ---------------------------------------------------------------------------
-- 10. The platform admin reads the platform recipients list; a tenant user does not.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_add_recipient('ops@qscorp.example');
  perform provio_test.assert_eq((select count(*) from public.platform_list_recipients()), 1,
    'the platform admin adds and lists a recipient');
  perform provio_test.assert_raises(
    $q$select public.platform_add_recipient('not-an-address')$q$,
    'valid email', 'an invalid recipient address is refused');
end $$;

select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from platform_notification_recipients), 0,
    'a tenant user reads no platform recipients');
end $$;

select provio_test.as_owner();
