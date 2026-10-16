-- 4B: Planning DB — sections, SIRA pre-fill suggestions, reconciliation gate and sign-off
-- (spec §10.1, §10.4).
--
-- The spec:
--   §10.1 "Sections are configurable per organisation … SIRA pre-fill (required behaviour): when
--         Planning begins, everything already available from SIRA for the Entity appears as smart
--         suggestions and pre-filled options … The auditor accepts, edits or rejects each suggestion.
--         Each decision is logged. Reconciliation: if the risks in Planning do not match the current
--         SIRA, a reconciliation error blocks Planning sign-off until resolved. Testing is locked
--         until Planning sign-off."
--   §10.4 "Every stage sign-off requires review … After sign-off the file is locked and read-only."
--
-- Reuse (grep first): nothing is named planning_sections / planning_suggestion_decisions /
-- populate_planning_suggestions / check_planning_reconciliation / sign_planning, so these are new.
-- sira_cycles / sira_scores (0003) and public.sira_band_for (0019) supply the pre-fill.
-- append_ledger_entry (0007) is the ledger path. The role_config_log pattern (0014) is not needed
-- here because planning_sections are not org-wide configuration.

-- ---------------------------------------------------------------------------
-- planning_sections: the configurable Planning content for one engagement (§10.1).
-- One row per section type. signed_off_at/by is set by sign_planning; once set the row is locked.
-- ---------------------------------------------------------------------------
create table if not exists planning_sections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  section_type text not null check (section_type in ('riskcontrol', 'scope', 'resources', 'other')),
  content jsonb not null default '{}'::jsonb,
  prepared_by uuid null,
  signed_off_at timestamptz null,
  signed_off_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (engagement_id, section_type)
);
create index if not exists planning_sections_engagement_idx on planning_sections (org_id, engagement_id);

-- ---------------------------------------------------------------------------
-- planning_suggestion_decisions: one row per SIRA suggestion the auditor accepted or rejected
-- (§10.1 "Each decision is logged").
-- ---------------------------------------------------------------------------
create table if not exists planning_suggestion_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  suggestion_id text not null,
  accepted boolean not null,
  reason text null,
  decided_at timestamptz not null default now(),
  decided_by uuid null,
  unique (engagement_id, suggestion_id)
);
create index if not exists psd_engagement_idx on planning_suggestion_decisions (org_id, engagement_id);

-- A rejected suggestion requires a reason (a decision that is logged with its rationale).
alter table planning_suggestion_decisions drop constraint if exists psd_reject_reason_chk;
alter table planning_suggestion_decisions add constraint psd_reject_reason_chk check (
  accepted or (reason is not null and length(btrim(reason)) > 0)
);

-- ---------------------------------------------------------------------------
-- planning_reconciliation_acks: an acknowledged SIRA/Planning discrepancy with a recorded reason,
-- which unblocks sign-off when the reconciliation gate would otherwise refuse it (§10.1).
-- ---------------------------------------------------------------------------
create table if not exists planning_reconciliation_acks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  reason text not null,
  acked_by uuid null,
  acked_at timestamptz not null default now(),
  unique (engagement_id)
);
create index if not exists pra_engagement_idx on planning_reconciliation_acks (org_id, engagement_id);

alter table planning_reconciliation_acks drop constraint if exists pra_reason_len_chk;
alter table planning_reconciliation_acks add constraint pra_reason_len_chk check (length(btrim(reason)) >= 10);

-- ---------------------------------------------------------------------------
-- Row-level security: every table is org-scoped, visible through the parent engagement.
-- No direct write policy; writes go through the RPCs below.
-- ---------------------------------------------------------------------------
alter table planning_sections enable row level security;
drop policy if exists planning_sections_select on planning_sections;
create policy planning_sections_select on planning_sections for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));

alter table planning_suggestion_decisions enable row level security;
drop policy if exists psd_select on planning_suggestion_decisions;
create policy psd_select on planning_suggestion_decisions for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));

alter table planning_reconciliation_acks enable row level security;
drop policy if exists pra_select on planning_reconciliation_acks;
create policy pra_select on planning_reconciliation_acks for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));

-- Pin org_id on insert, for application roles only (same defence as 0009, kept local to 4B).
do $$
declare
  t text;
begin
  foreach t in array array['planning_sections', 'planning_suggestion_decisions', 'planning_reconciliation_acks'] loop
    execute format('drop trigger if exists %I_pin_org on %I', t, t);
    execute format('create trigger %I_pin_org before insert on %I for each row execute function public.pin_org_id()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------

-- latest_published_sira_cycle: the most recent published cycle for an engagement's entity.
create or replace function public.latest_published_sira_cycle(p_engagement_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id
  from engagements en
  join sira_cycles c on c.universe_id = en.universe_id and c.org_id = en.org_id
  where en.id = p_engagement_id and en.org_id = public.jwt_org_id()
    and c.status = 'published'
  order by c.year desc, c.published_at desc
  limit 1
$$;

-- planning_signed_off: true once sign_planning has locked the engagement's planning sections.
create or replace function public.planning_signed_off(p_engagement_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from planning_sections s
    where s.engagement_id = p_engagement_id and s.org_id = public.jwt_org_id() and s.signed_off_at is not null
  )
$$;

-- ---------------------------------------------------------------------------
-- populate_planning_suggestions: the SIRA pre-fill (§10.1). Reads the latest published cycle's
-- scores for the engagement's entity and returns a JSON array of suggestions. Returns '[]' when no
-- published cycle exists. It never applies anything: the auditor accepts or rejects each item.
-- ---------------------------------------------------------------------------
create or replace function public.populate_planning_suggestions(p_engagement_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cycle uuid;
  v_entity uuid;
  v_out jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select en.entity_id into v_entity from engagements en
   where en.id = p_engagement_id and en.org_id = v_org;
  if v_entity is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;

  v_cycle := public.latest_published_sira_cycle(p_engagement_id);
  if v_cycle is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'suggestion_id', ('risk:' || s.risk_id)::text,
           'risk_id', s.risk_id,
           'risk_name', rl.name,
           'inherent_rating', s.score,
           'suggested_controls', '[]'::jsonb,
           'prior_finding_count', (
             select count(*) from findings f where f.org_id = v_org and f.entity_id = v_entity),
           'risk_band', public.sira_band_for(v_org, s.score)
         ) order by s.score desc, rl.name), '[]'::jsonb)
    into v_out
  from sira_scores s
  left join risks_library rl on rl.id = s.risk_id
  where s.cycle_id = v_cycle and s.entity_id = v_entity;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- decide_planning_suggestion: log an accept/reject of one suggestion (§10.1). perform_work.
-- ---------------------------------------------------------------------------
create or replace function public.decide_planning_suggestion(
  p_engagement_id uuid, p_suggestion_id text, p_accepted boolean, p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  insert into planning_suggestion_decisions (org_id, engagement_id, suggestion_id, accepted, reason, decided_by)
  values (v_org, p_engagement_id, p_suggestion_id, p_accepted, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  on conflict (engagement_id, suggestion_id) do update
    set accepted = excluded.accepted, reason = excluded.reason, decided_at = now(), decided_by = auth.uid();
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'planning_suggestion_decided', 'engagement', p_engagement_id,
          jsonb_build_object('suggestion_id', p_suggestion_id, 'accepted', p_accepted));
end $$;

-- ---------------------------------------------------------------------------
-- save_planning_section: upsert one section's content (§10.1). perform_work. Refused once the
-- planning is signed off (locked, §10.4).
-- ---------------------------------------------------------------------------
create or replace function public.save_planning_section(
  p_engagement_id uuid, p_section_type text, p_content jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if public.planning_signed_off(p_engagement_id) then
    raise exception 'planning_locked: planning sections are signed off and read-only' using errcode = 'P0001';
  end if;
  insert into planning_sections (org_id, engagement_id, section_type, content, prepared_by)
  values (v_org, p_engagement_id, p_section_type, coalesce(p_content, '{}'::jsonb), auth.uid())
  on conflict (engagement_id, section_type) do update
    set content = excluded.content, prepared_by = excluded.prepared_by, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- check_planning_reconciliation: true when every risk in the Planning RCM (the risk_ids listed in
-- the riskcontrol section's content->'risks') matches a risk in the latest published SIRA cycle for
-- the engagement's entity (§10.1).
-- ---------------------------------------------------------------------------
create or replace function public.check_planning_reconciliation(p_engagement_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cycle uuid;
  v_entity uuid;
  v_missing int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select en.entity_id into v_entity from engagements en
   where en.id = p_engagement_id and en.org_id = v_org;
  if v_entity is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  v_cycle := public.latest_published_sira_cycle(p_engagement_id);

  select count(*) into v_missing
  from planning_sections s
  cross join lateral jsonb_array_elements(coalesce(s.content -> 'risks', '[]'::jsonb)) r
  where s.engagement_id = p_engagement_id and s.org_id = v_org and s.section_type = 'riskcontrol'
    and not exists (
      select 1 from sira_scores sc
      where sc.cycle_id = v_cycle and sc.entity_id = v_entity
        and sc.risk_id = nullif(r ->> 'risk_id', '')::uuid
    );
  return v_missing = 0;
end $$;

-- ---------------------------------------------------------------------------
-- acknowledge_planning_discrepancy: record a reason for a known discrepancy so sign-off can
-- proceed (§10.1 "or the discrepancy is acknowledged with a recorded reason"). perform_work.
-- ---------------------------------------------------------------------------
create or replace function public.acknowledge_planning_discrepancy(
  p_engagement_id uuid, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'a discrepancy reason of at least 10 characters is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  insert into planning_reconciliation_acks (org_id, engagement_id, reason, acked_by)
  values (v_org, p_engagement_id, btrim(p_reason), auth.uid())
  on conflict (engagement_id) do update set reason = excluded.reason, acked_by = auth.uid(), acked_at = now();
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'planning_discrepancy_ack', 'engagement', p_engagement_id,
          jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------------------
-- sign_planning: lock the Planning stage (§10.1, §10.4). Requires review_and_approve, four-eyes
-- (the signer did not prepare every section), a clean reconciliation or a recorded acknowledgement,
-- and at least one section to sign. Writes a hash-chained ledger entry.
-- ---------------------------------------------------------------------------
create or replace function public.sign_planning(p_engagement_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sections int;
  v_self int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if public.planning_signed_off(p_engagement_id) then
    raise exception 'planning_locked: planning sections are already signed off' using errcode = 'P0001';
  end if;

  select count(*) into v_sections from planning_sections
   where engagement_id = p_engagement_id and org_id = v_org;
  if v_sections = 0 then
    raise exception 'no planning sections to sign off' using errcode = 'P0001';
  end if;

  -- Four-eyes: the signer must not be the preparer of every section.
  select count(*) into v_self from planning_sections
   where engagement_id = p_engagement_id and org_id = v_org and prepared_by = auth.uid();
  if v_self = v_sections then
    raise exception 'four_eyes: the signer prepared every planning section' using errcode = 'P0001';
  end if;

  -- Reconciliation gate: clean, or acknowledged with a recorded reason.
  if not public.check_planning_reconciliation(p_engagement_id)
     and not exists (select 1 from planning_reconciliation_acks a
                     where a.engagement_id = p_engagement_id and a.org_id = v_org) then
    raise exception 'planning_reconciliation: risks do not match the current SIRA and no discrepancy is acknowledged'
      using errcode = 'P0001';
  end if;

  update planning_sections
     set signed_off_at = now(), signed_off_by = auth.uid()
   where engagement_id = p_engagement_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'planning_signed_off',
    jsonb_build_object('engagement_id', p_engagement_id, 'sections', v_sections), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'planning_signed_off', 'engagement', p_engagement_id,
          jsonb_build_object('sections', v_sections));
end $$;

-- ---------------------------------------------------------------------------
-- Testing is locked until Planning sign-off (§10.1). An application role cannot create a workpaper
-- in the testing stage, or move a workpaper into the testing stage, for an engagement whose planning
-- is not signed off. Editing a workpaper that is already in testing (for example marking it prepared)
-- is not a stage transition and is left to the per-stage rules in 4E. Trusted roles (the table owner
-- and the service role) are exempt, exactly as pin_org_id is (they seed fixtures).
-- ---------------------------------------------------------------------------
create or replace function public.guard_testing_lock() returns trigger
language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.stage = 'testing'
     and (tg_op = 'INSERT' or old.stage is distinct from 'testing')
     and not public.planning_signed_off(new.engagement_id) then
    raise exception 'testing_locked: planning must be signed off before testing (engagement %)', new.engagement_id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists workpapers_testing_lock on workpapers;
create trigger workpapers_testing_lock before insert or update on workpapers
  for each row execute function public.guard_testing_lock();

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.latest_published_sira_cycle(uuid) from public, anon;
revoke execute on function public.planning_signed_off(uuid) from public, anon;
revoke execute on function public.populate_planning_suggestions(uuid) from public, anon;
revoke execute on function public.decide_planning_suggestion(uuid, text, boolean, text) from public, anon;
revoke execute on function public.save_planning_section(uuid, text, jsonb) from public, anon;
revoke execute on function public.check_planning_reconciliation(uuid) from public, anon;
revoke execute on function public.acknowledge_planning_discrepancy(uuid, text) from public, anon;
revoke execute on function public.sign_planning(uuid) from public, anon;

grant execute on function public.latest_published_sira_cycle(uuid) to authenticated;
grant execute on function public.planning_signed_off(uuid) to authenticated;
grant execute on function public.populate_planning_suggestions(uuid) to authenticated;
grant execute on function public.decide_planning_suggestion(uuid, text, boolean, text) to authenticated;
grant execute on function public.save_planning_section(uuid, text, jsonb) to authenticated;
grant execute on function public.check_planning_reconciliation(uuid) to authenticated;
grant execute on function public.acknowledge_planning_discrepancy(uuid, text) to authenticated;
grant execute on function public.sign_planning(uuid) to authenticated;
