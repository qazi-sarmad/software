-- Test 116 (U4): the live activity spine.
--
-- The spine is the organisation's recent activity as a SUMMARY stream: actor, action, object, a
-- reduced detail object and the timestamp. This proves: the stream is rights-gated (a caller who may
-- read all scopes or an integrity owner sees it; a scoped member gets an empty stream, never an
-- error); it carries the actor's display name; it reduces `detail` to the small allowed set (Law L2 —
-- no arbitrary tenant content passes through); it is org-scoped (a caller never sees another org's
-- rows); it honours `p_since` and `p_limit`; and it is ordered newest-first.
--
-- `provio_test.seed()` itself writes one `activity_log` row (action 'seed'), so every count below is
-- scoped to the actions this test inserts, never to the raw table total.
--
-- The harness runs this file twice against the same database; the fixture rows are removed first.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Two activity rows in org A, one in org B, with a `detail` that carries both an allowed field
-- (`title`) and a field the spine must DROP (`secret`). The actor's display name is set so the
-- spine's name resolution is exercised.
update org_members set display_name = 'Ayesha K.'
 where org_id = 'a0000000-0000-0000-0000-000000000001'
   and user_id = '10000000-0000-0000-0000-0000000000a2';

insert into activity_log (id, org_id, actor_id, action, object_type, object_id, detail, ts) values
  ('c1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-0000000000a1', 'report_frozen', 'report', null,
   '{"title":"R-2026-014","secret":"do-not-leak"}'::jsonb, '2026-01-02T10:00:00Z'),
  ('c1000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-0000000000a2', 'sira_cycle_published', 'sira_cycle', null,
   '{"title":"SIRA 2026"}'::jsonb, '2026-01-01T10:00:00Z'),
  ('c1000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-0000000000b1', 'report_frozen', 'report', null,
   '{"title":"B-report"}'::jsonb, '2026-01-03T10:00:00Z');

-- ===========================================================================
-- 1. An integrity owner (CIA) sees the org's stream: newest first, actor name resolved, detail
--    reduced.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_action text;
  v_actor text;
  v_summary jsonb;
  v_n int;
begin
  select count(*) into v_n from public.activity_spine_list(40, null)
   where action in ('report_frozen', 'sira_cycle_published');
  perform provio_test.assert_eq(v_n, 2, 'spine: the CIA sees org A''s two inserted rows');

  -- Org B's row is never in org A's stream.
  perform provio_test.assert_eq(
    (select count(*) from public.activity_spine_list(40, null) where summary ->> 'title' = 'B-report'),
    0, 'spine: org A never sees org B''s row');

  -- Newest first among the inserted rows: the 2026-01-02 row precedes the 2026-01-01 row.
  select action into v_action from public.activity_spine_list(40, null)
   where action in ('report_frozen', 'sira_cycle_published') order by ts desc limit 1;
  perform provio_test.assert_eq(v_action, 'report_frozen', 'spine: ordered newest first');

  -- The actor's display name is resolved from org_members.
  select actor_name, summary into v_actor, v_summary
    from public.activity_spine_list(40, null) where action = 'sira_cycle_published' limit 1;
  perform provio_test.assert_eq(v_actor, 'Ayesha K.', 'spine: the actor name is resolved');

  -- The detail is reduced: `title` survives, `secret` is dropped.
  perform provio_test.assert_eq(v_summary ->> 'title', 'SIRA 2026', 'spine: an allowed detail field survives');
  perform provio_test.assert_true(
    (v_summary ? 'secret') = false,
    'spine: a non-allowed detail field is dropped (Law L2)');
end $$;

-- ===========================================================================
-- 2. A scoped member (auditee, no view_all_scopes) gets an EMPTY stream, never an error.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-000000000001', 'auditee');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.activity_spine_list(40, null)), 0,
    'spine: a scoped member sees an empty stream (never an error)');
end $$;

-- ===========================================================================
-- 3. p_since filters, p_limit caps, and p_limit is clamped.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  -- p_since keeps only the inserted 2026-01-02 row (the seed row is newer but is excluded by action).
  perform provio_test.assert_eq(
    (select count(*) from public.activity_spine_list(40, '2026-01-01T12:00:00Z')
      where action in ('report_frozen', 'sira_cycle_published')), 1,
    'spine: p_since keeps only rows strictly after it');
  -- p_limit caps the number of rows returned.
  perform provio_test.assert_eq(
    (select count(*) from public.activity_spine_list(1, null)), 1,
    'spine: p_limit caps the number of rows');
  -- A zero or negative limit is clamped up to 1, never to an unbounded read.
  perform provio_test.assert_eq(
    (select count(*) from public.activity_spine_list(0, null)), 1,
    'spine: a non-positive limit is clamped to 1');
end $$;

-- ===========================================================================
-- 4. Org scoping: an org B integrity owner never sees org A's rows.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.activity_spine_list(40, null)
      where action in ('report_frozen', 'sira_cycle_published')), 1,
    'spine: org B sees only its own inserted row');
  perform provio_test.assert_eq(
    (select count(*) from public.activity_spine_list(40, null) where action = 'sira_cycle_published'), 0,
    'spine: org B never sees org A''s rows');
end $$;

-- ===========================================================================
-- 5. Anonymous (no session) is refused at the grant, never handed a stream.
-- ===========================================================================
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.activity_spine_list(40, null)$q$,
    null, 'spine: an anonymous caller cannot even call the function');
end $$;
select provio_test.as_owner();

-- Restore the seed (M5: no residue).
select provio_test.seed();
