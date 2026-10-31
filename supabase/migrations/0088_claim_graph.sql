-- 0088: the Evidence-Bound Claim Graph — tables (WRITE-1, W1.4).
--
-- The spec (§15.6) names the tables: "The engine stores its report structure in report_templates,
-- report_versions, report_blocks, report_claims, phrases and report_terminology, each hash-chained
-- where it is versioned." This migration creates report_templates, report_claims, report_terminology
-- and figure_functions with hash-chained version tables (the role_config_log pattern, 0014). The
-- phrase library lands in 0089 (W2); the figure registry is here because W4 references it and it is
-- data, not code.
--
-- M1: grepped supabase/migrations and supabase/tests for report_templates, report_claims,
--     report_terminology, figure_functions, report_graphs, report_template_versions,
--     report_claim_versions, figure_function_versions — none existed. report_versions (0036) already
--     exists and is reused unchanged.
-- M2: create table if not exists + add column if not exists; create or replace; drop policy/trigger
--     if exists before create; create index if not exists. Safe to apply repeatedly.
-- M3: report_versions keeps its shape; the graph hangs off it by report_version_id.
-- M5: every table here carries org_id and an FK to orgs(id) on delete cascade, so the SQL-test reset
--     (`truncate orgs cascade`) reaches it and a run leaves no residue.

-- ---------------------------------------------------------------------------
-- 1. report_templates — a report model is a versioned template with a document plan (W3.1). The
--    plan is data, so a model can be added without code.
-- ---------------------------------------------------------------------------
create table if not exists report_templates (
  id uuid primary key default gen_random_uuid()
);
alter table report_templates add column if not exists org_id uuid;
alter table report_templates add column if not exists model_id text;
alter table report_templates add column if not exists version int not null default 1;
alter table report_templates add column if not exists title text not null default '';
alter table report_templates add column if not exists plan jsonb not null default '{"sections":[]}'::jsonb;
alter table report_templates add column if not exists default_register jsonb not null default '{"formality":3,"tone":2,"voice":"active"}'::jsonb;
alter table report_templates add column if not exists allowed_registers jsonb not null default '[]'::jsonb;
alter table report_templates add column if not exists default_locale text not null default 'en-GB';
alter table report_templates add column if not exists is_current boolean not null default true;
alter table report_templates add column if not exists created_by uuid;
alter table report_templates add column if not exists created_at timestamptz not null default now();

alter table report_templates drop constraint if exists rt_locale_check;
alter table report_templates add constraint rt_locale_check check (default_locale in ('en-GB', 'en-US'));
alter table report_templates drop constraint if exists rt_org_id_fkey;
alter table report_templates add constraint rt_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists rt_org_model_version_idx on report_templates (org_id, model_id, version);
create index if not exists rt_org_model_current_idx on report_templates (org_id, model_id) where is_current;

alter table report_templates enable row level security;
drop policy if exists rt_select on report_templates;
create policy rt_select on report_templates for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.report_templates from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. report_template_versions — the hash-chained log of every template change (L5, D7 pattern).
-- ---------------------------------------------------------------------------
create table if not exists report_template_versions (
  id bigint generated always as identity primary key
);
alter table report_template_versions add column if not exists org_id uuid;
alter table report_template_versions add column if not exists entity text not null default 'report_template';
alter table report_template_versions add column if not exists entity_id uuid;
alter table report_template_versions add column if not exists version int;
alter table report_template_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table report_template_versions add column if not exists actor uuid;
alter table report_template_versions add column if not exists prev_hash text;
alter table report_template_versions add column if not exists row_hash text;
alter table report_template_versions add column if not exists created_at timestamptz not null default now();
alter table report_template_versions drop constraint if exists rtv_org_id_fkey;
alter table report_template_versions add constraint rtv_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists rtv_org_idx on report_template_versions (org_id, entity_id, id);

alter table report_template_versions enable row level security;
drop policy if exists rtv_select on report_template_versions;
create policy rtv_select on report_template_versions for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.report_template_versions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. report_claims — the nodes of the graph. One row per claim of a report version. The facts only:
--    no words, no register, no locale. `claim_hash` is computed by the engine and re-checked here.
-- ---------------------------------------------------------------------------
create table if not exists report_claims (
  id uuid primary key default gen_random_uuid()
);
alter table report_claims add column if not exists org_id uuid;
alter table report_claims add column if not exists report_version_id uuid;
alter table report_claims add column if not exists claim_id text not null default '';
alter table report_claims add column if not exists section_id text not null default '';
alter table report_claims add column if not exists position int not null default 0;
alter table report_claims add column if not exists kind text not null default 'calculated';
alter table report_claims add column if not exists claim_level text not null default 'calculated';
alter table report_claims add column if not exists slots jsonb not null default '[]'::jsonb;
alter table report_claims add column if not exists phrase_id text;
alter table report_claims add column if not exists phrase_version int;
alter table report_claims add column if not exists rule_id text;
alter table report_claims add column if not exists rule_version int;
alter table report_claims add column if not exists references_json jsonb not null default '[]'::jsonb;
alter table report_claims add column if not exists figures jsonb not null default '[]'::jsonb;
alter table report_claims add column if not exists approval jsonb;
alter table report_claims add column if not exists auditor_text text;
alter table report_claims add column if not exists claim_hash text not null default '';
alter table report_claims add column if not exists created_at timestamptz not null default now();

alter table report_claims drop constraint if exists rc_kind_check;
alter table report_claims add constraint rc_kind_check check (kind in ('calculated', 'derived', 'auditor'));
alter table report_claims drop constraint if exists rc_level_check;
alter table report_claims add constraint rc_level_check
  check (claim_level in ('verified', 'calculated', 'management_asserted', 'unresolved'));
alter table report_claims drop constraint if exists rc_org_id_fkey;
alter table report_claims add constraint rc_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
alter table report_claims drop constraint if exists rc_report_version_id_fkey;
alter table report_claims add constraint rc_report_version_id_fkey
  foreign key (report_version_id) references report_versions(id) on delete cascade;
create unique index if not exists rc_version_claim_idx on report_claims (report_version_id, claim_id);
create index if not exists rc_org_section_idx on report_claims (org_id, report_version_id, section_id, position);
-- A calculated or derived claim must carry a phrase and a rule; auditor text need not.
alter table report_claims drop constraint if exists rc_phrase_required;
alter table report_claims add constraint rc_phrase_required check (
  kind = 'auditor' or (phrase_id is not null and phrase_version is not null
                       and rule_id is not null and rule_version is not null)
);

alter table report_claims enable row level security;
drop policy if exists rc_select on report_claims;
create policy rc_select on report_claims for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.report_claims from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. report_claim_versions — the hash-chained log of claims as they are composed.
-- ---------------------------------------------------------------------------
create table if not exists report_claim_versions (
  id bigint generated always as identity primary key
);
alter table report_claim_versions add column if not exists org_id uuid;
alter table report_claim_versions add column if not exists report_version_id uuid;
alter table report_claim_versions add column if not exists claim_id text;
alter table report_claim_versions add column if not exists claim_hash text;
alter table report_claim_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table report_claim_versions add column if not exists actor uuid;
alter table report_claim_versions add column if not exists prev_hash text;
alter table report_claim_versions add column if not exists row_hash text;
alter table report_claim_versions add column if not exists created_at timestamptz not null default now();
alter table report_claim_versions drop constraint if exists rcv_org_id_fkey;
alter table report_claim_versions add constraint rcv_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists rcv_org_idx on report_claim_versions (org_id, report_version_id, id);

alter table report_claim_versions enable row level security;
drop policy if exists rcv_select on report_claim_versions;
create policy rcv_select on report_claim_versions for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.report_claim_versions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. report_terminology — the client's terminology mapping. A display mapping only: it never
--    rewrites auditor text (§15.6, W3.3).
-- ---------------------------------------------------------------------------
create table if not exists report_terminology (
  id uuid primary key default gen_random_uuid()
);
alter table report_terminology add column if not exists org_id uuid;
alter table report_terminology add column if not exists term_key text not null default '';
alter table report_terminology add column if not exists display_text text not null default '';
alter table report_terminology add column if not exists updated_by uuid;
alter table report_terminology add column if not exists updated_at timestamptz not null default now();
alter table report_terminology drop constraint if exists rterm_org_id_fkey;
alter table report_terminology add constraint rterm_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists rterm_org_key_idx on report_terminology (org_id, term_key);

alter table report_terminology enable row level security;
drop policy if exists rterm_select on report_terminology;
create policy rterm_select on report_terminology for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.report_terminology from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. figure_functions — the versioned, hash-identified registry (W4.1). Every number in a report is
--    a binding to one of these. Pure computation, identified by hash; the description is plain words.
-- ---------------------------------------------------------------------------
create table if not exists figure_functions (
  id uuid primary key default gen_random_uuid()
);
alter table figure_functions add column if not exists org_id uuid;
alter table figure_functions add column if not exists figure_id text not null default '';
alter table figure_functions add column if not exists version int not null default 1;
alter table figure_functions add column if not exists description text not null default '';
alter table figure_functions add column if not exists input_tables jsonb not null default '[]'::jsonb;
alter table figure_functions add column if not exists input_columns jsonb not null default '[]'::jsonb;
alter table figure_functions add column if not exists parameters jsonb not null default '[]'::jsonb;
alter table figure_functions add column if not exists result_scale int not null default 0;
alter table figure_functions add column if not exists body_hash text not null default '';
alter table figure_functions add column if not exists is_current boolean not null default true;
alter table figure_functions add column if not exists created_by uuid;
alter table figure_functions add column if not exists created_at timestamptz not null default now();
alter table figure_functions drop constraint if exists ff_org_id_fkey;
alter table figure_functions add constraint ff_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists ff_org_figure_version_idx on figure_functions (org_id, figure_id, version);
create index if not exists ff_org_current_idx on figure_functions (org_id, figure_id) where is_current;

alter table figure_functions enable row level security;
drop policy if exists ff_select on figure_functions;
create policy ff_select on figure_functions for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.figure_functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. figure_function_versions — hash-chained log of the registry.
-- ---------------------------------------------------------------------------
create table if not exists figure_function_versions (
  id bigint generated always as identity primary key
);
alter table figure_function_versions add column if not exists org_id uuid;
alter table figure_function_versions add column if not exists figure_id text;
alter table figure_function_versions add column if not exists version int;
alter table figure_function_versions add column if not exists body_hash text;
alter table figure_function_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table figure_function_versions add column if not exists actor uuid;
alter table figure_function_versions add column if not exists prev_hash text;
alter table figure_function_versions add column if not exists row_hash text;
alter table figure_function_versions add column if not exists created_at timestamptz not null default now();
alter table figure_function_versions drop constraint if exists ffv_org_id_fkey;
alter table figure_function_versions add constraint ffv_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists ffv_org_idx on figure_function_versions (org_id, figure_id, id);

alter table figure_function_versions enable row level security;
drop policy if exists ffv_select on figure_function_versions;
create policy ffv_select on figure_function_versions for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.figure_function_versions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. report_graphs — one row per committed (report version, register, locale). The graph root is
--    identical across registers and locales; the render hash is not. Both are committed with the
--    engine, template and phrase-library versions (W7.1, spec §15.6).
-- ---------------------------------------------------------------------------
create table if not exists report_graphs (
  id uuid primary key default gen_random_uuid()
);
alter table report_graphs add column if not exists org_id uuid;
alter table report_graphs add column if not exists report_version_id uuid;
alter table report_graphs add column if not exists model_id text not null default '';
alter table report_graphs add column if not exists formality int not null default 3;
alter table report_graphs add column if not exists tone int not null default 2;
alter table report_graphs add column if not exists voice text not null default 'active';
alter table report_graphs add column if not exists locale text not null default 'en-GB';
alter table report_graphs add column if not exists graph_root text not null default '';
alter table report_graphs add column if not exists render_hash text not null default '';
alter table report_graphs add column if not exists engine_version text not null default '';
alter table report_graphs add column if not exists template_version text not null default '';
alter table report_graphs add column if not exists phrase_library_version text not null default '';
alter table report_graphs add column if not exists fixed_timestamp timestamptz not null default now();
alter table report_graphs add column if not exists claim_count int not null default 0;
alter table report_graphs add column if not exists ledger_seq bigint;
alter table report_graphs add column if not exists created_by uuid;
alter table report_graphs add column if not exists created_at timestamptz not null default now();
alter table report_graphs drop constraint if exists rg_formality_check;
alter table report_graphs add constraint rg_formality_check check (formality between 1 and 5);
alter table report_graphs drop constraint if exists rg_tone_check;
alter table report_graphs add constraint rg_tone_check check (tone between 1 and 5);
alter table report_graphs drop constraint if exists rg_voice_check;
alter table report_graphs add constraint rg_voice_check check (voice in ('active', 'passive'));
alter table report_graphs drop constraint if exists rg_locale_check;
alter table report_graphs add constraint rg_locale_check check (locale in ('en-GB', 'en-US'));
alter table report_graphs drop constraint if exists rg_org_id_fkey;
alter table report_graphs add constraint rg_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
alter table report_graphs drop constraint if exists rg_report_version_id_fkey;
alter table report_graphs add constraint rg_report_version_id_fkey
  foreign key (report_version_id) references report_versions(id) on delete cascade;
create unique index if not exists rg_variant_idx
  on report_graphs (report_version_id, model_id, formality, tone, voice, locale);
create index if not exists rg_root_idx on report_graphs (graph_root);

alter table report_graphs enable row level security;
drop policy if exists rg_select on report_graphs;
create policy rg_select on report_graphs for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.report_graphs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. The append-only guards (L5, D7 pattern).
-- ---------------------------------------------------------------------------
create or replace function public.report_claims_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'report_claims rows are replaced by a recompose, never edited' using errcode = 'P0001';
end $$;
drop trigger if exists report_claims_no_update on report_claims;
create trigger report_claims_no_update before update or delete on report_claims
for each row execute function public.report_claims_append_only();

create or replace function public.report_graphs_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'a committed report graph is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists report_graphs_no_change on report_graphs;
create trigger report_graphs_no_change before update or delete on report_graphs
for each row execute function public.report_graphs_append_only();

create or replace function public.report_template_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'report_template_versions is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists report_template_versions_no_change on report_template_versions;
create trigger report_template_versions_no_change before update or delete on report_template_versions
for each row execute function public.report_template_versions_append_only();

create or replace function public.report_claim_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'report_claim_versions is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists report_claim_versions_no_change on report_claim_versions;
create trigger report_claim_versions_no_change before update or delete on report_claim_versions
for each row execute function public.report_claim_versions_append_only();

create or replace function public.figure_function_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'figure_function_versions is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists figure_function_versions_no_change on figure_function_versions;
create trigger figure_function_versions_no_change before update or delete on figure_function_versions
for each row execute function public.figure_function_versions_append_only();

-- ---------------------------------------------------------------------------
-- 10. The hash-chain writers (the role_config_log pattern, 0014). Each is security definer and
--     advisory-locked per org, so two writers cannot fork the chain.
-- ---------------------------------------------------------------------------
create or replace function public.report_template_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := new.org_id;
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(v_org::text));
  select v.row_hash into v_prev from report_template_versions v where v.org_id = v_org order by v.id desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || new.model_id || '|' || new.version::text || '|' || to_jsonb(new)::text;
  insert into report_template_versions (org_id, entity, entity_id, version, payload, actor, prev_hash, row_hash)
  values (v_org, 'report_template', new.id, new.version, to_jsonb(new), auth.uid(), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
  return new;
end $$;
drop trigger if exists report_templates_log on report_templates;
create trigger report_templates_log after insert or update on report_templates
for each row execute function public.report_template_version_log();

create or replace function public.figure_function_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := new.org_id;
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(v_org::text));
  select v.row_hash into v_prev from figure_function_versions v where v.org_id = v_org order by v.id desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || new.figure_id || '|' || new.version::text || '|' || new.body_hash;
  insert into figure_function_versions (org_id, figure_id, version, body_hash, payload, actor, prev_hash, row_hash)
  values (v_org, new.figure_id, new.version, new.body_hash, to_jsonb(new), auth.uid(), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
  return new;
end $$;
drop trigger if exists figure_functions_log on figure_functions;
create trigger figure_functions_log after insert or update on figure_functions
for each row execute function public.figure_function_version_log();

create or replace function public.report_claim_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := new.org_id;
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(v_org::text));
  select v.row_hash into v_prev from report_claim_versions v where v.org_id = v_org order by v.id desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || new.report_version_id::text || '|' || new.claim_id || '|' || new.claim_hash;
  insert into report_claim_versions (org_id, report_version_id, claim_id, claim_hash, payload, actor, prev_hash, row_hash)
  values (v_org, new.report_version_id, new.claim_id, new.claim_hash, to_jsonb(new), auth.uid(), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
  return new;
end $$;
drop trigger if exists report_claims_log on report_claims;
create trigger report_claims_log after insert on report_claims
for each row execute function public.report_claim_version_log();

-- ---------------------------------------------------------------------------
-- 11. Grants. The tables take no direct write (writes go through the security-definer RPCs added by
--     the tasks that need them). The trigger and chain-writer functions are not an anonymous or a
--     client surface: the shim grants `all` on new functions by default, so each is revoked
--     explicitly. This keeps the anonymous-callable set at exactly verify_certificate and
--     verify_board_pack (src/guards/anonGrantAllowList.test.ts).
-- ---------------------------------------------------------------------------
do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'report_claims_append_only', 'report_graphs_append_only',
         'report_template_versions_append_only', 'report_claim_versions_append_only',
         'figure_function_versions_append_only',
         'report_template_version_log', 'figure_function_version_log', 'report_claim_version_log'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

