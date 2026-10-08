-- Bounded procurement pilot. Auth is Supabase Auth; provisioning is operator-only.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null);
create table public.memberships (
  org_id uuid references public.organizations not null, user_id uuid references auth.users not null,
  role text not null check(role in ('preparer','reviewer','audit_manager','cia','observer','org_admin')),
  primary key(org_id,user_id)
);
create table public.audit_entities (
  id uuid default gen_random_uuid(), org_id uuid references public.organizations not null, name text not null,
  primary key(org_id,id)
);
create table public.entity_access (
  org_id uuid not null, entity_id uuid not null, user_id uuid not null,
  primary key(org_id,entity_id,user_id),
  foreign key(org_id,entity_id) references public.audit_entities(org_id,id),
  foreign key(org_id,user_id) references public.memberships(org_id,user_id)
);
create function public.audit_role(o uuid, e uuid) returns text language sql stable security definer
set search_path = '' as $$
 select m.role from public.memberships m join public.entity_access a using(org_id,user_id)
 where m.org_id=o and a.entity_id=e and m.user_id=auth.uid() and m.role <> 'org_admin'
$$;
create table public.audit_cases (
  id uuid primary key, org_id uuid not null, entity_id uuid not null,
  version integer not null default 0, state jsonb not null,
  foreign key(org_id,entity_id) references public.audit_entities(org_id,id), unique(org_id,id)
);
-- A per-case chain prevents a scoped auditor from receiving unrelated entities' history.
-- Every event contains the exact serialized committed bytes and a complete snapshot.
create table public.audit_events (
  case_id uuid references public.audit_cases not null, seq integer not null,
  actor_id uuid not null, request_id uuid not null, request_hash text not null,
  committed_text text not null, prev_hash text not null, hash text not null,
  primary key(case_id,seq), unique(case_id,request_id)
);
create table public.audit_evidence (
  org_id uuid not null, case_id uuid not null, id uuid primary key default gen_random_uuid(),
  name text not null, media_type text not null, bytes bytea not null,
  sha256 text not null, uploaded_by uuid not null, created_at timestamptz not null default now(),
  foreign key(org_id,case_id) references public.audit_cases(org_id,id),
  check(octet_length(bytes) between 1 and 10485760)
);
create function public.immutable_audit_record() returns trigger language plpgsql set search_path='' as $$
 begin raise exception 'IMMUTABLE_RECORD'; end $$;
create trigger immutable_events before update or delete or truncate on public.audit_events
 for each statement execute function public.immutable_audit_record();
create trigger immutable_evidence before update or delete or truncate on public.audit_evidence
 for each statement execute function public.immutable_audit_record();

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_entities enable row level security;
alter table public.entity_access enable row level security;
alter table public.audit_cases enable row level security;
alter table public.audit_events enable row level security;
alter table public.audit_evidence enable row level security;
create policy membership_self on public.memberships for select to authenticated using(user_id=auth.uid());
create policy access_self on public.entity_access for select to authenticated using(user_id=auth.uid());
create policy org_member on public.organizations for select to authenticated using(exists(select 1 from public.memberships where org_id=id and user_id=auth.uid()));
create policy entity_scope on public.audit_entities for select to authenticated using(public.audit_role(org_id,id) is not null);
-- Observers receive only a dedicated issued-report projection, never draft/population state.
create policy case_scope on public.audit_cases for select to authenticated using(public.audit_role(org_id,entity_id) in ('preparer','reviewer','audit_manager','cia'));
create policy event_scope on public.audit_events for select to authenticated using(exists(select 1 from public.audit_cases c where c.id=case_id));
create policy evidence_scope on public.audit_evidence for select to authenticated using(exists(select 1 from public.audit_cases c where c.id=case_id));
revoke all on public.organizations,public.memberships,public.audit_entities,public.entity_access,public.audit_cases,public.audit_events,public.audit_evidence from anon, authenticated;
grant select on public.organizations,public.memberships,public.audit_entities,public.entity_access,public.audit_cases,public.audit_events to authenticated;
-- Binary evidence is read through a scoped function to avoid bulk list downloads.

create function public.audit_command(p_case uuid, p_expected integer, p_key uuid, p_action text, p_data jsonb)
returns public.audit_cases language plpgsql security definer set search_path='' as $$
declare
 c public.audit_cases; s jsonb; r text; actor uuid := auth.uid(); old public.audit_events;
 req_hash text; prev text; committed text; item jsonb; rows jsonb; results jsonb;
 amount numeric; total numeric := 0; ids text[] := '{}'; flags jsonb; n integer;
 issue jsonb; ev uuid; file_bytes bytea; file_hash text;
begin
 if actor is null then raise exception 'UNAUTHENTICATED'; end if;
 if p_key is null or p_expected is null or p_expected<0 or p_data is null or jsonb_typeof(p_data)<>'object'
 or octet_length(p_data::text)>15000000 then raise exception 'INVALID_COMMAND'; end if;
 -- Locks non-existent IDs too: concurrent creation and retries serialize.
 perform pg_advisory_xact_lock(hashtextextended(p_case::text,0));
 select * into c from public.audit_cases where id=p_case for update;
 if c.id is null then
   if p_action<>'create' or p_expected<>0 then raise exception 'NOT_FOUND'; end if;
   c.id:=p_case; c.org_id:=(p_data->>'orgId')::uuid; c.entity_id:=(p_data->>'entityId')::uuid; c.version:=0;
   c.state:=jsonb_build_object('title',p_data->>'title','stage','planning','status','draft','preparer',actor,
     'rows','[]'::jsonb,'results','{}'::jsonb,'findings','[]'::jsonb,'issues','[]'::jsonb,'evidence','[]'::jsonb);
 end if;
 r:=public.audit_role(c.org_id,c.entity_id);
 if r is null or r not in ('preparer','reviewer','audit_manager','cia') then raise exception 'PERMISSION_DENIED'; end if;
 req_hash:=encode(extensions.digest(convert_to(jsonb_build_object('action',p_action,'expected',p_expected,'data',p_data)::text,'UTF8'),'sha256'),'hex');
 select * into old from public.audit_events where case_id=p_case and request_id=p_key;
 if found then
   if old.actor_id<>actor or old.request_hash<>req_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   -- Return current authoritative state; the original event remains available by request_id.
   return c;
 end if;
 if c.version<>p_expected then raise exception 'VERSION_CONFLICT'; end if;
 s:=c.state;
 if p_action in ('create','import_population','test_row','finding','submit') and
   (r not in ('preparer','audit_manager','cia') or s->>'status'<>'draft') then raise exception 'READ_ONLY'; end if;
 if p_action in ('import_population','test_row','finding','submit') and s->>'preparer'<>actor::text then
   raise exception 'PREPARER_REQUIRED'; end if;
 if p_action='create' then
   if c.version<>0 or length(trim(coalesce(p_data->>'title',''))) not between 3 and 200 then raise exception 'INVALID_TITLE'; end if;
   insert into public.audit_cases values(c.id,c.org_id,c.entity_id,0,s);
 elsif p_action='import_population' then
   rows:=p_data->'rows';
   if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 1 and 1000 then raise exception 'POPULATION_SIZE_1_TO_1000'; end if;
   if coalesce(p_data->>'currency','') !~ '^[A-Z]{3}$' or coalesce(p_data->>'sourceSha256','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_data->>'controlTotalMinor','') !~ '^[0-9]{1,15}$' then raise exception 'INVALID_MANIFEST'; end if;
   for item in select value from jsonb_array_elements(rows) loop
     if jsonb_typeof(item)<>'object' or not (item ?& array['id','invoice','vendor','date','amountMinor','createdBy','approvedBy','taxId'])
       or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','invoice','vendor','date','amountMinor','createdBy','approvedBy','taxId'))
       or exists(select 1 from jsonb_each(item) x where x.key<>'amountMinor' and jsonb_typeof(x.value)<>'string')
       or exists(select 1 from jsonb_each_text(item) x where length(x.value)>200)
       or coalesce(item->>'amountMinor','') !~ '^[0-9]{1,12}$' or jsonb_typeof(item->'amountMinor')<>'number'
       or length(trim(item->>'id'))=0 or length(trim(item->>'invoice'))=0 or length(trim(item->>'vendor'))=0
       or length(trim(item->>'createdBy'))=0 or length(trim(item->>'approvedBy'))=0
       or item->>'id'=any(ids) or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
       then raise exception 'INVALID_POPULATION_ROW'; end if;
     perform (item->>'date')::date; -- rejects impossible dates
     amount:=(item->>'amountMinor')::numeric;
     if amount<=0 then raise exception 'POSITIVE_PAYMENTS_ONLY'; end if;
     total:=total+amount; ids:=array_append(ids,item->>'id');
   end loop;
   if total<>(p_data->>'controlTotalMinor')::numeric then raise exception 'RECONCILIATION_FAILED'; end if;
   -- Rule version is fixed. Flags are computed here, not accepted from the client.
   select coalesce(jsonb_agg(jsonb_build_object('rowId',a->>'id','rules',
     (case when (select count(*) from jsonb_array_elements(rows) b where b->>'vendor'=a->>'vendor' and b->>'invoice'=a->>'invoice' and b->>'amountMinor'=a->>'amountMinor')>1 then '["duplicate_invoice"]'::jsonb else '[]'::jsonb end) ||
     (case when a->>'createdBy'=a->>'approvedBy' then '["segregation_of_duties"]'::jsonb else '[]'::jsonb end) ||
     (case when trim(a->>'taxId')='' then '["missing_vendor_tax_id"]'::jsonb else '[]'::jsonb end) ||
     (case when (a->>'amountMinor')::numeric<1000000 and (select sum((b->>'amountMinor')::numeric) from jsonb_array_elements(rows) b where b->>'vendor'=a->>'vendor' and b->>'date'=a->>'date' and (b->>'amountMinor')::numeric<1000000)>=1000000 then '["split_payment_candidate"]'::jsonb else '[]'::jsonb end)
   ) order by a->>'id'),'[]'::jsonb) into flags from jsonb_array_elements(rows) a;
   s:=s || jsonb_build_object('rows',rows,'results','{}'::jsonb,'findings','[]'::jsonb,'flags',flags,'stage','testing',
      'population',jsonb_build_object('sourceSha256',p_data->>'sourceSha256','rowsSha256',encode(extensions.digest(convert_to(rows::text,'UTF8'),'sha256'),'hex'),
      'currency',p_data->>'currency','controlTotalMinor',total,'count',jsonb_array_length(rows),'verifiedBy',actor,'verifiedAt',clock_timestamp(),
      'method','census-v1','floor',jsonb_array_length(rows),'rulesVersion','procurement-v1','approvalLimitMinor',1000000));
 elsif p_action='attach_evidence' then
   if r not in ('preparer','audit_manager','cia') or s->>'status' not in ('draft','issued') then raise exception 'READ_ONLY'; end if;
   if length(trim(coalesce(p_data->>'name',''))) not between 1 and 200 or
      p_data->>'mediaType' not in ('application/pdf','image/png','text/csv','text/plain') then raise exception 'INVALID_EVIDENCE'; end if;
   file_bytes:=decode(p_data->>'base64','base64');
   if file_bytes is null or octet_length(file_bytes) not between 1 and 10485760 then raise exception 'EVIDENCE_SIZE'; end if;
   file_hash:=encode(extensions.digest(file_bytes,'sha256'),'hex');
   insert into public.audit_evidence(org_id,case_id,name,media_type,bytes,sha256,uploaded_by)
     values(c.org_id,c.id,p_data->>'name',p_data->>'mediaType',file_bytes,file_hash,actor) returning id into ev;
   s:=jsonb_set(s,'{evidence}',(s->'evidence') || jsonb_build_array(jsonb_build_object('id',ev,'sha256',file_hash,'name',p_data->>'name','size',octet_length(file_bytes))));
 elsif p_action='test_row' then
   if s->'population' is null or not exists(select 1 from jsonb_array_elements(s->'rows') a where a->>'id'=p_data->>'rowId') then raise exception 'POPULATION_REQUIRED'; end if;
   if coalesce(p_data->>'outcome','') not in ('pass','exception') or length(trim(coalesce(p_data->>'note',''))) not between 10 and 4000
      or not exists(select 1 from public.audit_evidence e where e.case_id=c.id and e.id=(p_data->>'evidenceId')::uuid) then raise exception 'RESULT_REQUIRES_NOTE_AND_EVIDENCE'; end if;
   s:=jsonb_set(s,array['results',p_data->>'rowId'],jsonb_build_object('outcome',p_data->>'outcome','note',p_data->>'note','evidenceId',p_data->>'evidenceId','testedBy',actor));
 elsif p_action='finding' then
   if s->'population' is null or not exists(select 1 from jsonb_array_elements(s->'rows') a where a->>'id'=p_data->>'rowId') then raise exception 'POPULATION_REQUIRED'; end if;
   if exists(select 1 from unnest(array['condition','criteria','cause','impact','recommendation']) k where length(trim(coalesce(p_data->>k,''))) not between 10 and 4000)
     or coalesce(p_data->>'severity','') not in ('low','medium','high','critical') then raise exception 'FIVE_PART_FINDING_REQUIRED'; end if;
   item:=jsonb_build_object('id',gen_random_uuid(),'rowId',p_data->>'rowId','condition',p_data->>'condition','criteria',p_data->>'criteria','cause',p_data->>'cause',
       'impact',p_data->>'impact','recommendation',p_data->>'recommendation','severity',p_data->>'severity');
   s:=jsonb_set(s,'{findings}',s->'findings' || jsonb_build_array(item));
 elsif p_action='submit' then
   if s->'population' is null then raise exception 'POPULATION_REQUIRED'; end if;
   if exists(select 1 from jsonb_array_elements(s->'rows') a where s->'results'->(a->>'id') is null) then raise exception 'UNTESTED_ROWS'; end if;
   if exists(select 1 from jsonb_each(s->'results') t where t.value->>'outcome'='exception' and not exists(select 1 from jsonb_array_elements(s->'findings') f where f->>'rowId'=t.key)) then raise exception 'EXCEPTION_WITHOUT_FINDING'; end if;
   s:=s || jsonb_build_object('status','submitted','submittedBy',actor);
 elsif p_action='return' then
   if r not in ('reviewer','audit_manager','cia') or s->>'status'<>'submitted' or s->>'preparer'=actor::text
      or length(trim(coalesce(p_data->>'note',''))) not between 10 and 4000 then raise exception 'INDEPENDENT_REVIEW_REQUIRED'; end if;
   s:=s || jsonb_build_object('status','draft','returnNote',p_data->>'note');
 elsif p_action='seal' then
   if r not in ('reviewer','audit_manager','cia') or s->>'status'<>'submitted' or s->>'preparer'=actor::text
      or length(trim(coalesce(p_data->>'conclusion',''))) not between 10 and 4000 then raise exception 'INDEPENDENT_REVIEW_REQUIRED'; end if;
   s:=s || jsonb_build_object('status','sealed','stage','conclusion','reviewedBy',actor,'conclusion',p_data->>'conclusion','sealedAt',clock_timestamp());
 elsif p_action='issue' then
   if r<>'cia' or s->>'status'<>'sealed' then raise exception 'CIA_SEALED_REPORT_REQUIRED'; end if;
   -- Freeze a versioned template report. AI has no role in issuance.
   s:=s || jsonb_build_object('status','issued','report',jsonb_build_object('id',gen_random_uuid(),'template','procurement-v1','title',s->>'title',
     'population',s->'population','findings',s->'findings','conclusion',s->>'conclusion','reviewedBy',s->>'reviewedBy','issuedBy',actor,'issuedAt',clock_timestamp(),'sourceVersion',c.version));
   select coalesce(jsonb_agg(f || jsonb_build_object('status','open','retests','[]'::jsonb)),'[]'::jsonb) into rows from jsonb_array_elements(s->'findings') f;
   s:=jsonb_set(s,'{issues}',rows);
 elsif p_action in ('remediate','retest','close_issue') then
   if s->>'status'<>'issued' then raise exception 'ISSUED_REPORT_REQUIRED'; end if;
   select a into issue from jsonb_array_elements(s->'issues') a where a->>'id'=p_data->>'issueId';
   if issue is null or issue->>'status'='closed' then raise exception 'ISSUE_NOT_EDITABLE'; end if;
   if p_action='remediate' then
     if r not in ('preparer','audit_manager','cia') or issue->>'status' not in ('open','retest_failed') or length(trim(coalesce(p_data->>'note',''))) not between 10 and 4000
       or not exists(select 1 from public.audit_evidence e where e.case_id=c.id and e.id=(p_data->>'evidenceId')::uuid) then raise exception 'REMEDIATION_EVIDENCE_REQUIRED'; end if;
     issue:=issue || jsonb_build_object('status','pending_validation','remediation',jsonb_build_object('by',actor,'note',p_data->>'note','evidenceId',p_data->>'evidenceId'));
   elsif p_action='retest' then
     if r not in ('reviewer','audit_manager','cia') or issue->>'status'<>'pending_validation' or issue->'remediation'->>'by'=actor::text
       or coalesce(p_data->>'outcome','') not in ('pass','fail') or length(trim(coalesce(p_data->>'note',''))) not between 10 and 4000
       or not exists(select 1 from public.audit_evidence e where e.case_id=c.id and e.id=(p_data->>'evidenceId')::uuid) then raise exception 'INDEPENDENT_RETEST_REQUIRED'; end if;
     issue:=issue || jsonb_build_object('status',case when p_data->>'outcome'='pass' then 'validated' else 'retest_failed' end,
       'retests',issue->'retests' || jsonb_build_array(jsonb_build_object('by',actor,'at',clock_timestamp(),'outcome',p_data->>'outcome','note',p_data->>'note','evidenceId',p_data->>'evidenceId')));
   else
     if r not in ('reviewer','audit_manager','cia') or issue->>'status'<>'validated' or issue->'remediation'->>'by'=actor::text then raise exception 'VALIDATED_RETEST_REQUIRED'; end if;
     issue:=issue || jsonb_build_object('status','closed','closedBy',actor,'closedAt',clock_timestamp());
   end if;
   select jsonb_agg(case when a->>'id'=issue->>'id' then issue else a end order by ord) into rows from jsonb_array_elements(s->'issues') with ordinality x(a,ord);
   s:=jsonb_set(s,'{issues}',rows);
 else raise exception 'UNKNOWN_COMMAND';
 end if;
 select hash into prev from public.audit_events where case_id=c.id order by seq desc limit 1;
 prev:=coalesce(prev,repeat('0',64));
 committed:=jsonb_build_object('format','provio-event-v1','orgId',c.org_id,'entityId',c.entity_id,'caseId',c.id,'seq',c.version+1,
   'actorId',actor,'role',r,'action',p_action,'at',clock_timestamp(),'requestId',p_key,'prevHash',prev,'state',s)::text;
 insert into public.audit_events values(c.id,c.version+1,actor,p_key,req_hash,committed,prev,encode(extensions.digest(convert_to(committed,'UTF8'),'sha256'),'hex'));
 update public.audit_cases set version=c.version+1,state=s where id=c.id returning * into c;
 return c;
end $$;

create function public.issued_audits() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'report',state->'report','issues',state->'issues')),'[]'::jsonb)
 from public.audit_cases where state->>'status'='issued' and public.audit_role(org_id,entity_id) is not null
$$;
create function public.read_audit_evidence(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.audit_evidence; c public.audit_cases;
begin
 select * into e from public.audit_evidence where id=p_id;
 select * into c from public.audit_cases where id=e.case_id;
 if coalesce(public.audit_role(c.org_id,c.entity_id),'') not in ('preparer','reviewer','audit_manager','cia') then raise exception 'PERMISSION_DENIED'; end if;
 return jsonb_build_object('id',e.id,'name',e.name,'mediaType',e.media_type,'sha256',e.sha256,'base64',encode(e.bytes,'base64'));
end $$;
revoke all on function public.audit_role(uuid,uuid), public.audit_command(uuid,integer,uuid,text,jsonb),public.issued_audits(),public.read_audit_evidence(uuid),public.immutable_audit_record() from public,anon;
grant execute on function public.audit_role(uuid,uuid),public.audit_command(uuid,integer,uuid,text,jsonb),public.issued_audits(),public.read_audit_evidence(uuid) to authenticated;
