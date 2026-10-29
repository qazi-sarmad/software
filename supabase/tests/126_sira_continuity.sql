-- Test 126 (S18, S19): SIRA continuity and two-key acceptance.
-- Publishing builds a carry-forward pack and seeds the next cycle; open findings propose emergent
-- risks; the finaliser ENDORSES but a different auditor must ACCEPT; publication of the next cycle is
-- blocked while a proposal is outstanding; silence is reminded and reported as a finding.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a: publishing builds a carry-forward pack and seeds the next year's cycle, marked carried_forward.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  c uuid := 'a1000000-0000-0000-0000-0000000000a1';
  next_id uuid;
  pack jsonb;
begin
  perform public.publish_sira_cycle(c);

  select id into next_id from sira_cycles
   where universe_id = '30000000-0000-0000-0000-0000000000a1' and year = 2027;
  perform provio_test.assert_true(next_id is not null, 'S18: publishing seeds the next year''s cycle');

  perform provio_test.assert_eq(
    (select carried_forward from sira_scores where cycle_id = next_id and entity_id = '40000000-0000-0000-0000-0000000000a1'),
    true, 'S18: the seeded score is marked carried_forward');
  perform provio_test.assert_eq(
    (select carried_from_cycle_id from sira_scores where cycle_id = next_id and entity_id = '40000000-0000-0000-0000-0000000000a1'),
    c, 'S18: the seeded score names the cycle it came from');

  pack := public.sira_carry_forward_pack(c);
  perform provio_test.assert_eq(pack ->> 'from_year', '2026', 'S18: the pack records the from year');
  perform provio_test.assert_eq(pack ->> 'to_year', '2027', 'S18: the pack records the to year');
  perform provio_test.assert_true(jsonb_array_length(pack -> 'entities') = 1, 'S18: the pack lists one entity');

  perform provio_test.assert_true(
    exists (select 1 from sira_carry_forward where from_cycle_id = c and to_cycle_id = next_id),
    'S18: the carry-forward row links the two cycles');
end $$;
select provio_test.as_owner();

-- b: an open finding on the universe PROPOSES an emergent risk, once, pending for a human.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  n int;
begin
  -- The seed already holds one finding on A-E1 (the U1 universe's entity). Proposing picks it up.
  n := public.propose_emergent_risks('a1000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(n, 1, 'S18: an open finding proposes one emergent risk');
  n := public.propose_emergent_risks('a1000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(n, 0, 'S18: re-running proposes nothing again (idempotent)');
  perform provio_test.assert_eq(
    (select count(*) from sira_emergent_risks where source_kind = 'finding'), 1::bigint,
    'S18: the proposal records the finding as its source');
  perform provio_test.assert_eq(
    (select status from sira_emergent_risks where source_kind = 'finding'), 'pending',
    'S18: the proposal starts pending for a human');
end $$;
select provio_test.as_owner();

-- c: publication of the next cycle is blocked while a proposal is outstanding.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  next_id uuid;
  blk text;
begin
  select id into next_id from sira_cycles
   where universe_id = '30000000-0000-0000-0000-0000000000a1' and year = 2027;
  blk := public.sira_publish_block(next_id);
  perform provio_test.assert_true(blk like '%outstanding%', 'S19: a pending proposal blocks publication');
  perform provio_test.assert_raises(
    format($q$select public.publish_sira_cycle(%L)$q$, next_id),
    'outstanding', 'S19: publishing a cycle with an outstanding proposal is refused');
end $$;
select provio_test.as_owner();

-- d: the finaliser endorses; the same person cannot accept; a different auditor can.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.endorse_sira_cycle('a1000000-0000-0000-0000-0000000000a1', 'The environment is stable');
  perform provio_test.assert_eq(
    (select status from sira_acceptances where cycle_id = 'a1000000-0000-0000-0000-0000000000a1'),
    'awaiting_acceptance', 'S19: an endorsement leaves the cycle awaiting acceptance');
  perform provio_test.assert_raises(
    $q$select public.decide_sira_acceptance('a1000000-0000-0000-0000-0000000000a1', 'accepted', 'I am satisfied it is complete')$q$,
    'second person', 'S19: the finaliser cannot also accept');
end $$;
select provio_test.as_owner();

-- A reviewer (review_and_approve, not the finaliser) accepts.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.decide_sira_acceptance('a1000000-0000-0000-0000-0000000000a1', 'accepted', 'short')$q$,
    'at least 10 characters', 'S19: an acceptance reason is required');
  perform public.decide_sira_acceptance('a1000000-0000-0000-0000-0000000000a1', 'accepted', 'Reviewed and satisfied');
  perform provio_test.assert_eq(
    (select status from sira_acceptances where cycle_id = 'a1000000-0000-0000-0000-0000000000a1'),
    'accepted', 'S19: a different auditor accepts the cycle');
end $$;
select provio_test.as_owner();

-- e: with the proposal resolved and the acceptance recorded, the next cycle may publish.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  r uuid;
  next_id uuid;
  blk text;
begin
  select id into r from sira_emergent_risks where source_kind = 'finding';
  perform public.decide_emergent_risk(r, 'accepted', 'Relevant to next year''s plan');
  select id into next_id from sira_cycles
   where universe_id = '30000000-0000-0000-0000-0000000000a1' and year = 2027;
  blk := public.sira_publish_block(next_id);
  perform provio_test.assert_true(blk is null, 'S19: nothing blocks the next cycle once resolved');
end $$;
select provio_test.as_owner();

-- f: silence is reminded and reported as a finding. Use an Org A cycle in another universe.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  c2 uuid;
  raised int;
begin
  c2 := public.create_sira_cycle('30000000-0000-0000-0000-0000000000a2', 2026);
  perform public.publish_sira_cycle(c2);
  perform public.endorse_sira_cycle(c2, 'Endorsed');
  -- p_as_of is well past the reminder window, so silence is reported.
  raised := public.remind_sira_acceptance('a0000000-0000-0000-0000-000000000001', now() + interval '30 days', 14);
  perform provio_test.assert_eq(raised, 1, 'S19: an unanswered acceptance is reported as a finding');
  perform provio_test.assert_true(
    exists (select 1 from findings where sections ->> 'kind' = 'sira_acceptance_silence'),
    'S19: the silence finding is written');
  perform provio_test.assert_true(
    (select reminder_count from sira_acceptances where cycle_id = c2) >= 1,
    'S19: the reminder count is recorded');
end $$;
select provio_test.as_owner();

-- g: acceptance_state reports what the screen needs.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  s jsonb;
begin
  s := public.sira_acceptance_state('a1000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(s ->> 'acceptance_status', 'accepted', 'S19: state reports the acceptance status');
  perform provio_test.assert_eq(s ->> 'next_year', '2027', 'S18: state reports the next year');
end $$;
select provio_test.as_owner();

-- h: cross-org and anonymous refusal.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  n bigint;
begin
  select count(*) into n from sira_acceptances;
  perform provio_test.assert_eq(n, 0::bigint, 'S19: Org B sees no Org A acceptance (RLS)');
  select count(*) into n from sira_carry_forward;
  perform provio_test.assert_eq(n, 0::bigint, 'S18: Org B sees no Org A carry-forward (RLS)');
  perform provio_test.assert_raises(
    $q$select public.sira_acceptance_state('a1000000-0000-0000-0000-0000000000a1')$q$,
    'not found in this organisation', 'S19: Org B cannot read an Org A acceptance state');
end $$;
select provio_test.as_owner();

select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sira_carry_forward_pack('a1000000-0000-0000-0000-0000000000a1')$q$,
    null, 'an anonymous caller cannot read a carry-forward pack');
  perform provio_test.assert_raises(
    $q$select public.endorse_sira_cycle('a1000000-0000-0000-0000-0000000000a1', 'x')$q$,
    null, 'an anonymous caller cannot endorse a cycle');
end $$;
select provio_test.as_owner();

-- Restore the seed (M5: no residue).
select provio_test.seed();
