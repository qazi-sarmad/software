-- 00_lib.sql — shared helpers for the SQL tests.
-- Not a test itself; it only defines helper functions, so running it standalone is a no-op.
-- Every test starts with:  \i supabase/tests/00_lib.sql   then  select provio_test.seed();
--
-- Fixed identifiers used by the fixtures:
--   Org A        a0000000-0000-0000-0000-000000000001
--   Org B        b0000000-0000-0000-0000-000000000001
--   cia_a        10000000-0000-0000-0000-0000000000a1   role 20000000-...-a1
--   scoped_a     10000000-0000-0000-0000-0000000000a2   role 20000000-...-a2  (scope: universe u_a1)
--   orgadmin_a   10000000-0000-0000-0000-0000000000a3   role 20000000-...-a3
--   platform     10000000-0000-0000-0000-0000000000f0
--   cia_b        10000000-0000-0000-0000-0000000000b1   role 20000000-...-b1
--   universes    u_a1 30000000-...-a1, u_a2 30000000-...-a2, u_b1 30000000-...-b1
--   entities     e_a1 40000000-...-a1, e_a2 40000000-...-a2, e_b1 40000000-...-b1
--   engagements  g_a1 50000000-...-a1, g_a2 50000000-...-a2, g_b1 50000000-...-b1
--   workpapers   wp_a1 60000000-...-a1, wp_b1 60000000-...-b1
--   populations  pop_a1 70000000-...-a1, pop_b1 70000000-...-b1
--   samples      smp_a1 80000000-...-a1, smp_b1 80000000-...-b1

create schema if not exists provio_test;

create or replace function provio_test.assert_true(p_cond boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL: %', p_label using errcode = 'P0001';
  end if;
  raise notice 'ok: %', p_label;
end $$;

create or replace function provio_test.assert_eq(p_actual anycompatible, p_expected anycompatible, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % (expected %, got %)', p_label, p_expected, p_actual using errcode = 'P0001';
  end if;
  raise notice 'ok: %', p_label;
end $$;

-- Assert that running p_sql raises. p_match, when given, must be contained in the message.
create or replace function provio_test.assert_raises(p_sql text, p_match text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_match is null or position(p_match in sqlerrm) > 0 then
      raise notice 'ok: % [raised: %]', p_label, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % (raised wrong error: %)', p_label, sqlerrm using errcode = 'P0001';
  end;
  raise exception 'FAIL: % (no error raised)', p_label using errcode = 'P0001';
end $$;

-- The tables that carry org_id and hold tenant data.
create or replace function provio_test.org_tables() returns text[]
language sql immutable as $$
  select array[
    'roles','org_members','user_scopes','universes','entities','engagements','engagement_members',
    'risks_library','sira_cycles','sira_scores','plans','plan_versions','populations','population_rows',
    'samples','sample_rows','workpapers','sign_offs','test_rows','observations','findings','issues',
    'cap_items','ledger_entries','activity_log','config_versions','notifications','email_outbox',
    'entity_approval_settings','entity_decision_grants'
  ]
$$;

-- Rebuild the fixtures from scratch. Run as the owner, before switching role.
create or replace function provio_test.seed() returns void
language plpgsql as $$
declare
  sha_a text := repeat('a', 64);
  sha_b text := repeat('b', 64);
begin
  truncate orgs cascade;
  -- reopen_grants, platform_trail and platform_admins have no FK to orgs, so cascade does not reach them.
  truncate reopen_grants;
  truncate platform_trail;
  truncate platform_admins;
  truncate entity_decision_grants;

  insert into orgs (id, name, is_demo) values
    ('a0000000-0000-0000-0000-000000000001', 'Org A', false),
    ('b0000000-0000-0000-0000-000000000001', 'Org B', false);

  -- Seven seed roles per organisation, with the rights matrix from migration 0012_rights_closed.sql.
  insert into roles (id, org_id, name, slug, is_seed, rights) values
    ('20000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'CIA', 'cia', true, '{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":true,"perform_work":true,"can_reopen":true,"view_all_scopes":true,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'Preparer', 'preparer', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'Org Admin', 'org_admin', true, '{"manage_users":true,"manage_roles":true,"edit_config":true,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'Audit Manager', 'audit_manager', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":true,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":true,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'Observer', 'observer', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":true,"read_only":true}'),
    ('20000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-000000000001', 'Reviewer', 'reviewer', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-000000000001', 'Auditee', 'auditee', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":true}'),
    ('20000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'CIA', 'cia', true, '{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":true,"perform_work":true,"can_reopen":true,"view_all_scopes":true,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-000000000001', 'Preparer', 'preparer', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-000000000001', 'Org Admin', 'org_admin', true, '{"manage_users":true,"manage_roles":true,"edit_config":true,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-000000000001', 'Audit Manager', 'audit_manager', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":true,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":true,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000b5', 'b0000000-0000-0000-0000-000000000001', 'Observer', 'observer', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":true,"read_only":true}'),
    ('20000000-0000-0000-0000-0000000000b6', 'b0000000-0000-0000-0000-000000000001', 'Reviewer', 'reviewer', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false}'),
    ('20000000-0000-0000-0000-0000000000b7', 'b0000000-0000-0000-0000-000000000001', 'Auditee', 'auditee', true, '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":true}');

  insert into platform_admins (user_id) values ('10000000-0000-0000-0000-0000000000f0');

  insert into org_members (org_id, user_id, role_id, hierarchy_level) values
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', 1),
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-0000000000a2', 3),
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a3', '20000000-0000-0000-0000-0000000000a3', 1),
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a4', '20000000-0000-0000-0000-0000000000a4', 2),
    ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1', 1),
    ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b4', '20000000-0000-0000-0000-0000000000b4', 2);

  -- scoped_a sees only universe u_a1
  insert into user_scopes (org_id, user_id, universe_id) values
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000a1');

  insert into universes (id, org_id, name) values
    ('30000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A-U1'),
    ('30000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'A-U2'),
    ('30000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'B-U1');

  insert into entities (id, org_id, universe_id, name, approved, status) values
    ('40000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a1', 'A-E1', true, 'approved'),
    ('40000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a2', 'A-E2', true, 'approved'),
    ('40000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000b1', 'B-E1', true, 'approved'),
    -- Phase 3 (3B): a draft entity in the unscoped universe U2, so the submit/decide flow can be
    -- exercised without changing what a U1-scoped user sees.
    ('40000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a2', 'A-E3-draft', false, 'draft');

  insert into engagements (id, org_id, universe_id, entity_id, title) values
    ('50000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'A-Eng1'),
    ('50000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a2', 'A-Eng2'),
    ('50000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b1', 'B-Eng1');

  insert into engagement_members (org_id, engagement_id, user_id, team_role) values
    ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a2', 'Preparer'),
    ('b0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'Lead');

  insert into risks_library (org_id, name) values
    ('a0000000-0000-0000-0000-000000000001', 'A risk'),
    ('b0000000-0000-0000-0000-000000000001', 'B risk');

  insert into sira_cycles (id, org_id, universe_id, year) values
    ('a1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a1', 2026),
    ('b1000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000b1', 2026);

  insert into sira_scores (org_id, cycle_id, entity_id, risk_id, score)
  select 'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', id, 50
  from risks_library where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  insert into sira_scores (org_id, cycle_id, entity_id, risk_id, score)
  select 'b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b1', id, 50
  from risks_library where org_id = 'b0000000-0000-0000-0000-000000000001' limit 1;

  insert into plans (id, org_id, universe_id, period, status) values
    ('a2000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a1', '2026', 'draft'),
    ('b2000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000b1', '2026', 'draft');

  insert into plan_versions (org_id, plan_id, version, snapshot) values
    ('a0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-0000000000a1', 1, '{"v":1}'),
    ('b0000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-0000000000b1', 1, '{"v":1}');

  insert into populations (id, org_id, engagement_id, sha256, control_total_cents, status) values
    ('70000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', sha_a, 100000, 'verified'),
    ('70000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000b1', sha_b, 100000, 'verified');

  insert into population_rows (org_id, population_id, row_ref, data) values
    ('a0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a1', 1, '{"amt":1}'),
    ('b0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000b1', 1, '{"amt":1}');

  insert into samples (id, org_id, population_id, population_sha256, method, size_floor) values
    ('80000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a1', sha_a, 'random', 5),
    ('80000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000b1', sha_b, 'random', 5);

  insert into sample_rows (org_id, sample_id, row_ref, conclusion) values
    ('a0000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-0000000000a1', 1, 'tick'),
    ('b0000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-0000000000b1', 1, 'tick');

  insert into workpapers (id, org_id, engagement_id, stage) values
    ('60000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'testing'),
    ('60000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a2', 'testing'),
    ('60000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000b1', 'testing');

  insert into sign_offs (org_id, workpaper_id, stage, preparer_id, reviewer_id) values
    ('a0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000a1', 'testing', '10000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1'),
    ('b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000b1', 'testing', '10000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b2');

  insert into test_rows (org_id, workpaper_id, result) values
    ('a0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000a1', 'pass'),
    ('b0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000b1', 'pass');

  insert into observations (org_id, engagement_id, title) values
    ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'A obs'),
    ('b0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000b1', 'B obs');

  insert into findings (org_id, entity_id, severity) values
    ('a0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', 'High'),
    ('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000b1', 'High');

  insert into issues (org_id, entity_id, title) values
    ('a0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', 'A issue'),
    ('b0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000b1', 'B issue');

  insert into cap_items (org_id, issue_id, action)
  select 'a0000000-0000-0000-0000-000000000001', id, 'A cap' from issues where org_id = 'a0000000-0000-0000-0000-000000000001';
  insert into cap_items (org_id, issue_id, action)
  select 'b0000000-0000-0000-0000-000000000001', id, 'B cap' from issues where org_id = 'b0000000-0000-0000-0000-000000000001';

  insert into ledger_entries (org_id, prev_hash, hash, payload_hash, action, payload) values
    ('a0000000-0000-0000-0000-000000000001', '', '', '', 'seed', '{"org":"A"}'),
    ('b0000000-0000-0000-0000-000000000001', '', '', '', 'seed', '{"org":"B"}');

  insert into activity_log (org_id, action) values
    ('a0000000-0000-0000-0000-000000000001', 'seed'),
    ('b0000000-0000-0000-0000-000000000001', 'seed');

  insert into config_versions (org_id, key, value, version) values
    ('a0000000-0000-0000-0000-000000000001', 'sampling', '{"v":1}', 1),
    ('b0000000-0000-0000-0000-000000000001', 'sampling', '{"v":1}', 1);

  insert into notifications (org_id, user_id, kind, body) values
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 'info', 'A note'),
    ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000b1', 'info', 'B note');

  insert into email_outbox (org_id, to_address, subject) values
    ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'A mail'),
    ('b0000000-0000-0000-0000-000000000001', 'b@example.test', 'B mail');

  insert into platform_trail (actor_id, action, tenant_id, object_type) values
    ('10000000-0000-0000-0000-0000000000f0', 'provision', 'a0000000-0000-0000-0000-000000000001', 'org');
end $$;

-- Assume an identity: switch to the application role and set JWT claims.
-- Session-level (not SET LOCAL) so the identity survives across statements in a psql session.
create or replace function provio_test.as_user(p_sub text, p_org text, p_role text, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_sub, 'org_id', p_org, 'user_role', p_role, 'aal', p_aal)::text, false);
end $$;

create or replace function provio_test.as_anon() returns void
language plpgsql as $$
begin
  execute 'set role anon';
  perform set_config('request.jwt.claims', '{}', false);
end $$;

create or replace function provio_test.as_owner() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

grant usage on schema provio_test to anon, authenticated;
grant execute on all functions in schema provio_test to anon, authenticated;
