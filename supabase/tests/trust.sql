\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004'),('00000000-0000-0000-0000-000000000005'),('00000000-0000-0000-0000-000000000006');
insert into public.organizations values ('10000000-0000-0000-0000-000000000001','Synthetic A'),('10000000-0000-0000-0000-000000000002','Synthetic B');
insert into public.audit_entities values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Procurement'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Other tenant'),('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Unassigned');
insert into public.memberships values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','preparer'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','reviewer'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','cia'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','cia'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','observer'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','org_admin');
insert into public.entity_access select org_id,case when org_id='10000000-0000-0000-0000-000000000001'::uuid then '20000000-0000-0000-0000-000000000001'::uuid else '20000000-0000-0000-0000-000000000002'::uuid end,user_id from public.memberships;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERTION: %',message;end if;end$$;
create function pg_temp.denied(command text, expected text) returns void language plpgsql as $$
begin
 execute command;
 raise exception 'EXPECTED DENIAL: %',expected;
exception when others then
 if position(expected in sqlerrm)=0 or position('EXPECTED DENIAL' in sqlerrm)>0 then raise;end if;
end$$;
create function pg_temp.cmd(action text,data jsonb default '{}',expected int default null) returns public.audit_cases language sql as $$
 select public.audit_command('30000000-0000-0000-0000-000000000001',coalesce(expected,(select version from public.audit_cases where id='30000000-0000-0000-0000-000000000001')),gen_random_uuid(),action,data)
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert((select count(*)=1 from public.audit_entities),'entity scope');
select pg_temp.denied($q$insert into public.audit_cases values(gen_random_uuid(),'10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',0,'{}')$q$,'permission denied');
select pg_temp.denied($q$select public.audit_command(gen_random_uuid(),0,gen_random_uuid(),'create','{"orgId":"10000000-0000-0000-0000-000000000002","entityId":"20000000-0000-0000-0000-000000000002","title":"Forbidden"}')$q$,'PERMISSION_DENIED');
select pg_temp.denied($q$select public.audit_command(gen_random_uuid(),0,gen_random_uuid(),'create','{"orgId":"10000000-0000-0000-0000-000000000001","entityId":"20000000-0000-0000-0000-000000000003","title":"Forbidden"}')$q$,'PERMISSION_DENIED');
select pg_temp.assert((public.audit_command('30000000-0000-0000-0000-000000000001',0,'40000000-0000-0000-0000-000000000001','create','{"orgId":"10000000-0000-0000-0000-000000000001","entityId":"20000000-0000-0000-0000-000000000001","title":"Payments pilot"}')).version=1,'create');
select pg_temp.assert((public.audit_command('30000000-0000-0000-0000-000000000001',0,'40000000-0000-0000-0000-000000000001','create','{"orgId":"10000000-0000-0000-0000-000000000001","entityId":"20000000-0000-0000-0000-000000000001","title":"Payments pilot"}')).version=1,'idempotent retry');
select pg_temp.denied($q$select public.audit_command('30000000-0000-0000-0000-000000000001',0,'40000000-0000-0000-0000-000000000001','create','{"title":"Different"}')$q$,'IDEMPOTENCY_CONFLICT');
select pg_temp.denied($q$select pg_temp.cmd('submit')$q$,'POPULATION_REQUIRED');
select pg_temp.denied($q$select pg_temp.cmd('submit','{}',0)$q$,'VERSION_CONFLICT');
select pg_temp.denied($q$select pg_temp.cmd('test_row','{"rowId":"made-up","outcome":"pass"}')$q$,'POPULATION_REQUIRED');
-- Reconciliation failure must commit neither state nor event.
select pg_temp.denied($q$select pg_temp.cmd('import_population',jsonb_build_object('currency','USD','sourceSha256',repeat('a',64),'controlTotalMinor',1,'rows','[{"id":"p1","invoice":"INV","vendor":"V","date":"2026-10-01","amountMinor":980000,"createdBy":"u","approvedBy":"u","taxId":""},{"id":"p2","invoice":"INV","vendor":"V","date":"2026-10-01","amountMinor":980000,"createdBy":"u","approvedBy":"v","taxId":"T"}]'::jsonb))$q$,'RECONCILIATION_FAILED');
select pg_temp.assert((select count(*)=1 from public.audit_events),'failure rolls back ledger');
select pg_temp.denied($q$select pg_temp.cmd('import_population',jsonb_build_object('currency','USD','sourceSha256',repeat('a',64),'controlTotalMinor',1,'rows','[]'::jsonb))$q$,'POPULATION_SIZE_1_TO_1000');
select pg_temp.denied($q$select pg_temp.cmd('import_population',jsonb_build_object('currency','USD','sourceSha256',repeat('a',64),'controlTotalMinor',1,'rows','[{"id":"p1","invoice":"i","vendor":"v","date":"2026-02-30","amountMinor":1,"createdBy":"a","approvedBy":"b","taxId":"t"}]'::jsonb))$q$,'date/time field value out of range');
select pg_temp.denied($q$select pg_temp.cmd('import_population',jsonb_build_object('currency','USD','sourceSha256',repeat('a',64),'controlTotalMinor',2,'rows','[{"id":"p1","invoice":"i","vendor":"v","date":"2026-01-01","amountMinor":1,"createdBy":"a","approvedBy":"b","taxId":"t"},{"id":"p1","invoice":"i","vendor":"v","date":"2026-01-01","amountMinor":1,"createdBy":"a","approvedBy":"b","taxId":"t"}]'::jsonb))$q$,'INVALID_POPULATION_ROW');
select pg_temp.denied($q$select pg_temp.cmd('attach_evidence','{"name":"empty.txt","mediaType":"text/plain","base64":""}')$q$,'EVIDENCE_SIZE');
select pg_temp.denied($q$select pg_temp.cmd('attach_evidence','{"name":"huge.txt","mediaType":"text/plain"}'::jsonb || jsonb_build_object('base64',encode(decode(repeat('61',10485761),'hex'),'base64')))$q$,'EVIDENCE_SIZE');

select pg_temp.assert((pg_temp.cmd('import_population',jsonb_build_object('currency','USD','sourceSha256',repeat('a',64),'controlTotalMinor',1960000,'rows','[{"id":"p1","invoice":"INV","vendor":"V","date":"2026-10-01","amountMinor":980000,"createdBy":"u","approvedBy":"u","taxId":""},{"id":"p2","invoice":"INV","vendor":"V","date":"2026-10-01","amountMinor":980000,"createdBy":"u","approvedBy":"v","taxId":"T"}]'::jsonb))).state->'population'->>'count'='2','verified rows');
select pg_temp.assert((select state->'flags'='[{"rowId":"p1","rules":["duplicate_invoice","segregation_of_duties","missing_vendor_tax_id","split_payment_candidate"]},{"rowId":"p2","rules":["duplicate_invoice","split_payment_candidate"]}]'::jsonb from public.audit_cases),'exact anomaly identities');
select pg_temp.denied($q$select pg_temp.cmd('submit')$q$,'UNTESTED_ROWS');
select pg_temp.denied($q$select pg_temp.cmd('test_row','{"rowId":"p1","outcome":"pass","note":"Review evidence"}')$q$,'RESULT_REQUIRES_NOTE_AND_EVIDENCE');
select pg_temp.assert((pg_temp.cmd('attach_evidence','{"name":"test.txt","mediaType":"text/plain","base64":"aGVsbG8="}')).state->'evidence'->0->>'sha256'='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824','server binary hash');
select state->'evidence'->0->>'id' as evidence from public.audit_cases \gset
select pg_temp.assert((pg_temp.cmd('test_row',jsonb_build_object('rowId','p1','outcome','exception','note','Duplicate independently confirmed','evidenceId',:'evidence'))).version=4,'first result');
select pg_temp.assert((pg_temp.cmd('test_row',jsonb_build_object('rowId','p2','outcome','pass','note','Credit reversal explains flagged duplicate','evidenceId',:'evidence'))).version=5,'second result');
select pg_temp.denied($q$select pg_temp.cmd('submit')$q$,'EXCEPTION_WITHOUT_FINDING');
select pg_temp.assert((pg_temp.cmd('finding','{"rowId":"p1","severity":"high","condition":"Duplicate paid twice","criteria":"Pay each invoice once","cause":"Control failed at entry","impact":"Excess payment of 9800","recommendation":"Block duplicate invoices"}')).version=6,'finding');
select pg_temp.assert(jsonb_array_length(public.issued_audits())=0,'draft does not issue');
select pg_temp.assert((pg_temp.cmd('submit')).state->>'status'='submitted','submit');
select pg_temp.denied($q$select pg_temp.cmd('seal','{"conclusion":"Control needs improvement"}')$q$,'INDEPENDENT_REVIEW_REQUIRED');
select pg_temp.denied($q$select pg_temp.cmd('import_population','{}')$q$,'READ_ONLY');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.denied($q$select pg_temp.cmd('test_row','{}')$q$,'READ_ONLY');
select pg_temp.assert((pg_temp.cmd('seal','{"conclusion":"Control ineffective due to confirmed duplicate"}')).state->>'status'='sealed','independent seal');
select pg_temp.denied($q$select pg_temp.cmd('issue')$q$,'CIA_SEALED_REPORT_REQUIRED');
select pg_temp.denied($q$select pg_temp.cmd('attach_evidence','{"name":"late.txt","mediaType":"text/plain","base64":"aGVsbG8="}')$q$,'READ_ONLY');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert((pg_temp.cmd('issue')).state->>'status'='issued','CIA issuance');
select pg_temp.assert(jsonb_array_length(public.issued_audits())=1,'issued projection');
select state->'issues'->0->>'id' as issue from public.audit_cases \gset
select pg_temp.denied(format('select pg_temp.cmd(''close_issue'',%L)',jsonb_build_object('issueId',:'issue')::text),'VALIDATED_RETEST_REQUIRED');
select pg_temp.assert((pg_temp.cmd('remediate',jsonb_build_object('issueId',:'issue','note','Duplicate prevention configured','evidenceId',:'evidence'))).state->'issues'->0->>'status'='pending_validation','remediation');
select pg_temp.denied(format('select pg_temp.cmd(''retest'',%L)',jsonb_build_object('issueId',:'issue','outcome','pass','note','Tested control independently','evidenceId',:'evidence')::text),'INDEPENDENT_RETEST_REQUIRED');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert((pg_temp.cmd('retest',jsonb_build_object('issueId',:'issue','outcome','fail','note','Duplicate still accepted in retest','evidenceId',:'evidence'))).state->'issues'->0->>'status'='retest_failed','failed retest persists');
select pg_temp.denied(format('select pg_temp.cmd(''close_issue'',%L)',jsonb_build_object('issueId',:'issue')::text),'VALIDATED_RETEST_REQUIRED');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert((pg_temp.cmd('remediate',jsonb_build_object('issueId',:'issue','note','Duplicate prevention corrected','evidenceId',:'evidence'))).state->'issues'->0->>'status'='pending_validation','resubmit');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert((pg_temp.cmd('retest',jsonb_build_object('issueId',:'issue','outcome','pass','note','Independent retest blocks duplicate','evidenceId',:'evidence'))).state->'issues'->0->>'status'='validated','passed retest');
select pg_temp.assert((pg_temp.cmd('close_issue',jsonb_build_object('issueId',:'issue'))).state->'issues'->0->>'status'='closed','close');
select pg_temp.assert((select jsonb_array_length(state->'issues'->0->'retests')=2 from public.audit_cases),'retest history retained');
select pg_temp.assert((select count(*)=max(seq) and max(seq)=(select version from public.audit_cases) from public.audit_events),'atomic contiguous history');
select pg_temp.assert((select (committed_text::jsonb->'state'->'report')=(select state->'report' from public.audit_cases) from public.audit_events where seq=9),'issued report unchanged by remediation');
select pg_temp.denied($q$update public.audit_events set hash='tamper'$q$,'permission denied');
select pg_temp.denied($q$delete from public.audit_evidence$q$,'permission denied');
-- Foreign tenant, observer and org admin cannot read raw audit data or download bytes.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.assert((select count(*)=0 from public.audit_cases),'tenant read isolation');
select pg_temp.assert((select count(*)=0 from public.audit_events),'tenant ledger isolation');
select pg_temp.assert(public.issued_audits()='[]'::jsonb,'tenant projection isolation');
select pg_temp.denied(format('select public.read_audit_evidence(%L)',:'evidence'),'PERMISSION_DENIED');
select pg_temp.denied($q$select public.audit_command('30000000-0000-0000-0000-000000000001',15,gen_random_uuid(),'issue','{}')$q$,'PERMISSION_DENIED');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
select pg_temp.assert((select count(*)=0 from public.audit_cases),'observer raw isolation');
select pg_temp.assert(jsonb_array_length(public.issued_audits())=1,'observer issued access');
select pg_temp.denied(format('select public.read_audit_evidence(%L)',:'evidence'),'PERMISSION_DENIED');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
select pg_temp.assert((select count(*)=0 from public.audit_entities),'admin data blind');
select pg_temp.assert(public.issued_audits()='[]'::jsonb,'admin projection isolation');
reset role;
select pg_temp.denied($q$update public.audit_events set hash='tamper'$q$,'IMMUTABLE_RECORD');
select pg_temp.denied($q$truncate public.audit_evidence$q$,'IMMUTABLE_RECORD');
select pg_temp.assert((select bool_and(hash=encode(extensions.digest(convert_to(committed_text,'UTF8'),'sha256'),'hex')) from public.audit_events),'all committed hashes');
rollback;
