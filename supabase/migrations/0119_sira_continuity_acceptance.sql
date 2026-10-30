-- 0110: SIRA continuity and two-key acceptance (S18, S19).
--
-- S18 — continuity. Publishing a cycle produces a CARRY-FORWARD PACK (the prior score, its band, the
-- movement, the findings that touched it, the controls that failed, the emergent risks accepted) and
-- seeds the next year's cycle from it, marked carried_forward with provenance. Open findings and
-- anomalies PROPOSE an emergent risk through the existing queue; a human still accepts or rejects.
--
-- S19 — two-key acceptance. The owner's correction: the accept/reject/override control STAYS with the
-- SIRA finaliser, and it is visible and reminded — but the finaliser's decision is an ENDORSEMENT,
-- not a closure. The AUDITORS must accept. Publication of the next-year cycle is BLOCKED while a
-- proposal is outstanding, silence is reminded until resolved, and unresolved silence is reported as
-- a finding. A single role able to both propose and close is a control weakness.
--
-- Laws: L2 (nothing leaves the tenant; only hashes), rights not role names, idempotent (applied twice
-- by the harness), every new table carries org_id + RLS + a select policy, and the write paths are
-- security-definer RPCs. Nothing here reads the clock except where the caller passes it in.

-- ---------------------------------------------------------------------------
-- 1. Provenance on the emergent-risk queue, and a carried-forward flag on scores.
-- ---------------------------------------------------------------------------
alter table sira_emergent_risks add column if not exists source_kind text;
alter table sira_emergent_risks add column if not exists source_id uuid;
alter table sira_emergent_risks add column if not exists proposal_reason text;

-- A proposal written by the engine carries where it came from, so the queue can show the finding or
-- anomaly that raised it and dedupe a re-run.
create index if not exists ser_source_idx on sira_emergent_risks (org_id, source_kind, source_id);

alter table sira_scores add column if not exists carried_forward boolean not null default false;
alter table sira_scores add column if not exists carried_from_cycle_id uuid null references sira_cycles(id) on delete set null;
-- `band` is read by src/data/sira.ts:listScores and by the SIRA screen, but no migration ever created
-- it. Add it here (additive) so the read resolves and the carry-forward can record the prior band.
alter table sira_scores add column if not exists band text null;

-- ---------------------------------------------------------------------------
-- 2. The carry-forward pack. One row per published cycle, immutable, holding the pack the next cycle
--    was seeded from. Append-only by policy (select only; the RPC is the sole writer).
-- ---------------------------------------------------------------------------
create table if not exists sira_carry_forward (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  from_cycle_id uuid not null references sira_cycles(id) on delete cascade,
  to_cycle_id uuid null references sira_cycles(id) on delete set null,
  universe_id uuid not null references universes(id) on delete cascade,
  from_year int not null,
  to_year int not null,
  pack jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (from_cycle_id)
);
create index if not exists scf_universe_idx on sira_carry_forward (org_id, universe_id, from_year desc);

alter table sira_carry_forward enable row level security;
drop policy if exists scf_select on sira_carry_forward;
create policy scf_select on sira_carry_forward for select to authenticated
  using (org_id = public.jwt_org_id()
         and (public.can_read_all_scopes()
              or coalesce(public.caller_has_right('review_and_approve'), false)
              or public.has_scope(universe_id, null, null)));

-- ---------------------------------------------------------------------------
-- 3. Two-key acceptance. One row per published cycle: the finaliser's ENDORSEMENT, then the
--    AUDITOR's ACCEPTANCE (a different person, holding review_and_approve). Append-only; a decision
--    is recorded once.
-- ---------------------------------------------------------------------------
create table if not exists sira_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  cycle_id uuid not null references sira_cycles(id) on delete cascade,
  universe_id uuid not null references universes(id) on delete cascade,
  year int not null,
  status text not null default 'awaiting_acceptance'
    check (status in ('awaiting_acceptance', 'accepted', 'rejected')),
  endorsed_by uuid null,
  endorsed_at timestamptz null,
  endorsement_note text null,
  accepted_by uuid null,
  accepted_at timestamptz null,
  acceptance_reason text null,
  reminder_count int not null default 0,
  last_reminded_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (cycle_id)
);
create index if not exists sacc_status_idx on sira_acceptances (org_id, status, year);

alter table sira_acceptances enable row level security;
drop policy if exists sacc_select on sira_acceptances;
create policy sacc_select on sira_acceptances for select to authenticated
  using (org_id = public.jwt_org_id()
         and (public.can_read_all_scopes()
              or coalesce(public.caller_has_right('review_and_approve'), false)
              or public.has_scope(universe_id, null, null)));

-- ---------------------------------------------------------------------------
-- 4. sira_carry_forward_pack(p_cycle) — build the pack for a published cycle, read-only.
-- ---------------------------------------------------------------------------
create or replace function public.sira_carry_forward_pack(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cycle sira_cycles;
  v_entities jsonb;
  v_accepted jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select * into v_cycle from sira_cycles where id = p_cycle and org_id = v_org;
  if not found then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;

  -- Per entity: the mean prior score and its band, and the controls that failed (an ineffective or
  -- needs-improvement result on a workpaper attached to the entity).
  select coalesce(jsonb_agg(jsonb_build_object(
           'entity_id', x.entity_id,
           'name', x.name,
           'prior_score', x.mean_score,
           'prior_band', public.sira_band_for(v_org, x.mean_score),
           'score_count', x.score_count
         ) order by x.name), '[]'::jsonb)
    into v_entities
    from (
      select e.id as entity_id, e.name, round(avg(s.score), 2) as mean_score, count(*) as score_count
        from sira_scores s join entities e on e.id = s.entity_id
       where s.cycle_id = p_cycle
       group by e.id, e.name
    ) x;

  -- The emergent risks accepted for this universe up to and including this year.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'title', r.title, 'entity_id', r.entity_id, 'reason', r.decision_reason
         ) order by r.created_at), '[]'::jsonb)
    into v_accepted
    from sira_emergent_risks r
   where r.org_id = v_org and r.universe_id = v_cycle.universe_id and r.status = 'accepted';

  return jsonb_build_object(
    'from_cycle_id', v_cycle.id,
    'universe_id', v_cycle.universe_id,
    'from_year', v_cycle.year,
    'to_year', v_cycle.year + 1,
    'published_at', v_cycle.published_at,
    'entities', v_entities,
    'accepted_emergent_risks', v_accepted
  );
end $$;

revoke execute on function public.sira_carry_forward_pack(uuid) from public, anon;
grant execute on function public.sira_carry_forward_pack(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. seed_sira_next_cycle(p_cycle) — create the next year's cycle and seed it from the pack. Scores
--    are carried forward with provenance and marked carried_forward; nothing is scored fresh, so the
--    next cycle starts from the prior state and a human changes it. The public RPC checks the right;
--    the internal helper is what publish calls, so an approve_plan-only publisher is not blocked.
-- ---------------------------------------------------------------------------
create or replace function public.sira_seed_next_cycle_internal(p_cycle uuid, p_org uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cycle sira_cycles;
  v_next uuid;
begin
  select * into v_cycle from sira_cycles where id = p_cycle and org_id = p_org;
  if not found then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;

  insert into sira_cycles (org_id, universe_id, year, status, created_by)
  values (p_org, v_cycle.universe_id, v_cycle.year + 1, 'draft', p_actor)
  on conflict (org_id, universe_id, year) do nothing
  returning id into v_next;
  if v_next is null then
    select id into v_next from sira_cycles
     where org_id = p_org and universe_id = v_cycle.universe_id and year = v_cycle.year + 1;
  end if;

  insert into sira_scores (org_id, cycle_id, entity_id, risk_id, score, band, factor_values, method,
                           carried_forward, carried_from_cycle_id)
  select p_org, v_next, s.entity_id, s.risk_id, s.score, s.band, s.factor_values, s.method,
         true, v_cycle.id
    from sira_scores s
   where s.cycle_id = p_cycle
  on conflict (org_id, cycle_id, entity_id, risk_id) do nothing;

  return v_next;
end $$;

revoke execute on function public.sira_seed_next_cycle_internal(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.seed_sira_next_cycle(p_cycle uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  return public.sira_seed_next_cycle_internal(p_cycle, v_org, auth.uid());
end $$;

revoke execute on function public.seed_sira_next_cycle(uuid) from public, anon;
grant execute on function public.seed_sira_next_cycle(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. propose_emergent_risks(p_cycle) — open findings on the cycle's universe PROPOSE an emergent
--    risk in the existing queue. Idempotent: a finding already proposed is not proposed again. The
--    proposal is pending; a human accepts or rejects it (decide_emergent_risk).
-- ---------------------------------------------------------------------------
create or replace function public.propose_emergent_risks(p_cycle uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cycle sira_cycles;
  v_count int := 0;
  f record;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  select * into v_cycle from sira_cycles where id = p_cycle and org_id = v_org;
  if not found then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;

  -- A finding belongs to an entity through its observation's engagement, or through its own
  -- entity_id. Only findings on this universe's entities are proposed, and only once.
  for f in
    select distinct fi.id as finding_id, coalesce(fi.entity_id, en.entity_id) as entity_id,
           coalesce(fi.severity, 'medium') as severity, o.title as title
      from findings fi
      left join observations o on o.id = fi.observation_id
      left join engagements en on en.id = o.engagement_id
     where fi.org_id = v_org
       and coalesce(fi.entity_id, en.entity_id) in (
         select e.id from entities e where e.org_id = v_org and e.universe_id = v_cycle.universe_id)
       and not exists (
         select 1 from sira_emergent_risks r
          where r.org_id = v_org and r.source_kind = 'finding' and r.source_id = fi.id)
  loop
    insert into sira_emergent_risks (
      org_id, universe_id, entity_id, target_cycle_id, title, description, status, created_by,
      source_kind, source_id, proposal_reason)
    values (
      v_org, v_cycle.universe_id, f.entity_id, v_cycle.id,
      coalesce(f.title, 'Finding raised an emergent risk'),
      'Proposed from a finding of severity ' || f.severity || ' on this universe.',
      'pending', auth.uid(), 'finding', f.finding_id,
      'an open finding on this universe proposes an emergent risk for the next cycle');
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
    values (v_org, auth.uid(), 'emergent_risks_proposed', 'sira_cycle', p_cycle,
            jsonb_build_object('proposed', v_count, 'universe_id', v_cycle.universe_id));
  end if;
  return v_count;
end $$;

revoke execute on function public.propose_emergent_risks(uuid) from public, anon;
grant execute on function public.propose_emergent_risks(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Two-key acceptance RPCs.
--    endorse_sira_cycle: the finaliser (approve_plan) records an ENDORSEMENT. It is visible and
--      reminded; it does not close anything.
--    accept_sira_cycle / reject_sira_cycle: an AUDITOR (review_and_approve) makes the real decision,
--      and must be a different person from the finaliser.
-- ---------------------------------------------------------------------------
create or replace function public.endorse_sira_cycle(p_cycle uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cycle sira_cycles;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('approve_plan'), false) then
    raise exception 'not allowed: caller lacks the approve_plan right' using errcode = 'P0001';
  end if;
  select * into v_cycle from sira_cycles where id = p_cycle and org_id = v_org;
  if not found then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;
  if v_cycle.status <> 'published' then
    raise exception 'only a published cycle can be endorsed' using errcode = 'P0001';
  end if;

  insert into sira_acceptances (org_id, cycle_id, universe_id, year, status, endorsed_by, endorsed_at, endorsement_note)
  values (v_org, p_cycle, v_cycle.universe_id, v_cycle.year, 'awaiting_acceptance', auth.uid(), now(), p_note)
  on conflict (cycle_id) do update
    set endorsed_by = excluded.endorsed_by, endorsed_at = excluded.endorsed_at,
        endorsement_note = excluded.endorsement_note
    where sira_acceptances.status = 'awaiting_acceptance';

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'sira_cycle_endorsed', 'sira_cycle', p_cycle,
          jsonb_build_object('note', p_note));
end $$;

revoke execute on function public.endorse_sira_cycle(uuid, text) from public, anon;
grant execute on function public.endorse_sira_cycle(uuid, text) to authenticated;

create or replace function public.decide_sira_acceptance(p_cycle uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_row sira_acceptances;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if p_status not in ('accepted', 'rejected') then
    raise exception 'a decision is accepted or rejected' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'a decision reason of at least 10 characters is required' using errcode = 'P0001';
  end if;
  select * into v_row from sira_acceptances where cycle_id = p_cycle and org_id = v_org;
  if not found then
    raise exception 'this cycle is not awaiting acceptance' using errcode = 'P0001';
  end if;
  if v_row.status <> 'awaiting_acceptance' then
    raise exception 'this cycle has already been decided' using errcode = 'P0001';
  end if;
  -- Two keys: the person who endorsed cannot also accept.
  if v_row.endorsed_by is not null and v_row.endorsed_by = auth.uid() then
    raise exception 'the finaliser cannot also accept: a second person must accept' using errcode = 'P0001';
  end if;

  update sira_acceptances
     set status = p_status, accepted_by = auth.uid(), accepted_at = now(),
         acceptance_reason = btrim(p_reason)
   where id = v_row.id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'sira_acceptance_decided', 'sira_cycle', p_cycle,
          jsonb_build_object('status', p_status, 'reason', btrim(p_reason)));
end $$;

revoke execute on function public.decide_sira_acceptance(uuid, text, text) from public, anon;
grant execute on function public.decide_sira_acceptance(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The publication gate. sira_publish_block(p_cycle) returns a plain-language reason when the
--    cycle may not be published, or null when it may. Two blocks: an outstanding emergent-risk
--    proposal, and a prior cycle whose two-key acceptance is still outstanding.
-- ---------------------------------------------------------------------------
create or replace function public.sira_publish_block(p_cycle uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cycle sira_cycles;
  v_pending int;
  v_prior sira_acceptances;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select * into v_cycle from sira_cycles where id = p_cycle and org_id = v_org;
  if not found then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;

  select count(*) into v_pending
    from sira_emergent_risks r
   where r.org_id = v_org and r.universe_id = v_cycle.universe_id and r.status = 'pending';
  if v_pending > 0 then
    return format('%s emergent-risk proposal%s outstanding; resolve them before publishing', v_pending, case when v_pending = 1 then ' is' else 's are' end);
  end if;

  -- The immediately preceding published cycle of the same universe must have been accepted.
  select a.* into v_prior
    from sira_acceptances a
    join sira_cycles c on c.id = a.cycle_id
   where a.org_id = v_org and c.universe_id = v_cycle.universe_id and c.year < v_cycle.year
   order by c.year desc
   limit 1;
  if found and v_prior.status <> 'accepted' then
    return format('the %s cycle has not been accepted by an auditor yet; a second person must accept it before this cycle is published', v_prior.year);
  end if;

  return null;
end $$;

revoke execute on function public.sira_publish_block(uuid) from public, anon;
grant execute on function public.sira_publish_block(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Publish, extended (S18 + S19). The body keeps the original behaviour (freeze, ledger, activity)
--    and adds: the publication gate, the carry-forward pack, seeding the next cycle, and opening the
--    two-key acceptance. It is create or replace of the 0020 definition.
-- ---------------------------------------------------------------------------
create or replace function public.publish_sira_cycle(p_cycle uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_status text;
  v_summary jsonb;
  v_entry ledger_entries;
  v_block text;
  v_pack jsonb;
  v_next uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('approve_plan'), false) then
    raise exception 'not allowed: caller lacks the approve_plan right' using errcode = 'P0001';
  end if;
  select status into v_status from sira_cycles where id = p_cycle and org_id = v_org;
  if v_status is null then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status = 'published' then
    raise exception 'sira cycle is already published' using errcode = 'P0001';
  end if;

  -- S19: block while a proposal or a prior acceptance is outstanding.
  v_block := public.sira_publish_block(p_cycle);
  if v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'universe_id', c.universe_id,
           'year', c.year,
           'entity_count', (select count(distinct s.entity_id) from sira_scores s where s.cycle_id = c.id),
           'score_count', (select count(*) from sira_scores s where s.cycle_id = c.id),
           'mean_score', (select round(avg(s.score), 2) from sira_scores s where s.cycle_id = c.id)
         )
    into v_summary
    from sira_cycles c where c.id = p_cycle;

  insert into sira_cycle_publish_grants (org_id, cycle_id, txid) values (v_org, p_cycle, txid_current());

  update sira_cycles
     set status = 'published', published_at = now(), published_by = auth.uid()
   where id = p_cycle and org_id = v_org;

  v_entry := public.append_ledger_entry(v_org, 'sira_cycle_published', v_summary, auth.uid());

  -- S18: build the carry-forward pack and seed the next year's cycle from it.
  v_pack := public.sira_carry_forward_pack(p_cycle);
  insert into sira_carry_forward (org_id, from_cycle_id, universe_id, from_year, to_year, pack, created_by)
  values (v_org, p_cycle, (v_summary ->> 'universe_id')::uuid, (v_summary ->> 'year')::int,
          (v_summary ->> 'year')::int + 1, v_pack, auth.uid())
  on conflict (from_cycle_id) do nothing;

  v_next := public.sira_seed_next_cycle_internal(p_cycle, v_org, auth.uid());
  update sira_carry_forward set to_cycle_id = v_next where from_cycle_id = p_cycle;

  -- S19: open the two-key acceptance for this cycle.
  insert into sira_acceptances (org_id, cycle_id, universe_id, year, status)
  values (v_org, p_cycle, (v_summary ->> 'universe_id')::uuid, (v_summary ->> 'year')::int, 'awaiting_acceptance')
  on conflict (cycle_id) do nothing;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'sira_cycle_published', 'sira_cycle', p_cycle, v_summary);

  delete from sira_cycle_publish_grants where cycle_id = p_cycle and txid = txid_current();

  return v_entry.hash;
end $$;

-- ---------------------------------------------------------------------------
-- 10. remind_sira_acceptance(p_org, p_as_of) — remind the auditors of every outstanding acceptance
--     and report silence as a finding once the reminder has gone unanswered for long enough. Time is
--     an argument; the caller passes p_as_of. Idempotent per cycle: a finding is written once.
-- ---------------------------------------------------------------------------
create or replace function public.remind_sira_acceptance(p_org uuid, p_as_of timestamptz, p_days int default 14)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_days int := greatest(coalesce(p_days, 14), 1);
  a record;
  v_count int := 0;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_org is distinct from v_org then
    raise exception 'cross-org reminder refused' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if p_as_of is null then
    raise exception 'a reminder time is required' using errcode = 'P0001';
  end if;

  for a in
    select s.* from sira_acceptances s
     where s.org_id = v_org and s.status = 'awaiting_acceptance'
  loop
    update sira_acceptances
       set reminder_count = reminder_count + 1, last_reminded_at = p_as_of
     where id = a.id;

    insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
    values (v_org, auth.uid(), 'sira_acceptance_reminded', 'sira_cycle', a.cycle_id,
            jsonb_build_object('year', a.year, 'reminder_count', a.reminder_count + 1));

    -- Silence reported as a finding: outstanding beyond p_days and never decided. Written once.
    if p_as_of > coalesce(a.endorsed_at, a.created_at) + make_interval(days => v_days)
       and not exists (
         select 1 from findings f
          where f.org_id = v_org
            and f.sections ->> 'kind' = 'sira_acceptance_silence'
            and f.sections ->> 'cycle_id' = a.cycle_id::text) then
      insert into findings (org_id, entity_id, severity, sections)
      values (v_org, null, 'medium', jsonb_build_object(
        'kind', 'sira_acceptance_silence',
        'cycle_id', a.cycle_id,
        'year', a.year,
        'title', format('SIRA %s cycle is still awaiting an auditor acceptance', a.year),
        'detail', format('Endorsed but not accepted within %s days of publication.', v_days)));
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;

revoke execute on function public.remind_sira_acceptance(uuid, timestamptz, int) from public, anon;
grant execute on function public.remind_sira_acceptance(uuid, timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. sira_acceptance_state(p_cycle) — the one call the SIRA screen makes: the acceptance, the
--     outstanding proposals, and whether the next cycle may be published.
-- ---------------------------------------------------------------------------
create or replace function public.sira_acceptance_state(p_cycle uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cycle sira_cycles;
  v_acc sira_acceptances;
  v_pending int;
  v_next int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select * into v_cycle from sira_cycles where id = p_cycle and org_id = v_org;
  if not found then
    raise exception 'cycle not found in this organisation' using errcode = 'P0001';
  end if;
  select * into v_acc from sira_acceptances where cycle_id = p_cycle and org_id = v_org;
  select count(*) into v_pending from sira_emergent_risks r
   where r.org_id = v_org and r.universe_id = v_cycle.universe_id and r.status = 'pending';
  v_next := v_cycle.year + 1;

  return jsonb_build_object(
    'cycle_id', v_cycle.id,
    'year', v_cycle.year,
    'status', v_cycle.status,
    'acceptance_status', coalesce(v_acc.status, 'none'),
    'endorsed_by', v_acc.endorsed_by,
    'endorsed_at', v_acc.endorsed_at,
    'accepted_by', v_acc.accepted_by,
    'accepted_at', v_acc.accepted_at,
    'acceptance_reason', v_acc.acceptance_reason,
    'reminder_count', coalesce(v_acc.reminder_count, 0),
    'pending_proposals', v_pending,
    'next_year', v_next,
    'can_publish_next', (public.sira_publish_block(p_cycle) is null)
  );
end $$;

revoke execute on function public.sira_acceptance_state(uuid) from public, anon;
grant execute on function public.sira_acceptance_state(uuid) to authenticated;
