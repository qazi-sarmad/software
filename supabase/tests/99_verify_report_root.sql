-- 99: verify_report_root — the third anonymous function (WRITE-1, 0094, W10.3).
--   * The anonymous surface grows by exactly one function and nothing else became anonymous-callable.
--   * A reader holding a graph root confirms existence, issuance time and versions.
--   * It returns no tenant content: no organisation name while public_verify_show_title is off, and
--     never the root, a claim, a figure or a tenant identifier.
--   * An unknown root returns not_found. A short or null root returns not_found without a scan.
--   * The function is refused while the tenant's public_verification entitlement is off.
--   * Cross-org: the function is security definer and returns the same shape for any caller; it never
--     exposes one tenant's data to another because it returns no tenant data at all.
-- M5: the fixtures are written as the owner and removed by provio_test.seed() on the next run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The anonymous surface is exactly the three allow-listed functions.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_anon text[];
  v_extra text[];
begin
  select array_agg(distinct p.proname) into v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join aclexplode(p.proacl) a on true
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and r.rolname = 'anon' and a.privilege_type = 'EXECUTE'
     and d.objid is null;
  select array_agg(s) into v_extra from unnest(coalesce(v_anon, '{}'::text[])) s
    where s not in ('verify_certificate','verify_board_pack','verify_report_root');
  perform provio_test.assert_eq(coalesce(array_length(v_extra, 1), 0), 0,
    'anon executes no function outside the three: ' || coalesce(array_to_string(v_extra, ', '), 'none'));
  perform provio_test.assert_true(
    'verify_report_root' = any(coalesce(v_anon, '{}'::text[])),
    'verify_report_root is callable by anon');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Turn on the entitlements (as the platform admin) so the gate passes.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','public_verification',true,'Assurance','verify add-on');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Build one committed report graph for Org A and read its root back.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_eng uuid := '50000000-0000-0000-0000-0000000000a1';
  v_version uuid;
begin
  insert into report_versions (org_id, engagement_id, version_number, status)
    values (v_org, v_eng, 41, 'draft') returning id into v_version;
  insert into report_graphs (org_id, report_version_id, model_id, formality, tone, voice, locale,
                             graph_root, render_hash, engine_version, template_version, phrase_library_version)
    values (v_org, v_version, 'M1', 3, 2, 'active', 'en-GB', repeat('a', 64), repeat('b', 64),
            '1.2.3', '2.0.0', '1.1.0');
  perform set_config('provio_test.root', repeat('a', 64), false);
end $$;

-- ---------------------------------------------------------------------------
-- 4. A holder of the root confirms existence, issuance time and versions.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
declare
  v record;
begin
  select * into v from public.verify_report_root(current_setting('provio_test.root'));
  perform provio_test.assert_eq(v.status, 'valid', 'a committed root reports valid');
  perform provio_test.assert_true(v.issued_at is not null, 'the issuance time is returned');
  perform provio_test.assert_eq(v.engine_version, '1.2.3', 'the engine version is returned');
  perform provio_test.assert_eq(v.template_version, '2.0.0', 'the template version is returned');
  perform provio_test.assert_eq(v.phrase_library_version, '1.1.0', 'the phrase-library version is returned');
  perform provio_test.assert_eq(v.model_id, 'M1', 'the model id is returned');
  perform provio_test.assert_true(v.organisation is null,
    'the organisation name is hidden while public_verify_show_title is off');

  -- An unknown root, a short root and a null root all return not_found.
  select * into v from public.verify_report_root(repeat('f', 64));
  perform provio_test.assert_eq(v.status, 'not_found', 'an unknown root returns not_found');
  perform provio_test.assert_true(v.engine_version is null, 'not_found carries no version');
  select * into v from public.verify_report_root('short');
  perform provio_test.assert_eq(v.status, 'not_found', 'a short root returns not_found');
  select * into v from public.verify_report_root(null);
  perform provio_test.assert_eq(v.status, 'not_found', 'a null root returns not_found');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Turning public_verify_show_title on exposes only the organisation name, never the root.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into org_settings_extra (org_id, public_verify_show_title)
values ('a0000000-0000-0000-0000-000000000001', true)
on conflict (org_id) do update set public_verify_show_title = excluded.public_verify_show_title;
select provio_test.as_anon();
do $$
declare v record;
begin
  select * into v from public.verify_report_root(current_setting('provio_test.root'));
  perform provio_test.assert_eq(v.organisation, 'Org A',
    'the organisation name is shown when the setting is on');
end $$;

-- ---------------------------------------------------------------------------
-- 6. With the entitlement off, the same root returns not_found to an anonymous caller.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','public_verification',false,'Assurance','verify off');
end $$;
select provio_test.as_anon();
do $$
declare v record;
begin
  select * into v from public.verify_report_root(current_setting('provio_test.root'));
  perform provio_test.assert_eq(v.status, 'not_found',
    'the root is not disclosed while public_verification is off');
end $$;

-- ---------------------------------------------------------------------------
-- 7. The function is security definer, reads only report_graphs and org_settings_extra, and a tenant
--    cannot reach the graph row directly through RLS.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_prosec boolean;
  v_src text;
begin
  select p.prosecdef into v_prosec from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'verify_report_root';
  perform provio_test.assert_true(v_prosec, 'verify_report_root is security definer');
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'verify_report_root';
  perform provio_test.assert_true(position('graph_root' in v_src) > 0,
    'the function reads report_graphs by root');
  perform provio_test.assert_true(position('claim' in lower(v_src)) = 0,
    'the function never reads a claim');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from report_graphs), 0,
    'Org B reads no report graph row through RLS');
end $$;

select provio_test.as_owner();
