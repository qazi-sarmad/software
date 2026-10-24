-- 6D: CAP register DB (spec §16.1, §16.2, §16.3).
--
-- The spec:
--   §16.1 "Each finding becomes a CAP. … the responsible department, the due date, the action
--          description and the remediation evidence."
--   §16.2 "Remediation evidence and an action description are mandatory. An authorised reviewer
--          approves closure. Statuses: Verified and closed · Verified and closed with delay ·
--          Unverified · Overdue and unverified."
--   §16.3 "The CAP register and the issued report must match exactly (§15.5). Any mismatch blocks the
--          freeze."
--
-- D-6D-CAP (mandatory decision, recorded before this migration): earlier CAP work used the UI
-- vocabulary Open → In progress → Pending validation → Overdue / Closed. This migration adopts the
-- §16.2 vocabulary as the single canonical status set and maps the old UI states onto it:
--   Open               → open
--   In progress        → open
--   Pending validation → unverified
--   Overdue            → overdue_unverified
--   Closed             → verified_closed
-- The mapping lives in one place (src/lib/cap.ts capStatusToDb/capStatusFromDb) so no second status
-- set survives. How to reverse: drop the mapping and restore the UI vocabulary.
--
-- Reuse (grep first): `cap_items` (0004) is a stub with only action/due_date/status and no evidence,
-- reviewer or finding link. Rather than extend it with a parallel shape, this migration creates the
-- §16 register as `caps` and leaves `cap_items` untouched for the legacy demo seed. Decision
-- D-6D-M1 records this.

create table if not exists caps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  report_id uuid null references report_versions(id) on delete set null,
  engagement_id uuid null references engagements(id) on delete set null,
  finding_id uuid null references findings(id) on delete set null,
  issue_id uuid null references issues(id) on delete set null,
  responsible_dept text null,
  due_date date null,
  action_description text null,
  remediation_evidence text null,
  status text not null default 'open'
    check (status in ('open', 'verified_closed', 'verified_closed_delay',
                      'unverified', 'overdue_unverified')),
  verified_at timestamptz null,
  verified_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists caps_org_idx on caps (org_id, engagement_id);
create index if not exists caps_report_idx on caps (org_id, report_id);
create index if not exists caps_finding_idx on caps (org_id, finding_id);

-- A CAP row names either a finding or an issue, never neither (§16.1 "Each finding becomes a CAP").
alter table caps drop constraint if exists caps_target_chk;
alter table caps add constraint caps_target_chk check (finding_id is not null or issue_id is not null);

-- Verification requires the action description and the remediation evidence (§16.2 "mandatory").
alter table caps drop constraint if exists caps_verified_evidence_chk;
alter table caps add constraint caps_verified_evidence_chk check (
  status = 'open' or status = 'unverified' or status = 'overdue_unverified'
  or (nullif(btrim(coalesce(action_description, '')), '') is not null
      and nullif(btrim(coalesce(remediation_evidence, '')), '') is not null)
);

-- ---------------------------------------------------------------------------
-- compose_report (replaced): embed each finding's CAP due date so the reconciliation can compare the
-- report against the register (§16.3). Idempotent CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
create or replace function public.compose_report(p_engagement_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_entity uuid;
  v_version uuid;
  v_next int;
  v_findings int;
  v_scope jsonb;
  v_opinion text;
  v_pos int := 0;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  select e.entity_id into v_entity from engagements e where e.id = p_engagement_id and e.org_id = v_org;
  if v_entity is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from conclusion_records c
                  where c.engagement_id = p_engagement_id and c.org_id = v_org and c.locked_at is not null) then
    raise exception 'conclusion_not_signed_off: the report becomes available only after Conclusion sign-off'
      using errcode = 'P0001';
  end if;

  select coalesce(max(r.version_number), 0) + 1 into v_next
  from report_versions r where r.engagement_id = p_engagement_id and r.org_id = v_org;

  insert into report_versions (org_id, engagement_id, version_number, status, created_by)
  values (v_org, p_engagement_id, v_next, 'draft', auth.uid())
  returning id into v_version;

  select count(*) into v_findings from findings f
   where f.org_id = v_org and f.entity_id = v_entity;

  select content into v_scope from planning_sections s
   where s.engagement_id = p_engagement_id and s.org_id = v_org and s.section_type = 'scope';
  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  values (v_org, p_engagement_id, v_version, 'scope', 'text',
          case when v_scope is null or v_scope = '{}'::jsonb
               then jsonb_build_object('missing', 'scope')
               else v_scope end,
          v_pos, v_scope is null or v_scope = '{}'::jsonb);
  v_pos := v_pos + 1;

  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  values (v_org, p_engagement_id, v_version, 'executive_summary', 'text',
          jsonb_build_object('findings', v_findings), v_pos, false);
  v_pos := v_pos + 1;

  -- Findings block: each finding with the CAP due date from the register (§16.3).
  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  select v_org, p_engagement_id, v_version, 'findings', 'table',
         coalesce(jsonb_agg(jsonb_build_object(
           'finding_id', f.id, 'severity', f.severity, 'severity_level_id', f.severity_level_id,
           'due_date', (select c.due_date from caps c
                         where c.org_id = v_org and c.finding_id = f.id
                         order by c.created_at desc limit 1))
           order by f.id), '[]'::jsonb),
         v_pos, v_findings = 0
  from findings f where f.org_id = v_org and f.entity_id = v_entity;
  v_pos := v_pos + 1;

  select c.overall_opinion into v_opinion from conclusion_records c
   where c.engagement_id = p_engagement_id and c.org_id = v_org;
  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  values (v_org, p_engagement_id, v_version, 'opinion', 'text',
          case when nullif(btrim(coalesce(v_opinion, '')), '') is null
               then jsonb_build_object('missing', 'overall_opinion')
               else jsonb_build_object('opinion', v_opinion) end,
          v_pos, nullif(btrim(coalesce(v_opinion, '')), '') is null);
  v_pos := v_pos + 1;

  insert into report_blocks (org_id, engagement_id, report_version_id, section_type, block_type,
                             content, position, is_placeholder)
  select v_org, p_engagement_id, v_version, 'appendices', 'table',
         coalesce(jsonb_agg(jsonb_build_object('workpaper_id', w.id, 'status', w.status) order by w.id), '[]'::jsonb),
         v_pos, count(*) = 0
  from workpapers w where w.org_id = v_org and w.engagement_id = p_engagement_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'report_composed', 'engagement', p_engagement_id,
          jsonb_build_object('version', v_next));
  return v_version;
end $$;

-- ---------------------------------------------------------------------------
-- update_cap: record a CAP action and move it to 'unverified' awaiting review (§16.2). Requires
-- perform_work. Logs the update.
-- ---------------------------------------------------------------------------
create or replace function public.update_cap(
  p_cap_id uuid, p_action_description text, p_remediation_evidence text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cap caps;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  select * into v_cap from caps c where c.id = p_cap_id and c.org_id = v_org;
  if v_cap.id is null then
    raise exception 'cap not found in this organisation' using errcode = 'P0001';
  end if;

  update caps
     set action_description = coalesce(p_action_description, action_description),
         remediation_evidence = coalesce(p_remediation_evidence, remediation_evidence),
         status = case when status = 'open' then 'unverified' else status end
   where id = p_cap_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'cap_updated', 'cap', p_cap_id,
          jsonb_build_object('action_description', p_action_description));
end $$;

-- ---------------------------------------------------------------------------
-- close_cap: an authorised reviewer approves closure (§16.2). Requires review_and_approve. Writes a
-- hash-chained ledger entry. verified + delay → verified_closed_delay; verified → verified_closed;
-- not verified → overdue_unverified when past due, else unverified.
-- ---------------------------------------------------------------------------
create or replace function public.close_cap(p_cap_id uuid, p_verified boolean, p_delay boolean)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cap caps;
  v_status text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  select * into v_cap from caps c where c.id = p_cap_id and c.org_id = v_org;
  if v_cap.id is null then
    raise exception 'cap not found in this organisation' using errcode = 'P0001';
  end if;

  v_status := case
    when p_verified and p_delay then 'verified_closed_delay'
    when p_verified then 'verified_closed'
    when v_cap.due_date is not null and v_cap.due_date < current_date then 'overdue_unverified'
    else 'unverified'
  end;

  update caps
     set status = v_status,
         verified_at = case when p_verified then now() else verified_at end,
         verified_by = case when p_verified then auth.uid() else verified_by end
   where id = p_cap_id;

  perform public.append_ledger_entry(
    v_org, 'cap_closed',
    jsonb_build_object('cap_id', p_cap_id, 'status', v_status,
                       'finding_id', v_cap.finding_id, 'issue_id', v_cap.issue_id), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'cap_closed', 'cap', p_cap_id, jsonb_build_object('status', v_status));
  return v_status;
end $$;

-- ---------------------------------------------------------------------------
-- check_cap_reconciliation: every finding/issue in the report has a CAP row and the due dates match
-- (§16.3). Reads from `caps`, never from the report blocks, except for the list of finding ids the
-- report contains and the due date the report shows.
-- ---------------------------------------------------------------------------
create or replace function public.check_cap_reconciliation(p_report_version_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_block jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not exists (select 1 from report_versions r where r.id = p_report_version_id and r.org_id = v_org) then
    raise exception 'report version not found in this organisation' using errcode = 'P0001';
  end if;

  select b.content into v_block from report_blocks b
   where b.report_version_id = p_report_version_id and b.org_id = v_org and b.section_type = 'findings'
   limit 1;
  v_block := coalesce(v_block, '[]'::jsonb);

  -- Every finding the report shows must have a CAP row in the caller's org, and where the report
  -- carries a due date it must equal the register's due date.
  return not exists (
    select 1
    from jsonb_array_elements(v_block) e
    where not exists (
      select 1 from caps c
       where c.org_id = v_org
         and c.finding_id = (e ->> 'finding_id')::uuid
         and (e ->> 'due_date' is null
              or (c.due_date is not null and c.due_date = (e ->> 'due_date')::date))
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: org-scoped select only. Writes go through the RPCs above.
-- ---------------------------------------------------------------------------
alter table caps enable row level security;

drop policy if exists caps_select on caps;
create policy caps_select on caps for select to authenticated
  using (org_id = public.jwt_org_id());

drop trigger if exists caps_pin_org on caps;
create trigger caps_pin_org before insert on caps
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.update_cap(uuid, text, text) from public, anon;
revoke execute on function public.close_cap(uuid, boolean, boolean) from public, anon;
revoke execute on function public.check_cap_reconciliation(uuid) from public, anon;

grant execute on function public.update_cap(uuid, text, text) to authenticated;
grant execute on function public.close_cap(uuid, boolean, boolean) to authenticated;
grant execute on function public.check_cap_reconciliation(uuid) to authenticated;
