-- Test 111 (Phase 4.1): methodology and test steps are first-class, versioned, org-scoped data.
--
-- Before 0110 a "test step" was React state and there was no procedure library. This test proves the
-- new surface is real: a template is written with its ordered steps, a second save versions it, a
-- publish flips the current version, the readers return the current template, the hash chain records
-- every change and is append-only, the right is enforced, orgs cannot see each other's templates, and
-- a new tenant is seeded with a default procedure (4.4).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The platform administrator is a real account: platform_create_tenant writes invite_cap_events,
-- whose invited_by column references auth.users, so without this row the provisioning step at §10
-- fails on the foreign key. Seeded the same way test 123 seeds it.
select provio_test.as_owner();
insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000f0', 'platform@qscorp.test')
on conflict (id) do nothing;

-- ===========================================================================
-- 1. procedure_template_save writes a version with its ordered steps.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v_tpl procedure_templates;
  v_steps int;
begin
  v_id := public.procedure_template_save(
    'internal_audit', 'Treasury procedure', 'Treasury-specific steps',
    '[{"step_key":"design","label":"Walk the treasury process","kind":"inquiry"},
      {"step_key":"operate","label":"Test the control operated","kind":"inspection","requires_evidence":true},
      {"step_key":"conclude","label":"Recompute the buffer","kind":"reperformance","requires_evidence":true}]'::jsonb);
  select * into v_tpl from procedure_templates where id = v_id;
  perform provio_test.assert_eq(v_tpl.org_id, 'a0000000-0000-0000-0000-000000000001',
    'save: the template belongs to the caller org');
  perform provio_test.assert_eq(v_tpl.version, 1, 'save: the first version is 1');
  perform provio_test.assert_true(v_tpl.is_current, 'save: the new version is current');
  perform provio_test.assert_eq(
    (select count(*) from test_step_templates where template_id = v_id), 3::bigint,
    'save: three steps are written');
  perform provio_test.assert_eq(
    (select label from test_step_templates where template_id = v_id and step_key = 'conclude'),
    'Recompute the buffer', 'save: the step label is stored');
  perform provio_test.assert_eq(
    (select requires_evidence from test_step_templates where template_id = v_id and step_key = 'design'),
    false, 'save: requires_evidence defaults to false');
  -- The steps come back in array order.
  select count(*) into v_steps from test_step_templates where template_id = v_id and ordinal between 1 and 3;
  perform provio_test.assert_eq(v_steps, 3, 'save: every step has an ordinal in 1..3');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 2. A second save versions the template and marks the previous version not current.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v_cur int;
begin
  v_id := public.procedure_template_save(
    'internal_audit', 'Treasury procedure v2', 'Edited',
    '[{"step_key":"design","label":"Walk the process","kind":"inquiry"}]'::jsonb);
  perform provio_test.assert_eq((select version from procedure_templates where id = v_id), 2,
    'save: the second save is version 2');
  select count(*) into v_cur from procedure_templates
   where org_id = 'a0000000-0000-0000-0000-000000000001' and model_id = 'internal_audit' and is_current;
  perform provio_test.assert_eq(v_cur, 1, 'save: exactly one current version per model');
  perform provio_test.assert_eq(
    (select version from procedure_templates where org_id = 'a0000000-0000-0000-0000-000000000001'
       and model_id = 'internal_audit' and is_current), 2, 'save: the newest version is current');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 3. Validation: an unknown kind, a duplicate key, an empty list and a blank label are refused.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.procedure_template_save('m','t','d','[{"step_key":"a","label":"x","kind":"telepathy"}]'::jsonb)$q$,
    'unknown step kind', 'save: an unknown kind is refused');
  perform provio_test.assert_raises(
    $q$select public.procedure_template_save('m','t','d','[{"step_key":"a","label":"x"},{"step_key":"a","label":"y"}]'::jsonb)$q$,
    'duplicate step_key', 'save: a duplicate step key is refused');
  perform provio_test.assert_raises(
    $q$select public.procedure_template_save('m','t','d','[]'::jsonb)$q$,
    'non-empty array of steps', 'save: an empty step list is refused');
  perform provio_test.assert_raises(
    $q$select public.procedure_template_save('m','t','d','[{"step_key":"a","label":"  "}]'::jsonb)$q$,
    'needs a label', 'save: a blank label is refused');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 4. The right is enforced: a Preparer (no edit_config) is refused, an Org Admin is allowed.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.procedure_template_save('m','t','d','[{"step_key":"a","label":"x"}]'::jsonb)$q$,
    'lacks the edit_config right', 'save: a caller without edit_config is refused');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_id uuid;
begin
  v_id := public.procedure_template_save('aml', 'AML procedure', '',
    '[{"step_key":"s1","label":"Review alerts","kind":"document_review"}]'::jsonb);
  perform provio_test.assert_true(v_id is not null, 'save: an Org Admin with edit_config succeeds');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 5. The readers: list returns the current templates, get returns one with ordered steps.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_list jsonb;
  v_one jsonb;
  v_id uuid;
begin
  v_list := public.procedure_template_list();
  perform provio_test.assert_true(jsonb_array_length(v_list) >= 2, 'list: returns the org current templates');
  select (t ->> 'id')::uuid into v_id from jsonb_array_elements(v_list) t where t ->> 'model_id' = 'aml';
  v_one := public.procedure_template_get(v_id);
  perform provio_test.assert_eq(v_one ->> 'model_id', 'aml', 'get: returns the requested template');
  perform provio_test.assert_eq(jsonb_array_length(v_one -> 'steps'), 1, 'get: returns the template steps');
  perform provio_test.assert_eq(v_one -> 'steps' -> 0 ->> 'step_key', 's1', 'get: the step key round-trips');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 6. Publish flips the current version.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_v1 uuid;
begin
  select id into v_v1 from procedure_templates
   where org_id = 'a0000000-0000-0000-0000-000000000001' and model_id = 'internal_audit' and version = 1;
  perform public.procedure_template_publish(v_v1);
  perform provio_test.assert_eq(
    (select version from procedure_templates where org_id = 'a0000000-0000-0000-0000-000000000001'
       and model_id = 'internal_audit' and is_current), 1, 'publish: the chosen version becomes current');
  perform provio_test.assert_eq(
    (select count(*) from procedure_templates where org_id = 'a0000000-0000-0000-0000-000000000001'
       and model_id = 'internal_audit' and is_current), 1::bigint, 'publish: only one version stays current');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 7. The hash chain records every change and is append-only.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    (select count(*) from procedure_template_versions
      where org_id = 'a0000000-0000-0000-0000-000000000001') >= 4,
    'chain: every template and step change is logged');
  perform provio_test.assert_true(
    (select count(*) from procedure_template_versions
      where org_id = 'a0000000-0000-0000-0000-000000000001' and row_hash is not null
        and prev_hash is not null) > 0,
    'chain: rows carry prev_hash and row_hash');
  perform provio_test.assert_raises(
    $q$update procedure_template_versions set payload = '{}'::jsonb$q$,
    'append-only', 'chain: the version log cannot be updated');
end $$;

-- ===========================================================================
-- 8. Cross-org isolation: org B sees none of org A's templates or steps.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from procedure_templates where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'isolation: org B cannot read org A procedure templates');
  perform provio_test.assert_eq(
    (select count(*) from test_step_templates where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'isolation: org B cannot read org A test step templates');
  perform provio_test.assert_eq(
    (select count(*) from procedure_template_versions where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'isolation: org B cannot read org A template versions');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 9. procedure_template_seed is idempotent and platform_create_tenant seeds a default (4.4).
-- ===========================================================================
do $$
declare
  v_first uuid;
  v_second uuid;
  v_new uuid;
  v_steps int;
begin
  v_first := public.procedure_template_seed('a0000000-0000-0000-0000-000000000001', 'baseline', 'Baseline');
  v_second := public.procedure_template_seed('a0000000-0000-0000-0000-000000000001', 'baseline', 'Baseline');
  perform provio_test.assert_eq(v_first, v_second, 'seed: a second seed returns the existing template');
  select count(*) into v_steps from test_step_templates where template_id = v_first;
  perform provio_test.assert_eq(v_steps, 3, 'seed: the default procedure has three steps');
end $$;

-- A platform admin creates a tenant; the new tenant already has the default methodology.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_new uuid;
begin
  v_new := public.platform_create_tenant('Methodology Test Client', 'admin@example.test', 'onboarding');
  perform provio_test.assert_true(v_new is not null, 'provision: a tenant is created');
end $$;
select provio_test.as_owner();

-- Read as the owner: the platform role correctly reads no tenant content (L2), so the seeded rows
-- are only visible from a context that owns them.
do $$
declare
  v_new uuid;
  v_tpls int;
begin
  select id into v_new from orgs where name = 'Methodology Test Client';
  perform provio_test.assert_true(v_new is not null, 'provision: the new tenant row exists');
  select count(*) into v_tpls from procedure_templates
   where org_id = v_new and model_id = 'internal_audit' and is_current;
  perform provio_test.assert_eq(v_tpls, 1, 'provision: the new tenant is seeded with a default procedure');
end $$;

-- ===========================================================================
-- 10. Applying a procedure to a workpaper snapshots its steps, and finalize enforces them (4.2).
-- ===========================================================================
-- An Org Admin lacks perform_work, so applying a template is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.workpaper_apply_template('60000000-0000-0000-0000-0000000000a1', 'internal_audit')$q$,
    'lacks the perform_work right', 'apply: a caller without perform_work is refused');
end $$;
select provio_test.as_owner();

-- A Preparer applies the current internal_audit procedure: three steps are snapshotted.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_n int;
begin
  v_n := public.workpaper_apply_template('60000000-0000-0000-0000-0000000000a1', 'internal_audit');
  perform provio_test.assert_eq(v_n, 3, 'apply: three steps are snapshotted onto the workpaper');
  perform provio_test.assert_eq(
    (select label from workpaper_step_state where workpaper_id = '60000000-0000-0000-0000-0000000000a1'
       and step_id = 'conclude'), 'Recompute the buffer', 'apply: the step label is copied in');
  perform provio_test.assert_eq(
    (select requires_evidence from workpaper_step_state where workpaper_id = '60000000-0000-0000-0000-0000000000a1'
       and step_id = 'operate'), true, 'apply: requires_evidence is copied in');
  -- An unknown model is refused.
  perform provio_test.assert_raises(
    $q$select public.workpaper_apply_template('60000000-0000-0000-0000-0000000000a1', 'no_such_model')$q$,
    'no current procedure for model', 'apply: an unknown model is refused');
  -- Finalize is blocked while a step is incomplete (the step gate runs before the row gate).
  perform provio_test.assert_raises(
    $q$select public.finalize_testing('60000000-0000-0000-0000-0000000000a1')$q$,
    'test step(s) are not complete', 'finalize: an incomplete step blocks finalization');
  -- Complete every step; finalize now fails on the missing rows, proving the step gate cleared.
  perform public.set_test_step_state('60000000-0000-0000-0000-0000000000a1', 'design', true);
  perform public.set_test_step_state('60000000-0000-0000-0000-0000000000a1', 'operate', true);
  perform public.set_test_step_state('60000000-0000-0000-0000-0000000000a1', 'conclude', true);
  -- Re-applying refreshes the definition but never clears a completed tick.
  perform public.workpaper_apply_template('60000000-0000-0000-0000-0000000000a1', 'internal_audit');
  perform provio_test.assert_eq(
    (select completed from workpaper_step_state where workpaper_id = '60000000-0000-0000-0000-0000000000a1'
       and step_id = 'design'), true, 'apply: re-applying keeps a completed tick');
  perform provio_test.assert_raises(
    $q$select public.finalize_testing('60000000-0000-0000-0000-0000000000a1')$q$,
    'no rows to finalize', 'finalize: with steps done, the row gate is what remains');
end $$;
select provio_test.as_owner();

-- With a row recorded, finalize succeeds and the workpaper moves to prepared.
do $$
begin
  insert into workpaper_rows (org_id, workpaper_id, row_ref, result)
  values ('a0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000a1', 'r1', 'tick');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.finalize_testing('60000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(
    (select status from workpapers where id = '60000000-0000-0000-0000-0000000000a1'),
    'prepared', 'finalize: the workpaper moves to prepared once steps and rows are done');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 11. Grants: anon cannot execute any of the new RPCs.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.procedure_template_save(text,text,text,jsonb)', 'EXECUTE'),
    'grants: anon cannot execute procedure_template_save');
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.procedure_template_list()', 'EXECUTE'),
    'grants: anon cannot execute procedure_template_list');
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.procedure_template_get(uuid)', 'EXECUTE'),
    'grants: anon cannot execute procedure_template_get');
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.procedure_template_publish(uuid)', 'EXECUTE'),
    'grants: anon cannot execute procedure_template_publish');
end $$;
