-- 0008: row-level security and application role grants.
-- RLS is enabled on every table in public. Every policy derives the organisation from the JWT
-- claim only (public.jwt_org_id()). No policy reads an org from a request header or body.
-- No USING (true) policy exists anywhere (verified by supabase/tests/13_rls_enabled.sql).
-- Scope checks go only through public.has_scope (SECURITY DEFINER, fixed search_path).

-- CI re-applies migrations to the same project on every run, so this file must be idempotent.
-- Every policy in the public schema is defined here, so drop them all before recreating.
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table orgs               enable row level security;
alter table roles              enable row level security;
alter table org_members        enable row level security;
alter table user_scopes        enable row level security;
alter table universes          enable row level security;
alter table entities           enable row level security;
alter table engagements        enable row level security;
alter table engagement_members enable row level security;
alter table risks_library      enable row level security;
alter table sira_cycles        enable row level security;
alter table sira_scores        enable row level security;
alter table plans              enable row level security;
alter table plan_versions      enable row level security;
alter table populations        enable row level security;
alter table population_rows    enable row level security;
alter table samples            enable row level security;
alter table sample_rows        enable row level security;
alter table workpapers         enable row level security;
alter table sign_offs          enable row level security;
alter table test_rows          enable row level security;
alter table observations       enable row level security;
alter table findings           enable row level security;
alter table issues             enable row level security;
alter table cap_items          enable row level security;
alter table ledger_entries     enable row level security;
alter table activity_log       enable row level security;
alter table config_versions    enable row level security;
alter table platform_trail     enable row level security;
alter table notifications      enable row level security;
alter table email_outbox       enable row level security;
alter table reopen_grants      enable row level security;
alter table platform_admins    enable row level security;

-- ---------------------------------------------------------------------------
-- Identity and configuration tables.
-- ---------------------------------------------------------------------------

-- orgs: a member reads its own org row; the platform admin reads org metadata only.
drop policy if exists orgs_select_member on orgs;
create policy orgs_select_member on orgs for select to authenticated
  using (id = public.jwt_org_id() or public.jwt_user_role() = 'platform_admin');
drop policy if exists orgs_select_anon_none on orgs;
create policy orgs_select_anon_none on orgs for select to anon using (false);

-- roles: org_admin and cia manage; every member reads its own org's roles.
drop policy if exists roles_select on roles;
create policy roles_select on roles for select to authenticated
  using (org_id = public.jwt_org_id());
drop policy if exists roles_write on roles;
create policy roles_write on roles for all to authenticated
  using (org_id = public.jwt_org_id() and (public.is_org_admin() or public.is_cia()))
  with check (org_id = public.jwt_org_id() and (public.is_org_admin() or public.is_cia()));

-- org_members: a member reads its own row; org_admin and cia read all rows in the org.
drop policy if exists org_members_select on org_members;
create policy org_members_select on org_members for select to authenticated
  using (org_id = public.jwt_org_id() and (user_id = auth.uid() or public.is_org_admin() or public.is_cia()));
drop policy if exists org_members_write on org_members;
create policy org_members_write on org_members for all to authenticated
  using (org_id = public.jwt_org_id() and public.is_org_admin())
  with check (org_id = public.jwt_org_id() and public.is_org_admin());

-- user_scopes: the caller reads its own scopes; org_admin and cia read all.
drop policy if exists user_scopes_select on user_scopes;
create policy user_scopes_select on user_scopes for select to authenticated
  using (org_id = public.jwt_org_id() and (user_id = auth.uid() or public.is_org_admin() or public.is_cia()));
drop policy if exists user_scopes_write on user_scopes;
create policy user_scopes_write on user_scopes for all to authenticated
  using (org_id = public.jwt_org_id() and public.is_org_admin())
  with check (org_id = public.jwt_org_id() and public.is_org_admin());

-- config_versions: append-only, visible to org_admin and cia.
drop policy if exists config_versions_select on config_versions;
create policy config_versions_select on config_versions for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_org_admin() or public.is_cia()));
drop policy if exists config_versions_insert on config_versions;
create policy config_versions_insert on config_versions for insert to authenticated
  with check (org_id = public.jwt_org_id() and (public.is_org_admin() or public.is_cia()));

-- ---------------------------------------------------------------------------
-- Structure: universes and entities.
-- org_admin manages structure (§23) but sees no audit content (D1).
-- ---------------------------------------------------------------------------
drop policy if exists universes_select on universes;
create policy universes_select on universes for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin() or public.has_scope(id, null, null)));
drop policy if exists universes_write on universes;
create policy universes_write on universes for all to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()))
  with check (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()));

drop policy if exists entities_select on entities;
create policy entities_select on entities for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin() or public.has_scope(universe_id, id, null)));
drop policy if exists entities_write on entities;
create policy entities_write on entities for all to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()))
  with check (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()));

-- ---------------------------------------------------------------------------
-- Engagements and membership: audit content. cia sees all in the org (D1);
-- org_admin sees none. A member sees engagements in scope or on the team.
-- ---------------------------------------------------------------------------
drop policy if exists engagements_select on engagements;
create policy engagements_select on engagements for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.has_scope(universe_id, entity_id, id)));
drop policy if exists engagements_write on engagements;
create policy engagements_write on engagements for all to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.has_scope(universe_id, entity_id, id)))
  with check (org_id = public.jwt_org_id() and (public.is_cia() or public.has_scope(universe_id, entity_id, id)));

drop policy if exists engagement_members_select on engagement_members;
create policy engagement_members_select on engagement_members for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.has_scope(null, null, engagement_id)));
drop policy if exists engagement_members_write on engagement_members;
create policy engagement_members_write on engagement_members for all to authenticated
  using (org_id = public.jwt_org_id() and public.is_cia())
  with check (org_id = public.jwt_org_id() and public.is_cia());

-- ---------------------------------------------------------------------------
-- SIRA and plans.
-- ---------------------------------------------------------------------------
drop policy if exists risks_library_select on risks_library;
create policy risks_library_select on risks_library for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()));
drop policy if exists risks_library_write on risks_library;
create policy risks_library_write on risks_library for all to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()))
  with check (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()));

drop policy if exists sira_cycles_select on sira_cycles;
create policy sira_cycles_select on sira_cycles for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.has_scope(universe_id, null, null)));
drop policy if exists sira_cycles_write on sira_cycles;
create policy sira_cycles_write on sira_cycles for all to authenticated
  using (org_id = public.jwt_org_id() and public.is_cia())
  with check (org_id = public.jwt_org_id() and public.is_cia());

drop policy if exists sira_scores_select on sira_scores;
create policy sira_scores_select on sira_scores for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.has_scope(null, entity_id, null)));
drop policy if exists sira_scores_write on sira_scores;
create policy sira_scores_write on sira_scores for all to authenticated
  using (org_id = public.jwt_org_id() and public.is_cia())
  with check (org_id = public.jwt_org_id() and public.is_cia());

drop policy if exists plans_select on plans;
create policy plans_select on plans for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.has_scope(universe_id, null, null)));
drop policy if exists plans_write on plans;
create policy plans_write on plans for all to authenticated
  using (org_id = public.jwt_org_id() and public.is_cia())
  with check (org_id = public.jwt_org_id() and public.is_cia());

drop policy if exists plan_versions_select on plan_versions;
create policy plan_versions_select on plan_versions for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from plans p where p.id = plan_id));
drop policy if exists plan_versions_insert on plan_versions;
create policy plan_versions_insert on plan_versions for insert to authenticated
  with check (org_id = public.jwt_org_id() and exists (select 1 from plans p where p.id = plan_id));

-- ---------------------------------------------------------------------------
-- Testing content. Visibility follows the parent engagement through RLS on the
-- parent table; no separate scope logic is duplicated.
-- ---------------------------------------------------------------------------
drop policy if exists populations_select on populations;
create policy populations_select on populations for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));
drop policy if exists populations_write on populations;
create policy populations_write on populations for all to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id))
  with check (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));

drop policy if exists population_rows_select on population_rows;
create policy population_rows_select on population_rows for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from populations p where p.id = population_id));
drop policy if exists population_rows_write on population_rows;
create policy population_rows_write on population_rows for all to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from populations p where p.id = population_id))
  with check (org_id = public.jwt_org_id() and exists (select 1 from populations p where p.id = population_id));

drop policy if exists samples_select on samples;
create policy samples_select on samples for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from populations p where p.id = population_id));
drop policy if exists samples_write on samples;
create policy samples_write on samples for all to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from populations p where p.id = population_id))
  with check (org_id = public.jwt_org_id() and exists (select 1 from populations p where p.id = population_id));

drop policy if exists sample_rows_select on sample_rows;
create policy sample_rows_select on sample_rows for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from samples s where s.id = sample_id));
drop policy if exists sample_rows_write on sample_rows;
create policy sample_rows_write on sample_rows for all to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from samples s where s.id = sample_id))
  with check (org_id = public.jwt_org_id() and exists (select 1 from samples s where s.id = sample_id));

drop policy if exists workpapers_select on workpapers;
create policy workpapers_select on workpapers for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));
drop policy if exists workpapers_write on workpapers;
create policy workpapers_write on workpapers for all to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id))
  with check (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));

drop policy if exists sign_offs_select on sign_offs;
create policy sign_offs_select on sign_offs for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from workpapers w where w.id = workpaper_id));
drop policy if exists sign_offs_insert on sign_offs;
create policy sign_offs_insert on sign_offs for insert to authenticated
  with check (org_id = public.jwt_org_id() and exists (select 1 from workpapers w where w.id = workpaper_id));

drop policy if exists test_rows_select on test_rows;
create policy test_rows_select on test_rows for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from workpapers w where w.id = workpaper_id));
drop policy if exists test_rows_write on test_rows;
create policy test_rows_write on test_rows for all to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from workpapers w where w.id = workpaper_id))
  with check (org_id = public.jwt_org_id() and exists (select 1 from workpapers w where w.id = workpaper_id));

drop policy if exists observations_select on observations;
create policy observations_select on observations for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));
drop policy if exists observations_write on observations;
create policy observations_write on observations for all to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id))
  with check (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));

drop policy if exists findings_select on findings;
create policy findings_select on findings for select to authenticated
  using (org_id = public.jwt_org_id() and (
    exists (select 1 from observations o where o.id = observation_id)
    or exists (select 1 from entities en where en.id = entity_id)));
drop policy if exists findings_write on findings;
create policy findings_write on findings for all to authenticated
  using (org_id = public.jwt_org_id() and (
    exists (select 1 from observations o where o.id = observation_id)
    or exists (select 1 from entities en where en.id = entity_id)))
  with check (org_id = public.jwt_org_id() and (
    exists (select 1 from observations o where o.id = observation_id)
    or exists (select 1 from entities en where en.id = entity_id)));

drop policy if exists issues_select on issues;
create policy issues_select on issues for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from entities en where en.id = entity_id));
drop policy if exists issues_write on issues;
create policy issues_write on issues for all to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from entities en where en.id = entity_id))
  with check (org_id = public.jwt_org_id() and exists (select 1 from entities en where en.id = entity_id));

drop policy if exists cap_items_select on cap_items;
create policy cap_items_select on cap_items for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from issues i where i.id = issue_id));
drop policy if exists cap_items_write on cap_items;
create policy cap_items_write on cap_items for all to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from issues i where i.id = issue_id))
  with check (org_id = public.jwt_org_id() and exists (select 1 from issues i where i.id = issue_id));

-- ---------------------------------------------------------------------------
-- Accountability tables. Visible to cia and org_admin; append through functions.
-- ---------------------------------------------------------------------------
drop policy if exists ledger_entries_select on ledger_entries;
create policy ledger_entries_select on ledger_entries for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()));
drop policy if exists activity_log_select on activity_log;
create policy activity_log_select on activity_log for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()));
drop policy if exists activity_log_insert on activity_log;
create policy activity_log_insert on activity_log for insert to authenticated
  with check (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()));

drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated
  using (org_id = public.jwt_org_id() and user_id = auth.uid());
drop policy if exists notifications_write on notifications;
create policy notifications_write on notifications for all to authenticated
  using (org_id = public.jwt_org_id() and user_id = auth.uid())
  with check (org_id = public.jwt_org_id() and user_id = auth.uid());

drop policy if exists email_outbox_select on email_outbox;
create policy email_outbox_select on email_outbox for select to authenticated
  using (org_id = public.jwt_org_id() and (public.is_cia() or public.is_org_admin()));

-- ---------------------------------------------------------------------------
-- Platform trail: metadata only, platform admin only (spec §24, E).
-- ---------------------------------------------------------------------------
drop policy if exists platform_trail_select on platform_trail;
create policy platform_trail_select on platform_trail for select to authenticated
  using (public.jwt_user_role() = 'platform_admin');
drop policy if exists platform_trail_insert on platform_trail;
create policy platform_trail_insert on platform_trail for insert to authenticated
  with check (public.jwt_user_role() = 'platform_admin');

-- reopen_grants has RLS enabled and no policy: only SECURITY DEFINER functions touch it.

-- platform_admins: a platform user reads its own row; tenant users read nothing.
drop policy if exists platform_admins_select on platform_admins;
create policy platform_admins_select on platform_admins for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Tenant metadata view for the platform portal (metadata columns only).
-- security_invoker so orgs RLS still applies to the reader.
-- ---------------------------------------------------------------------------
create or replace view public.tenant_metadata with (security_invoker = true) as
  select id, name, is_demo, created_at from orgs;

-- ---------------------------------------------------------------------------
-- Platform role (E). No privilege on any tenant business table.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_admin') then
    create role platform_admin nologin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Application role grants (D5).
-- anon/authenticated get DML on tenant tables (RLS decides which rows) but never
-- UPDATE or DELETE on the append-only tables, and never INSERT on ledger_entries
-- or reopen_grants. They hold no ALTER/TRIGGER/DROP (they own nothing).
-- ---------------------------------------------------------------------------
do $$
declare
  r text;
  fn record;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant usage on schema public to %I', r);
      execute format('grant select on all tables in schema public to %I', r);
      execute format('grant insert, update, delete on all tables in schema public to %I', r);
      execute format('revoke update, delete on ledger_entries, activity_log, config_versions, plan_versions from %I', r);
      execute format('revoke insert, update, delete on ledger_entries from %I', r);
      execute format('revoke insert, update, delete on reopen_grants from %I', r);
      execute format('revoke insert, update, delete on platform_admins from %I', r);
      execute format('revoke insert, update, delete on platform_trail from %I', r);
      -- Grant execute on the application's own functions only. A blanket
      -- "all functions in schema public" also reaches extension functions (dblink
      -- and the like) that may be installed in public, and the grantor cannot grant
      -- on those, which aborts the migration. Extension members are those with an
      -- 'e' dependency in pg_depend.
      for fn in
        select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
        where n.nspname = 'public' and d.objid is null
      loop
        execute format('grant execute on function public.%I(%s) to %I', fn.name, fn.args, r);
      end loop;
      execute format('grant select on public.tenant_metadata to %I', r);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'platform_admin') then
    grant usage on schema public to platform_admin;
    grant select on public.orgs to platform_admin;
    grant select on public.platform_trail to platform_admin;
    grant select on public.tenant_metadata to platform_admin;
  end if;
end $$;
