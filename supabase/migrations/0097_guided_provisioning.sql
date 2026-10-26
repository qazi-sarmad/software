-- 0097: guided client provisioning (WP3).
--
-- A non-technical Super Admin stands up client N from zero with no further code. Everything the
-- guided path needs already exists as separate platform RPCs (status, entitlement, invite cap,
-- support access, job health, trail). What was missing is the *tenant itself*: nothing in the
-- migrations created an org, so a new client could only be made by hand in SQL. This migration adds
-- the four missing pieces and nothing else:
--
--   1. platform_create_tenant  — create the org and seed its roles, settings and first invite.
--   2. platform_seed_org_roles — the role seed, extracted so create and repair share one body.
--   3. platform_configure_email_sender — the platform fallback sender, with a mandatory reason.
--   4. platform_provisioning_status    — a structured readiness report for the wizard.
--
-- Laws: every function is security definer and calls require_platform_admin(); the platform role is
-- read from the JWT claim, so a tenant session is refused in the database, not the browser. Creating
-- a tenant writes no tenant *content* — only the org row, its role catalogue and its settings. The
-- platform administrator still reads no tenant data (L2): platform_provisioning_status returns
-- counts and booleans, never a row of tenant content.

-- ---------------------------------------------------------------------------
-- The seed role matrix. One source of truth, read by both the create path and the repair path.
-- The matrix matches migration 0087 (the last to rewrite it). A drift between this and 0087 is
-- caught by SQL test 102, which compares every seeded role to the rights 0087 leaves behind.
-- ---------------------------------------------------------------------------
create or replace function public.seed_role_matrix() returns table (name text, slug text, rights jsonb)
language sql immutable as $$
  select * from (values
    ('CIA','cia','{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":true,"perform_work":true,"can_reopen":true,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":true,"view_insights":true}'::jsonb),
    ('Org Admin','org_admin','{"manage_users":true,"manage_roles":true,"edit_config":true,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb),
    ('Audit Manager','audit_manager','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":true,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"view_insights":true}'::jsonb),
    ('Reviewer','reviewer','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb),
    ('Preparer','preparer','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb),
    ('Observer','observer','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":true,"read_only":true,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"view_insights":false}'::jsonb),
    ('Auditee','auditee','{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":true,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb)
  ) as m(name, slug, rights)
$$;
revoke execute on function public.seed_role_matrix() from public, anon, authenticated;

-- Seed the seven roles for an org. Idempotent: a role that already exists keeps its rights, so a
-- repaired org does not lose a customised matrix. Only the platform administrator may call it.
create or replace function public.platform_seed_org_roles(p_org uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_added int := 0;
begin
  perform public.require_platform_admin();
  if p_org is null or not exists (select 1 from orgs where id = p_org) then
    raise exception 'unknown organisation' using errcode = 'P0001';
  end if;
  insert into roles (org_id, name, slug, is_seed, rights)
  select p_org, m.name, m.slug, true, m.rights from public.seed_role_matrix() m
  on conflict (org_id, slug) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end $$;

-- ---------------------------------------------------------------------------
-- Create a tenant. The guided path's first step.
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
-- The platform fallback email sender. email_profile_save already writes it; this wrapper adds the
-- reason the guided path must record and the trail entry the wizard shows.
-- ---------------------------------------------------------------------------
create or replace function public.platform_configure_email_sender(
  p_display_name text, p_from_address text, p_reply_to text, p_provider text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.require_platform_admin();
  if p_from_address is null or position('@' in p_from_address) <= 1 then
    raise exception 'a valid from address is required' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required when changing the platform sender' using errcode = 'P0001';
  end if;
  v_id := public.email_profile_save(
    null, 'platform', coalesce(nullif(btrim(p_provider), ''), 'stub'),
    p_display_name, btrim(p_from_address), p_reply_to, '{}'::jsonb, true, null);
  -- email_profile_save writes the row but never marks a default; the platform fallback sender is by
  -- definition the default, so it is promoted here in the same transaction.
  perform public.email_set_default_profile(v_id);
  perform public.platform_log('platform_email_sender_configured', null, 'email_profile', v_id,
    jsonb_build_object('from_address', btrim(p_from_address), 'reason', p_reason));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- The readiness report. Counts and booleans only: no tenant content crosses to the platform role.
-- The wizard's "confirm the first engagement can be created" step reads this.
-- ---------------------------------------------------------------------------
create or replace function public.platform_provisioning_status(p_org uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_roles int;
  v_status text;
  v_entitlements int;
  v_cap int;
  v_invites int;
  v_engagements int;
  v_sender boolean;
begin
  perform public.require_platform_admin();
  if p_org is null or not exists (select 1 from orgs where id = p_org) then
    raise exception 'unknown organisation' using errcode = 'P0001';
  end if;

  select count(*) into v_roles from roles r where r.org_id = p_org;
  select ts.status into v_status from tenant_settings ts where ts.org_id = p_org;
  select count(*) into v_entitlements from tenant_entitlements e where e.org_id = p_org and e.enabled;
  select s.per_user_daily into v_cap from invite_cap_settings s where s.org_id = p_org;
  select count(*) into v_invites from invite_cap_events e where e.org_id = p_org;
  select count(*) into v_engagements from engagements g where g.org_id = p_org;
  select exists (select 1 from email_sender_profiles p where p.scope = 'platform' and p.enabled and p.is_default)
    into v_sender;

  -- can_create_engagement: the minimum the database needs before an engagement can be created.
  -- It is a read-only check; it writes nothing.
  return jsonb_build_object(
    'org_id', p_org,
    'roles_seeded', v_roles,
    'roles_ready', v_roles >= 7,
    'status', coalesce(v_status, 'active'),
    'active', coalesce(v_status, 'active') = 'active',
    'entitlements_enabled', v_entitlements,
    'invite_cap', coalesce(v_cap, 20),
    'invites_sent', v_invites,
    'has_initial_invite', v_invites > 0,
    'platform_sender_ready', v_sender,
    'engagement_count', v_engagements,
    'can_create_engagement', (v_roles >= 7 and coalesce(v_status, 'active') = 'active'),
    'ready', (v_roles >= 7 and coalesce(v_status, 'active') = 'active' and v_invites > 0)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants. Application functions to authenticated only; the platform role is re-checked inside.
-- seed_role_matrix is internal and stays unreadable by application roles.
-- ---------------------------------------------------------------------------
revoke execute on function public.platform_seed_org_roles(uuid) from public, anon;
grant execute on function public.platform_seed_org_roles(uuid) to authenticated;
revoke execute on function public.platform_create_tenant(text, text, text) from public, anon;
grant execute on function public.platform_create_tenant(text, text, text) to authenticated;
revoke execute on function public.platform_configure_email_sender(text, text, text, text, text) from public, anon;
grant execute on function public.platform_configure_email_sender(text, text, text, text, text) to authenticated;
revoke execute on function public.platform_provisioning_status(uuid) from public, anon;
grant execute on function public.platform_provisioning_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Feature catalogue: the guided path may set entitlements, so the switch itself must be sellable.
-- (feature_entitlements is the entitlement mechanism; it is seeded here so a plan can carry it.)
-- ---------------------------------------------------------------------------
insert into feature_catalogue (key, label, description, default_on)
values ('guided_provisioning', 'Guided provisioning', 'The Super Admin guided client provisioning path.', true)
on conflict (key) do nothing;
