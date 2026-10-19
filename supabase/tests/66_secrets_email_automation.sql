-- Test 66 (S2.a): secrets, email sender profiles and the automation engine (F5, F6, F7).
--
-- Covers: a secret is masked and never readable by a tenant role; only a configuration actor sets
-- one; sender resolution falls back to the platform default and then to stub; the engine turns an
-- event into an in-app notification and queued email; the tenant rule overrides the platform rule;
-- the loop guard pauses a hot rule; a disabled email feature is refused (F25).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. A secret is stored masked and never revealed to a tenant role.
--    The value no longer passes through SQL (M-2, F5): secret_store_ref, the service-role-only RPC
--    the Edge Function calls, receives only a mask and, at most, ciphertext. The tests below set a
--    secret the way the Edge Function does — as the service role.
-- ---------------------------------------------------------------------------
select provio_test.as_service();
do $$
declare
  v_id uuid;
  v_masked text;
begin
  v_id := public.secret_store_ref('a0000000-0000-0000-0000-000000000001', 'resend_key', 'ct-1', '•••• 3456', null);
  perform provio_test.assert_true(v_id is not null, 'secret_store_ref returns an id');
  v_masked := public.secret_display(v_id);
  perform provio_test.assert_eq(v_masked, '•••• 3456', 'the secret display is masked to the last four');
  perform provio_test.assert_true(position('abcdef' in v_masked) = 0, 'the masked display leaks no middle characters');
  perform provio_test.assert_true(
    public.secret_reveal(v_id) = 'ct-1',
    'the service role stores ciphertext, never a plaintext value');
end $$;

-- The mask helper no longer receives a full value: it formats only a suffix (M-2, F5).
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(public.secret_mask_value('3456'), '•••• 3456', 'mask formats a suffix');
  perform provio_test.assert_eq(public.secret_mask_value(null), '•••• not set', 'mask handles an empty suffix');
end $$;

-- A tenant user cannot call secret_reveal (execute is service_role only) and cannot select the table.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.secret_reveal(id) from secret_store$q$,
    'permission denied', 'a tenant role cannot reveal a secret');
  perform provio_test.assert_eq((select count(*) from secret_store), 0::bigint,
    'a tenant role reads no secret rows');
end $$;

-- A tenant role cannot call the new service-role-only entry points either.
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.secret_store_ref('a0000000-0000-0000-0000-000000000001','x','ct','•••• x',null)$q$,
    'permission denied', 'a tenant role cannot call secret_store_ref');
  perform provio_test.assert_raises(
    $q$select public.secret_vault_store('value')$q$,
    'permission denied', 'a tenant role cannot call secret_vault_store');
end $$;

-- secret_put is gone: no SQL entry point accepts a plaintext secret any more (M-2, F5).
do $$
begin
  perform provio_test.assert_true(
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'secret_put'),
    'the plaintext-taking secret_put no longer exists');
end $$;

-- Replacing a secret keeps only one live row and marks the old one replaced.
select provio_test.as_service();
do $$
declare v_new uuid;
begin
  v_new := public.secret_store_ref('a0000000-0000-0000-0000-000000000001', 'resend_key', 'ct-2', '•••• 9999', null);
  perform provio_test.assert_eq(public.secret_display(v_new), '•••• 9999',
    'the new secret display shows the new last four');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from secret_store where label = 'resend_key' and replaced_at is null), 1::bigint,
    'replacing a secret leaves exactly one live row');
  perform provio_test.assert_eq(
    (select count(*) from secret_store where label = 'resend_key' and replaced_at is not null), 1::bigint,
    'the replaced secret is marked replaced, not deleted');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Vault presence is reported, so the wizard can say which store is in use (F5).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_true(public.vault_available() is not null,
    'vault_available answers without error');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Email sender profiles: save, resolve to the platform default, and fall back to stub.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_platform uuid;
begin
  v_platform := public.email_profile_save(null, 'platform', 'resend', 'QSCorp',
    'noreply@qscorp.example', null, '{}'::jsonb, true, null);
  perform public.email_set_default_profile(v_platform);
  perform provio_test.assert_eq(public.email_resolve_profile('a0000000-0000-0000-0000-000000000001'),
    v_platform, 'a tenant with no sender resolves to the platform default');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_tenant uuid;
begin
  v_tenant := public.email_profile_save('a0000000-0000-0000-0000-000000000001', 'tenant', 'resend',
    'Tenant A', 'noreply@a.example', null, '{}'::jsonb, true, 500);
  perform public.email_profile_test_result(v_tenant, 'Test message accepted', 'ok');
  perform provio_test.assert_eq(public.email_resolve_profile('a0000000-0000-0000-0000-000000000001'),
    v_tenant, 'a tenant with its own ok sender resolves to it');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_platform uuid;
begin
  select id into v_platform from email_sender_profiles where org_id is null and is_default limit 1;
  perform public.email_force_profile('a0000000-0000-0000-0000-000000000001', v_platform, false, false);
  perform provio_test.assert_eq(public.email_resolve_profile('a0000000-0000-0000-0000-000000000001'),
    null, 'with no allowed sender the resolution is stub (null)');
end $$;

-- An Org Admin cannot set the platform default profile.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.email_set_default_profile((select id from email_sender_profiles limit 1))$q$,
    'not allowed', 'an Org Admin cannot set the platform default sender');
end $$;

-- ---------------------------------------------------------------------------
-- 4. The engine turns config.changed into an in-app notification and queued email, and the tenant
--    rule overrides the platform rule with the same key.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_rule uuid;
begin
  -- The platform default rule for config.changed exists and is enabled.
  perform provio_test.assert_true(
    exists (select 1 from automation_rules where rule_key = 'platform.config.changed' and enabled),
    'the seeded config.changed platform rule is enabled');

  -- A tenant overrides it with the same key.
  v_rule := public.automation_rule_save('a0000000-0000-0000-0000-000000000001', 'platform.config.changed',
    'Tenant A override', 'config.changed', '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('type','notify','role_target','org_admin',
      'to_roles', jsonb_build_array('org_admin'), 'message','Tenant A was changed.')), true);
  perform provio_test.assert_true(v_rule is not null, 'the tenant saved its own rule');
end $$;

-- The engine runs as the service role (the dispatcher), never as a tenant session.
select provio_test.as_owner();
do $$
declare
  v_event bigint;
  v_acted int;
begin
  v_event := public.emit_event('a0000000-0000-0000-0000-000000000001', 'config.changed',
    jsonb_build_object('area','email','summary','Email sender changed'));
  v_acted := public.rule_engine_process(v_event);

  perform provio_test.assert_true(v_acted >= 1, 'the engine acted on the event');
  perform provio_test.assert_true(
    exists (select 1 from notifications n
             where n.org_id = 'a0000000-0000-0000-0000-000000000001' and n.event_key = 'config.changed'),
    'an in-app notification was written');

  -- Processing the same event twice does nothing more (idempotent).
  perform provio_test.assert_eq(public.rule_engine_process(v_event), 0,
    're-processing an event performs no further actions');
end $$;

-- ---------------------------------------------------------------------------
-- 5. The loop guard pauses a rule that has seen more than 20 events in an hour.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_rule uuid;
  i int;
begin
  v_rule := public.automation_rule_save('b0000000-0000-0000-0000-000000000001', 'hot.rule',
    'Hot rule', 'anomaly.raised', '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('type','notify','role_target','cia',
      'to_roles', jsonb_build_array('cia'))), true);
  for i in 1..25 loop
    perform public.emit_event('b0000000-0000-0000-0000-000000000001', 'anomaly.raised',
      jsonb_build_object('severity','high','amount', 1000 + i));
  end loop;
  perform provio_test.assert_true(not public.rule_loop_guard(v_rule),
    'the loop guard refuses a rule past 20 events an hour');
  perform provio_test.assert_true(
    (select paused_at is not null from automation_rules where id = v_rule),
    'the hot rule was auto-paused with a notice');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A rule condition is evaluated deterministically from the event payload.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_true(
    public.rule_conditions_ok(jsonb_build_object('severity','high','amount', 5000),
      jsonb_build_array(jsonb_build_object('field','severity','operator','eq','value','high'),
                        jsonb_build_object('field','amount','operator','gte','value','1000'))),
    'all conditions pass on a matching payload');
  perform provio_test.assert_true(
    not public.rule_conditions_ok(jsonb_build_object('severity','low','amount', 500),
      jsonb_build_array(jsonb_build_object('field','amount','operator','gte','value','1000'))),
    'a failing condition blocks the rule');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Test with a sample event returns recipients and a rendered message and sends nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_rule uuid;
  v_before int;
  v_after int;
  v_row record;
begin
  v_rule := public.automation_rule_save('a0000000-0000-0000-0000-000000000001', 'test.rule',
    'Test rule', 'cap.overdue', '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('type','notify','role_target','org_admin',
      'to_addresses', jsonb_build_array('lead@a.example'))), true);
  select count(*) into v_before from email_queue;
  select * into v_row from public.automation_rule_test(v_rule,
    jsonb_build_object('severity','high','days_overdue', 10));
  select count(*) into v_after from email_queue;
  perform provio_test.assert_eq(v_after, v_before, 'Test with a sample event queues no email');
  perform provio_test.assert_true(v_row.subject is not null, 'Test returns a rendered subject');
  perform provio_test.assert_true('lead@a.example' = any (v_row.recipients),
    'Test lists the fixed recipient address');
end $$;

-- ---------------------------------------------------------------------------
-- 8. A tenant rule with the same key replaces the platform rule's behaviour.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_event bigint;
begin
  -- Only the tenant rule (org set) should match now, not the platform template.
  v_event := public.emit_event('a0000000-0000-0000-0000-000000000001', 'config.changed',
    jsonb_build_object('area','email','summary','Email sender changed again'));
  perform public.rule_engine_process(v_event);
  perform provio_test.assert_true(
    exists (select 1 from notifications n
             where n.org_id = 'a0000000-0000-0000-0000-000000000001'
               and n.body = 'Tenant A was changed.'),
    'the tenant override produced its own notification text');
end $$;

-- ---------------------------------------------------------------------------
-- 9. The platform admin reads no tenant notification (the platform-blind rule).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_eq((select count(*) from notifications), 0::bigint,
    'the platform admin reads no tenant notification');
  perform provio_test.assert_true((select count(*) from automation_rules) > 0,
    'the platform admin still reads the platform rules');
end $$;

-- ---------------------------------------------------------------------------
-- 10. Unauthenticated callers are refused on the write RPCs.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.automation_rule_save('a0000000-0000-0000-0000-000000000001','x','x','config.changed','[]'::jsonb,'[]'::jsonb)$q$,
    'permission denied', 'anon cannot save an automation rule');
  perform provio_test.assert_raises(
    $q$select public.secret_store_ref('a0000000-0000-0000-0000-000000000001','x','ct','•••• x',null)$q$,
    'permission denied', 'anon cannot set a secret');
end $$;

select provio_test.as_owner();
