-- 0110: Phase 4.1 — methodology and test steps as first-class data.
--
-- The audit found that a "test step" was React state: the shape lived in src/data/initialData.ts,
-- the command layer ticked it, and nothing described *what a step is*. There was no procedure
-- library, no versioned step catalogue, and no way for a client to define their own methodology.
--
-- This migration makes a methodology (a "procedure template") and its ordered test steps real,
-- versioned, org-scoped data:
--
--   1. procedure_templates          — a named, versioned procedure per audit type (model_id).
--   2. procedure_template_versions  — the hash-chained log of every template change (L5, D7).
--   3. test_step_templates          — the ordered steps of one procedure version.
--   4. procedure_template_versions  — step changes are logged in the same chain.
--
-- Writers (all require edit_config, all reason-stamped through admin_log_change):
--   procedure_template_save(model_id, title, steps)  — create a new version with its steps.
--   procedure_template_publish(template_id)          — mark a version the current one.
-- Readers:
--   procedure_template_list()                        — every current template for the org.
--   procedure_template_get(template_id)              — one template with its ordered steps.
--
-- Laws: M2 (create table if not exists / add column if not exists / create or replace; drop
-- policy/trigger before create; create index if not exists), M5 (every table carries org_id with an
-- FK to orgs(id) on delete cascade so the test reset reaches it and a run leaves no residue).

-- ---------------------------------------------------------------------------
-- 1. procedure_templates — a methodology is a versioned, org-owned procedure for an audit type.
-- ---------------------------------------------------------------------------
create table if not exists procedure_templates (
  id uuid primary key default gen_random_uuid()
);
alter table procedure_templates add column if not exists org_id uuid;
alter table procedure_templates add column if not exists model_id text;
alter table procedure_templates add column if not exists version int not null default 1;
alter table procedure_templates add column if not exists title text not null default '';
alter table procedure_templates add column if not exists description text not null default '';
alter table procedure_templates add column if not exists is_current boolean not null default true;
alter table procedure_templates add column if not exists created_by uuid;
alter table procedure_templates add column if not exists created_at timestamptz not null default now();

alter table procedure_templates drop constraint if exists pt_org_id_fkey;
alter table procedure_templates add constraint pt_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists pt_org_model_version_idx on procedure_templates (org_id, model_id, version);
create index if not exists pt_org_model_current_idx on procedure_templates (org_id, model_id) where is_current;

alter table procedure_templates enable row level security;
drop policy if exists pt_select on procedure_templates;
create policy pt_select on procedure_templates for select to authenticated
  using (org_id = public.jwt_org_id());
revoke insert, update, delete on public.procedure_templates from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. test_step_templates — the ordered steps of one procedure version. A step is data: an id, a
--    label, a kind, whether evidence is required, and an order. Nothing here is React state.
-- ---------------------------------------------------------------------------
create table if not exists test_step_templates (
  id uuid primary key default gen_random_uuid()
);
alter table test_step_templates add column if not exists org_id uuid;
alter table test_step_templates add column if not exists template_id uuid;
alter table test_step_templates add column if not exists step_key text;
alter table test_step_templates add column if not exists label text not null default '';
alter table test_step_templates add column if not exists kind text not null default 'inquiry';
alter table test_step_templates add column if not exists requires_evidence boolean not null default false;
alter table test_step_templates add column if not exists ordinal int not null default 1;
alter table test_step_templates add column if not exists created_at timestamptz not null default now();

-- The kind is a closed set. It mirrors the non-population test types the spec names (§27.3: inquiry,
-- observation, document review) plus the population-based reperformance/analytical types. The
-- database refuses a kind the product cannot explain.
alter table test_step_templates drop constraint if exists tst_kind_chk;
alter table test_step_templates add constraint tst_kind_chk check (
  kind in ('inquiry', 'observation', 'document_review', 'inspection', 'reperformance', 'recalculation', 'analytical')
);
alter table test_step_templates drop constraint if exists tst_org_id_fkey;
alter table test_step_templates add constraint tst_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
alter table test_step_templates drop constraint if exists tst_template_id_fkey;
alter table test_step_templates add constraint tst_template_id_fkey foreign key (template_id)
  references procedure_templates(id) on delete cascade;
create unique index if not exists tst_template_key_idx on test_step_templates (template_id, step_key);
create index if not exists tst_org_template_idx on test_step_templates (org_id, template_id, ordinal);

alter table test_step_templates enable row level security;
drop policy if exists tst_select on test_step_templates;
create policy tst_select on test_step_templates for select to authenticated
  using (org_id = public.jwt_org_id());
revoke insert, update, delete on public.test_step_templates from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. procedure_template_versions — the hash-chained log of every template change (L5, D7). A step
--    change is logged through the same chain as the template row itself.
-- ---------------------------------------------------------------------------
create table if not exists procedure_template_versions (
  id bigint generated always as identity primary key
);
alter table procedure_template_versions add column if not exists org_id uuid;
alter table procedure_template_versions add column if not exists entity text not null default 'procedure_template';
alter table procedure_template_versions add column if not exists entity_id uuid;
alter table procedure_template_versions add column if not exists version int;
alter table procedure_template_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table procedure_template_versions add column if not exists actor uuid;
alter table procedure_template_versions add column if not exists prev_hash text;
alter table procedure_template_versions add column if not exists row_hash text;
alter table procedure_template_versions add column if not exists created_at timestamptz not null default now();
alter table procedure_template_versions drop constraint if exists ptv_org_id_fkey;
alter table procedure_template_versions add constraint ptv_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists ptv_org_idx on procedure_template_versions (org_id, entity_id, id);

alter table procedure_template_versions enable row level security;
drop policy if exists ptv_select on procedure_template_versions;
create policy ptv_select on procedure_template_versions for select to authenticated
  using (org_id = public.jwt_org_id());
revoke insert, update, delete on public.procedure_template_versions from public, anon, authenticated;

-- The chain writers. Each is security definer and advisory-locked per org (the report_template
-- pattern, 0088), so two writers cannot fork the chain.
create or replace function public.procedure_template_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := new.org_id;
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(v_org::text));
  select v.row_hash into v_prev from procedure_template_versions v
   where v.org_id = v_org order by v.id desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || new.model_id || '|' || new.version::text || '|' || to_jsonb(new)::text;
  insert into procedure_template_versions (org_id, entity, entity_id, version, payload, actor, prev_hash, row_hash)
  values (v_org, 'procedure_template', new.id, new.version, to_jsonb(new), auth.uid(), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
  return new;
end $$;
drop trigger if exists procedure_templates_log on procedure_templates;
create trigger procedure_templates_log after insert or update on procedure_templates
for each row execute function public.procedure_template_version_log();

create or replace function public.test_step_template_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := new.org_id;
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(v_org::text));
  select v.row_hash into v_prev from procedure_template_versions v
   where v.org_id = v_org order by v.id desc limit 1;
  v_body := coalesce(v_prev, '') || '|step|' || new.template_id::text || '|' || new.step_key || '|' || to_jsonb(new)::text;
  insert into procedure_template_versions (org_id, entity, entity_id, version, payload, actor, prev_hash, row_hash)
  values (v_org, 'test_step_template', new.template_id, null, to_jsonb(new), auth.uid(), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
  return new;
end $$;
drop trigger if exists test_step_templates_log on test_step_templates;
create trigger test_step_templates_log after insert on test_step_templates
for each row execute function public.test_step_template_version_log();

-- The version log is append-only (the report_template_versions pattern).
create or replace function public.procedure_template_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'procedure_template_versions is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists procedure_template_versions_no_change on procedure_template_versions;
create trigger procedure_template_versions_no_change before update or delete on procedure_template_versions
for each row execute function public.procedure_template_versions_append_only();

-- Pin org_id on both content tables.
do $$
declare
  t text;
begin
  foreach t in array array['procedure_templates', 'test_step_templates'] loop
    execute format('drop trigger if exists %I_pin_org on %I', t, t);
    execute format('create trigger %I_pin_org before insert on %I for each row execute function public.pin_org_id()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. procedure_template_save (4.1). The writer. Creates a new version of a procedure with its
--    ordered steps. Requires edit_config; every change is logged (§23).
-- ---------------------------------------------------------------------------
create or replace function public.procedure_template_save(
  p_model_id text, p_title text, p_description text, p_steps jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_next int;
  v_id uuid;
  v_step jsonb;
  v_key text;
  v_kind text;
  v_ord int := 0;
  v_seen text[] := array[]::text[];
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.admin_require_right('edit_config');
  if p_model_id is null or length(btrim(p_model_id)) = 0 then
    raise exception 'a model id is required' using errcode = 'P0001';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    raise exception 'a procedure needs a non-empty array of steps' using errcode = 'P0001';
  end if;

  -- Validate every step before writing anything, so a bad step cannot leave a half-written version.
  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_key := btrim(coalesce(v_step ->> 'step_key', ''));
    v_kind := coalesce(v_step ->> 'kind', 'inquiry');
    if v_key = '' then
      raise exception 'every step needs a step_key' using errcode = 'P0001';
    end if;
    if v_key = any(v_seen) then
      raise exception 'duplicate step_key: %', v_key using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_key;
    if v_kind <> all(array['inquiry','observation','document_review','inspection','reperformance','recalculation','analytical']) then
      raise exception 'unknown step kind: %', v_kind using errcode = 'P0001';
    end if;
    if coalesce(btrim(v_step ->> 'label'), '') = '' then
      raise exception 'step % needs a label', v_key using errcode = 'P0001';
    end if;
  end loop;

  select coalesce(max(t.version), 0) + 1 into v_next
    from procedure_templates t where t.org_id = v_org and t.model_id = btrim(p_model_id);

  update procedure_templates set is_current = false
   where org_id = v_org and model_id = btrim(p_model_id) and is_current;

  insert into procedure_templates (org_id, model_id, version, title, description, is_current, created_by)
  values (v_org, btrim(p_model_id), v_next,
          coalesce(nullif(btrim(coalesce(p_title, '')), ''), btrim(p_model_id)),
          coalesce(p_description, ''), true, auth.uid())
  returning id into v_id;

  -- The steps, in array order. The ordinal is the position, so the stored procedure is unambiguous.
  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_ord := v_ord + 1;
    insert into test_step_templates (org_id, template_id, step_key, label, kind, requires_evidence, ordinal)
    values (v_org, v_id, btrim(v_step ->> 'step_key'), btrim(v_step ->> 'label'),
            coalesce(v_step ->> 'kind', 'inquiry'), coalesce((v_step ->> 'requires_evidence')::boolean, false), v_ord);
  end loop;

  perform public.admin_log_change(v_org, 'procedure_templates',
    jsonb_build_object('model_id', btrim(p_model_id), 'version', v_next, 'steps', v_ord),
    'procedure_template_saved', 'procedure_template', v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. procedure_template_publish (4.1). A version becomes the current one. Requires edit_config.
-- ---------------------------------------------------------------------------
create or replace function public.procedure_template_publish(p_template_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_tpl procedure_templates;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.admin_require_right('edit_config');
  select * into v_tpl from procedure_templates where id = p_template_id and org_id = v_org;
  if v_tpl.id is null then
    raise exception 'template not found in this organisation' using errcode = 'P0001';
  end if;
  update procedure_templates set is_current = false
   where org_id = v_org and model_id = v_tpl.model_id and is_current;
  update procedure_templates set is_current = true where id = p_template_id and org_id = v_org;
  perform public.admin_log_change(v_org, 'procedure_templates',
    jsonb_build_object('model_id', v_tpl.model_id, 'version', v_tpl.version, 'published', true),
    'procedure_template_published', 'procedure_template', p_template_id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. procedure_template_list / procedure_template_get (4.1) — the readers for the library screen.
-- ---------------------------------------------------------------------------
create or replace function public.procedure_template_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'model_id', t.model_id, 'version', t.version, 'title', t.title,
           'description', t.description,
           'steps', coalesce((select jsonb_agg(jsonb_build_object(
                        'step_key', s.step_key, 'label', s.label, 'kind', s.kind,
                        'requires_evidence', s.requires_evidence, 'ordinal', s.ordinal)
                      order by s.ordinal)
                    from test_step_templates s where s.template_id = t.id), '[]'::jsonb),
           'updated_at', t.created_at)
         order by t.model_id), '[]'::jsonb)
  from procedure_templates t
  where t.org_id = public.jwt_org_id() and t.is_current;
$$;

create or replace function public.procedure_template_get(p_template_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', t.id, 'model_id', t.model_id, 'version', t.version, 'title', t.title,
           'description', t.description,
           'steps', coalesce((select jsonb_agg(jsonb_build_object(
                        'step_key', s.step_key, 'label', s.label, 'kind', s.kind,
                        'requires_evidence', s.requires_evidence, 'ordinal', s.ordinal)
                      order by s.ordinal)
                    from test_step_templates s where s.template_id = t.id), '[]'::jsonb),
           'updated_at', t.created_at)
  from procedure_templates t
  where t.id = p_template_id and t.org_id = public.jwt_org_id();
$$;

-- ---------------------------------------------------------------------------
-- 7. The default procedure a new tenant is seeded with (4.4). One generic three-step procedure per
--    audit type the product names. A tenant that never edits it has a working methodology.
-- ---------------------------------------------------------------------------
create or replace function public.procedure_template_seed(p_org uuid, p_model_id text, p_title text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_existing uuid;
begin
  perform public.provio_org_guard(p_org);
  -- Idempotent: a tenant that already has a current template for the model keeps it.
  select t.id into v_existing from procedure_templates t
   where t.org_id = p_org and t.model_id = p_model_id and t.is_current limit 1;
  if v_existing is not null then
    return v_existing;
  end if;
  insert into procedure_templates (org_id, model_id, version, title, description, is_current)
  values (p_org, p_model_id, 1, p_title,
          'The default three-step procedure. Edit it to match your methodology.', true)
  returning id into v_id;
  insert into test_step_templates (org_id, template_id, step_key, label, kind, requires_evidence, ordinal)
  values
    (p_org, v_id, 'design', 'Inquiry: understand the control design and walk the process through', 'inquiry', false, 1),
    (p_org, v_id, 'operate', 'Inspection: test that the control operated as described, with evidence', 'inspection', true, 2),
    (p_org, v_id, 'conclude', 'Reperformance: recompute the key figure and record the conclusion', 'reperformance', true, 3);
  return v_id;
end $$;
revoke execute on function public.procedure_template_seed(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Seed every existing tenant so the library is never empty on an upgraded install. New tenants
--    are seeded by platform_create_tenant (extended below).
-- ---------------------------------------------------------------------------
do $$
declare
  o record;
begin
  for o in select id from orgs loop
    perform public.procedure_template_seed(o.id, 'internal_audit', 'Internal audit — standard procedure');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. platform_create_tenant (4.4, replaced). The 0097 body plus the default methodology seed, so a
--    brand-new client has a working procedure library from the first sign-in.
-- ---------------------------------------------------------------------------
create or replace function public.platform_create_tenant(
  p_name text, p_initial_admin_email text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_roles int;
begin
  perform public.require_platform_admin();
  if p_name is null or btrim(p_name) = '' then
    raise exception 'an organisation name is required' using errcode = 'P0001';
  end if;
  if p_initial_admin_email is null or position('@' in p_initial_admin_email) <= 1 then
    raise exception 'a valid initial administrator email is required' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required when creating a tenant' using errcode = 'P0001';
  end if;

  -- The org row. Its own triggers (0015, 0019, 0021, 0022) seed the invitation cap, the SIRA model,
  -- the plan-approval settings and the engagement gate. The roles are seeded below because nothing
  -- else does it: the seed roles live in the test fixtures and in this function, and nowhere else.
  insert into orgs (name) values (btrim(p_name)) returning id into v_id;

  insert into tenant_settings (org_id, status) values (v_id, 'active')
  on conflict (org_id) do update set status = 'active', updated_at = now();

  v_roles := public.platform_seed_org_roles(v_id);

  -- 4.4: the default methodology, so the library is usable before the client edits anything.
  perform public.procedure_template_seed(v_id, 'internal_audit', 'Internal audit — standard procedure');

  -- The first invitation. It is recorded exactly as invite_user_capped records one (an
  -- invite_cap_events row plus a queued email), so the initial administrator arrives through the
  -- same acceptance path (admin_accept_invite, 0057) as every later invite.
  insert into invite_cap_events (org_id, invited_by, email, role_slug)
  values (v_id, auth.uid(), lower(btrim(p_initial_admin_email)), 'org_admin');
  perform public.queue_email(
    v_id, array[lower(btrim(p_initial_admin_email))], 'You have been invited to Provio', null,
    'An invitation to join Provio has been sent to your email. You can sign in once your account is created.',
    jsonb_build_object('kind', 'user_invitation', 'email', lower(btrim(p_initial_admin_email)),
                       'role_slug', 'org_admin'));

  perform public.platform_log('tenant_created', v_id, 'tenant', v_id,
    jsonb_build_object('name', btrim(p_name), 'initial_admin_email', lower(btrim(p_initial_admin_email)),
                       'roles_seeded', v_roles, 'reason', p_reason));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 10. The config-area registry (F7). Registering the version table gives the library screen a
--     history area and the automation engine a config.changed event on every change.
-- ---------------------------------------------------------------------------
insert into config_areas (key, label, history_table, notify_policy) values
  ('procedure_templates', 'Methodology and test-step library', 'procedure_template_versions', 'both')
on conflict (key) do update set label = excluded.label, history_table = excluded.history_table,
  notify_policy = excluded.notify_policy;

do $$
declare
  a record;
begin
  for a in select history_table from config_areas where notify_policy <> 'none' loop
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = a.history_table) then
      execute format('drop trigger if exists %I on public.%I', 'cfg_notify_' || a.history_table, a.history_table);
      execute format('create trigger %I after insert on public.%I for each row execute function public.config_area_notify()',
                     'cfg_notify_' || a.history_table, a.history_table);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Grants. Every writer and reader is authenticated-only (the right is checked inside).
-- ---------------------------------------------------------------------------
revoke execute on function public.procedure_template_save(text, text, text, jsonb) from public, anon;
revoke execute on function public.procedure_template_publish(uuid) from public, anon;
revoke execute on function public.procedure_template_list() from public, anon;
revoke execute on function public.procedure_template_get(uuid) from public, anon;
grant execute on function public.procedure_template_save(text, text, text, jsonb) to authenticated;
grant execute on function public.procedure_template_publish(uuid) to authenticated;
grant execute on function public.procedure_template_list() to authenticated;
grant execute on function public.procedure_template_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. workpaper_step_state becomes the snapshot of a template applied to a workpaper (4.2). The
--     definition (label, kind, requires_evidence, ordinal) is copied in at apply time, so a later
--     edit to the template never rewrites a workpaper already in progress.
-- ---------------------------------------------------------------------------
alter table workpaper_step_state add column if not exists template_id uuid null;
alter table workpaper_step_state add column if not exists label text not null default '';
alter table workpaper_step_state add column if not exists kind text not null default 'inquiry';
alter table workpaper_step_state add column if not exists requires_evidence boolean not null default false;
alter table workpaper_step_state add column if not exists ordinal int not null default 1;

-- ---------------------------------------------------------------------------
-- 13. workpaper_apply_template (4.2). Snapshots the current procedure for a model onto a workpaper.
--     Requires perform_work; refuses a signed-off workpaper. Idempotent: re-applying refreshes the
--     definition of each step but never clears a completed tick.
-- ---------------------------------------------------------------------------
create or replace function public.workpaper_apply_template(p_workpaper_id uuid, p_model_id text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_wp workpapers;
  v_tpl uuid;
  v_added int := 0;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  select * into v_wp from workpapers where id = p_workpaper_id and org_id = v_org;
  if v_wp.id is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  if v_wp.status = 'signed_off' then
    raise exception 'workpaper_locked: a signed-off workpaper is read-only' using errcode = 'P0001';
  end if;

  select t.id into v_tpl from procedure_templates t
   where t.org_id = v_org and t.model_id = p_model_id and t.is_current limit 1;
  if v_tpl is null then
    raise exception 'no current procedure for model %', p_model_id using errcode = 'P0001';
  end if;

  insert into workpaper_step_state
    (org_id, workpaper_id, step_id, completed, template_id, label, kind, requires_evidence, ordinal, updated_at)
  select v_org, p_workpaper_id, s.step_key, false, v_tpl, s.label, s.kind, s.requires_evidence, s.ordinal, now()
    from test_step_templates s where s.template_id = v_tpl
  on conflict (workpaper_id, step_id) do update
    set template_id = excluded.template_id, label = excluded.label, kind = excluded.kind,
        requires_evidence = excluded.requires_evidence, ordinal = excluded.ordinal, updated_at = now();
  get diagnostics v_added = row_count;
  return v_added;
end $$;

-- ---------------------------------------------------------------------------
-- 14. finalize_testing (4.2, replaced). The 0100 body plus a step gate: when the workpaper carries
--     test steps, every one must be completed before fieldwork can be finalised. A workpaper with no
--     steps is unaffected, so the change is additive for any engagement that never applies a template.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_testing(p_workpaper_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_wp workpapers;
  v_rows int;
  v_unresolved int;
  v_steps int;
  v_open_steps int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;

  select * into v_wp from workpapers where id = p_workpaper_id and org_id = v_org;
  if v_wp.id is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  if v_wp.status = 'signed_off' then
    raise exception 'workpaper_locked: a signed-off workpaper is read-only' using errcode = 'P0001';
  end if;

  -- 4.2: every step applied from a procedure must be complete. A manually ticked step (no template)
  -- is a note, not a gate, so it never blocks finalization.
  select count(*) into v_steps from workpaper_step_state
   where workpaper_id = p_workpaper_id and org_id = v_org and template_id is not null;
  if v_steps > 0 then
    select count(*) into v_open_steps from workpaper_step_state
     where workpaper_id = p_workpaper_id and org_id = v_org and template_id is not null and not completed;
    if v_open_steps > 0 then
      raise exception 'workpaper_incomplete: % test step(s) are not complete', v_open_steps using errcode = 'P0001';
    end if;
  end if;

  select count(*) into v_rows from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org;
  if v_rows = 0 then
    raise exception 'no rows to finalize on workpaper %', p_workpaper_id using errcode = 'P0001';
  end if;

  select count(*) into v_unresolved from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org and result is null;
  if v_unresolved > 0 then
    raise exception 'workpaper_incomplete: % row(s) have no result', v_unresolved using errcode = 'P0001';
  end if;

  select count(*) into v_unresolved from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org
     and result in ('cross', 'unverifiable') and not exception_flag;
  if v_unresolved > 0 then
    raise exception 'workpaper_incomplete: % exception row(s) are not flagged', v_unresolved using errcode = 'P0001';
  end if;

  update workpapers
     set status = 'prepared', prepared = true, prepared_by = auth.uid(), prepared_at = now()
   where id = p_workpaper_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'test_finalize',
    jsonb_build_object('workpaper_id', p_workpaper_id::text,
                       'engagement_id', v_wp.engagement_id::text, 'rows', v_rows),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'test_finalize', 'workpaper', p_workpaper_id,
          jsonb_build_object('rows', v_rows));
end $$;

revoke execute on function public.workpaper_apply_template(uuid, text) from public, anon;
grant execute on function public.workpaper_apply_template(uuid, text) to authenticated;
