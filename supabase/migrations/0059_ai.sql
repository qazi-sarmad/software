-- 0059: AI (S5.a, F8). Ollama-compatible, self-hosted endpoints only; advisory; labelled; separate
-- from the deterministic record until a user accepts.
--
-- Laws: L1 (no AI in any test result, sample, score, gate, finding status or check) and L2 (tenant
-- data never leaves its tenant boundary and never reaches a vendor-hosted model).
--
-- Authority split (F8): the Super Admin owns the master switch (tenant_settings.ai_enabled, 0031),
-- the model registry (ai_models), the endpoint deny-list (ai_endpoint_denylist) and the per-tenant
-- default model (tenant_ai_models). The Org Admin (when enabled) owns the endpoint override, the
-- bearer token (Vault/secret_store, 0054), the access mode, use-case toggles, prompts and
-- parameters, fallback, retention and the voice library. An Org Admin call that touches ai_models or
-- tenant_ai_models is refused (SQL test 69).
--
-- The AI model registry is registered in config_areas as platform_only (0051), so a model change
-- emits ai_model.changed and notifies platform recipients only (F7).
--
-- M1: grepped supabase/migrations and supabase/tests for ai_models, ai_endpoint_denylist,
--     ai_use_cases, ai_calls, ai_suggestions, tenant_ai_models, org_voice_profile, org_voice_terms,
--     org_voice_samples, ai_endpoint_denied, ai_model_add, ai_use_case_save, ai_suggestion_save,
--     ai_call_log; none existed. ai_model_versions (0051) exists and is extended, not recreated.
-- M2: create table if not exists + add column if not exists; create or replace; drop trigger/policy
--     if exists before create; create index if not exists. Safe to apply repeatedly.

-- ---------------------------------------------------------------------------
-- 1. ai_models — the platform model registry (F8, platform_only). Super Admin only.
-- ---------------------------------------------------------------------------
create table if not exists ai_models (
  id uuid primary key default gen_random_uuid()
);
alter table ai_models add column if not exists name text not null default '';
alter table ai_models add column if not exists provider text not null default 'ollama';
alter table ai_models add column if not exists model_ref text not null default '';
alter table ai_models add column if not exists notes text;
alter table ai_models add column if not exists status text not null default 'live';
alter table ai_models add column if not exists created_by uuid;
alter table ai_models add column if not exists created_at timestamptz not null default now();
alter table ai_models add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_models_status_chk') then
    alter table ai_models add constraint ai_models_status_chk check (status in ('live','parked'));
  end if;
end $$;

alter table ai_models enable row level security;
drop policy if exists ai_models_select on ai_models;
create policy ai_models_select on ai_models for select to authenticated
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 1b. Extend tenant_settings (0031) with the AI access mode and the bearer-token secret id (F8).
--     M1: tenant_settings exists in 0031 with ai_enabled and ai_model_endpoint; extend, do not
--     recreate. M2: add column if not exists, so a second apply is a no-op.
-- ---------------------------------------------------------------------------
alter table tenant_settings add column if not exists ai_access_mode text not null default 'server';
alter table tenant_settings add column if not exists ai_secret_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_settings_ai_access_mode_chk') then
    alter table tenant_settings add constraint tenant_settings_ai_access_mode_chk
      check (ai_access_mode in ('server','browser'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. ai_endpoint_denylist — vendor AI API hosts the platform refuses (F8). Super Admin edits it.
-- ---------------------------------------------------------------------------
create table if not exists ai_endpoint_denylist (
  id uuid primary key default gen_random_uuid()
);
alter table ai_endpoint_denylist add column if not exists pattern text not null default '';
alter table ai_endpoint_denylist add column if not exists label text;
alter table ai_endpoint_denylist add column if not exists created_at timestamptz not null default now();

alter table ai_endpoint_denylist enable row level security;
drop policy if exists ai_endpoint_denylist_select on ai_endpoint_denylist;
create policy ai_endpoint_denylist_select on ai_endpoint_denylist for select to authenticated
  using (auth.uid() is not null);

-- M2: a unique pattern makes the seed below idempotent, so a second apply adds no duplicate row.
create unique index if not exists ai_endpoint_denylist_pattern_uidx on ai_endpoint_denylist (pattern);

insert into ai_endpoint_denylist (pattern, label) values
  ('api.openai.com','OpenAI'),
  ('api.anthropic.com','Anthropic'),
  ('generativelanguage.googleapis.com','Google Gemini'),
  ('api.mistral.ai','Mistral'),
  ('api.cohere.com','Cohere'),
  ('api.groq.com','Groq'),
  ('openrouter.ai','OpenRouter'),
  ('api.together.xyz','Together'),
  ('api.deepseek.com','DeepSeek'),
  ('api.x.ai','xAI'),
  ('api.perplexity.ai','Perplexity'),
  ('api.fireworks.ai','Fireworks'),
  ('.openai.azure.com','Azure OpenAI'),
  ('bedrock-runtime.','Amazon Bedrock'),
  ('api-inference.huggingface.co','Hugging Face Inference'),
  ('.endpoints.huggingface.cloud','Hugging Face Endpoints'),
  ('api.replicate.com','Replicate')
on conflict (pattern) do nothing;

-- ---------------------------------------------------------------------------
-- 3. tenant_ai_models — the per-tenant default model and per-use-case override (F8). Super Admin
--    writes it; the Org Admin can never add, remove, change or choose a model.
-- ---------------------------------------------------------------------------
create table if not exists tenant_ai_models (
  id uuid primary key default gen_random_uuid()
);
alter table tenant_ai_models add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table tenant_ai_models add column if not exists model_id uuid references ai_models(id) on delete cascade;
alter table tenant_ai_models add column if not exists use_case text;
alter table tenant_ai_models add column if not exists is_default boolean not null default false;
alter table tenant_ai_models add column if not exists created_by uuid;
alter table tenant_ai_models add column if not exists created_at timestamptz not null default now();

alter table tenant_ai_models enable row level security;
drop policy if exists tenant_ai_models_select on tenant_ai_models;
create policy tenant_ai_models_select on tenant_ai_models for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create index if not exists tenant_ai_models_org_idx on tenant_ai_models (org_id, use_case);

-- ---------------------------------------------------------------------------
-- 4. ai_use_cases — per-tenant use-case toggles and parameters (F8). Org Admin (when enabled).
-- ---------------------------------------------------------------------------
create table if not exists ai_use_cases (
  id uuid primary key default gen_random_uuid()
);
alter table ai_use_cases add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table ai_use_cases add column if not exists use_case text not null default '';
alter table ai_use_cases add column if not exists enabled boolean not null default false;
alter table ai_use_cases add column if not exists system_prompt text;
alter table ai_use_cases add column if not exists temperature numeric(3,2) not null default 0.20;
alter table ai_use_cases add column if not exists top_p numeric(3,2) not null default 0.90;
alter table ai_use_cases add column if not exists max_tokens int;
alter table ai_use_cases add column if not exists updated_by uuid;
alter table ai_use_cases add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_use_cases_key_chk') then
    alter table ai_use_cases add constraint ai_use_cases_key_chk check (use_case in (
      'observation_draft','cap_wording','board_slides','anomaly_explain','exec_summary',
      'report_wording','risk_wording'));
  end if;
end $$;

alter table ai_use_cases enable row level security;
drop policy if exists ai_use_cases_select on ai_use_cases;
create policy ai_use_cases_select on ai_use_cases for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create unique index if not exists ai_use_cases_org_key_uidx on ai_use_cases (org_id, use_case);

-- ---------------------------------------------------------------------------
-- 5. ai_calls — the AI call log (F8). Prompt and response text live only for the retention window;
--    the ledger keeps the hashes forever. The retention purge (pg_cron) deletes the text columns.
-- ---------------------------------------------------------------------------
create table if not exists ai_calls (
  id uuid primary key default gen_random_uuid()
);
alter table ai_calls add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table ai_calls add column if not exists use_case text;
alter table ai_calls add column if not exists model_name text;
alter table ai_calls add column if not exists model_digest text;
alter table ai_calls add column if not exists prompt_hash text;
alter table ai_calls add column if not exists response_hash text;
alter table ai_calls add column if not exists prompt_text text;
alter table ai_calls add column if not exists response_text text;
alter table ai_calls add column if not exists access_mode text;
alter table ai_calls add column if not exists flags jsonb not null default '{}'::jsonb;
alter table ai_calls add column if not exists actor uuid;
alter table ai_calls add column if not exists created_at timestamptz not null default now();

alter table ai_calls enable row level security;
drop policy if exists ai_calls_select on ai_calls;
create policy ai_calls_select on ai_calls for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create index if not exists ai_calls_org_idx on ai_calls (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. ai_suggestions — a wording suggestion, kept OUT of the record until a user accepts it (F8).
-- ---------------------------------------------------------------------------
create table if not exists ai_suggestions (
  id uuid primary key default gen_random_uuid()
);
alter table ai_suggestions add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table ai_suggestions add column if not exists use_case text;
alter table ai_suggestions add column if not exists record_type text;
alter table ai_suggestions add column if not exists record_id text;
alter table ai_suggestions add column if not exists status text not null default 'suggested';
alter table ai_suggestions add column if not exists text text;
alter table ai_suggestions add column if not exists flagged_figures jsonb not null default '[]'::jsonb;
alter table ai_suggestions add column if not exists accepted_text text;
alter table ai_suggestions add column if not exists created_by uuid;
alter table ai_suggestions add column if not exists created_at timestamptz not null default now();
alter table ai_suggestions add column if not exists decided_by uuid;
alter table ai_suggestions add column if not exists decided_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_suggestions_status_chk') then
    alter table ai_suggestions add constraint ai_suggestions_status_chk
      check (status in ('suggested','accepted','edited','rejected'));
  end if;
end $$;

alter table ai_suggestions enable row level security;
drop policy if exists ai_suggestions_select on ai_suggestions;
create policy ai_suggestions_select on ai_suggestions for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create index if not exists ai_suggestions_org_idx on ai_suggestions (org_id, record_type, record_id);

-- ---------------------------------------------------------------------------
-- 7. Voice library (F8): org_voice_profile, org_voice_terms, org_voice_samples.
-- ---------------------------------------------------------------------------
create table if not exists org_voice_profile (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table org_voice_profile add column if not exists tone text not null default 'neutral';
alter table org_voice_profile add column if not exists person text not null default 'third';
alter table org_voice_profile add column if not exists length text not null default 'standard';
alter table org_voice_profile add column if not exists custom_instructions text;
alter table org_voice_profile add column if not exists updated_by uuid;
alter table org_voice_profile add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_voice_profile_tone_chk') then
    alter table org_voice_profile add constraint org_voice_profile_tone_chk
      check (tone in ('formal','neutral','concise'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_voice_profile_length_chk') then
    alter table org_voice_profile add constraint org_voice_profile_length_chk
      check (length in ('brief','standard','detailed'));
  end if;
end $$;

alter table org_voice_profile enable row level security;
drop policy if exists org_voice_profile_select on org_voice_profile;
create policy org_voice_profile_select on org_voice_profile for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create table if not exists org_voice_terms (
  id uuid primary key default gen_random_uuid()
);
alter table org_voice_terms add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table org_voice_terms add column if not exists preferred_phrase text;
alter table org_voice_terms add column if not exists avoid_phrase text;
alter table org_voice_terms add column if not exists glossary_term text;
alter table org_voice_terms add column if not exists definition text;
alter table org_voice_terms add column if not exists created_by uuid;
alter table org_voice_terms add column if not exists created_at timestamptz not null default now();

alter table org_voice_terms enable row level security;
drop policy if exists org_voice_terms_select on org_voice_terms;
create policy org_voice_terms_select on org_voice_terms for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create table if not exists org_voice_samples (
  id uuid primary key default gen_random_uuid()
);
alter table org_voice_samples add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table org_voice_samples add column if not exists kind text not null default 'observation';
alter table org_voice_samples add column if not exists title text;
alter table org_voice_samples add column if not exists text text;
alter table org_voice_samples add column if not exists source text;
alter table org_voice_samples add column if not exists created_by uuid;
alter table org_voice_samples add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_voice_samples_kind_chk') then
    alter table org_voice_samples add constraint org_voice_samples_kind_chk
      check (kind in ('observation','finding','cap','report','board'));
  end if;
end $$;

alter table org_voice_samples enable row level security;
drop policy if exists org_voice_samples_select on org_voice_samples;
create policy org_voice_samples_select on org_voice_samples for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 8. ai_endpoint_denied(p_url) — true when a URL matches a vendor AI host (F8). Pure SQL so both
--    the app and the SQL test can use it; the Edge gateway calls it before a server-mode call.
-- ---------------------------------------------------------------------------
create or replace function public.ai_endpoint_denied(p_url text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ai_endpoint_denylist d
     where p_url is not null
       and (
         lower(p_url) like '%' || lower(d.pattern) || '%'
       )
  )
$$;

-- ---------------------------------------------------------------------------
-- 9. Platform RPCs: the model registry and the deny-list (F8). Super Admin only.
-- ---------------------------------------------------------------------------
create or replace function public.ai_model_add(
  p_name text, p_model_ref text, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_platform_admin();
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_model_ref), '') = '' then
    raise exception 'a model name and a model reference are required' using errcode = 'P0001';
  end if;
  insert into ai_models (name, model_ref, notes, created_by)
  values (p_name, p_model_ref, p_notes, auth.uid())
  returning id into v_id;
  insert into ai_model_versions (entity, entity_id, action, payload, actor)
  values ('ai_model', v_id::text, 'add', jsonb_build_object('name', p_name, 'model_ref', p_model_ref), auth.uid());
  perform public.platform_log('ai_model_added', null, 'ai_model', v_id, jsonb_build_object('name', p_name));
  return v_id;
end $$;

create or replace function public.ai_model_remove(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  delete from ai_models where id = p_id;
  insert into ai_model_versions (entity, entity_id, action, payload, actor)
  values ('ai_model', p_id::text, 'remove', '{}'::jsonb, auth.uid());
  perform public.platform_log('ai_model_removed', null, 'ai_model', p_id, '{}'::jsonb);
end $$;

create or replace function public.ai_model_update(p_id uuid, p_name text, p_model_ref text, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  if p_status not in ('live','parked') then
    raise exception 'unknown model status: %', p_status using errcode = 'P0001';
  end if;
  update ai_models set name = p_name, model_ref = p_model_ref, status = p_status, updated_at = now()
   where id = p_id;
  insert into ai_model_versions (entity, entity_id, action, payload, actor)
  values ('ai_model', p_id::text, 'update',
    jsonb_build_object('name', p_name, 'model_ref', p_model_ref, 'status', p_status), auth.uid());
  perform public.platform_log('ai_model_updated', null, 'ai_model', p_id, jsonb_build_object('status', p_status));
end $$;

-- Assign a tenant's default model (or a per-use-case override). Super Admin only.
create or replace function public.ai_tenant_set_model(
  p_org uuid, p_model_id uuid, p_use_case text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  if p_use_case is null then
    update tenant_ai_models set is_default = false where org_id = p_org and is_default;
  end if;
  insert into tenant_ai_models (org_id, model_id, use_case, is_default, created_by)
  values (p_org, p_model_id, p_use_case, p_use_case is null, auth.uid());
  perform public.platform_log('ai_tenant_model_set', p_org, 'tenant', p_org,
    jsonb_build_object('model_id', p_model_id, 'use_case', p_use_case));
end $$;

-- The deny-list editor (F8). Super Admin only. A pattern that matches a vendor host is what is
-- stored; the write refuses a pattern that is blank.
create or replace function public.ai_denylist_add(p_pattern text, p_label text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_platform_admin();
  if coalesce(trim(p_pattern), '') = '' then
    raise exception 'a pattern is required' using errcode = 'P0001';
  end if;
  insert into ai_endpoint_denylist (pattern, label) values (lower(p_pattern), p_label)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ai_denylist_remove(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  delete from ai_endpoint_denylist where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Org RPCs: use-case settings, the endpoint override and the voice library (F8). An Org Admin
--     (edit_config) when ai_enabled and the ai_assist entitlement; a consultant may act too (F4).
--     None of these touch ai_models or tenant_ai_models.
-- ---------------------------------------------------------------------------
create or replace function public.ai_require_org_actor(p_org uuid, p_feature text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_config_actor(p_org, 'edit_config');
  if not public.has_feature(p_org, p_feature) then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if not coalesce((select ts.ai_enabled from tenant_settings ts where ts.org_id = p_org), false) then
    raise exception 'AI is not enabled for this organisation' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.ai_use_case_save(
  p_org uuid, p_use_case text, p_enabled boolean, p_system_prompt text,
  p_temperature numeric default 0.20, p_top_p numeric default 0.90, p_max_tokens int default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ai_require_org_actor(p_org, 'ai_assist');
  if p_use_case not in ('observation_draft','cap_wording','board_slides','anomaly_explain',
                        'exec_summary','report_wording','risk_wording') then
    raise exception 'unknown AI use case: %', p_use_case using errcode = 'P0001';
  end if;
  if p_temperature < 0 or p_temperature > 2 then
    raise exception 'temperature must be between 0 and 2' using errcode = 'P0001';
  end if;
  insert into ai_use_cases (org_id, use_case, enabled, system_prompt, temperature, top_p, max_tokens, updated_by)
  values (p_org, p_use_case, coalesce(p_enabled,false), p_system_prompt,
          coalesce(p_temperature,0.20), coalesce(p_top_p,0.90), p_max_tokens, auth.uid())
  on conflict (org_id, use_case) do update
    set enabled = excluded.enabled, system_prompt = excluded.system_prompt,
        temperature = excluded.temperature, top_p = excluded.top_p, max_tokens = excluded.max_tokens,
        updated_by = auth.uid(), updated_at = now();
end $$;

create or replace function public.ai_voice_profile_save(
  p_org uuid, p_tone text, p_person text, p_length text, p_custom text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ai_require_org_actor(p_org, 'ai_voice_library');
  if p_tone not in ('formal','neutral','concise') then
    raise exception 'unknown tone: %', p_tone using errcode = 'P0001';
  end if;
  if p_length not in ('brief','standard','detailed') then
    raise exception 'unknown length: %', p_length using errcode = 'P0001';
  end if;
  insert into org_voice_profile (org_id, tone, person, length, custom_instructions, updated_by)
  values (p_org, p_tone, p_person, p_length, p_custom, auth.uid())
  on conflict (org_id) do update
    set tone = excluded.tone, person = excluded.person, length = excluded.length,
        custom_instructions = excluded.custom_instructions, updated_by = auth.uid(), updated_at = now();
end $$;

create or replace function public.ai_voice_term_add(
  p_org uuid, p_preferred text, p_avoid text, p_term text, p_definition text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.ai_require_org_actor(p_org, 'ai_voice_library');
  insert into org_voice_terms (org_id, preferred_phrase, avoid_phrase, glossary_term, definition, created_by)
  values (p_org, p_preferred, p_avoid, p_term, p_definition, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ai_voice_sample_add(
  p_org uuid, p_kind text, p_title text, p_text text, p_source text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.ai_require_org_actor(p_org, 'ai_voice_library');
  if p_kind not in ('observation','finding','cap','report','board') then
    raise exception 'unknown sample kind: %', p_kind using errcode = 'P0001';
  end if;
  insert into org_voice_samples (org_id, kind, title, text, source, created_by)
  values (p_org, p_kind, p_title, p_text, p_source, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- The endpoint override and access mode (F8). A vendor-hosted URL is refused with the fixed message.
create or replace function public.ai_set_endpoint(
  p_org uuid, p_url text, p_access_mode text, p_secret_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ai_require_org_actor(p_org, 'ai_assist');
  if p_access_mode not in ('server','browser') then
    raise exception 'unknown access mode: %', p_access_mode using errcode = 'P0001';
  end if;
  if p_url is not null and public.ai_endpoint_denied(p_url) then
    raise exception 'This looks like a vendor-hosted AI service. Provio only allows models that run on your own infrastructure (spec L2).'
      using errcode = 'P0001';
  end if;
  insert into tenant_settings (org_id, ai_model_endpoint, ai_access_mode, ai_secret_id, updated_at)
  values (p_org, p_url, p_access_mode, p_secret_id, now())
  on conflict (org_id) do update
    set ai_model_endpoint = excluded.ai_model_endpoint, ai_access_mode = excluded.ai_access_mode,
        ai_secret_id = excluded.ai_secret_id, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- 11. ai_call_log — the gateway records a call (F8). Writes the ledger entry (kind ai_call) and the
--     retention-bounded row. Called by the Edge Function with the caller's JWT.
-- ---------------------------------------------------------------------------
create or replace function public.ai_call_log(
  p_org uuid, p_use_case text, p_model_name text, p_model_digest text,
  p_prompt_hash text, p_response_hash text, p_access_mode text, p_flags jsonb default '{}'::jsonb,
  p_prompt_text text default null, p_response_text text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_retention int;
begin
  if not public.config_actor_ok(p_org, 'edit_config') and not public.is_platform_admin() then
    raise exception 'not allowed: the caller cannot log an AI call for this organisation'
      using errcode = 'P0001';
  end if;
  v_retention := coalesce((select ose.ai_retention_days from org_settings_extra ose where ose.org_id = p_org), 30);
  insert into ai_calls (org_id, use_case, model_name, model_digest, prompt_hash, response_hash,
                        prompt_text, response_text, access_mode, flags, actor)
  values (p_org, p_use_case, p_model_name, p_model_digest, p_prompt_hash, p_response_hash,
          case when v_retention = 0 then null else p_prompt_text end,
          case when v_retention = 0 then null else p_response_text end,
          p_access_mode, coalesce(p_flags,'{}'::jsonb), auth.uid())
  returning id into v_id;
  -- The ledger keeps hashes forever (F8, F20).
  perform public.append_ledger_entry(p_org, 'ai_call',
    jsonb_build_object('use_case', p_use_case, 'model', p_model_name, 'model_digest', p_model_digest,
                       'prompt_hash', p_prompt_hash, 'response_hash', p_response_hash,
                       'access_mode', p_access_mode, 'flags', coalesce(p_flags,'{}'::jsonb)), auth.uid());
  return v_id;
end $$;

-- Purge the retention-bounded text (F8). Called daily by pg_cron.
create or replace function public.ai_purge_expired() returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update ai_calls c
     set prompt_text = null, response_text = null
   where (c.prompt_text is not null or c.response_text is not null)
     and c.created_at < now() - (
       coalesce((select ose.ai_retention_days from org_settings_extra ose where ose.org_id = c.org_id), 30)
       || ' days')::interval;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 12. ai_suggestion_save / ai_suggestion_decide — a suggestion is kept OUT of the record until a
--     user accepts it (F8). Accepting returns the text so the normal write RPC can run.
-- ---------------------------------------------------------------------------
create or replace function public.ai_suggestion_save(
  p_org uuid, p_use_case text, p_record_type text, p_record_id text, p_text text,
  p_flagged jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.config_actor_ok(p_org, 'edit_config') and not public.is_platform_admin() then
    raise exception 'not allowed: the caller cannot save a suggestion for this organisation'
      using errcode = 'P0001';
  end if;
  insert into ai_suggestions (org_id, use_case, record_type, record_id, text, flagged_figures, created_by)
  values (p_org, p_use_case, p_record_type, p_record_id, p_text, coalesce(p_flagged,'[]'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ai_suggestion_decide(
  p_id uuid, p_status text, p_accepted_text text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if p_status not in ('accepted','edited','rejected') then
    raise exception 'unknown suggestion status: %', p_status using errcode = 'P0001';
  end if;
  select org_id into v_org from ai_suggestions where id = p_id;
  if v_org is null then
    raise exception 'unknown suggestion' using errcode = 'P0001';
  end if;
  if not public.config_actor_ok(v_org, 'edit_config') and not public.is_platform_admin() then
    raise exception 'not allowed: the caller cannot decide a suggestion for this organisation'
      using errcode = 'P0001';
  end if;
  -- A flagged, unverified figure blocks acceptance until the user edits the text (F8 number guard).
  if p_status in ('accepted','edited')
     and (select jsonb_array_length(flagged_figures) > 0 from ai_suggestions where id = p_id)
     and p_status = 'accepted' then
    raise exception 'Confirm or remove the unverified figures before accepting.' using errcode = 'P0001';
  end if;
  update ai_suggestions
     set status = p_status, accepted_text = p_accepted_text, decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- 13. Register the AI model registry history (platform_only) — it is already registered in 0051;
--     this re-asserts it and attaches the notify trigger (idempotent).
-- ---------------------------------------------------------------------------
insert into config_areas (key, label, history_table, notify_policy) values
  ('ai_models','AI model registry','ai_model_versions','platform_only')
on conflict (key) do update set label = excluded.label, history_table = excluded.history_table,
  notify_policy = excluded.notify_policy;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ai_model_versions') then
    execute 'drop trigger if exists cfg_notify_ai_model_versions on public.ai_model_versions';
    execute 'create trigger cfg_notify_ai_model_versions after insert on public.ai_model_versions '
         || 'for each row execute function public.config_area_notify()';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 14. Grants. Platform RPCs and org RPCs to authenticated (each re-checks its right); nothing to anon.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'ai_model_add','ai_model_remove','ai_model_update','ai_tenant_set_model',
      'ai_denylist_add','ai_denylist_remove',
      'ai_use_case_save','ai_voice_profile_save','ai_voice_term_add','ai_voice_sample_add',
      'ai_set_endpoint','ai_call_log','ai_suggestion_save','ai_suggestion_decide',
      'ai_endpoint_denied'
    )
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;
