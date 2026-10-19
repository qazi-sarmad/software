-- Test 70 (S6.a): escalation rules and Work Queue proposals (F12).
--
-- Covers: the deterministic recommendation (no AI, no randomness); an escalation rule needs a
-- recommendation template; an escalation writes an escalation_events row, an in-app notification and
-- an optional Work Queue proposal; the targeted role sees the proposal and another role does not; a
-- CIA converts it through the normal flow; a disabled escalation entitlement is refused (F25); the
-- seeded platform templates exist.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The deterministic recommendation: first matching rule wins, and the fallback is "Needs review".
--    No AI, no randomness (L1).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare v_rec record;
begin
  select * into v_rec from public.escalation_recommendation(
    jsonb_build_object('severity','critical'),
    jsonb_build_array(
      jsonb_build_object('field','severity','equals','critical','recommend','Yes',
        'reason','A critical-severity anomaly was raised.'),
      jsonb_build_object('field','severity','equals','high','recommend','Yes',
        'reason','A high-severity anomaly was raised.')));
  perform provio_test.assert_eq(v_rec.recommendation, 'Yes', 'a critical severity recommends Yes');
  perform provio_test.assert_eq(v_rec.reason, 'A critical-severity anomaly was raised.',
    'the reason is filled from the matching rule');

  select * into v_rec from public.escalation_recommendation(
    jsonb_build_object('severity','low'),
    jsonb_build_array(
      jsonb_build_object('field','severity','equals','critical','recommend','Yes','reason','x'),
      jsonb_build_object('default_recommend','Needs review','default_reason','No rule matched.')));
  perform provio_test.assert_eq(v_rec.recommendation, 'Needs review',
    'no match falls back to the default recommendation');
  perform provio_test.assert_eq(v_rec.reason, 'No rule matched.', 'the default reason is used');

  -- An empty template still answers deterministically rather than erroring.
  select * into v_rec from public.escalation_recommendation('{}'::jsonb, '[]'::jsonb);
  perform provio_test.assert_eq(v_rec.recommendation, 'Needs review',
    'an empty template answers Needs review, not an error');
end $$;

-- The three platform template rules are seeded and enabled.
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from automation_rules
      where org_id is null and rule_key like 'platform.escalation.%' and enabled), 3::bigint,
    'three platform escalation templates are seeded and enabled');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Grant the escalation entitlement to Org A (F25).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'escalation', true, null, 'test grant');
end $$;

-- ---------------------------------------------------------------------------
-- 3. An escalation rule without a recommendation template is refused (L1). An ordinary Org Admin
--    (edit_config) saves one with a template.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_rule uuid;
begin
  perform provio_test.assert_raises(
    $q$select public.escalation_rule_save('a0000000-0000-0000-0000-000000000001', 'bad.rule',
      'Bad', 'anomaly.raised', '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('type','escalate','to_roles', jsonb_build_array('cia'))))$q$,
    'needs a recommendation template', 'a rule without a recommendation template is refused');

  v_rule := public.escalation_rule_save('a0000000-0000-0000-0000-000000000001', 'platform.escalation.high_anomaly',
    'Tenant override: escalate high anomalies', 'anomaly.raised',
    jsonb_build_array(jsonb_build_object('field','severity','operator','in','value','high,critical')),
    jsonb_build_array(jsonb_build_object('type','escalate','severity','high',
      'to_roles', jsonb_build_array('cia'), 'role_target','cia', 'create_proposal', true,
      'proposal_title','Mini-engagement draft',
      'recommendation', jsonb_build_array(
        jsonb_build_object('field','severity','equals','critical','recommend','Yes',
          'reason','A critical-severity anomaly was raised.'),
        jsonb_build_object('default_recommend','Needs review',
          'default_reason','An anomaly was raised; a person should review it.')))),
    true);
  perform provio_test.assert_true(v_rule is not null, 'an Org Admin saves an escalation rule');
  perform provio_test.assert_true(
    exists (select 1 from automation_rule_versions where entity_id = v_rule),
    'the escalation rule is hash-chained in its version history');
end $$;

-- ---------------------------------------------------------------------------
-- 4. An event raises the escalation: an escalation_events row, an in-app notification and a Work
--    Queue proposal. The engine runs as the owner (the dispatcher), never as a tenant session.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_event bigint;
  v_fired int;
  v_escalation uuid;
begin
  v_event := public.emit_event('a0000000-0000-0000-0000-000000000001', 'anomaly.raised',
    jsonb_build_object('severity','critical','entity','Bank charges','summary','Duplicate payments'));
  v_fired := public.escalation_evaluate(v_event);
  perform provio_test.assert_eq(v_fired, 1, 'one escalation fired');

  select id into v_escalation from escalation_events
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  perform provio_test.assert_true(v_escalation is not null, 'an escalation_events row was written');
  perform provio_test.assert_eq(
    (select recommendation from escalation_events where id = v_escalation), 'Yes',
    'the stored recommendation is deterministic');
  perform provio_test.assert_eq(
    (select reason from escalation_events where id = v_escalation),
    'A critical-severity anomaly was raised.', 'the stored reason is filled from the event fields');

  perform provio_test.assert_true(
    exists (select 1 from notifications
             where org_id = 'a0000000-0000-0000-0000-000000000001' and event_key = 'escalation.triggered'),
    'an in-app notification was written');

  perform provio_test.assert_true(
    exists (select 1 from work_queue_proposals
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and source_escalation_id = v_escalation and status = 'proposed'),
    'a Work Queue proposal was created');

  perform provio_test.assert_true(
    exists (select 1 from ledger_entries
             where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'escalation_triggered'),
    'the escalation is logged to the ledger');

  -- Re-evaluating the same event fires nothing more (idempotent per event).
  perform provio_test.assert_eq(public.escalation_evaluate(v_event), 0,
    're-evaluating an event fires no further escalation');
end $$;

-- ---------------------------------------------------------------------------
-- 5. The targeted role sees the proposal; a role not targeted does not.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.work_queue_proposal_list('a0000000-0000-0000-0000-000000000001')), 1::bigint,
    'the CIA sees the escalation proposal');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.work_queue_proposal_list('a0000000-0000-0000-0000-000000000001')), 0::bigint,
    'a role not targeted and without view_all_scopes sees nothing');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A CIA converts the proposal; a role without manage_engagements is refused. The id is captured
--    as the owner so a role that cannot read the table can still be tested.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare v_id uuid;
begin
  select id into v_id from work_queue_proposals
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform set_config('provio_test.proposal_id', v_id::text, false);
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
begin
  perform provio_test.assert_raises(
    format($q$select public.work_queue_proposal_decide('%s', 'converted')$q$,
           current_setting('provio_test.proposal_id')),
    'not allowed', 'a role without manage_engagements cannot convert a proposal');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_id uuid := current_setting('provio_test.proposal_id')::uuid;
begin
  perform public.work_queue_proposal_decide(v_id, 'converted');
  perform provio_test.assert_eq(
    (select status from public.work_queue_proposal_list('a0000000-0000-0000-0000-000000000001')
      where id = v_id), 'converted', 'the CIA converts the proposal');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Cross-org isolation: Org B sees no escalation and no proposal.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.escalation_event_list('b0000000-0000-0000-0000-000000000001')), 0::bigint,
    'Org B reads no Org A escalation');
  perform provio_test.assert_eq(
    (select count(*) from public.work_queue_proposal_list('b0000000-0000-0000-0000-000000000001')), 0::bigint,
    'Org B sees no Org A proposal');
end $$;

-- A tenant role reads only its own org's rows (RLS), and cannot write the table directly: every
-- write goes through a security-definer RPC.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into work_queue_proposals (org_id, kind, title) values ('a0000000-0000-0000-0000-000000000001', 'mini_engagement_draft', 'direct')$q$,
    'policy', 'a tenant role cannot insert a proposal directly');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Turning the escalation entitlement off refuses the write with the plan message (F25).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'escalation', false, null, 'test revoke');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.escalation_rule_save('a0000000-0000-0000-0000-000000000001', 'tenant.off',
      'Off', 'anomaly.raised', '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('type','escalate','to_roles', jsonb_build_array('cia'),
        'recommendation', jsonb_build_array(jsonb_build_object('default_recommend','Yes','default_reason','x')))))$q$,
    'not included in your plan', 'a disabled escalation feature refuses the write');
end $$;
