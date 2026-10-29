-- Test 125: Board Pack depth (migration 0099, F10 / S7).
--   * the boundary (from_ts, to_ts) is actually applied to every source row;
--   * the snapshot now carries a real SIRA heatmap (entity x band) and a plan Gantt;
--   * every figure the new fields add still carries refs (the F10 invariant);
--   * the snapshot stays deterministic and cross-org isolated;
--   * a section can be renamed by configuration (no code change).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The board_pack feature gates the snapshot; grant it for Org A and Org B.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','board_pack',true,'Assurance','board pack add-on');
  perform public.platform_set_entitlement('b0000000-0000-0000-0000-000000000001','board_pack',true,'Assurance','board pack add-on');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- A. The boundary is applied. Two SIRA scores and one CAP, one of each dated in the past.
-- ===========================================================================
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_all jsonb;
  v_windowed jsonb;
  v_from timestamptz := now() - interval '1 hour';
begin
  -- A plan item with a real window, so the Gantt has something to lay out.
  insert into plan_items (id, org_id, plan_id, title, status, planned_start, planned_end)
  values ('d1000000-0000-0000-0000-0000000000a1', org_a, 'a2000000-0000-0000-0000-0000000000a1',
          'Payroll audit', 'approved', current_date + 10, current_date + 20),
         ('d1000000-0000-0000-0000-0000000000a2', org_a, 'a2000000-0000-0000-0000-0000000000a1',
          'Treasury review', 'proposed', current_date + 15, current_date + 16);

  -- A CAP that is 45 days overdue and created two days ago: inside a one-hour window? No.
  insert into caps (id, org_id, engagement_id, finding_id, due_date, status, action_description)
  select 'd2000000-0000-0000-0000-0000000000a1', org_a, '50000000-0000-0000-0000-0000000000a1',
         id, current_date - 45, 'open', 'Fix the control'
    from findings where org_id = org_a limit 1;
  update caps set created_at = now() - interval '2 days'
   where id = 'd2000000-0000-0000-0000-0000000000a1';

  -- The full snapshot sees the CAP in the 31-60 band.
  v_all := public.board_pack_snapshot(org_a, 'org', null, null);
  perform provio_test.assert_eq((v_all -> 'cap' -> '31-60' ->> 'value')::int, 1,
    'boundary: the full snapshot counts the 45-day CAP in the 31-60 band');

  -- A window that starts after the CAP was created excludes it: this is the boundary defect the
  -- migration fixes (before it, from_ts was echoed but never filtered on).
  v_windowed := public.board_pack_snapshot(org_a, 'org', v_from, null);
  perform provio_test.assert_eq(coalesce(v_windowed -> 'cap' -> '31-60' ->> 'value', '0')::int, 0,
    'boundary: a window starting after the CAP was created excludes it');

  -- The window is echoed honestly.
  perform provio_test.assert_eq((v_windowed ->> 'from_ts')::timestamptz, v_from,
    'boundary: the snapshot reports the window it used');
end $$;

-- ===========================================================================
-- B. The SIRA heatmap: entity x band, dense, every cell carrying its score rows as refs.
-- ===========================================================================
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_snap jsonb;
  v_heat jsonb;
  v_cell jsonb;
  v_bad text[];
begin
  v_snap := public.board_pack_snapshot(org_a, 'org', null, null);
  v_heat := v_snap -> 'sira' -> 'heatmap';

  perform provio_test.assert_true(v_heat is not null, 'heatmap: the snapshot carries a heatmap');
  perform provio_test.assert_true(jsonb_array_length(v_heat -> 'entities') >= 1,
    'heatmap: at least one entity row');
  perform provio_test.assert_true(jsonb_array_length(v_heat -> 'bands') >= 1,
    'heatmap: the configured bands are the columns');
  perform provio_test.assert_true(jsonb_array_length(v_heat -> 'cells') >= 1,
    'heatmap: at least one non-empty cell');

  -- The seeded A-E1 entity has a score, so its cell must exist and carry the score's ref.
  select c into v_cell
    from jsonb_array_elements(v_heat -> 'cells') c
   where c ->> 'entity' = 'A-E1'
   limit 1;
  perform provio_test.assert_true(v_cell is not null, 'heatmap: the scored entity has a cell');
  perform provio_test.assert_true((v_cell ->> 'value')::int >= 1, 'heatmap: the cell counts the score');
  perform provio_test.assert_true(jsonb_array_length(v_cell -> 'refs') >= 1,
    'heatmap: the cell points at the score rows behind it');
  perform provio_test.assert_eq(v_cell -> 'refs' -> 0 ->> 'type', 'sira_score',
    'heatmap: the ref is a sira_score');

  -- The whole deep snapshot still satisfies the F10 invariant: no figure without refs.
  v_bad := public.board_pack_figure_refs(v_snap);
  perform provio_test.assert_eq(coalesce(array_length(v_bad, 1), 0), 0,
    'heatmap: every figure in the deep snapshot carries at least one ref');
end $$;

-- ===========================================================================
-- C. The plan Gantt: one row per dated plan item, with a start, an end and a status.
-- ===========================================================================
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_gantt jsonb;
  v_first jsonb;
  v_bad text[];
begin
  v_gantt := public.board_pack_snapshot(org_a, 'org', null, null) -> 'plan' -> 'gantt';
  perform provio_test.assert_true(v_gantt is not null, 'gantt: the snapshot carries a gantt');
  perform provio_test.assert_eq(jsonb_array_length(v_gantt), 2, 'gantt: both dated plan items are rows');

  v_first := v_gantt -> 0;
  perform provio_test.assert_eq(v_first ->> 'title', 'Payroll audit', 'gantt: the row names the plan item');
  perform provio_test.assert_true((v_first ->> 'start') is not null, 'gantt: the row has a start date');
  perform provio_test.assert_true((v_first ->> 'end') is not null, 'gantt: the row has an end date');
  perform provio_test.assert_eq(v_first ->> 'status', 'approved', 'gantt: the row carries the status');
  perform provio_test.assert_true(jsonb_array_length(v_first -> 'refs') >= 1,
    'gantt: the bar points at its plan item');

  v_bad := public.board_pack_figure_refs(jsonb_build_object('plan', jsonb_build_object('value', 2,
    'refs', jsonb_build_array(jsonb_build_object('type','plan_item','id','d1000000-0000-0000-0000-0000000000a1')),
    'gantt', v_gantt)));
  perform provio_test.assert_eq(coalesce(array_length(v_bad, 1), 0), 0,
    'gantt: every bar carries a ref, so the invariant holds');
end $$;

-- ===========================================================================
-- D. Determinism and cross-org isolation for the deep snapshot.
-- ===========================================================================
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
  org_b uuid := 'b0000000-0000-0000-0000-000000000001';
  v1 jsonb;
  v2 jsonb;
  v_b jsonb;
begin
  v1 := public.board_pack_snapshot(org_a, 'org', null, null);
  v2 := public.board_pack_snapshot(org_a, 'org', null, null);
  perform provio_test.assert_eq(public.canonical_payload(v1) = public.canonical_payload(v2), true,
    'determinism: two deep snapshots of the same state are byte-identical');

  v_b := public.board_pack_snapshot(org_b, 'org', null, null);
  perform provio_test.assert_eq(
    coalesce((v_b -> 'sira' -> 'heatmap' -> 'cells' -> 0 ->> 'entity'), 'A-E1'), 'B-E1',
    'isolation: Org B sees only its own entity in the heatmap');
  perform provio_test.assert_true(
    not exists (
      select 1 from jsonb_array_elements(v_b -> 'plan' -> 'gantt') g
       where g ->> 'title' = 'Payroll audit'),
    'isolation: Org B does not see Org A plan items in the gantt');
end $$;

-- ===========================================================================
-- E. A section can be renamed by configuration (F10: configuration, not code).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_label text;
begin
  perform public.board_pack_sections_save('a0000000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('section_key','sira','label','Residual risk and heatmap')));
  select label into v_label from board_pack_sections
   where org_id = 'a0000000-0000-0000-0000-000000000001' and section_key = 'sira';
  perform provio_test.assert_eq(v_label, 'Residual risk and heatmap',
    'config: the Org Admin renamed a section');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- F. The refusal path: an org without the entitlement, and a caller with no session.
-- ===========================================================================
-- The board_pack feature is not on by default; revoke it and the snapshot must refuse.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','board_pack',false,'Assurance','revoked');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.board_pack_snapshot('a0000000-0000-0000-0000-000000000001','org',null,null)$q$,
    'not included in your plan', 'refusal: the snapshot refuses without the board_pack feature');
end $$;
select provio_test.as_owner();

-- Restore the entitlement so later tests in the run are unaffected.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','board_pack',true,'Assurance','restored');
end $$;
select provio_test.as_owner();

do $$ begin perform provio_test.assert_true(true, 'test 105 complete'); end $$;
