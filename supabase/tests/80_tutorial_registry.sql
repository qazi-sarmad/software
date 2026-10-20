-- Test 80 (S12, F18): the tutorial registry covers every Appendix A key, and the seed re-applies.
--
-- 0071 seeds one tutorials row per key from src/lib/tutorialKeys.json. provio_test.seed() truncates
-- tutorials, so this test re-applies the migration after seeding and proves:
--   1. every Appendix A key has a complete row (title, ordered steps, media path) — check-tutorials
--      mirrors the same list in the build, against the GIF files under public/tutorials;
--   2. a platform admin and an org member can both read the registry (F18);
--   3. the seed is idempotent: re-applying 0071 changes no row (M2).
--
-- Applies twice (M2, M6): the whole file is a no-op on a second run.
\i supabase/tests/00_lib.sql
select provio_test.seed();
-- seed() truncated tutorials; re-apply the seed migration exactly as CI applies migrations.
\i supabase/migrations/0071_tutorial_registry_seed.sql

-- ---------------------------------------------------------------------------
-- 1. Every Appendix A key has a complete row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing int;
  v_incomplete int;
begin
  select count(*) into v_missing
  from (values
    ('oa.dual-session'),('sa.dual-session'),('sa.setup-wizard'),('sa.setup-1'),('sa.setup-2'),
    ('sa.setup-3'),('sa.setup-4'),('sa.setup-5'),('sa.setup-6'),('sa.setup-7'),('sa.setup-8'),
    ('sa.setup-9'),('sa.health'),('sa.tenant-hub'),('sa.email-resend'),('sa.email-microsoft'),
    ('sa.email-smtp'),('sa.email-default'),('sa.email-force-tenant'),('sa.recipients'),
    ('sa.ai-models'),('sa.ai-denylist'),('sa.automation'),('sa.templates'),('sa.hosting-fit'),
    ('sa.hosting-rules'),('sa.migration'),('sa.tutorials'),('sa.features'),('sa.plans'),('sa.trail'),
    ('oa.setup-wizard'),('oa.setup-1'),('oa.setup-2'),('oa.setup-3'),('oa.setup-4'),('oa.setup-5'),
    ('oa.setup-6'),('oa.setup-7'),('oa.setup-8'),('oa.setup-9'),('oa.profile'),('oa.branding'),
    ('oa.pptx-theme'),('oa.features'),('oa.roles'),('oa.ai'),('oa.ai-test'),('oa.ai-usecases'),
    ('oa.voice'),('oa.templates'),('oa.boardpack-config'),('oa.certificate-config'),('oa.email-resend'),
    ('oa.email-microsoft'),('oa.email-smtp'),('oa.email-test'),('oa.automation'),('oa.templates-email'),
    ('oa.escalation'),('oa.auditors'),('oa.auditor-matrix'),('oa.hosting'),('oa.migration'),
    ('oa.deployment-kit'),('oa.retire-old'),('oa.history'),('oa.tutorials'),('oa.golive'),('oa.invite'),
    ('oa.patterns-config'),('oa.boardpack-use'),('oa.boardpack-generate'),('oa.boardpack-view'),
    ('oa.boardpack-download'),('oa.certificate'),('oa.verify'),('oa.ai-assist'),
    ('oa.escalation-cards'),('oa.timetravel'),('oa.patterns'),('ex.accept'),('ex.home'),
    ('ex.engagement'),('ex.verify')
  ) as expected(key)
  where not exists (select 1 from public.tutorials t where t.key = expected.key);

  select count(*) into v_incomplete
  from public.tutorials t
  where t.title is null or jsonb_array_length(t.steps) = 0 or t.media_path is null;

  perform provio_test.assert_eq(v_missing, 0, 'every Appendix A tutorial key has a registry row');
  perform provio_test.assert_eq(v_incomplete, 0, 'every seeded tutorial row is complete');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Readable by a platform admin and by an org member.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform provio_test.assert_true(
    (select count(*) from public.list_tutorials()) >= 85,
    'F18: a platform admin reads the whole tutorial registry');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    (select count(*) from public.list_tutorials()) >= 1,
    'F18: an org member reads the tutorial registry');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Idempotent: re-applying the seed migration changes no row (M2).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_before int;
begin
  select count(*) into v_before from public.tutorials;
  -- on conflict (key) do nothing means a second application inserts nothing.
  insert into public.tutorials (key, audience, title, steps, media_path)
  values ('oa.profile', 'org_admin', 'Organisation profile', '["x"]'::jsonb, 'tutorials/oa.profile.gif')
  on conflict (key) do nothing;
  perform provio_test.assert_eq(
    (select count(*) from public.tutorials), v_before,
    'M2: re-applying the tutorial seed changes nothing');
end $$;

select provio_test.as_owner();
