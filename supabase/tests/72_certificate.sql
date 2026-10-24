-- Test 72 (S8.a): engagement certificate and public verification (F11).
--
-- Covers: the certificate field list is configurable and seeded; issuing requires manage_engagements,
-- the `certificates` entitlement and a sealed engagement; the cert_hash is computed in the database;
-- a ledger entry (certificate_issued) is written; revoking needs can_reopen and a reason and writes
-- certificate_revoked; reopening an engagement supersedes its certificate; the anonymous surface is
-- exactly two functions that return only status / issued_at / hash / counts; the organisation name and
-- title appear only when public_verify_show_title is on; cross-org isolation and RLS.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The field list is seeded per organisation, in the F11 order.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  org_a uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform public.certificate_config_seed(org_a);
  perform provio_test.assert_eq(
    (select count(*) from certificate_config where org_id = org_a), 10,
    'ten certificate fields are seeded for the organisation');
  perform provio_test.assert_eq(
    (select field_key from certificate_config where org_id = org_a and ordinal = 1),
    'engagement_id', 'the first field is the engagement identifier');
  perform public.certificate_config_seed(org_a);
  perform provio_test.assert_eq(
    (select count(*) from certificate_config where org_id = org_a), 10,
    'seeding again adds nothing (M2)');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Turn on the entitlements and set app_base_url (as the platform admin).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','certificates',true,'Assurance','cert add-on');
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','public_verification',true,'Assurance','verify add-on');
end $$;

select provio_test.as_owner();
insert into org_settings_extra (org_id, app_base_url)
values ('a0000000-0000-0000-0000-000000000001', 'https://provio-test.invalid')
on conflict (org_id) do update set app_base_url = excluded.app_base_url;

-- ---------------------------------------------------------------------------
-- 3. Issuing refuses when the engagement is not sealed.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.certificate_issue('50000000-0000-0000-0000-0000000000a1')$q$,
    'not sealed', 'issuing is refused while the engagement is open');
end $$;

-- An Org Admin without manage_engagements cannot issue even a sealed certificate.
select provio_test.as_owner();
update engagements set sealed = true where id = '50000000-0000-0000-0000-0000000000a1';

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.certificate_issue('50000000-0000-0000-0000-0000000000a1')$q$,
    'not allowed', 'an Org Admin without manage_engagements is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 4. The CIA issues. The hash is the canonical document's hash, and a ledger entry is written.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
create temp table if not exists cert_row as
  select public.certificate_issue('50000000-0000-0000-0000-0000000000a1') as id;

select provio_test.as_owner();
do $$
declare
  v_id uuid;
  v_row record;
  v_ledger record;
begin
  select id into v_id from cert_row;
  perform provio_test.assert_true(v_id is not null, 'the certificate is issued');
  select * into v_row from engagement_certificates where id = v_id;
  perform provio_test.assert_eq(v_row.status, 'valid', 'the certificate is valid');
  perform provio_test.assert_eq(length(v_row.cert_hash), 64, 'the cert_hash is a SHA-256 hex digest');
  perform provio_test.assert_eq(v_row.cert_hash,
    public.ledger_payload_hash(public.canonical_payload(v_row.canonical)),
    'the cert_hash is the hash of the canonical document, computed in the database');
  perform provio_test.assert_eq((v_row.canonical ->> 'version')::int, 1, 'the first certificate is version 1');
  perform provio_test.assert_true((v_row.canonical ->> 'engagement_root_hash') is not null,
    'the document carries the engagement root hash');
  select * into v_ledger from ledger_entries where id = v_row.ledger_entry_id;
  perform provio_test.assert_eq(v_ledger.action, 'certificate_issued', 'a ledger entry is written');
  perform provio_test.assert_eq(v_ledger.payload ->> 'cert_hash', v_row.cert_hash,
    'the ledger entry carries the cert hash');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Revoke: needs can_reopen and a reason; writes certificate_revoked.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    format($q$select public.certificate_revoke('%s', 'a good reason')$q$, (select id from cert_row)),
    'not allowed', 'an Org Admin without can_reopen is refused');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    format($q$select public.certificate_revoke('%s', '')$q$, (select id from cert_row)),
    'reason is required', 'a revoke without a reason is refused');
  perform public.certificate_revoke((select id from cert_row), 'engagement reopened for corrections');
end $$;

select provio_test.as_owner();
do $$
declare v_ledger record;
begin
  perform provio_test.assert_eq(
    (select status from engagement_certificates where id = (select id from cert_row)),
    'revoked', 'the certificate is revoked');
  select * into v_ledger from ledger_entries
   where action = 'certificate_revoked' order by seq desc limit 1;
  perform provio_test.assert_eq(v_ledger.payload ->> 'certificate_id', (select id::text from cert_row),
    'the revoke writes a ledger entry naming the certificate');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Reopening a sealed engagement supersedes its valid certificate.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
update engagements set sealed = true where id = '50000000-0000-0000-0000-0000000000a2';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.certificate_issue('50000000-0000-0000-0000-0000000000a2');
do $$
begin
  perform public.reopen_engagement('50000000-0000-0000-0000-0000000000a2', 'corrections needed after review');
end $$;

-- Seal again and re-issue; the version increments and only the new certificate is valid.
select provio_test.as_owner();
update engagements set sealed = true where id = '50000000-0000-0000-0000-0000000000a2';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.certificate_issue('50000000-0000-0000-0000-0000000000a2');
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from engagement_certificates
      where engagement_id = '50000000-0000-0000-0000-0000000000a2' and status = 'superseded'), 1,
    'reopening supersedes the valid certificate for the engagement');
  perform provio_test.assert_eq(
    (select count(*) from engagement_certificates
      where engagement_id = '50000000-0000-0000-0000-0000000000a2' and status = 'valid'), 1,
    're-issuing after a reopen leaves exactly one valid certificate');
  perform provio_test.assert_eq(
    (select max(version) from engagement_certificates
      where engagement_id = '50000000-0000-0000-0000-0000000000a2'), 2,
    'the second certificate is version 2');
end $$;

-- ---------------------------------------------------------------------------
-- 7. The anonymous surface. Exactly two functions, and they return only the permitted fields.
--
--    Extension members (dblink and the like) are excluded. The hosted platform grants EXECUTE to anon
--    on them through its own default privileges, and the migration role does not own them, so no
--    migration can revoke that grant. They are not part of Provio's surface: nothing in this
--    repository grants anon on them. Their presence is reported below so it stays visible
--    (D-M1-extension-anon-grant).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_anon text[];
  v_ext text[];
begin
  select array_agg(distinct p.proname) into v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join aclexplode(p.proacl) a on true
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and r.rolname = 'anon' and a.privilege_type = 'EXECUTE'
     and d.objid is null;
  perform provio_test.assert_eq(
    (select count(*) from unnest(coalesce(v_anon, '{}'::text[])) s
      where s not in ('verify_certificate','verify_board_pack')), 0,
    'no function other than the two verification functions is granted to anon: ' ||
      coalesce((select string_agg(s, ', ' order by s) from unnest(coalesce(v_anon, '{}'::text[])) s
                 where s not in ('verify_certificate','verify_board_pack')), 'none'));

  select array_agg(distinct p.proname) into v_ext
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join aclexplode(p.proacl) a on true
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and r.rolname = 'anon' and a.privilege_type = 'EXECUTE';
  if coalesce(array_length(v_ext, 1), 0) > 0 then
    raise notice 'note: % platform extension function(s) in public still granted to anon: %',
      array_length(v_ext, 1), array_to_string(v_ext, ', ');
  end if;
end $$;

-- The anon role can execute exactly the two functions and selects nothing: for every tenant table it
-- either holds no privilege (a permission error) or holds the 0008 blanket SELECT but the
-- authenticated-only RLS policy yields zero rows. Either way anon sees nothing.
select provio_test.as_anon();
do $$
declare
  t text;
  n bigint;
  v_visible text[] := '{}';
begin
  foreach t in array provio_test.org_tables() loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then
        v_visible := v_visible || t;
      end if;
    exception when insufficient_privilege then
      null;  -- no privilege at all: also nothing visible
    end;
  end loop;
  perform provio_test.assert_eq(coalesce(array_length(v_visible, 1), 0), 0,
    'anon selects no row from any tenant table (permission denied or RLS yields zero)');
  perform provio_test.assert_raises(
    $q$insert into engagement_certificates (org_id, engagement_id) values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1')$q$,
    null, 'anon cannot write a certificate');
end $$;

-- verify_certificate returns only the allowed columns and the not_found status for an unknown id.
-- The id is handed to the anon block through a session setting, because a temp table is owned by the
-- test role and anon cannot read it.
select provio_test.as_owner();
select set_config('provio_test.cert_id',
  (select id::text from engagement_certificates
    where engagement_id = '50000000-0000-0000-0000-0000000000a2' and status = 'valid'), false);

select provio_test.as_anon();
do $$
declare
  v record;
  v_id uuid := current_setting('provio_test.cert_id')::uuid;
begin
  select * into v from public.verify_certificate('00000000-0000-0000-0000-0000000000ff');
  perform provio_test.assert_eq(v.status, 'not_found', 'an unknown id returns not_found');
  perform provio_test.assert_true(v.organisation is null, 'not_found carries no organisation name');

  select * into v from public.verify_certificate(v_id);
  perform provio_test.assert_eq(v.status, 'valid', 'a valid certificate reports valid');
  perform provio_test.assert_true(v.cert_hash is not null, 'the hash is returned');
  perform provio_test.assert_true(v.organisation is null,
    'the organisation name is hidden while public_verify_show_title is off');
  perform provio_test.assert_true(v.engagement_title is null,
    'the engagement title is hidden while public_verify_show_title is off');
  perform provio_test.assert_true(v.sealed_workpapers >= 0, 'the sealed workpaper count is returned');
end $$;

-- Turning public_verify_show_title on exposes the organisation name and the title.
select provio_test.as_owner();
update org_settings_extra set public_verify_show_title = true
 where org_id = 'a0000000-0000-0000-0000-000000000001';
select provio_test.as_anon();
do $$
declare v record;
begin
  select * into v from public.verify_certificate(current_setting('provio_test.cert_id')::uuid);
  perform provio_test.assert_eq(v.organisation, 'Org A',
    'the organisation name is shown when the setting is on');
  perform provio_test.assert_eq(v.engagement_title, 'A-Eng2',
    'the engagement title is shown when the setting is on');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Cross-org: Org B cannot read Org A's certificates, and RLS blocks a direct read.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select count(*) from public.certificate_list('a0000000-0000-0000-0000-000000000001')$q$,
    'not allowed', 'Org B cannot list Org A certificates');
  perform provio_test.assert_eq(
    (select count(*) from public.certificate_list('b0000000-0000-0000-0000-000000000001')), 0,
    'Org B lists no certificate of its own');
  perform provio_test.assert_eq(
    (select count(*) from engagement_certificates), 0,
    'Org B reads no Org A certificate row through RLS');
  perform provio_test.assert_raises(
    $q$insert into engagement_certificates (org_id, engagement_id) values ('b0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000b1')$q$,
    'engagement_certificates', 'a tenant cannot insert a certificate directly');
end $$;
