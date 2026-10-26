-- Test 82 (C1.3): RPC authority. Every SECURITY DEFINER function that takes an organisation or an
-- object id must refuse an Org B caller naming an Org A object. This is the data-driven cross-org
-- test the review (docs/COMPLETION-RPC-REVIEW.md) requires: the probes below are the leaks found on
-- 2026-10-21, plus the platform-template listings that legitimately allow a null org.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Org A fixtures the probes try to reach. Written as the owner so the rows exist.
insert into automation_rules (id, org_id, rule_key, name, event_key, conditions, actions, enabled, is_platform_template)
values ('a1000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','secret-rule-a','Org A secret rule','finding.sealed','{}','{}',true,false);
insert into notification_templates (id, org_id, event_key, subject, blocks, is_platform_template)
values ('a2000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','finding.sealed','Org A secret template','[]',false);
insert into tenant_entitlements (org_id, feature_key, enabled, plan_name, reason)
values ('a0000000-0000-0000-0000-000000000001','board_pack',true,'Assurance','org a secret');
insert into email_sender_profiles (id, org_id, scope, provider, display_name, from_address, enabled, is_default)
values ('a3000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','tenant','resend','Org A secret sender','secret-a@a.invalid',true,true);
insert into secret_store (id, org_id, label, masked, ciphertext)
values ('a4000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','org-a-key','MASKED-AAAA','xyz');
insert into org_settings_extra (org_id, app_base_url)
values ('a0000000-0000-0000-0000-000000000001','https://org-a.example');
insert into hosting_connections (id, org_id, label, kind, host, port, database_name, username)
values ('a5000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','Org A conn','supabase_self_hosted','a.invalid',5432,'a','a');
insert into board_pack_history (id, org_id, scope_key, scope_description, boundary_kind, snapshot, data_hash)
values ('a6000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','org','Org A pack','since_last','{"secret":true}','aaaa');

-- a: an Org B user calling each function with an Org A handle is refused, or (for a
--    set-returning reader) sees no Org A row. The third column marks a set-returning function:
--    `select count(*) from (select f(...)) q` can be planned away when the column is unused, so a
--    scalar is evaluated through its own select and a set-returning call through a real FROM.
--    A reader that returns nothing has not leaked, so it is not a failure.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1','b0000000-0000-0000-0000-000000000001','cia');
do $do$
declare
  v_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_ag uuid := '50000000-0000-0000-0000-0000000000a1';
  v_rule uuid := 'a1000000-0000-4000-8000-000000000001';
  probes text[][] := array[
    ['automation_rule_list',          'srf', $$select public.automation_rule_list(%A%)$$],
    ['notification_template_list',    'srf', $$select public.notification_template_list(%A%)$$],
    ['email_sender_profiles_list',    'srf', $$select public.email_sender_profiles_list(%A%)$$],
    ['get_org_settings_extra',        'srf', $$select public.get_org_settings_extra(%A%)$$],
    ['entity_approval_config',        'srf', $$select public.entity_approval_config(%A%)$$],
    ['plan_approval_config',          'scalar', $$select public.plan_approval_config(%A%)$$],
    ['org_required_sections',         'scalar', $$select public.org_required_sections(%A%)$$],
    ['sira_model_snapshot',           'scalar', $$select public.sira_model_snapshot(%A%)$$],
    ['sira_band_for',                 'scalar', $$select public.sira_band_for(%A%, 50)$$],
    ['consultation_active',           'srf', $$select public.consultation_active(%A%)$$],
    ['verify_ledger',                 'scalar', $$select public.verify_ledger(%A%)$$],
    ['engagement_root_hash',          'scalar', $$select public.engagement_root_hash(%AG%)$$],
    ['is_engagement_sealed',          'scalar', $$select public.is_engagement_sealed(%AG%)$$],
    ['reopen_granted',                'scalar', $$select public.reopen_granted(%AG%)$$],
    ['board_pack_get',                'srf', $$select public.board_pack_get('a6000000-0000-4000-8000-000000000001')$$],
    ['admin_next_version',            'scalar', $$select public.admin_next_version(%A%, 'x')$$],
    ['admin_log_change',              'scalar', $$select public.admin_log_change(%A%, 'x', '{}'::jsonb, 'hack', 'org', null)$$],
    ['append_ledger_entry',           'scalar', $$select public.append_ledger_entry(%A%, 'hack', '{}'::jsonb, null)$$],
    ['emit_event',                    'scalar', $$select public.emit_event(%A%, 'hack.event', '{}'::jsonb)$$],
    ['queue_email',                   'scalar', $$select public.queue_email(%A%, '{x@y.z}', 's', null, null, '{}'::jsonb)$$],
    ['automation_rule_version_write', 'scalar', $$select public.automation_rule_version_write(%A%, %RULE%, 'save', '{}'::jsonb)$$],
    ['hosting_connection_test_result','scalar', $$select public.hosting_connection_test_result('a5000000-0000-4000-8000-000000000001', 'ok', 'x')$$],
    ['board_pack_list',               'srf', $$select public.board_pack_list(%A%, null)$$],
    ['list_tenant_entitlements',      'srf', $$select public.list_tenant_entitlements(%A%)$$],
    ['email_resolve_profile',         'scalar', $$select public.email_resolve_profile(%A%)$$],
    ['render_notification',           'srf', $$select public.render_notification(%A%, 'finding.sealed', '{}'::jsonb)$$],
    ['rule_recipients',               'scalar', $$select public.rule_recipients(%A%, '{"to_roles":["cia"]}'::jsonb)$$],
    ['rule_loop_guard',               'scalar', $$select public.rule_loop_guard(%RULE%)$$]
  ];
  i int;
  sql text;
  v_count bigint;
begin
  for i in 1 .. array_length(probes, 1) loop
    sql := replace(probes[i][3], '%A%', quote_literal(v_a));
    sql := replace(sql, '%AG%', quote_literal(v_ag));
    sql := replace(sql, '%RULE%', quote_literal(v_rule));
    begin
      if probes[i][2] = 'srf' then
        execute 'select count(*) from (' || sql || ') q' into v_count;
        perform provio_test.assert_eq(v_count, 0::bigint,
          format('%s returns no Org A rows to an Org B caller', probes[i][1]));
      else
        execute sql;
        raise exception 'FAIL: % accepted an Org A handle from an Org B caller', probes[i][1]
          using errcode = 'P0001';
      end if;
    exception when others then
      if position('FAIL:' in sqlerrm) > 0 then
        raise;
      end if;
      raise notice 'ok: % refused a cross-org call', probes[i][1];
    end;
  end loop;
end $do$;

-- b: no Org A row was written or read through those calls.
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from config_versions where org_id = 'a0000000-0000-0000-0000-000000000001' and key = 'x'),
    0, 'admin_log_change wrote nothing into Org A');
  perform provio_test.assert_eq(
    (select count(*) from activity_log where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'hack'),
    0, 'admin_log_change logged nothing into Org A');
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'hack'),
    0, 'append_ledger_entry wrote no Org A ledger row');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where org_id = 'a0000000-0000-0000-0000-000000000001' and event_key = 'hack.event'),
    0, 'emit_event wrote no Org A event');
  perform provio_test.assert_eq(
    (select count(*) from email_queue where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0, 'queue_email queued no Org A email');
  perform provio_test.assert_eq(
    (select count(*) from automation_rule_versions where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0, 'automation_rule_version_write wrote no Org A version');
end $$;

-- c: the org's own member is still served. A null org lists the platform templates only.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-000000000001','cia');
do $$
declare
  n int;
begin
  perform provio_test.assert_eq(
    (select count(*) from public.automation_rule_list('a0000000-0000-0000-0000-000000000001')
      where rule_key = 'secret-rule-a'), 1,
    'the org''s own member still reads its own automation rule');
  perform provio_test.assert_eq(
    (select count(*) from public.notification_template_list('a0000000-0000-0000-0000-000000000001')
      where subject = 'Org A secret template'), 1,
    'the org''s own member still reads its own notification template');
  perform provio_test.assert_eq(
    (select public.secret_display('a4000000-0000-4000-8000-000000000001')), 'MASKED-AAAA',
    'the org''s own member reads its own secret mask');
  -- A null org returns the platform templates, and nothing that belongs to another tenant. The
  -- listing helpers do not return org_id, so the check names the Org A fixture rows instead.
  select count(*) into n from public.automation_rule_list(null) where rule_key = 'secret-rule-a';
  perform provio_test.assert_eq(n, 0, 'a null org lists no tenant rules');
  select count(*) into n from public.notification_template_list(null) where subject = 'Org A secret template';
  perform provio_test.assert_eq(n, 0, 'a null org lists no tenant notification templates');
  select count(*) into n from public.email_sender_profiles_list(null) where org_id is not null;
  perform provio_test.assert_eq(n, 0, 'a null org lists no tenant sender profiles');
  select count(*) into n from public.board_pack_list(null, null) where scope_description = 'Org A pack';
  perform provio_test.assert_eq(n, 0, 'a null org lists no tenant board packs');
end $$;

-- d: the platform administrator still reaches every org; the function's own right check decides.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.automation_rule_list('a0000000-0000-0000-0000-000000000001')
      where rule_key = 'secret-rule-a'), 1,
    'a platform administrator reads an org rule through the listing');
  perform provio_test.assert_eq(
    (select count(*) from public.entity_approval_config('a0000000-0000-0000-0000-000000000001')), 1,
    'a platform administrator reads an org entity-approval config');
end $$;

-- e: the guard helper is internal to the definer functions and is not an anon surface.
do $$
declare
  fn oid;
begin
  select p.oid into fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'provio_org_guard' limit 1;
  perform provio_test.assert_true(fn is not null, 'provio_org_guard exists');
  perform provio_test.assert_true(
    not has_function_privilege('anon', fn, 'execute'), 'anon may not execute provio_org_guard');
end $$;

-- f: the secret-returning functions stay service_role only (F5, L2). The full anon surface is
--    enforced by the source guard src/guards/anonGrantAllowList.test.ts, which replays the grants;
--    this test checks the four functions whose bodies can return a secret or a ciphertext.
do $$
declare
  fn text;
  secrets text[] := array['secret_reveal','graph_client_secret','email_dispatch_token','secret_vault_store'];
  o oid;
begin
  foreach fn in array secrets loop
    select p.oid into o from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn limit 1;
    if o is null then
      continue;
    end if;
    perform provio_test.assert_true(not has_function_privilege('anon', o, 'execute'),
      format('anon may not execute %s', fn));
    perform provio_test.assert_true(not has_function_privilege('authenticated', o, 'execute'),
      format('authenticated may not execute %s', fn));
    perform provio_test.assert_true(has_function_privilege('service_role', o, 'execute'),
      format('service_role may execute %s', fn));
  end loop;
end $$;

select provio_test.as_owner();
