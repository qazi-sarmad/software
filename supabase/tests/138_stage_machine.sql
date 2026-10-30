-- Test 138 (S6 / F30, R5): the engagement stage machine is configurable, and the configuration is
-- READ by the one write path.
--
-- The safety property this test leads with: an organisation that configures nothing is byte-for-byte
-- unchanged. The default machine is the three legacy stages in the legacy order, so every existing
-- migration and every existing SQL test keeps its behaviour.
\i supabase/tests/00_lib.sql
select provio_test.seed();

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'a1@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid')
on conflict (id) do nothing;

-- ===========================================================================
-- 1. The default machine is the three legacy stages, in order.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_eq(
    (select string_agg(m.key, ',' order by m.pos) from public.stage_machine_effective('a0000000-0000-0000-0000-000000000001') m),
    'planning,testing,conclusion', 'F30: the default machine is planning, testing, conclusion');
  perform provio_test.assert_eq(
    (select public.stage_position('a0000000-0000-0000-0000-000000000001', 'testing')), 2,
    'F30: testing is the second stage by default');
  perform provio_test.assert_eq(
    (select public.stage_anchor('a0000000-0000-0000-0000-000000000001', 'conclusion')), 'conclusion',
    'F30: a default stage anchors to itself');
  perform provio_test.assert_true(
    (select public.stage_position('a0000000-0000-0000-0000-000000000001', 'fieldwork')) is null,
    'F30: an unconfigured stage is not on the default machine');
end $$;

-- ===========================================================================
-- 2. The configuration RPC: rights, and the refusals.
-- ===========================================================================
-- A caller without edit_config is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_save_stage_machine('[{"key":"planning","label":"Planning","anchor":"planning"},{"key":"testing","label":"Testing","anchor":"testing"},{"key":"conclusion","label":"Conclusion","anchor":"conclusion"}]'::jsonb)$q$,
    'edit_config', 'F30: a caller without edit_config cannot save the machine');
end $$;
select provio_test.as_owner();

-- As the Org Admin (edit_config), the refusals each name their reason and write nothing.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_res jsonb;
begin
  -- Too few stages.
  v_res := public.admin_save_stage_machine('[{"key":"planning","label":"Planning","anchor":"planning"}]'::jsonb);
  perform provio_test.assert_true(v_res ->> 'ok' = 'false' and v_res ->> 'reason' like '%at least the three%',
    'F30: a machine with fewer than three stages is refused');

  -- A machine that drops an anchor.
  v_res := public.admin_save_stage_machine(
    '[{"key":"planning","label":"Planning","anchor":"planning"},{"key":"testing","label":"Testing","anchor":"testing"}]'::jsonb);
  perform provio_test.assert_true(v_res ->> 'ok' = 'false',
    'F30: a machine that drops an anchor is refused');

  -- An out-of-order anchor.
  v_res := public.admin_save_stage_machine(
    '[{"key":"testing","label":"Testing","anchor":"testing"},{"key":"planning","label":"Planning","anchor":"planning"},{"key":"conclusion","label":"Conclusion","anchor":"conclusion"}]'::jsonb);
  perform provio_test.assert_true(v_res ->> 'ok' = 'false' and v_res ->> 'reason' like '%order%',
    'F30: an out-of-order anchor is refused');

  -- A duplicate key.
  v_res := public.admin_save_stage_machine(
    '[{"key":"planning","label":"Planning","anchor":"planning"},{"key":"planning","label":"Again","anchor":"testing"},{"key":"conclusion","label":"Conclusion","anchor":"conclusion"}]'::jsonb);
  perform provio_test.assert_true(v_res ->> 'ok' = 'false' and v_res ->> 'reason' like '%duplicate%',
    'F30: a duplicate stage key is refused');

  -- An unknown anchor.
  v_res := public.admin_save_stage_machine(
    '[{"key":"planning","label":"Planning","anchor":"planning"},{"key":"testing","label":"Testing","anchor":"testing"},{"key":"conclusion","label":"Conclusion","anchor":"reporting"}]'::jsonb);
  perform provio_test.assert_true(v_res ->> 'ok' = 'false' and v_res ->> 'reason' like '%anchor%',
    'F30: an unknown anchor is refused');

  perform provio_test.assert_eq((select count(*) from org_stage_machine), 0::bigint,
    'F30: every refusal left the machine unwritten');
end $$;

-- ===========================================================================
-- 3. The happy path: a tenant inserts a Fieldwork stage inside the planning phase and renames a
--    label. The machine is read back, and a transition follows the CONFIGURED order.
-- ===========================================================================
do $$
declare
  v_res jsonb;
begin
  v_res := public.admin_save_stage_machine(
    '[{"key":"planning","label":"Plan","anchor":"planning"},
      {"key":"fieldwork","label":"Fieldwork","anchor":"planning"},
      {"key":"testing","label":"Test","anchor":"testing"},
      {"key":"conclusion","label":"Conclude","anchor":"conclusion"}]'::jsonb);
  perform provio_test.assert_true(v_res ->> 'ok' = 'true', 'F30: a four-stage machine saves');
  perform provio_test.assert_eq((select count(*) from org_stage_machine), 4::bigint,
    'F30: four stages are stored');
  perform provio_test.assert_eq((select public.stage_position('a0000000-0000-0000-0000-000000000001', 'fieldwork')), 2,
    'F30: fieldwork sits between planning and testing');
  perform provio_test.assert_eq((select public.stage_anchor('a0000000-0000-0000-0000-000000000001', 'fieldwork')), 'planning',
    'F30: fieldwork inherits the planning anchor');
end $$;

-- The machine is read back by the screen RPC, marked custom.
do $$
declare
  v_res jsonb;
begin
  v_res := public.stage_machine_get();
  perform provio_test.assert_true(v_res ->> 'ok' = 'true' and (v_res ->> 'custom')::boolean,
    'F30: the screen read marks the machine custom');
  perform provio_test.assert_eq(jsonb_array_length(v_res -> 'stages'), 4,
    'F30: the screen read returns all four stages');
end $$;

-- A transition to the tenant stage follows the configured order: planning -> fieldwork is legal.
select provio_test.as_owner();
insert into planning_sections (org_id, engagement_id, section_type, content, signed_off_at, signed_off_by) values
  ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'scope', '{"summary":"x"}'::jsonb, now(), '10000000-0000-0000-0000-0000000000a1');

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'fieldwork', 'planning');
  perform provio_test.assert_eq(
    (select stage from engagements where id = '50000000-0000-0000-0000-0000000000a1'), 'fieldwork',
    'F30: a move to the tenant stage is accepted');

  -- The tenant stage is now current; moving BACK to planning is not a forward move.
  perform provio_test.assert_raises(
    $q$select public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'planning', 'fieldwork')$q$,
    'illegal_transition', 'F30: a backward move on the custom machine is refused');
end $$;

-- ===========================================================================
-- 4. A stage that is in use cannot be dropped from the machine (no orphaned engagement).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_res jsonb;
begin
  v_res := public.admin_save_stage_machine(
    '[{"key":"planning","label":"Plan","anchor":"planning"},
      {"key":"testing","label":"Test","anchor":"testing"},
      {"key":"conclusion","label":"Conclude","anchor":"conclusion"}]'::jsonb);
  perform provio_test.assert_true(v_res ->> 'ok' = 'false' and v_res ->> 'reason' like '%in use%',
    'F30: dropping a stage a live engagement sits on is refused');
  perform provio_test.assert_eq((select count(*) from org_stage_machine), 4::bigint,
    'F30: the refused removal wrote nothing');
end $$;

-- ===========================================================================
-- 5. Reset to the default. The engagement is moved back first so the reset is not blocked.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'testing', 'fieldwork');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_res jsonb;
begin
  v_res := public.admin_reset_stage_machine();
  perform provio_test.assert_true(v_res ->> 'ok' = 'true', 'F30: the reset succeeds');
  perform provio_test.assert_eq((select count(*) from org_stage_machine), 0::bigint,
    'F30: the reset leaves no rows');
  perform provio_test.assert_eq(
    (select string_agg(m.key, ',' order by m.pos) from public.stage_machine_effective('a0000000-0000-0000-0000-000000000001') m),
    'planning,testing,conclusion', 'F30: after the reset the default machine applies again');
end $$;

-- ===========================================================================
-- 6. Isolation: Org B has its own machine. A change in A is invisible to B.
-- ===========================================================================
do $$
begin
  perform public.admin_save_stage_machine(
    '[{"key":"planning","label":"Plan","anchor":"planning"},
      {"key":"fieldwork","label":"Fieldwork","anchor":"planning"},
      {"key":"testing","label":"Test","anchor":"testing"},
      {"key":"conclusion","label":"Conclude","anchor":"conclusion"}]'::jsonb);
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select string_agg(m.key, ',' order by m.pos) from public.stage_machine_effective('b0000000-0000-0000-0000-000000000001') m),
    'planning,testing,conclusion', 'F30: Org B still sees the default machine');
  perform provio_test.assert_eq((select count(*) from org_stage_machine), 0::bigint,
    'F30: Org B reads zero Org A stage rows under RLS');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 7. The anon surface.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.admin_save_stage_machine(jsonb)', 'execute'),
    'F30: anon cannot execute admin_save_stage_machine');
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.stage_machine_get()', 'execute'),
    'F30: anon cannot execute stage_machine_get');
end $$;
