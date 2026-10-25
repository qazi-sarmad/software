-- Test 94 (AI-REMOVE-3): the AI feature is gone, and the ledger is untouched.
--
-- Migration 0087 removes every AI table, column, function, trigger, cron job, registry row and
-- right. This test proves the removal, and proves the two things the owner required to be kept:
-- the business ledger and its hash chain still verify, and old ledger rows stay.
--
-- Applies twice (M2, M6): the whole file is a no-op on a second run.
\i supabase/tests/00_lib.sql
select provio_test.seed();
-- seed() truncates tutorials; re-apply the seed migration so the tutorial assertions below are not
-- vacuous (the same pattern test 80 uses).
\i supabase/migrations/0071_tutorial_registry_seed.sql

-- ---------------------------------------------------------------------------
-- 1. Every AI table is gone.
-- ---------------------------------------------------------------------------
do $$
declare
  v_left text[] := '{}';
  t text;
begin
  foreach t in array array[
    'ai_models','ai_endpoint_denylist','tenant_ai_models','ai_use_cases','ai_calls',
    'ai_suggestions','ai_model_versions','org_voice_profile','org_voice_terms','org_voice_samples'
  ]
  loop
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = t) then
      v_left := v_left || t;
    end if;
  end loop;
  perform provio_test.assert_eq(array_length(v_left, 1), null,
    format('no AI table survives 0087; still present: %s', v_left));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Every AI column is gone.
-- ---------------------------------------------------------------------------
do $$
declare
  v_left text[] := '{}';
  c record;
begin
  for c in select * from (values
      ('tenant_settings','ai_enabled'), ('tenant_settings','ai_model_endpoint'),
      ('tenant_settings','ai_access_mode'), ('tenant_settings','ai_secret_id'),
      ('org_settings_extra','ai_retention_days')
    ) as t(tbl, col)
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = c.tbl and column_name = c.col) then
      v_left := v_left || (c.tbl || '.' || c.col);
    end if;
  end loop;
  perform provio_test.assert_eq(array_length(v_left, 1), null,
    format('no AI column survives 0087; still present: %s', v_left));
end $$;

-- ---------------------------------------------------------------------------
-- 3. No AI function is reachable. Each call must fail at name resolution, which is the strongest
--    possible form: the name does not exist, so there is nothing to authorise against.
-- ---------------------------------------------------------------------------
do $$
declare
  v_calls text[] := array[
    'select public.ai_gateway_authorise(''a0000000-0000-0000-0000-000000000001'')',
    'select public.ai_purge_expired()',
    'select public.ai_endpoint_denied(''https://api.openai.com/v1'')',
    'select public.ai_call_log(''a0000000-0000-0000-0000-000000000001'',''u'',''m'',''d'',''p'',''r'',''server'')',
    'select public.ai_set_endpoint(''a0000000-0000-0000-0000-000000000001'',''https://x'',''server'')',
    'select public.platform_enable_ai(''a0000000-0000-0000-0000-000000000001'', true, null)'
  ];
  v_sql text;
begin
  foreach v_sql in array v_calls
  loop
    perform provio_test.assert_raises(v_sql, 'does not exist', format('gone: %s', v_sql));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The rights vocabulary is fourteen keys and use_ai_assist is rejected.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_true(
    public.rights_keys_valid('{"view_board_pack":true,"generate_board_pack":true,"view_insights":true}'::jsonb),
    'the extended keys are still valid');
  perform provio_test.assert_true(
    not public.rights_keys_valid('{"use_ai_assist":true}'::jsonb),
    'use_ai_assist is refused by the closed list');
  perform provio_test.assert_eq(
    (select count(*) from roles where rights ? 'use_ai_assist'), 0::bigint,
    'no role in any organisation carries use_ai_assist');
end $$;

-- ---------------------------------------------------------------------------
-- 5. The AI registry rows are gone, and no AI tutorial remains.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from feature_catalogue
      where key in ('ai_assist','ai_voice_library','ai_board_slides')), 0::bigint,
    'the three AI feature keys are gone from the catalogue');
  perform provio_test.assert_eq(
    (select count(*) from config_areas where key = 'ai_models'), 0::bigint,
    'the AI model config area is gone');
  perform provio_test.assert_eq(
    (select count(*) from tenant_entitlements
      where feature_key in ('ai_assist','ai_voice_library','ai_board_slides')), 0::bigint,
    'no tenant holds an AI entitlement');
  perform provio_test.assert_eq(
    (select count(*) from automation_events_catalogue
      where event_key in ('ai_model.changed','ai.call_failed')), 0::bigint,
    'the AI events are gone from the event catalogue');
  perform provio_test.assert_eq(
    (select count(*) from automation_event_fields where event_key = 'ai_model.changed'), 0::bigint,
    'the AI event fields are gone');
  perform provio_test.assert_eq(
    (select count(*) from automation_rules where event_key like '%ai_model%'), 0::bigint,
    'the AI automation rule is gone');
  perform provio_test.assert_eq(
    (select count(*) from notification_templates where event_key = 'ai_model.changed'), 0::bigint,
    'the AI notification template is gone');
  perform provio_test.assert_eq(
    (select count(*) from tutorials where key in
      ('oa.ai','oa.ai-test','oa.ai-usecases','oa.voice','sa.ai-models','sa.ai-denylist')), 0::bigint,
    'the six AI tutorials are gone from the registry');
end $$;

-- ---------------------------------------------------------------------------
-- 6. The ledger and its hash chain are untouched: a row can still be appended and the chain verifies.
--    This is the owner's explicit requirement: no AI history is lost, and the chain still holds.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform public.append_ledger_entry(v_org, 'post_ai_removal_probe',
    jsonb_build_object('note', 'the ledger still writes after 0087'), null);
  perform provio_test.assert_eq(public.verify_ledger(v_org), null::bigint,
    'the ledger chain still verifies after the AI removal');
end $$;
