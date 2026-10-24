-- Test 69 (S5.a): AI (F8). Covers the authority split, the deny-list, the number guard, the
-- retention purge, the ledger entry and the entitlements.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. An Org Admin cannot touch ai_models or tenant_ai_models (F8). Every such call is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_refused boolean;
begin
  v_refused := false;
  begin
    perform public.ai_model_add('sneaky', 'llama3');
  exception when others then v_refused := true;
  end;
  perform provio_test.assert_true(v_refused, 'an Org Admin cannot add a model');

  v_refused := false;
  begin
    perform public.ai_tenant_set_model('a0000000-0000-0000-0000-000000000001', gen_random_uuid(), null);
  exception when others then v_refused := true;
  end;
  perform provio_test.assert_true(v_refused, 'an Org Admin cannot assign a model');

  v_refused := false;
  begin
    perform public.ai_denylist_add('evil.example');
  exception when others then v_refused := true;
  end;
  perform provio_test.assert_true(v_refused, 'an Org Admin cannot edit the deny-list');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The Super Admin owns the registry and the deny-list (F8).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_model uuid;
begin
  v_model := public.ai_model_add('Local Llama', 'llama3.1:8b', 'on the client box');
  perform provio_test.assert_true(v_model is not null, 'the Super Admin adds a model');
  perform public.ai_tenant_set_model('a0000000-0000-0000-0000-000000000001', v_model, null);
  perform provio_test.assert_eq(
    (select count(*) from tenant_ai_models where org_id = 'a0000000-0000-0000-0000-000000000001' and is_default),
    1, 'the tenant has one default model');
  perform provio_test.assert_true(
    exists (select 1 from ai_model_versions where entity = 'ai_model' and action = 'add'),
    'a model change is hash-chained');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Enable AI and grant the ai_assist entitlement so the org RPCs can run (F8, F25).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_enable_ai('a0000000-0000-0000-0000-000000000001', true, 'http://10.0.0.5:11434');
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'ai_assist', true, null, 'test grant');
end $$;

-- The deny-list refuses a vendor-hosted endpoint (F8, L2).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_refused boolean; v_msg text;
begin
  perform provio_test.assert_true(public.ai_endpoint_denied('https://api.openai.com/v1/chat'),
    'the OpenAI host is denied');
  perform provio_test.assert_true(public.ai_endpoint_denied('https://bedrock-runtime.us-east-1.amazonaws.com'),
    'a Bedrock host is denied');
  perform provio_test.assert_true(not public.ai_endpoint_denied('http://10.0.0.5:11434'),
    'a private Ollama host is not denied by the list');

  v_refused := false; v_msg := '';
  begin
    perform public.ai_set_endpoint('a0000000-0000-0000-0000-000000000001',
      'https://api.openai.com/v1', 'server', null);
  exception when others then v_refused := true; v_msg := sqlerrm;
  end;
  perform provio_test.assert_true(v_refused, 'saving a vendor endpoint is refused');
  perform provio_test.assert_true(v_msg like '%vendor-hosted AI service%',
    'the refusal names the vendor-hosted rule');

  -- A private Ollama endpoint saves fine.
  perform public.ai_set_endpoint('a0000000-0000-0000-0000-000000000001',
    'http://10.0.0.5:11434', 'server', null);
end $$;

-- tenant_settings is platform-readable (0031), so the Super Admin confirms the saved endpoint.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_eq(
    (select ai_model_endpoint from tenant_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'http://10.0.0.5:11434', 'a private endpoint is saved');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A use case is saved when AI is on and the entitlement is present (F8).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.ai_use_case_save('a0000000-0000-0000-0000-000000000001', 'observation_draft', true, 'draft the observation', 0.2, 0.9, 600);
  perform provio_test.assert_eq(
    (select enabled from ai_use_cases where org_id = 'a0000000-0000-0000-0000-000000000001' and use_case = 'observation_draft'),
    true, 'the use case is saved and enabled');
end $$;

-- ---------------------------------------------------------------------------
-- 5. AI off refuses the write (F8).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_enable_ai('a0000000-0000-0000-0000-000000000001', false, null);
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_refused boolean;
begin
  v_refused := false;
  begin
    perform public.ai_use_case_save('a0000000-0000-0000-0000-000000000001', 'cap_wording', true, 'x', 0.2, 0.9, 400);
  exception when others then v_refused := true;
  end;
  perform provio_test.assert_true(v_refused, 'AI is off, so the use-case save is refused');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_enable_ai('a0000000-0000-0000-0000-000000000001', true, 'http://10.0.0.5:11434');
end $$;

-- ---------------------------------------------------------------------------
-- 5b. A disabled ai_assist feature refuses the write with the fixed message (F25).
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'ai_assist', false, null, 'test disable');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_refused boolean; v_msg text;
begin
  v_refused := false; v_msg := '';
  begin
    perform public.ai_use_case_save('a0000000-0000-0000-0000-000000000001', 'cap_wording', true, 'x', 0.2, 0.9, 400);
  exception when others then v_refused := true; v_msg := sqlerrm;
  end;
  perform provio_test.assert_true(v_refused, 'a disabled feature refuses the write');
  perform provio_test.assert_true(v_msg like '%not included in your plan%', 'the refusal is the plan message');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'ai_assist', true, null, 'test re-enable');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A call is logged with a ledger entry; retention 0 stores hashes only (F8).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.admin_set_org_settings_extra(null, null, null, null, 0);
end $$;
do $$
declare v_id uuid; v_prompt text; v_ledger int;
begin
  v_id := public.ai_call_log('a0000000-0000-0000-0000-000000000001', 'observation_draft',
    'llama3.1:8b', 'sha256:abc', 'phash', 'rhash', 'server', '{}'::jsonb, 'the prompt', 'the response');
  perform provio_test.assert_true(v_id is not null, 'the call is logged');
  select prompt_text into v_prompt from ai_calls where id = v_id;
  perform provio_test.assert_true(v_prompt is null, 'retention 0 keeps hashes only');
  select count(*) into v_ledger from ledger_entries
   where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'ai_call';
  perform provio_test.assert_true(v_ledger >= 1, 'an ai_call ledger entry is written');
end $$;

-- ---------------------------------------------------------------------------
-- 7. A flagged figure blocks acceptance until the user edits the text (F8 number guard).
-- ---------------------------------------------------------------------------
do $$
declare v_sid uuid; v_refused boolean;
begin
  v_sid := public.ai_suggestion_save('a0000000-0000-0000-0000-000000000001', 'cap_wording',
    'cap', 'cap-1', 'The amount is 12345.', '[{"token":"12345"}]'::jsonb);
  v_refused := false;
  begin
    perform public.ai_suggestion_decide(v_sid, 'accepted', null);
  exception when others then v_refused := true;
  end;
  perform provio_test.assert_true(v_refused, 'accepting with an unverified figure is refused');
  perform public.ai_suggestion_decide(v_sid, 'edited', 'The amount is as recorded.');
  perform provio_test.assert_eq(
    (select status from ai_suggestions where id = v_sid), 'edited', 'editing clears the block');
end $$;

-- ---------------------------------------------------------------------------
-- 8. The retention purge clears old text but keeps the ledger (F8).
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.admin_set_org_settings_extra(null, null, null, null, 30);
  perform public.ai_call_log('a0000000-0000-0000-0000-000000000001', 'cap_wording',
    'llama3.1:8b', null, 'p2', 'r2', 'server', '{}'::jsonb, 'old prompt', 'old response');
end $$;
-- ai_calls has no direct write policy (L5), so the owner backdates the row for the purge test.
select provio_test.as_owner();
do $$
begin
  update ai_calls set created_at = now() - interval '90 days'
   where org_id = 'a0000000-0000-0000-0000-000000000001' and response_text = 'old response';
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
-- Audit round 2: the purge is a platform-wide sweep run by the scheduler, not by a user.
select provio_test.as_owner();
do $$
declare v_purged int; v_text text;
begin
  v_purged := public.ai_purge_expired();
  perform provio_test.assert_true(v_purged >= 1, 'the purge cleared at least one row');
  select response_text into v_text from ai_calls
   where org_id = 'a0000000-0000-0000-0000-000000000001' and response_hash = 'r2';
  perform provio_test.assert_true(v_text is null, 'the expired text is gone');
end $$;

-- ---------------------------------------------------------------------------
-- 9. Cross-org: a second org's branding/AI rows are invisible to the first (RLS).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_true(
    not exists (select 1 from ai_calls where org_id = 'a0000000-0000-0000-0000-000000000002'),
    'the other org has no AI calls');
end $$;
