-- Test 109 (Phase 3.4): report_templates now has an effect.
--
-- Before 0108 the table had no writer and no reader, so it was pure dead config. This test saves a
-- template, proves compose_report honours it, proves the section list is validated, proves the
-- default is unchanged when no template exists, and proves every save is versioned and logged.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures: sign off Testing, pull exceptions and sign the Conclusion for A-Eng1, so the report is
-- available (§15.1). Workpapers/rows are inserted as the owner (the Planning gate blocks an app role).
insert into workpaper_rows (org_id, workpaper_id, row_ref, result, rationale, exception_flag) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R1','cross','Invoice missing','true'),
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R2','tick',null,false);
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.pull_exceptions('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 1. With no template, compose_report produces the pre-0108 default (five sections).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_version uuid; v_blocks int;
begin
  v_version := public.compose_report('50000000-0000-0000-0000-0000000000a1');
  select count(*) into v_blocks from report_blocks where report_version_id = v_version;
  perform provio_test.assert_eq(v_blocks, 5, '3.4: the default template produces five sections');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. report_template_save validates the section list: an unknown section id is refused; a well-formed
--    one is saved as a new current version and logged (L5, §23).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_id uuid;
begin
  perform provio_test.assert_raises(
    $q$select public.report_template_save('M1', 'Bad', '[{"id":"made_up"}]'::jsonb)$q$,
    'unknown section id', '3.4: a template naming an unknown section is refused');
  perform provio_test.assert_raises(
    $q$select public.report_template_save('M1', 'Empty', '[]'::jsonb)$q$,
    'non-empty array', '3.4: an empty template is refused');

  v_id := public.report_template_save('M1', 'Lean report',
    '[{"id":"findings"},{"id":"opinion"}]'::jsonb);
  perform provio_test.assert_true(v_id is not null, '3.4: a valid template is saved');
  perform provio_test.assert_eq(
    (select version from report_templates where id = v_id), 1, '3.4: the first template is version 1');
  perform provio_test.assert_true(
    exists (select 1 from report_template_versions where entity_id = v_id),
    '3.4: the template save is hash-chained in its version history');
  perform provio_test.assert_true(
    exists (select 1 from config_versions
             where org_id = 'a0000000-0000-0000-0000-000000000001' and key = 'report_templates'),
    '3.4: the template save writes a versioned config change');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. compose_report now honours the template: only the two named sections are created.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_version uuid; v_sections text[];
begin
  v_version := public.compose_report('50000000-0000-0000-0000-0000000000a1');
  select array_agg(distinct section_type order by section_type) into v_sections
    from report_blocks where report_version_id = v_version;
  perform provio_test.assert_eq(array_length(v_sections, 1), 2,
    '3.4: the composed report has exactly the template sections');
  perform provio_test.assert_true('findings' = any(v_sections) and 'opinion' = any(v_sections),
    '3.4: the composed report has the named sections');
  perform provio_test.assert_true(not ('scope' = any(v_sections)),
    '3.4: a section the template omits is not created');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. report_template_list returns the org's current template.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v jsonb;
begin
  v := public.report_template_list();
  perform provio_test.assert_eq(jsonb_array_length(v), 1, '3.4: one current template is listed');
  perform provio_test.assert_eq(v -> 0 ->> 'model_id', 'M1', '3.4: the template is for model M1');
  perform provio_test.assert_eq(jsonb_array_length(v -> 0 -> 'sections'), 2,
    '3.4: the template carries its two sections');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. Saving a second template supersedes the first: only the newest is current.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform public.report_template_save('M1', 'Full again',
    '[{"id":"executive_summary"},{"id":"scope"},{"id":"findings"},{"id":"opinion"},{"id":"appendices"}]'::jsonb);
end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from report_templates
      where org_id = 'a0000000-0000-0000-0000-000000000001' and model_id = 'M1' and is_current)::int, 1,
    '3.4: exactly one version is current after a second save');
  perform provio_test.assert_eq(
    (select max(version) from report_templates
      where org_id = 'a0000000-0000-0000-0000-000000000001' and model_id = 'M1'), 2,
    '3.4: the second save is version 2');
end $$;
select provio_test.as_owner();
