-- Test 85 (C2.9): the tenant-granted, read-only support session (spec §24, NOT-DONE item 24).
--
-- The default state stays: with no grant, a platform administrator reads NOTHING. A tenant-granted,
-- unrevoked, unexpired content_read grant opens read-only access to that org's objects, every read is
-- written to support_access_log, expiry and revocation stop the access on the next call, and no
-- support function is a write path.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- a. With no grant, the platform administrator reads nothing and every attempt is logged denied.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_true(public.support_grant_active(v_org) is null,
    'no grant: the gate is closed');
  perform provio_test.assert_eq((select count(*) from public.support_list_engagements(v_org)), 0::bigint,
    'no grant: support_list_engagements returns nothing');
  perform provio_test.assert_eq(
    (select count(*) from public.support_read_object('engagement', '50000000-0000-0000-0000-0000000000a1', v_org)),
    0::bigint, 'no grant: support_read_object returns nothing');
  -- The two refused calls above wrote denied rows, and the platform admin can see them through the
  -- tenant-facing list only when it holds a grant, so the count comes from the owner below.
end $$;
select provio_test.as_owner();

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_eq(
    (select count(*) from support_access_log where org_id = v_org and outcome = 'denied'),
    2::bigint, 'the two refused calls were each logged as denied');
  perform provio_test.assert_eq(
    (select count(*) from support_access_log where org_id = v_org and outcome = 'ok'),
    0::bigint, 'nothing was logged as a successful read');
end $$;

-- ---------------------------------------------------------------------------
-- b. A tenant grants content_read. Now the platform administrator reads the org's objects, and every
--    successful read is logged.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.grant_support_access('a0000000-0000-0000-0000-000000000001', '{"content_read":true}'::jsonb, 4);
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_eng uuid := '50000000-0000-0000-0000-0000000000a1';
begin
  perform provio_test.assert_true(public.support_grant_active(v_org) is not null,
    'a live content_read grant opens the gate');
  perform provio_test.assert_eq((select count(*) from public.support_list_engagements(v_org)), 2::bigint,
    'the platform admin lists the two engagements of the granted org');
  perform provio_test.assert_eq(
    (select label from public.support_read_object('engagement', v_eng, v_org)), 'A-Eng1',
    'the platform admin reads a granted engagement by id');
  perform provio_test.assert_eq(
    (select count(*) from public.support_read_object('workpaper', '60000000-0000-0000-0000-0000000000a1', v_org)),
    1::bigint, 'the platform admin reads a granted workpaper');
  perform provio_test.assert_eq(
    (select count(*) from public.support_read_object('population', '70000000-0000-0000-0000-0000000000a1', v_org)),
    1::bigint, 'the platform admin reads a granted population');
  -- An object of another org is refused even while a grant is live.
  perform provio_test.assert_eq(
    (select count(*) from public.support_read_object('engagement', '50000000-0000-0000-0000-0000000000b1', v_org)),
    0::bigint, 'an object of another org is not returned under a grant');
  -- The platform role still reads no business table directly (L2).
  perform provio_test.assert_eq((select count(*) from engagements), 0::bigint,
    'the platform admin still reads no engagement row directly');
end $$;
select provio_test.as_owner();

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_eq(
    (select count(*) from support_access_log where org_id = v_org and outcome = 'ok'),
    4::bigint, 'four successful reads were logged');
  perform provio_test.assert_eq(
    (select count(*) from support_access_log where org_id = v_org and outcome = 'denied'),
    3::bigint, 'the cross-org read was logged as denied');
end $$;

-- ---------------------------------------------------------------------------
-- c. Revocation stops access on the NEXT call.
-- ---------------------------------------------------------------------------
-- The owner revokes the row directly (the RPC requires the platform role, which cannot read the
-- grant table itself); the point under test is that a revoked row closes the gate on the next call.
update support_access_grants set revoked_at = now(), revoke_reason = 'support finished'
 where org_id = 'a0000000-0000-0000-0000-000000000001' and revoked_at is null;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_true(public.support_grant_active(v_org) is null,
    'a revoked grant closes the gate on the next call');
  perform provio_test.assert_eq((select count(*) from public.support_list_engagements(v_org)), 0::bigint,
    'a revoked grant yields nothing');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- d. Expiry stops access on the next call.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  -- granted_at must precede expires_at (sag_expires_after_grant), so back-date the grant.
  insert into support_access_grants (org_id, granted_at, expires_at, scope, kind)
  values (v_org, now() - interval '2 hours', now() - interval '1 minute', '{"content_read":true}', 'content_read');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_true(public.support_grant_active(v_org) is null,
    'an expired grant closes the gate on the next call');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- e. A tenant caller cannot reach any support function (it is not a platform administrator), and a
--    tenant reads only its own support_access_log rows.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_raises(
    format($q$select * from public.support_list_engagements('%s')$q$, v_org),
    'platform administrator only', 'a tenant user cannot start a support session');
  perform provio_test.assert_raises(
    format($q$select * from public.support_read_object('engagement','50000000-0000-0000-0000-0000000000a1','%s')$q$, v_org),
    'platform administrator only', 'a tenant user cannot read through a support session');
  -- The tenant reads its own log.
  perform provio_test.assert_true(
    (select count(*) from public.support_access_log_list(v_org)) > 0,
    'the tenant reads its own support access trail');
  -- But not another org's.
  perform provio_test.assert_raises(
    $q$select * from public.support_access_log_list('b0000000-0000-0000-0000-000000000001')$q$,
    'platform administrator only', 'a tenant cannot read another org support trail');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- f. No support function is a write path. Prove the engagements, workpapers, findings and sign_offs
--    row counts are unchanged across a whole support session (the counts are read as the owner, since
--    the platform role cannot read them at all), and that support_access_log has no write policy.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.grant_support_access('a0000000-0000-0000-0000-000000000001', '{"content_read":true}'::jsonb, 2);
select provio_test.as_owner();

do $$
declare
  v_before record;
  v_after record;
begin
  select (select count(*) from engagements) as e,
         (select count(*) from workpapers) as w,
         (select count(*) from findings) as f,
         (select count(*) from sign_offs) as s into v_before;

  perform provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
  perform (select count(*) from public.support_list_engagements('a0000000-0000-0000-0000-000000000001'));
  perform (select count(*) from public.support_read_object('finding', '40000000-0000-0000-0000-0000000000a1',
    'a0000000-0000-0000-0000-000000000001'));
  perform provio_test.as_owner();

  select (select count(*) from engagements) as e,
         (select count(*) from workpapers) as w,
         (select count(*) from findings) as f,
         (select count(*) from sign_offs) as s into v_after;

  perform provio_test.assert_eq(v_after.e, v_before.e, 'a support session writes no engagement');
  perform provio_test.assert_eq(v_after.w, v_before.w, 'a support session writes no workpaper');
  perform provio_test.assert_eq(v_after.f, v_before.f, 'a support session writes no finding');
  perform provio_test.assert_eq(v_after.s, v_before.s, 'a support session writes no sign-off');
end $$;

do $$
declare
  v_policies int;
begin
  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'support_access_log'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  perform provio_test.assert_eq(v_policies, 0, 'support_access_log has no write policy');
  perform provio_test.assert_true(
    (select relrowsecurity from pg_class where relname = 'support_access_log'),
    'support_access_log has RLS enabled');
end $$;

-- A signed-in caller cannot insert into the trail directly.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into support_access_log (org_id, function_name, outcome) values ('a0000000-0000-0000-0000-000000000001','forged','ok')$q$,
    null, 'a signed-in caller cannot write the support trail');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- g. The grant kinds are unchanged: a config or full_admin grant is not a content_read grant.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_id uuid;
begin
  update support_access_grants set revoked_at = now() where org_id = v_org and revoked_at is null;
  insert into support_access_grants (org_id, granted_at, expires_at, scope, kind)
  values (v_org, now(), now() + interval '2 hours', '{"content_read":true}', 'config')
  returning id into v_id;
  perform provio_test.assert_true(public.support_grant_active(v_org) is null,
    'a config grant does not open the content_read session');
  update support_access_grants set kind = 'full_admin' where id = v_id;
  perform provio_test.assert_true(public.support_grant_active(v_org) is null,
    'a full_admin grant does not open the content_read session');
  update support_access_grants set revoked_at = now() where id = v_id;
end $$;

select provio_test.as_owner();
