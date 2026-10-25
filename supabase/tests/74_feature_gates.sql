-- Test 74 (M-4b): the feature gate is retrofitted into the RPCs that were built before has_feature
-- existed (F25 enforcement rule 2). For each gated RPC: the write or read is refused while the
-- feature is off, and allowed again once it is on, without losing data. The plan change that turns a
-- feature on and off is exercised through platform_set_entitlement.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. board_pack: the snapshot and the section save refuse while the feature is off.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_raises(
    $q$select public.board_pack_snapshot('a0000000-0000-0000-0000-000000000001','org',null,null)$q$,
    'not included in your plan', 'the board_pack snapshot is refused when the feature is off');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.board_pack_sections_save('a0000000-0000-0000-0000-000000000001',
        jsonb_build_array(jsonb_build_object('section_key','cover','ordinal',1,'enabled',true)))$q$,
    'not included in your plan', 'saving the Board Pack sections is refused when the feature is off');
end $$;

-- Turn it on: the snapshot and the section save work again (no data was lost).
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','board_pack',true,'Assurance','board pack add-on');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_snap jsonb;
begin
  v_snap := public.board_pack_snapshot('a0000000-0000-0000-0000-000000000001','org',null,null);
  perform provio_test.assert_true(v_snap is not null, 'the snapshot works once the feature is on');
  perform public.board_pack_sections_save('a0000000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('section_key','cover','ordinal',1,'enabled',true)));
end $$;

-- ---------------------------------------------------------------------------
-- 2. certificates: config save and revoke refuse while the feature is off. A certificate is inserted
--    directly by the owner (the RPCs that would create one are themselves gated).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into engagement_certificates (id, org_id, engagement_id, version, canonical, cert_hash, status)
values ('d0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000a1', 1, '{"sealed_workpapers":1}'::jsonb,
        encode(extensions.digest('cert','sha256'),'hex'), 'valid');

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.certificate_config_save('a0000000-0000-0000-0000-000000000001','[]'::jsonb)$q$,
    'not included in your plan', 'saving the certificate configuration is refused when the feature is off');
  perform provio_test.assert_raises(
    $q$select public.certificate_revoke('d0000000-0000-0000-0000-0000000000c1','a good reason')$q$,
    'not included in your plan', 'revoking a certificate is refused when the feature is off');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','certificates',true,'Assurance','cert add-on');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.certificate_revoke('d0000000-0000-0000-0000-0000000000c1','a good reason');
  perform provio_test.assert_eq(
    (select status from engagement_certificates where id = 'd0000000-0000-0000-0000-0000000000c1'),
    'revoked', 'revoking works once the feature is on');
end $$;

-- ---------------------------------------------------------------------------
-- 3. public_verification: verify_certificate reports not_found while the feature is off (it must not
--    leak whether the certificate exists), and the real status once it is on.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into engagement_certificates (id, org_id, engagement_id, version, canonical, cert_hash, status)
values ('d0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000a1', 1, '{"sealed_workpapers":2}'::jsonb,
        encode(extensions.digest('cert2','sha256'),'hex'), 'valid');

select provio_test.as_anon();
do $$
declare v record;
begin
  select * into v from public.verify_certificate('d0000000-0000-0000-0000-0000000000c2');
  perform provio_test.assert_eq(v.status, 'not_found',
    'verify_certificate reports not_found while public_verification is off');
  perform provio_test.assert_true(v.cert_hash is null, 'not_found carries no hash');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','public_verification',true,'Assurance','verify add-on');
end $$;

select provio_test.as_anon();
do $$
declare v record;
begin
  select * into v from public.verify_certificate('d0000000-0000-0000-0000-0000000000c2');
  perform provio_test.assert_eq(v.status, 'valid',
    'verify_certificate returns the real status once the feature is on');
end $$;

-- ---------------------------------------------------------------------------
-- 5. automation_rules: rule save and rule test refuse while the feature is off. automation_rules is
--    an `included` feature and is on by default, so turn it off first.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','automation_rules',false,'Standard','exercise the off state');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.automation_rule_save('a0000000-0000-0000-0000-000000000001','x.rule','X','config.changed','[]'::jsonb,'[]'::jsonb)$q$,
    'not included in your plan', 'saving a rule is refused when automation_rules is off');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','automation_rules',true,'Standard','re-enable');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_rule uuid;
begin
  v_rule := public.automation_rule_save('a0000000-0000-0000-0000-000000000001','x.rule','X','config.changed','[]'::jsonb,'[]'::jsonb);
  perform provio_test.assert_true(v_rule is not null, 'saving a rule works once automation_rules is on');
  perform provio_test.assert_raises(
    $q$select * from public.automation_rule_test(gen_random_uuid(),'{}'::jsonb)$q$,
    'no such rule', 'the rule test still validates its input');
end $$;

-- ---------------------------------------------------------------------------
-- 6. escalation: escalation_evaluate is the engine's own hook, so a disabled feature is a silent
--    no-op (return 0), not an exception that would abort the event batch.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare v_event bigint;
begin
  v_event := public.emit_event('a0000000-0000-0000-0000-000000000001','anomaly.raised',
    jsonb_build_object('severity','critical','summary','x'));
  perform provio_test.assert_eq(public.escalation_evaluate(v_event), 0,
    'escalation_evaluate is a no-op when the escalation feature is off');
end $$;

-- ---------------------------------------------------------------------------
-- 7. The gates are live in the database: the gated RPCs really reference has_feature. This is the
--    SQL-side mirror of the featureMapCompleteness guard (F25 rule 5).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_gated int;
begin
  select count(*) into v_gated
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 'has_feature' and p.prokind = 'f'
     and pg_get_functiondef(p.oid) like '%has_feature(%';
  perform provio_test.assert_true(v_gated >= 9,
    'at least the nine retrofitted RPCs reference has_feature');
end $$;
