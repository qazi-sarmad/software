-- Test 60: the platform administrator is blind to tenant business data, and only the platform_*
-- functions are callable by it (D3, L2, spec §24, §25.2, decision D-PLATFORM-RIGHTS).
-- Pattern from 03_platform_blind.sql. The difference: this test drives every platform_* control
-- function and then re-checks that the tenant tables are still unreadable afterwards.
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');

-- a: zero rows from every tenant business table, including findings and invite_cap_events.
do $$
declare
  t text;
  n int;
begin
  foreach t in array provio_test.org_tables() loop
    execute format('select count(*) from %I', t) into n;
    perform provio_test.assert_eq(n, 0, format('platform_admin reads no rows from %s', t));
  end loop;
  perform provio_test.assert_eq((select count(*) from invite_cap_events), 0,
    'platform_admin reads no invite_cap_events rows');
  perform provio_test.assert_eq((select count(*) from support_access_grants), 0,
    'platform_admin reads no support_access_grants rows');
end $$;

-- b: every platform control function is callable and writes exactly one platform_trail row.
do $$
declare
  v_before int;
  v_after int;
  v_grant uuid;
begin
  select count(*) into v_before from platform_trail;

  perform public.platform_set_feature_flag('a0000000-0000-0000-0000-000000000001', 'beta_reports', true);
  perform public.platform_enable_ai('a0000000-0000-0000-0000-000000000001', true, 'https://model.example/v1');
  perform public.platform_set_invite_cap('a0000000-0000-0000-0000-000000000001', 25);
  v_grant := public.platform_grant_support_access(
    'a0000000-0000-0000-0000-000000000001', '{"read":true}'::jsonb, 4);
  perform public.platform_revoke_support_access(v_grant, 'ticket 12345 closed by the owner');

  select count(*) into v_after from platform_trail;
  perform provio_test.assert_eq(v_after - v_before, 5,
    'the five platform control calls each wrote a platform_trail row');
  perform provio_test.assert_true(
    exists (select 1 from platform_trail where action = 'feature_flag_set'),
    'the feature-flag action is on the platform trail');
  perform provio_test.assert_true(
    exists (select 1 from platform_trail where action = 'ai_enablement_changed'),
    'the AI-enablement action is on the platform trail');
  perform provio_test.assert_true(
    exists (select 1 from platform_trail where action = 'support_access_granted'),
    'the support-access grant is on the platform trail');
end $$;

-- c: after granting support access, the platform admin still reads no tenant business table.
do $$
declare
  t text;
  n int;
begin
  foreach t in array provio_test.org_tables() loop
    execute format('select count(*) from %I', t) into n;
    perform provio_test.assert_eq(n, 0,
      format('platform_admin still reads no rows from %s after a support grant', t));
  end loop;
end $$;

-- d: an ordinary org user cannot call the platform control functions.
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.platform_set_feature_flag('a0000000-0000-0000-0000-000000000001', 'x', true)$q$,
    'platform administrator only', 'an org user cannot set a feature flag');
  perform provio_test.assert_raises(
    $q$select public.platform_set_invite_cap('a0000000-0000-0000-0000-000000000001', 50)$q$,
    'platform administrator only', 'an org user cannot set the invite cap');
  perform provio_test.assert_raises(
    $q$select public.platform_enable_ai('a0000000-0000-0000-0000-000000000001', true, null)$q$,
    'platform administrator only', 'an org user cannot enable AI');
end $$;

select provio_test.as_owner();
