-- 90_tutorial_steps.sql — C4.
-- The S12 seed wrote the same three generic lines for every key. Migration 0081 replaces them with
-- the real ordered steps, but only where the recorder has not generated the row yet.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The seed helper clears the registry (M5). Re-apply the registry seed and the step migration, which
-- also proves both are safe to apply again (M2): 0071 does nothing on a key it has already written,
-- and 0081 only rewrites a row the recorder has not generated. 0092 adds the two keys that were added
-- to the JSON after 0071 but never seeded; it is re-applied here for the same M2 proof.
\i supabase/migrations/0071_tutorial_registry_seed.sql
\i supabase/migrations/0081_tutorial_steps.sql
\i supabase/migrations/0092_tutorial_registry_gap.sql

do $$
declare
  v_generic int;
  v_short int;
  v_follow int;
  v_keys int;
begin
  -- 1. No key is left on the S12 filler wording.
  select count(*) into v_follow from tutorials where steps::text ilike '%Follow the highlighted control%';
  perform provio_test.assert_eq(v_follow, 0, 'C4: no key still carries the S12 filler step');

  -- 2. Every key has at least four steps.
  select count(*) into v_short from tutorials where jsonb_array_length(steps) < 4;
  perform provio_test.assert_eq(v_short, 0, 'C4: every key has at least four steps');

  -- 3. Every step carries text; a step that drives a control carries its testid.
  select count(*) into v_generic
    from tutorials t, jsonb_array_elements(t.steps) s
   where coalesce(s ->> 'text', '') = '';
  perform provio_test.assert_eq(v_generic, 0, 'C4: no step is empty');

  -- 4. The registry is complete (77 rows: the frozen JSON key list, less the six AI tutorials and the two AI setup steps that 0087 removed).
  select count(*) into v_keys from tutorials;
  perform provio_test.assert_true(v_keys >= 77, 'C4: the registry holds every Appendix A key');

  -- 5. At least one step per key names a control to drive, so a recording shows a real action.
  perform provio_test.assert_eq(
    (select count(*) from tutorials t
      where not exists (select 1 from jsonb_array_elements(t.steps) s where s ->> 'testid' is not null)),
    0, 'C4: every key names at least one control to drive');

  -- 6. The registry holds every key in the frozen JSON list. 0071 seeded 77 rows and 0092 adds the
  --    two keys that were added to src/lib/tutorialKeys.json after 0071 was written but never seeded
  --    (oa.connectors, oa.formats). Without 0092 a fresh database is two keys short of the app.
  select count(*) into v_keys
    from (values
      ('oa.connectors'), ('oa.formats')
    ) as expected(key)
   where not exists (select 1 from tutorials t where t.key = expected.key);
  perform provio_test.assert_eq(v_keys, 0, 'W12: the two post-0071 keys have registry rows');

  -- 7. The two added rows carry their real ordered steps, not the S12 filler or an empty array.
  perform provio_test.assert_true(
    (select jsonb_array_length(steps) >= 4 from tutorials where key = 'oa.connectors'),
    'W12: oa.connectors carries its real steps');
  perform provio_test.assert_true(
    (select jsonb_array_length(steps) >= 4 from tutorials where key = 'oa.formats'),
    'W12: oa.formats carries its real steps');
end $$;
