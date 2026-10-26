-- Hardening regression tests (audit 2026-10-23). Each block asserts the secure behaviour.
-- Spec §6: an entity must be approved before it is used in an engagement; §7: deployment is gated.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures owned by the test harness (as owner, not as a user).
insert into secret_store (id, org_id, label, ciphertext, masked) values
  ('70000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'org B secret', 'ct-b', '•••• b');
insert into hosting_connections (id, org_id, kind, ssl_mode) values
  ('80000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'managed_postgres', 'require');
insert into tenant_settings (org_id, status, feature_flags, usage_quota)
  values ('a0000000-0000-0000-0000-000000000001', 'active', '{}', '{}')
  on conflict (org_id) do update set status = 'active';
-- An approved plan for universe A-U1 that includes entity A-E1, so the gated deployment path can succeed.
update plans set status = 'approved', approved_at = now()
  where id = 'a2000000-0000-0000-0000-0000000000a1';
insert into plan_items (org_id, plan_id, entity_id, title, is_adhoc, status) values
  ('a0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-0000000000a1',
   '40000000-0000-0000-0000-0000000000a1', 'A-E1 in the plan', false, 'approved');
-- 1. A CIA user cannot insert an engagement directly on an unapproved entity (spec §6, §7).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_raises(
    $q$insert into engagements (org_id, universe_id, entity_id, title) values ('a0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-0000000000a2','40000000-0000-0000-0000-0000000000a3','bypass')$q$,
    null, 'cia cannot INSERT an engagement on a draft entity directly');
end $$;

-- 2. The gated RPC still refuses the same draft entity with its own outcome (the gate works).
do $$ declare r jsonb; begin
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a3', null, null, 'gated');
  perform provio_test.assert_eq(r->>'outcome', 'entity_not_approved', 'deploy_engagement refuses a draft entity');
end $$;

-- 2b. The legitimate path still works: an approved entity in the approved plan is deployed.
do $$ declare r jsonb; begin
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', null, null, 'Gated A');
  perform provio_test.assert_eq(r->>'outcome', 'deployed', 'deploy_engagement deploys an approved, planned entity');
  perform provio_test.assert_eq(
    (select count(*) from engagements where id = (r->>'engagement_id')::uuid), 1::bigint,
    'the deployed engagement exists');
end $$;

-- 3. Authenticated users cannot insert engagements at table level, whatever the entity.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform provio_test.assert_raises(
    $q$insert into engagements (org_id, universe_id, entity_id, title) values ('a0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-0000000000a1','direct')$q$,
    'permission denied', 'org_admin cannot INSERT engagements directly');
end $$;

-- 4. An org A CIA cannot attach an org B secret to a hosting connection. (The equivalent AI-endpoint
--    probe was removed with ai_set_endpoint in 0087; this is the remaining cross-tenant credential
--    path.)
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_raises(
    $q$select public.hosting_connection_set_secret('80000000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-0000000000b1', 'x')$q$,
    'does not belong', 'hosting_connection_set_secret refuses another org''s secret');
end $$;

select provio_test.as_owner();

-- 6. anon holds no table privileges on the public schema at all (RLS is not the only control).
do $$ declare n int; begin
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  perform provio_test.assert_eq(n, 0, 'anon holds no table privileges in public');
end $$;

-- 7. authenticated holds no TRUNCATE, TRIGGER or REFERENCES on any public table.
do $$ declare n int; begin
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public'
     and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  perform provio_test.assert_eq(n, 0, 'authenticated holds no TRUNCATE/TRIGGER/REFERENCES');
end $$;

-- 8. The dblink extension is not present (it was unused and reachable by anon).
do $$ begin
  perform provio_test.assert_true(
    not exists (select 1 from pg_extension where extname = 'dblink'), 'dblink extension is removed');
end $$;

-- 9. The access-token hook is not callable by end users or anon.
do $$ declare fn oid; begin
  select p.oid into fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'custom_access_token_hook' limit 1;
  perform provio_test.assert_true(fn is not null, 'custom_access_token_hook exists');
  perform provio_test.assert_true(not has_function_privilege('authenticated', fn, 'execute'),
    'authenticated may not call custom_access_token_hook');
  perform provio_test.assert_true(not has_function_privilege('anon', fn, 'execute'),
    'anon may not call custom_access_token_hook');
end $$;

-- 10. Seed functions take an arbitrary org id, so end users may not call them directly.
--     board_pack_sections_seed is the one the app calls, and it must stay callable.
do $$ declare
  fn text;
  seeds text[] := array['seed_sira_model','seed_org_sampling_table','seed_severity_levels',
    'seed_plan_approval_settings','seed_engagement_gate_settings','certificate_config_seed',
    'change_control_seed','pattern_settings_seed'];
  o oid;
begin
  foreach fn in array seeds loop
    select p.oid into o from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn limit 1;
    if o is null then continue; end if;
    perform provio_test.assert_true(not has_function_privilege('authenticated', o, 'execute'),
      format('authenticated may not call %s', fn));
  end loop;
  select p.oid into o from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'board_pack_sections_seed' limit 1;
  perform provio_test.assert_true(has_function_privilege('authenticated', o, 'execute'),
    'board_pack_sections_seed stays callable by the app');
end $$;
