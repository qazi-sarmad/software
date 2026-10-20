-- Test 75 (S9): the external auditor portal (F13).
--
-- Covers: the invite is a single-use hashed token and a queued email; acceptance provisions an
-- external_auditor_access row and per-engagement grants; a normal tenant member and the platform
-- admin are NOT external actors; an expired or revoked grant stops access immediately; the ext_
-- read surface returns only permitted fields and logs every call; an external auditor reads ZERO rows
-- from every business table; no ext_ function performs a write; and the access-token hook stamps
-- user_role = 'external_auditor'.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The auth account for the external auditor (the Edge Function creates it; the test inserts it).
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000e1', 'ext@provio-test.invalid')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Turn on the entitlement and invite an external auditor. The token is hashed, never stored in
--    the clear, and the queued email carries the acceptance link and is pending.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','external_auditors',true,'Assurance','external add-on');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_id uuid;
begin
  v_id := public.external_auditor_invite('ext.auditor@example.test',
            array['50000000-0000-0000-0000-0000000000a1'::uuid], 'time_boxed', 30);
  perform provio_test.assert_true(v_id is not null, 'S9: the invite returns an id');
  perform set_config('provio.test.ext_invite', v_id::text, false);
end $$;
select provio_test.as_owner();

do $$
declare
  v_id uuid := current_setting('provio.test.ext_invite')::uuid;
  v_body text;
begin
  perform provio_test.assert_eq(
    (select email from external_auditor_invites where id = v_id), 'ext.auditor@example.test',
    'S9: the invite records the lower-cased email');
  perform provio_test.assert_true(
    (select length(token_hash) = 64 from external_auditor_invites where id = v_id),
    'S9: the token is stored as a sha256 hex digest, never in the clear');
  select body_text into v_body from email_queue
   where metadata ->> 'invite_id' = v_id::text order by created_at desc limit 1;
  perform provio_test.assert_true(v_body like '%/external/accept?token=%',
    'S9: the queued email carries the acceptance link');
  perform provio_test.assert_eq(
    (select status from email_queue where metadata ->> 'invite_id' = v_id::text order by created_at desc limit 1),
    'pending', 'S9: the invitation email is queued, not sent');
  -- The invite writes the external_access_granted ledger entry (F20).
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'external_access_granted'),
    1::bigint, 'S9: inviting writes an external_access_granted ledger entry');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A normal tenant member cannot invite (no edit_config), and the feature gate refuses when off.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  -- The CIA holds edit_config, so this is allowed; the preparer below is the refusal case.
  perform public.external_auditor_invite('cia.invite@example.test', '{}'::uuid[], 'time_boxed', 30);
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.external_auditor_invite('no.rights@example.test', '{}'::uuid[], 'time_boxed', 30)$q$,
    'not allowed', 'S9: a member without edit_config cannot invite an external auditor');
end $$;
select provio_test.as_owner();

-- Feature off refuses.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','external_auditors',false,'Assurance','off');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.external_auditor_invite('off@example.test', '{}'::uuid[], 'time_boxed', 30)$q$,
    'not included in your plan', 'S9: the feature gate refuses an invite while the feature is off');
end $$;
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','external_auditors',true,'Assurance','back on');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. Acceptance provisions the access row and the grant. A single-use token is refused the second
--    time. The accept function is service_role only (asserted by the grant, exercised as owner here).
-- ---------------------------------------------------------------------------
do $$
declare
  v_token text := 'ext-token-000000000000000000000000000000000000000000000000000';
  v_id uuid;
begin
  insert into external_auditor_invites
    (org_id, email, token_hash, expiry_kind, access_days, engagement_ids, invited_by, expires_at)
  values ('a0000000-0000-0000-0000-000000000001', 'ext.auditor@example.test',
          encode(extensions.digest(v_token, 'sha256'), 'hex'), 'time_boxed', 30,
          array['50000000-0000-0000-0000-0000000000a1'::uuid],
          '10000000-0000-0000-0000-0000000000a3', now() + interval '7 days')
  returning id into v_id;
  perform set_config('provio.test.ext_accept_id', v_id::text, false);
  perform set_config('provio.test.ext_accept_token', v_token, false);
end $$;

do $$
declare
  v_token text := current_setting('provio.test.ext_accept_token');
  r record;
begin
  select * into r from public.external_auditor_accept(v_token, '10000000-0000-0000-0000-0000000000e1');
  perform provio_test.assert_eq(r.out_org_id, 'a0000000-0000-0000-0000-000000000001'::uuid,
    'S9: acceptance returns the organisation');
  perform provio_test.assert_eq(
    (select active from external_auditor_access
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-0000000000e1'), true,
    'S9: acceptance creates an active access row');
  perform provio_test.assert_eq(
    (select count(*) from external_auditor_grants
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-0000000000e1'
        and engagement_id = '50000000-0000-0000-0000-0000000000a1'), 1::bigint,
    'S9: acceptance creates one grant for the invited engagement');
  perform provio_test.assert_raises(
    $q$select public.external_auditor_accept(current_setting('provio.test.ext_accept_token'), '10000000-0000-0000-0000-0000000000e1')$q$,
    'already been used', 'S9: an invite can be used once');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A normal tenant member and the platform admin are NOT external actors. Only the granted
--    external auditor is.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(public.external_actor_ok('a0000000-0000-0000-0000-000000000001', null), false,
    'S9: a tenant CIA is not an external actor');
  perform provio_test.assert_eq((select count(*) from public.ext_list_engagements()), 0::bigint,
    'S9: a tenant CIA gets no rows from the ext_ surface');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform provio_test.assert_eq(public.external_actor_ok('a0000000-0000-0000-0000-000000000001', null), false,
    'S9: the platform admin is never an external actor');
end $$;

-- ---------------------------------------------------------------------------
-- 5. The external auditor reads only its granted engagement, through the ext_ surface. Every call is
--    logged. The org name is available through ext_me (SECURITY DEFINER), not by a direct read.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'external_auditor');
do $$
declare
  v_list record;
  v_summary record;
begin
  select * into v_list from public.ext_list_engagements();
  perform provio_test.assert_eq(v_list.engagement_id, '50000000-0000-0000-0000-0000000000a1'::uuid,
    'S9: the auditor sees exactly the granted engagement');
  perform provio_test.assert_eq(v_list.title, 'A-Eng1', 'S9: the granted engagement title is returned');

  select * into v_summary from public.ext_engagement_summary('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(v_summary.title, 'A-Eng1', 'S9: the summary returns the title');
  perform provio_test.assert_true(v_summary.sealed_workpapers >= 0, 'S9: the summary returns a count');

  -- The engagement not granted is refused: no rows, and a denied log row.
  perform provio_test.assert_eq(
    (select count(*) from public.ext_engagement_summary('50000000-0000-0000-0000-0000000000a2')), 0::bigint,
    'S9: an ungranted engagement yields no summary row');

  -- ext_me returns the account's own state.
  perform provio_test.assert_eq((select email from public.ext_me()), 'ext.auditor@example.test',
    'S9: ext_me returns the auditor email');
end $$;

-- Every ext_ call wrote a log row.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_true(
    (select count(*) from external_access_log
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-0000000000e1'
        and function_name in ('ext_list_engagements','ext_engagement_summary','ext_me')) >= 3,
    'S9: every ext_ call is logged to external_access_log');
  perform provio_test.assert_true(
    (select count(*) from external_access_log
      where user_id = '10000000-0000-0000-0000-0000000000e1' and outcome = 'denied') >= 1,
    'S9: a refused call is logged as denied');
end $$;

-- ---------------------------------------------------------------------------
-- 6. An external auditor reads ZERO rows from every business table. RLS excludes them: they are not
--    org_members and hold no scope. (orgs and roles were tightened in 0066 to exclude them too.)
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'external_auditor');
do $$
declare
  t text;
  n bigint;
  v_visible text[] := '{}';
begin
  foreach t in array provio_test.org_tables() loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then
        v_visible := v_visible || t;
      end if;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  -- roles is in org_tables() and is tightened by 0066; orgs is not in the list but is asserted below.
  perform provio_test.assert_eq(coalesce(array_length(v_visible, 1), 0), 0,
    'S9: an external auditor reads no row from any business table (offenders: ' ||
      coalesce(array_to_string(v_visible, ', '), 'none') || ')');
  perform provio_test.assert_eq((select count(*) from orgs), 0::bigint,
    'S9: an external auditor reads no orgs row');
  perform provio_test.assert_eq((select count(*) from roles), 0::bigint,
    'S9: an external auditor reads no roles row');
  perform provio_test.assert_eq((select count(*) from org_members), 0::bigint,
    'S9: an external auditor reads no org_members row');
  -- And cannot write.
  perform provio_test.assert_raises(
    $q$insert into external_auditor_grants (org_id, user_id, engagement_id) values ('a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-0000000000e1','50000000-0000-0000-0000-0000000000a1')$q$,
    null, 'S9: an external auditor cannot write a grant');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 7. No ext_ function performs a write (except the mandatory access log). Static proof: the body of
--    every function whose name starts with ext_ contains no insert/update/delete other than
--    `insert into external_access_log`.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_body text;
  bad text[] := '{}';
begin
  for r in
    select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'ext\_%'
  loop
    v_body := regexp_replace(r.prosrc, 'insert\s+into\s+external_access_log', '', 'gi');
    if v_body ~* '\minsert\M' or v_body ~* '\mupdate\M' or v_body ~* '\mdelete\M' then
      bad := bad || r.proname;
    end if;
  end loop;
  perform provio_test.assert_eq(coalesce(array_length(bad, 1), 0), 0,
    'S9: no ext_ function writes (offenders: ' || coalesce(array_to_string(bad, ', '), 'none') || ')');
end $$;

-- ---------------------------------------------------------------------------
-- 8. An expired grant stops access immediately; a revoked grant too. Restoring the expiry restores
--    access without data loss.
-- ---------------------------------------------------------------------------
do $$
begin
  update external_auditor_grants set expires_at = now() - interval '1 minute'
   where org_id = 'a0000000-0000-0000-0000-000000000001'
     and user_id = '10000000-0000-0000-0000-0000000000e1'
     and engagement_id = '50000000-0000-0000-0000-0000000000a1';
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'external_auditor');
do $$
begin
  perform provio_test.assert_eq(public.external_actor_ok('a0000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-0000000000a1'), false,
    'S9: an expired grant is not active');
  perform provio_test.assert_eq((select count(*) from public.ext_list_engagements()), 0::bigint,
    'S9: an expired grant yields no engagement');
end $$;
select provio_test.as_owner();

-- Restore the expiry: access returns.
do $$
begin
  update external_auditor_grants set expires_at = now() + interval '30 days'
   where org_id = 'a0000000-0000-0000-0000-000000000001'
     and user_id = '10000000-0000-0000-0000-0000000000e1'
     and engagement_id = '50000000-0000-0000-0000-0000000000a1';
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'external_auditor');
do $$
begin
  perform provio_test.assert_eq((select count(*) from public.ext_list_engagements()), 1::bigint,
    'S9: restoring the expiry restores access without data loss');
end $$;
select provio_test.as_owner();

-- Revoke the whole account (as the Org Admin). Access stops and a ledger entry is written.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.external_auditor_revoke('a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-0000000000e1', null);
end $$;
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select active from external_auditor_access
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-0000000000e1'), false,
    'S9: revoking the account deactivates it');
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'external_access_revoked'),
    1::bigint, 'S9: revoking writes an external_access_revoked ledger entry');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'external_auditor');
do $$
begin
  perform provio_test.assert_eq((select count(*) from public.ext_list_engagements()), 0::bigint,
    'S9: a revoked account gets no engagement from the ext_ surface');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 9. The access-token hook stamps user_role = 'external_auditor' and org_id for an external user.
-- ---------------------------------------------------------------------------
do $$
declare
  v_claims jsonb;
begin
  -- Re-activate the account so the hook finds an active row.
  update external_auditor_access set active = true, revoked_at = null
   where org_id = 'a0000000-0000-0000-0000-000000000001'
     and user_id = '10000000-0000-0000-0000-0000000000e1';
  v_claims := public.custom_access_token_hook(jsonb_build_object(
    'user_id', '10000000-0000-0000-0000-0000000000e1', 'claims', '{}'::jsonb)) -> 'claims';
  perform provio_test.assert_eq(v_claims ->> 'user_role', 'external_auditor',
    'S9: the auth hook stamps user_role = external_auditor');
  perform provio_test.assert_eq((v_claims ->> 'org_id')::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid,
    'S9: the auth hook stamps the org_id for an external user');
end $$;

-- ---------------------------------------------------------------------------
-- 10. Cross-org: Org B's admin cannot see Org A's external auditors, and the read surface refuses.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.external_auditor_list('a0000000-0000-0000-0000-000000000001')$q$,
    'not allowed', 'S9: Org B cannot list Org A external auditors');
end $$;
select provio_test.as_owner();
