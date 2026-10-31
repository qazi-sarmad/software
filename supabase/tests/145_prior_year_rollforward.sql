-- Test 145 (integrator, final phase): prior-year workpaper roll-forward, the export check, and the
-- prior-year-access gate on every prior-year request.
--
-- Owner instruction 2026-10-30: "prior-year workpaper roll-forward + export check; only those with
-- prior-year access may raise such requests."
--
-- Happy path: the CIA builds a roll-forward of engagement g_a1 from g_a2; the manifest lists the
-- source's workpapers; after the source workpaper is exported the export check is complete.
-- Bad paths: an item with no recorded export leaves the check incomplete and names it; a caller who
-- cannot read the source engagement is refused; a self-roll-forward is refused; a cross-tenant source
-- is refused; a preparer without manage_engagements is refused.

\i supabase/tests/00_lib.sql
select provio_test.seed();

-- A scoped deployer: holds manage_engagements but NOT view_all_scopes, and its scope is universe u_a2
-- only. It can reach a prior-year request for g_a2 but not for g_a1, so the access gate is isolated
-- from the manage_engagements gate.
insert into roles (id, org_id, name, slug, is_seed, rights) values
  ('20000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'Scoped deployer',
   'scoped_deployer', false, '{"manage_engagements":true}'::jsonb);
insert into org_members (org_id, user_id, role_id, hierarchy_level) values
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000c1',
   '20000000-0000-0000-0000-0000000000c1', 3);
insert into user_scopes (org_id, user_id, universe_id) values
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000c1',
   '30000000-0000-0000-0000-0000000000a2');

-- ===========================================================================
-- 1. The access predicate. The CIA (view_all_scopes) can read both engagements; the scoped deployer
--    can read only its own universe.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(public.prior_year_access_ok('50000000-0000-0000-0000-0000000000a1'),
    'P1: the CIA has prior-year access to g_a1');
  perform provio_test.assert_true(public.prior_year_access_ok('50000000-0000-0000-0000-0000000000a2'),
    'P1: the CIA has prior-year access to g_a2');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'scoped_deployer');
do $$
begin
  perform provio_test.assert_true(public.prior_year_access_ok('50000000-0000-0000-0000-0000000000a2'),
    'P1: the scoped deployer has access to g_a2 (its universe)');
  perform provio_test.assert_true(not public.prior_year_access_ok('50000000-0000-0000-0000-0000000000a1'),
    'P1: the scoped deployer has NO access to g_a1 (another universe)');
end $$;

-- ===========================================================================
-- 2. BAD PATH — the access gate. The scoped deployer holds manage_engagements but cannot read the
--    source engagement, so the roll-forward is refused by name.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises($q$
    select public.prior_year_rollforward_build('50000000-0000-0000-0000-0000000000a2'::uuid,
                                               '50000000-0000-0000-0000-0000000000a1'::uuid)
  $q$, 'prior-year access', 'P2: a caller without prior-year access to the source is refused');
  perform provio_test.assert_raises($q$
    select public.import_prior_year_item('50000000-0000-0000-0000-0000000000a1'::uuid, 'scope',
                                         '50000000-0000-0000-0000-0000000000a2'::uuid)
  $q$, 'prior-year access', 'P2: the same gate guards a prior-year import');
end $$;

-- ===========================================================================
-- 3. BAD PATH — an engagement cannot roll forward from itself.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.prior_year_rollforward_build('50000000-0000-0000-0000-0000000000a1'::uuid,
                                               '50000000-0000-0000-0000-0000000000a1'::uuid)
  $q$, 'cannot roll forward from itself', 'P3: a self-roll-forward is refused');
end $$;

-- ===========================================================================
-- 4. BAD PATH — a cross-tenant source is refused.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises($q$
    select public.prior_year_rollforward_build('50000000-0000-0000-0000-0000000000a1'::uuid,
                                               '50000000-0000-0000-0000-0000000000b1'::uuid)
  $q$, 'not found in this organisation', 'P4: a cross-tenant source is refused');
end $$;

-- ===========================================================================
-- 5. HAPPY PATH — build the roll-forward for g_a1 from g_a2. g_a2 has workpaper wp_a2; with no export
--    yet, the manifest lists it as not exported and the export check is incomplete and names it.
-- ===========================================================================
do $$
declare
  v_out jsonb;
  v_check jsonb;
begin
  v_out := public.prior_year_rollforward_build('50000000-0000-0000-0000-0000000000a1',
                                               '50000000-0000-0000-0000-0000000000a2');
  perform provio_test.assert_eq((v_out ->> 'items_expected')::int, 1, 'P5: one source workpaper is expected');
  perform provio_test.assert_eq((v_out ->> 'export_complete')::boolean, false, 'P5: the export check starts incomplete');

  v_check := public.prior_year_export_check('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((v_check ->> 'complete')::boolean, false, 'P5: the check reports incomplete');
  perform provio_test.assert_eq((v_check ->> 'items_present')::int, 0, 'P5: no item is present yet');
  perform provio_test.assert_eq(jsonb_array_length(v_check -> 'missing'), 1, 'P5: the missing item is named');
  perform provio_test.assert_eq(v_check -> 'missing' -> 0 ->> 'workpaper_id',
    '60000000-0000-0000-0000-0000000000a2', 'P5: the missing item is wp_a2');
end $$;

-- ===========================================================================
-- 6. HAPPY PATH — record the export of wp_a2, rebuild, and the export check is complete.
-- ===========================================================================
do $$
declare
  v_out jsonb;
  v_check jsonb;
begin
  perform public.log_export('workpaper', '60000000-0000-0000-0000-0000000000a2', 'pdf', '{}'::jsonb, 'sha256:test');
  v_out := public.prior_year_rollforward_build('50000000-0000-0000-0000-0000000000a1',
                                               '50000000-0000-0000-0000-0000000000a2');
  perform provio_test.assert_eq((v_out ->> 'export_complete')::boolean, true, 'P6: the export check is now complete');
  perform provio_test.assert_eq((v_out ->> 'rollforward_id') is not null, true, 'P6: the roll-forward has an id');
  perform provio_test.assert_eq(
    (select version from prior_year_rollforwards where engagement_id = '50000000-0000-0000-0000-0000000000a1'),
    2, 'P6: a rebuild is a new version');

  v_check := public.prior_year_export_check('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((v_check ->> 'complete')::boolean, true, 'P6: the check reports complete');
  perform provio_test.assert_eq(jsonb_array_length(v_check -> 'missing'), 0, 'P6: nothing is missing');
end $$;

-- ===========================================================================
-- 7. HAPPY PATH — the export check refuses when no roll-forward has been built.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises($q$
    select public.prior_year_export_check('50000000-0000-0000-0000-0000000000b1'::uuid)
  $q$, 'no roll-forward has been built', 'P7: a check without a roll-forward is refused');
end $$;

-- ===========================================================================
-- 8. BAD PATH — a preparer (no manage_engagements) cannot build a roll-forward, even for a source it
--    could read.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.prior_year_rollforward_build('50000000-0000-0000-0000-0000000000a1'::uuid,
                                               '50000000-0000-0000-0000-0000000000a2'::uuid)
  $q$, 'manage_engagements', 'P8: a preparer cannot build a roll-forward');
end $$;

-- ===========================================================================
-- 9. HAPPY PATH — a prior-year import by a caller with access succeeds and is recorded.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
begin
  v_id := public.import_prior_year_item('50000000-0000-0000-0000-0000000000a2', 'scope',
                                        '50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(v_id is not null, 'P9: an import by a caller with access succeeds');
  perform provio_test.assert_eq(
    (select status from prior_year_imports where id = v_id), 'imported_confirm',
    'P9: the import is recorded as imported_confirm');
end $$;

-- ===========================================================================
-- 10. ISOLATION — org B sees none of org A's roll-forwards.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from prior_year_rollforwards_list()), 0::bigint,
    'P10: org B sees none of org A''s roll-forwards');
end $$;

select provio_test.as_owner();
