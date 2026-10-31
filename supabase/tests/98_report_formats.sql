-- 98: report formats — the per-client versioned format editor (WRITE-1, 0091).
--   * RLS on every new table, no direct write from a tenant, isolation between organisations.
--   * A format is created as a draft; saving again updates the draft.
--   * Publishing is refused while the format has validation issues.
--   * A published version is immutable; the next save creates the next draft version.
--   * The version log is hash-chained and append-only.
--   * Cross-org: Org B cannot read, save or publish Org A's format.
-- M5: the fixtures are written as the owner and removed by provio_test.seed() on the next run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. RLS is on for every table 0091 creates.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  n int;
begin
  foreach t in array array['report_formats', 'format_audiences', 'report_format_versions'] loop
    select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t and c.relrowsecurity;
    perform provio_test.assert_eq(n, 1, format('RLS is enabled on %s', t));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. No direct write from a tenant to any of the tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_n int;
begin
  foreach t in array array['report_formats', 'format_audiences', 'report_format_versions'] loop
    select count(*) into v_n from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = t
        and g.grantee in ('anon', 'authenticated', 'public')
        and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE');
    perform provio_test.assert_eq(v_n, 0, format('%s takes no direct write from a tenant', t));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. A format is created as a draft; the version log chains it.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.format_save(
  'a0000000-0000-0000-0000-000000000001', 'board-quarterly', 'M1', 'Board quarterly',
  '[{"key":"cover","label":"Cover","role":"cover","visible":true,"register":null}]'::jsonb,
  '{"pageSize":"A4","marginTopMm":20,"marginRightMm":20,"marginBottomMm":20,"marginLeftMm":20}'::jsonb,
  'en-GB', repeat('a', 64));

do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from report_formats where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 1,
    'the format was created');
  perform provio_test.assert_eq(
    (select status from report_formats where format_key = 'board-quarterly'), 'draft',
    'a new format is a draft');
  perform provio_test.assert_eq(
    (select version from report_formats where format_key = 'board-quarterly')::int, 1,
    'the first version is 1');
  perform provio_test.assert_eq(
    (select count(*) from report_format_versions where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 1,
    'the version log holds one row');
  perform provio_test.assert_true(
    (select coalesce(prev_hash, '') = '' from report_format_versions where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'the first version row has an empty prev_hash');
end $$;

-- Saving again while still a draft updates the same row and chains another version entry.
select public.format_save(
  'a0000000-0000-0000-0000-000000000001', 'board-quarterly', 'M1', 'Board quarterly (revised)',
  '[{"key":"cover","label":"Cover","role":"cover","visible":true,"register":null},{"key":"findings","label":"Findings","role":"findings","visible":true,"register":null}]'::jsonb,
  '{"pageSize":"A4","marginTopMm":20,"marginRightMm":20,"marginBottomMm":20,"marginLeftMm":20}'::jsonb,
  'en-GB', repeat('b', 64));
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from report_formats where format_key = 'board-quarterly')::int, 1,
    'a draft save updates the same row, not a new version');
  perform provio_test.assert_eq(
    (select body_hash from report_formats where format_key = 'board-quarterly'), repeat('b', 64),
    'the draft carries the new body hash');
  perform provio_test.assert_eq(
    (select count(*) from report_format_versions where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 2,
    'the version log chained a second row');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Publishing is refused while the format has validation issues.
-- ---------------------------------------------------------------------------
do $$ begin
  perform provio_test.assert_raises(
    format('select public.format_publish(%L, 3)', (select id from report_formats where format_key = 'board-quarterly')),
    'validation issue',
    'publishing is refused when the format has issues');
end $$;

-- With zero issues the publish succeeds.
select public.format_publish((select id from report_formats where format_key = 'board-quarterly'), 0);
do $$
begin
  perform provio_test.assert_eq(
    (select status from report_formats where format_key = 'board-quarterly'), 'published',
    'the format is published once it has no issues');
end $$;

-- ---------------------------------------------------------------------------
-- 5. A published version is immutable: a change creates the next draft version.
-- ---------------------------------------------------------------------------
select public.format_save(
  'a0000000-0000-0000-0000-000000000001', 'board-quarterly', 'M1', 'Board quarterly v2',
  '[{"key":"cover","label":"Cover","role":"cover","visible":true,"register":null}]'::jsonb,
  '{"pageSize":"Letter","marginTopMm":25,"marginRightMm":20,"marginBottomMm":20,"marginLeftMm":20}'::jsonb,
  'en-US', repeat('c', 64));
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from report_formats where format_key = 'board-quarterly')::int, 2,
    'editing a published format creates a second version');
  perform provio_test.assert_eq(
    (select status from report_formats where format_key = 'board-quarterly' order by version desc limit 1), 'draft',
    'the new version is a draft');
  perform provio_test.assert_eq(
    (select status from report_formats where format_key = 'board-quarterly' order by version asc limit 1), 'published',
    'the published version is left untouched');
  perform provio_test.assert_eq(
    (select version from report_formats where format_key = 'board-quarterly' order by version desc limit 1)::int, 2,
    'the new version is 2');
end $$;

-- The published row itself refuses an update.
select provio_test.as_owner();
do $$ begin
  perform provio_test.assert_raises(
    format('update report_formats set label = ''tampered'' where id = %L', (select id from report_formats where format_key = 'board-quarterly' and status = 'published')),
    'immutable',
    'a published format version refuses an update');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');

-- ---------------------------------------------------------------------------
-- 6. The version log is append-only.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$ begin
  perform provio_test.assert_raises(
    $q$update report_format_versions set body_hash = 'x'$q$, 'append-only',
    'report_format_versions refuses an update');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');

-- ---------------------------------------------------------------------------
-- 7. Audiences: an audience that may edit but not view is refused by the table check.
-- ---------------------------------------------------------------------------
select public.format_audience_set(
  (select id from report_formats where format_key = 'board-quarterly' order by version asc limit 1),
  '[{"roleSlug":"cia","canView":true,"canEdit":true},{"roleSlug":"auditee","canView":true,"canEdit":false}]'::jsonb);
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from format_audiences a join report_formats f on f.id = a.format_id
      where f.format_key = 'board-quarterly' and f.status = 'published')::int, 2,
    'two audiences were recorded on the published version');
end $$;
select provio_test.as_owner();
do $$ begin
  perform provio_test.assert_raises(
    $q$insert into format_audiences (org_id, format_id, role_slug, can_view, can_edit)
       values ('a0000000-0000-0000-0000-000000000001', gen_random_uuid(), 'x', false, true)$q$,
    'fa_contradiction_check',
    'an audience that may edit but not view is refused');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');

-- ---------------------------------------------------------------------------
-- 8. Cross-org: Org B cannot read, save or publish Org A's format.
-- ---------------------------------------------------------------------------
-- Capture Org A's published format id as the owner, so the cross-org call is the only variable.
create temporary table _fmt_probe as
  select id from report_formats where format_key = 'board-quarterly' and status = 'published';
grant select on _fmt_probe to public;

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform provio_test.assert_eq(
    (select count(*) from public.format_list('a0000000-0000-0000-0000-000000000001'))::int, 0,
    'org B reads no Org A formats through format_list');
end $$;
do $$ begin
  perform provio_test.assert_raises(
    format($q$select public.format_save('a0000000-0000-0000-0000-000000000001', 'hijack', 'M1', 'x', '[]'::jsonb, '{}'::jsonb, 'en-GB', %L)$q$, repeat('d', 64)),
    'org',
    'org B cannot save a format into Org A');
end $$;
do $$ begin
  perform provio_test.assert_raises(
    format('select public.format_publish(%L, 0)', (select id from _fmt_probe)),
    'org',
    'org B cannot publish an Org A format');
end $$;

-- Org A still reads its own formats.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform provio_test.assert_eq(
    (select count(*) from public.format_list('a0000000-0000-0000-0000-000000000001'))::int, 2,
    'org A reads its own two format versions');
end $$;
drop table _fmt_probe;
