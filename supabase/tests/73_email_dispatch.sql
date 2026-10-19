-- Test 73 (M-3): the email dispatcher surface (F6, F21, F5).
--
-- Covers: the dispatch token is service_role only and never readable by a tenant; the dispatcher's
-- claim/complete RPCs are service_role only; a pending row older than 7 days expires and is not
-- claimed; the token setter refuses without Vault; the schedule functions exist and are granted
-- correctly. The adapters themselves are unit-tested in vitest (emailAdapters, emailDispatchLoop).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The dispatch token reader is service_role only. A tenant role and anon cannot read it.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.email_dispatch_token()$q$,
    'permission denied', 'a tenant role cannot read the dispatch token');
  perform provio_test.assert_raises(
    $q$select public.email_dispatch_set_token('https://x.example','tok','•••• tok')$q$,
    'permission denied', 'a tenant role cannot set the dispatch token');
end $$;

select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.email_dispatch_token()$q$,
    'permission denied', 'anon cannot read the dispatch token');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The dispatcher claim/complete RPCs are service_role only (0056). A tenant role is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.email_dispatch_claim(10)$q$,
    'permission denied', 'a tenant role cannot claim email');
  perform provio_test.assert_raises(
    $q$select public.email_dispatch_complete('00000000-0000-0000-0000-000000000000','sent')$q$,
    'permission denied', 'a tenant role cannot complete email');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A pending row older than 7 days expires and is not claimed. A fresh pending row is claimed.
--    queue_email is a tenant surface; the claim/expire RPCs are the dispatcher's (service_role).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
create temporary table if not exists t73_ids (k text, id uuid);
grant select, insert on t73_ids to authenticated, service_role;
do $$
declare v_old uuid; v_new uuid;
begin
  v_old := public.queue_email('a0000000-0000-0000-0000-000000000001',
    array['a@a.example'], 'Old', '<p>o</p>', 'o', '{}'::jsonb);
  v_new := public.queue_email('a0000000-0000-0000-0000-000000000001',
    array['b@a.example'], 'New', '<p>n</p>', 'n', '{}'::jsonb);
  insert into t73_ids values ('old', v_old), ('new', v_new);
end $$;

select provio_test.as_service();
do $$
declare
  v_old uuid; v_new uuid; v_claimed int;
begin
  select id into v_old from t73_ids where k = 'old';
  select id into v_new from t73_ids where k = 'new';
  update email_queue set created_at = now() - interval '8 days' where id = v_old;

  perform public.email_expire_stale(7);

  perform provio_test.assert_eq(
    (select status from email_queue where id = v_old), 'expired',
    'a pending row older than 7 days becomes expired');

  select count(*) into v_claimed from public.email_dispatch_claim(10) q where q.id = v_old;
  perform provio_test.assert_eq(v_claimed, 0, 'an expired row is not claimed');

  select count(*) into v_claimed from public.email_dispatch_claim(10) q where q.id = v_new;
  perform provio_test.assert_eq(v_claimed, 1, 'a fresh pending row is claimed');
end $$;

-- ---------------------------------------------------------------------------
-- 4. The claim respects the batch limit and never returns more than the cap.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  for i in 1..15 loop
    perform public.queue_email('a0000000-0000-0000-0000-000000000001',
      array['c@a.example'], 'Batch ' || i, '<p>b</p>', 'b', '{}'::jsonb);
  end loop;
end $$;

select provio_test.as_service();
do $$
declare v_n int;
begin
  select count(*) into v_n from public.email_dispatch_claim(10);
  perform provio_test.assert_eq(v_n, 10, 'the claim returns at most the requested batch');
end $$;

-- ---------------------------------------------------------------------------
-- 5. complete() applies the F6 retry backoff and gives up after five attempts.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_id uuid;
begin
  v_id := public.queue_email('a0000000-0000-0000-0000-000000000001',
    array['d@a.example'], 'Retry', '<p>r</p>', 'r', '{}'::jsonb);
  insert into t73_ids values ('retry', v_id);
end $$;

select provio_test.as_service();
do $$
declare v_id uuid;
begin
  select id into v_id from t73_ids where k = 'retry';

  -- Five failures: the first four keep it pending with a growing backoff, the fifth fails it.
  perform public.email_dispatch_complete(v_id, 'failed', 'resend', 500, null, 'boom token=abc');
  perform provio_test.assert_eq(
    (select status from email_queue where id = v_id), 'pending',
    'a first failure keeps the row pending');
  perform provio_test.assert_eq(
    (select attempts from email_queue where id = v_id), 1, 'the attempt counter advances');
  perform provio_test.assert_true(
    (select error_text from email_queue where id = v_id) not like '%abc%',
    'the provider error is redacted before it is stored');

  perform public.email_dispatch_complete(v_id, 'failed', 'resend', 500, null, 'x');
  perform public.email_dispatch_complete(v_id, 'failed', 'resend', 500, null, 'x');
  perform public.email_dispatch_complete(v_id, 'failed', 'resend', 500, null, 'x');
  perform public.email_dispatch_complete(v_id, 'failed', 'resend', 500, null, 'x');
  perform provio_test.assert_eq(
    (select status from email_queue where id = v_id), 'failed',
    'the fifth failure marks the row failed');
end $$;

-- ---------------------------------------------------------------------------
-- 6. The Microsoft app secret is service_role only; the client id and save RPC are the platform
--    admin's. A tenant role is refused everywhere.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.graph_client_secret()$q$,
    'permission denied', 'a tenant role cannot read the Microsoft app secret');
  perform provio_test.assert_raises(
    $q$select public.graph_app_save('cid','tid','https://r.example')$q$,
    'not allowed', 'a tenant role cannot save the Microsoft app');
end $$;

-- ---------------------------------------------------------------------------
-- 7. The platform admin saves the app registration and reads the client id back.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.graph_app_save('client-abc', 'tenant-xyz', 'https://app.example/oauth');
  perform provio_test.assert_eq(public.graph_client_id(), 'client-abc',
    'the platform admin saves and reads the client id');
end $$;

-- ---------------------------------------------------------------------------
-- 8. The token setter refuses when Vault is absent (this deployment has no Vault), and never stores
--    a value. The message is the plain one from 0054.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
begin
  if not public.vault_available() then
    perform provio_test.assert_raises(
      $q$select public.email_dispatch_set_token('https://x.example','tok','•••• tok')$q$,
      'vault is not available', 'the token setter refuses without Vault');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. The schedule functions exist. pg_cron/pg_net are absent locally, so the job itself is created
--    only on a deployment that has them; the migration still applied (M2).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'email_expire_stale'),
    'email_expire_stale exists');
  perform provio_test.assert_true(
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'email_dispatch_set_token'),
    'email_dispatch_set_token exists');
end $$;

select provio_test.as_owner();

drop table if exists t73_ids;
select provio_test.as_owner();
