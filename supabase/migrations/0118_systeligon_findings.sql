-- 0118 (S13): record a Systeligon rule run's findings against an engagement.
--
-- Spec §9.4: a finding carries its rule id, version and source rows, and the report must cite it with
-- that provenance intact. This is the authoritative half of that loop — `loadSysteligonFindings`
-- (src/data/reportGraph.ts) reads the rows this RPC writes, and `commitReportGraph` turns them into
-- report claims. Without this writer the reader would be the exact defect the code-verified audit
-- found: a function the product never calls.
--
-- A finding is recorded as a ledger entry (`action = 'rule_finding'`, so the chain is unbroken and
-- the append-only ledger still applies). The payload carries the full finding, the engagement it
-- concerns and the rule run's instant, so a sealed report is reproducible from the ledger alone.
--
-- M1: grepped migrations and tests for `systeligon_finding_record`; new, not redefined.
-- M2: create or replace; no table changes shape.
-- M6: applied twice and all SQL tests run twice by the harness before the push.

-- ---------------------------------------------------------------------------
-- 1. The feature key. The findings feed the report; they belong with the rule packs feature.
-- ---------------------------------------------------------------------------
insert into feature_catalogue (key, label, description, group_name, price_class, default_on, status) values
  ('systeligon_findings','Systeligon findings','Deterministic rule findings recorded against an engagement, cited in the report with their provenance','Systeligon','included',true,'live')
on conflict (key) do update set label = excluded.label, description = excluded.description,
  group_name = excluded.group_name, price_class = excluded.price_class, status = excluded.status;

-- ---------------------------------------------------------------------------
-- 2. systeligon_finding_record(p_org, p_engagement_id, p_evaluated_at, p_findings)
--    Appends one ledger entry per finding. Idempotent per (engagement, evaluated_at, rule, version):
--    re-recording the same run adds nothing, so a re-derivation never duplicates a citation.
-- ---------------------------------------------------------------------------
create or replace function public.systeligon_finding_record(
  p_org uuid,
  p_engagement_id uuid,
  p_evaluated_at timestamptz,
  p_findings jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_finding jsonb;
  v_added int := 0;
  v_rule text;
  v_ver int;
  v_eng uuid;
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then
    raise exception 'an organisation is required' using errcode = 'P0001';
  end if;
  perform public.provio_org_guard(v_org);
  if not public.has_feature(v_org, 'systeligon_findings') then
    raise exception 'feature_off: systeligon_findings' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('perform_work') or public.caller_has_right('review_and_approve')) then
    raise exception 'not permitted: perform_work or review_and_approve is required' using errcode = 'P0001';
  end if;
  if p_evaluated_at is null then
    raise exception 'the evaluation instant is required — a finding is never recorded against a clock'
      using errcode = 'P0001';
  end if;

  if p_engagement_id is not null then
    select e.id into v_eng from engagements e where e.id = p_engagement_id and e.org_id = v_org;
    if v_eng is null then
      raise exception 'engagement not found in this organisation' using errcode = 'P0001';
    end if;
  end if;

  for v_finding in select value from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    v_rule := v_finding ->> 'ruleId';
    v_ver := nullif(v_finding ->> 'ruleVersion', '')::int;
    if coalesce(v_rule, '') = '' or v_ver is null then
      raise exception 'every finding needs a ruleId and a ruleVersion' using errcode = 'P0001';
    end if;
    continue when exists (
      select 1 from ledger_entries l
       where l.org_id = v_org and l.action = 'rule_finding'
         and l.payload ->> 'engagement_id' is not distinct from p_engagement_id::text
         and (l.payload ->> 'evaluated_at')::timestamptz = p_evaluated_at
         and l.payload -> 'finding' ->> 'ruleId' = v_rule
         and (l.payload -> 'finding' ->> 'ruleVersion')::int = v_ver
    );
    perform public.append_ledger_entry(v_org, 'rule_finding',
      jsonb_build_object(
        'engagement_id', p_engagement_id::text,
        'evaluated_at', p_evaluated_at,
        'finding', v_finding),
      auth.uid());
    v_added := v_added + 1;
  end loop;
  return v_added;
end $$;

comment on function public.systeligon_finding_record(uuid, uuid, timestamptz, jsonb) is
  'S13: records a rule run''s findings against an engagement as idempotent, hash-chained ledger entries. The report reads them through loadSysteligonFindings and cites each with its rule provenance.';

-- ---------------------------------------------------------------------------
-- 3. Grants. A tenant caller may record under a right; the runner (service) too.
-- ---------------------------------------------------------------------------
revoke execute on function public.systeligon_finding_record(uuid, uuid, timestamptz, jsonb)
  from public, anon;
grant execute on function public.systeligon_finding_record(uuid, uuid, timestamptz, jsonb)
  to authenticated, service_role;
