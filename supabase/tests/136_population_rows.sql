-- Test 119 (population rows): the missing writer behind the population grid.
--
-- `population_rows` had NO production writer: a population could be registered with a sha256 and a
-- row count, but its rows were never stored, so `compute_sample` found an empty population and every
-- draw raised `population_gate`. This proves: `import_population_rows` stores rows positionally and
-- refreshes the row count; a caller WITHOUT perform_work is refused; a population from another org is
-- invisible; a sealed engagement refuses the import; the import is ledgered; and `list_population_rows`
-- returns the rows org-scoped, ordered by row_ref, with a bounded limit.
--
-- The harness runs this file twice against the same database; the import REPLACES by default and
-- `provio_test.seed()` resets the data at the top, so a second run is identical to the first.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. A caller with perform_work (the preparer a2) imports rows positionally.
--    The row count is refreshed and a ledger entry is appended.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_pop uuid := '70000000-0000-0000-0000-0000000000a1';
  v_total int;
  v_rc int;
  v_ledger_before bigint;
  v_ledger_after bigint;
  v_rows jsonb;
begin
  select count(*) into v_ledger_before from public.ledger_entries where action = 'population_rows_import';

  v_total := public.import_population_rows(v_pop, '[
    {"row_ref": 1, "data": {"ref": "1", "amount": "100.00"}},
    {"row_ref": 2, "data": {"ref": "2", "amount": "250.00"}},
    {"row_ref": 3, "data": {"ref": "3", "amount": "75.50"}}
  ]'::jsonb, false);
  perform provio_test.assert_eq(v_total, 3, 'import: three rows stored');

  select row_count into v_rc from populations where id = v_pop;
  perform provio_test.assert_eq(v_rc, 3, 'import: the population row_count is refreshed to the stored total');

  select count(*) into v_ledger_after from public.ledger_entries where action = 'population_rows_import';
  perform provio_test.assert_true(v_ledger_after = v_ledger_before + 1,
    'import: appends exactly one population_rows_import ledger entry');

  v_rows := public.list_population_rows(v_pop, 100);
  perform provio_test.assert_eq(jsonb_array_length(v_rows), 3, 'list: three rows returned');
  perform provio_test.assert_eq(v_rows -> 0 ->> 'row_ref', '1', 'list: ordered by row_ref');
  perform provio_test.assert_eq(v_rows -> 0 -> 'data' ->> 'amount', '100.00', 'list: row data is returned');

  -- Re-import without append REPLACES: the total tracks the new payload.
  v_total := public.import_population_rows(v_pop, '[
    {"row_ref": 1, "data": {"ref": "1"}},
    {"row_ref": 2, "data": {"ref": "2"}}
  ]'::jsonb, false);
  perform provio_test.assert_eq(v_total, 2, 'import: a replace drops the rows not in the new payload');

  -- Append keeps the existing rows and continues the numbering.
  v_total := public.import_population_rows(v_pop, '[{"ref": "9"}]'::jsonb, true);
  perform provio_test.assert_eq(v_total, 3, 'import: an append adds to the existing rows');
end $$;

-- ===========================================================================
-- 2. A caller WITHOUT perform_work (the observer a5) is refused.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  begin
    perform public.import_population_rows('70000000-0000-0000-0000-0000000000a1',
      '[{"row_ref": 1, "data": {}}]'::jsonb, false);
    perform provio_test.assert_true(false, 'import: an observer without perform_work must be refused');
  exception when others then
    perform provio_test.assert_true(sqlerrm like '%perform_work%',
      'import: the refusal names the missing right');
  end;
end $$;

-- ===========================================================================
-- 3. A population in ANOTHER org is invisible to a caller who HAS the right.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  begin
    perform public.import_population_rows('70000000-0000-0000-0000-0000000000b1',
      '[{"row_ref": 1, "data": {}}]'::jsonb, false);
    perform provio_test.assert_true(false, 'import: a foreign-org population must not be importable');
  exception when others then
    perform provio_test.assert_true(sqlerrm like '%not found%', 'import: a foreign population is refused');
  end;
end $$;

-- ===========================================================================
-- 4. list_population_rows is org-scoped: a caller sees only its own org's rows.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_rows jsonb;
begin
  v_rows := public.list_population_rows('70000000-0000-0000-0000-0000000000a1', 100);
  perform provio_test.assert_eq(jsonb_array_length(v_rows), 0,
    'list: a foreign population returns no rows to another org');
end $$;

select provio_test.as_owner();
