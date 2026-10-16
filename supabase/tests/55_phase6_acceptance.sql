-- Test 55 (6F): Phase 6 acceptance — the cross-cutting guarantees for report drafting, management
-- comments, the CAP register, freeze/issuance and the email queue in one place. Cross-org reads and
-- writes refused, unauthenticated calls refused, no-right callers refused, and the platform-only
-- visibility of the queue and the settings secrets (spec §15, §16; L2, L3).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. Cross-org: an Org B caller reads zero Org A rows in every Phase 6 table and cannot call a Phase 6
--    RPC that targets an Org A object.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['report_versions','report_blocks','report_comments','caps','email_queue','email_settings'] loop
    execute format('select count(*) from %I where org_id = %L', t, 'a0000000-0000-0000-0000-000000000001') into n;
    perform provio_test.assert_eq(n, 0::bigint, format('6F: an Org B caller reads zero Org A rows in %s', t));
  end loop;
  perform provio_test.assert_raises(
    $q$select public.compose_report('50000000-0000-0000-0000-0000000000a1')$q$,
    'not found in this organisation', '6F: an Org B caller cannot compose an Org A report');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. Unauthenticated: anon cannot call any Phase 6 RPC and reads zero rows.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.compose_report('50000000-0000-0000-0000-0000000000a1')$q$,
    null, '6F: anon cannot compose a report');
  perform provio_test.assert_raises(
    $q$select public.freeze_report('00000000-0000-0000-0000-000000000000'::uuid)$q$,
    null, '6F: anon cannot freeze a report');
  perform provio_test.assert_raises(
    $q$select public.close_cap('00000000-0000-0000-0000-000000000000'::uuid, true, false)$q$,
    null, '6F: anon cannot close a CAP');
  perform provio_test.assert_eq((select count(*) from report_versions), 0::bigint,
    '6F: anon reads zero report versions');
  perform provio_test.assert_eq((select count(*) from caps), 0::bigint,
    '6F: anon reads zero CAPs');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. No-right caller: the Observer holds neither approve_plan nor review_and_approve.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.compose_report('50000000-0000-0000-0000-0000000000a1')$q$,
    'review_and_approve', '6F: an Observer cannot compose a report');
  perform provio_test.assert_raises(
    $q$select public.close_cap('00000000-0000-0000-0000-000000000000'::uuid, true, false)$q$,
    'review_and_approve', '6F: an Observer cannot close a CAP');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. The email queue keeps pending rows platform-only; a tenant sees only sent/failed (6E RLS).
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.queue_email('a0000000-0000-0000-0000-000000000001', array['a@example.test'],
                             'Pending', null, 'body', '{}'::jsonb);
  insert into email_queue (org_id, to_addresses, subject, status, sent_at)
  values ('a0000000-0000-0000-0000-000000000001', array['a@example.test'], 'Sent', 'sent', now());
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq((select count(*) from email_queue where status = 'pending'), 0::bigint,
    '6F: a tenant cannot see pending queue rows');
  perform provio_test.assert_eq((select count(*) from email_queue), 1::bigint,
    '6F: a tenant sees exactly its own sent row');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. The platform admin reads the pending row but still no tenant business table (L2).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_true((select count(*) >= 1 from email_queue where status = 'pending'),
    '6F: the platform role sees the pending queue rows');
  perform provio_test.assert_eq((select count(*) from report_versions), 0::bigint,
    '6F: the platform role reads zero tenant report versions');
  perform provio_test.assert_eq((select count(*) from caps), 0::bigint,
    '6F: the platform role reads zero tenant CAPs');
end $$;
select provio_test.as_owner();
