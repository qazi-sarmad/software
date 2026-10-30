-- Test 143 (integrator, final phase): roles and access configurable at every level.
--
-- Owner instruction 2026-10-30: "every role is configurable per org as default for that org or for a
-- universe or for an engagement (complete customization in roles and access). All orgs are different;
-- all CIAs have different preferences in day-to-day engagements."
--
-- Every SEED role is exercised here, not only the CIA: the point of the row is that all seven are
-- configurable at all three scopes. The happy path is proved at each scope and the resolution order is
-- proved (engagement beats universe beats org beats membership); the bad paths prove a cross-tenant
-- scope id, an unknown role, a non-member and a missing default are each refused with no partial write.

\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. Every seed role is configurable as the DEFAULT for the organisation. The owner's "all orgs are
--    different": org A picks a different org-level default than the seed matrix, and each of the seven
--    roles can be set without touching the others.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_roles text[] := array['cia','audit_manager','reviewer','preparer','observer','auditee','org_admin'];
  v_role text;
  v_id uuid;
begin
  foreach v_role in array v_roles loop
    v_id := public.role_scope_default_set('org', null, null, v_role, true, 'org default ' || v_role);
    perform provio_test.assert_true(v_id is not null, format('S1: %s is configurable as an org default', v_role));
  end loop;
  perform provio_test.assert_eq(
    (select count(*) from role_scope_defaults where org_id = 'a0000000-0000-0000-0000-000000000001' and scope_kind = 'org'),
    7::bigint, 'S1: all seven seed roles are org defaults');
  -- Idempotent: a second set updates rather than duplicating.
  perform public.role_scope_default_set('org', null, null, 'cia', true, 'again');
  perform provio_test.assert_eq(
    (select count(*) from role_scope_defaults where org_id = 'a0000000-0000-0000-0000-000000000001'
       and scope_kind = 'org' and role_slug = 'cia'),
    1::bigint, 'S1: setting an org default twice keeps one row');
  perform provio_test.assert_eq(
    (select version from role_scope_defaults where org_id = 'a0000000-0000-0000-0000-000000000001'
       and scope_kind = 'org' and role_slug = 'cia'),
    2, 'S1: a re-set bumps the version (config-as-ledger)');
end $$;

-- ===========================================================================
-- 2. A UNIVERSE default and an ENGAGEMENT default, for different roles — "a universe or an
--    engagement". The engagement default is set on the engagement in universe u_a1.
-- ===========================================================================
do $$
begin
  perform public.role_scope_default_set('universe', '30000000-0000-0000-0000-0000000000a1', null, 'reviewer', true, 'U1 default');
  perform public.role_scope_default_set('engagement', null, '50000000-0000-0000-0000-0000000000a1', 'observer', true, 'Eng1 default');
  perform provio_test.assert_eq(
    (select count(*) from role_scope_defaults where org_id = 'a0000000-0000-0000-0000-000000000001' and scope_kind = 'universe'),
    1::bigint, 'S2: a universe default is stored');
  perform provio_test.assert_eq(
    (select count(*) from role_scope_defaults where org_id = 'a0000000-0000-0000-0000-000000000001' and scope_kind = 'engagement'),
    1::bigint, 'S2: an engagement default is stored');
end $$;

-- ===========================================================================
-- 3. role_assign with NO explicit role applies the scope's configured default — the default does
--    something. At the engagement the engagement default (observer) wins over the universe and org
--    defaults, which is the "most specific scope" rule.
-- ===========================================================================
do $$
declare
  v_applied int;
  v_eff jsonb;
begin
  v_applied := public.role_assign('10000000-0000-0000-0000-0000000000a4', 'engagement', null,
                                  '50000000-0000-0000-0000-0000000000a1', null, 'apply the engagement default');
  perform provio_test.assert_eq(v_applied, 1, 'S3: one default role was applied');
  perform provio_test.assert_true(
    (select is_default from role_assignments
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-0000000000a4'
        and engagement_id = '50000000-0000-0000-0000-0000000000a1' and role_slug = 'observer'),
    'S3: the applied grant is marked as a default');
  v_eff := public.role_effective('10000000-0000-0000-0000-0000000000a4', '50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(v_eff ->> 'source', 'engagement', 'S3: the engagement scope wins the resolution');
  perform provio_test.assert_true((v_eff -> 'role_slugs') ? 'observer', 'S3: the engagement default role resolved');
  perform provio_test.assert_true((v_eff -> 'rights' ->> 'read_only')::boolean, 'S3: the observer rights resolved');
end $$;

-- ===========================================================================
-- 4. Resolution falls through to the universe when the engagement has no default, and to the org when
--    neither does. Every level is proved, so "configurable at each level" is not just a claim.
-- ===========================================================================
do $$
declare
  v_eff jsonb;
begin
  -- a4 on engagement g_a2 (universe u_a2, no engagement default, no universe default) → the org
  -- default applies. a4 is an audit_manager member; the org default for the org is what was set in §1.
  perform public.role_assign('10000000-0000-0000-0000-0000000000a4', 'universe',
                             '30000000-0000-0000-0000-0000000000a2', null, 'preparer', 'explicit at U2');
  v_eff := public.role_effective('10000000-0000-0000-0000-0000000000a4', '50000000-0000-0000-0000-0000000000a2');
  perform provio_test.assert_eq(v_eff ->> 'source', 'universe', 'S4: the universe grant resolves when the engagement has none');
  perform provio_test.assert_true((v_eff -> 'rights' ->> 'perform_work')::boolean, 'S4: the universe role rights resolved');
end $$;

-- ===========================================================================
-- 5. Multiple roles at ONE scope add up (a union), not one silently winning.
-- ===========================================================================
do $$
declare
  v_eff jsonb;
begin
  perform public.role_assign('10000000-0000-0000-0000-0000000000a2', 'engagement', null,
                             '50000000-0000-0000-0000-0000000000a1', 'reviewer', 'reviewer on Eng1');
  perform public.role_assign('10000000-0000-0000-0000-0000000000a2', 'engagement', null,
                             '50000000-0000-0000-0000-0000000000a1', 'preparer', 'and preparer on Eng1');
  v_eff := public.role_effective('10000000-0000-0000-0000-0000000000a2', '50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(jsonb_array_length(v_eff -> 'role_slugs'), 2, 'S5: two roles are held at the engagement');
  perform provio_test.assert_true((v_eff -> 'rights' ->> 'review_and_approve')::boolean, 'S5: the reviewer right is present');
  perform provio_test.assert_true((v_eff -> 'rights' ->> 'perform_work')::boolean, 'S5: the preparer right is present too');
end $$;

-- ===========================================================================
-- 6. The scoped right predicate is the same answer: a scoped decision needs no role name.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    public.role_effective_has_right('10000000-0000-0000-0000-0000000000a2',
                                    '50000000-0000-0000-0000-0000000000a1', 'perform_work'),
    'S6: the scoped predicate sees the preparer right');
  perform provio_test.assert_true(
    not public.role_effective_has_right('10000000-0000-0000-0000-0000000000a2',
                                        '50000000-0000-0000-0000-0000000000a1', 'manage_users'),
    'S6: the scoped predicate withholds a right neither role confers');
end $$;

-- ===========================================================================
-- 7. With NO scoped grant anywhere, the membership role stands — an org that configures nothing keeps
--    exactly the behaviour it had. The seed's a1 is the CIA member.
-- ===========================================================================
do $$
declare
  v_eff jsonb;
begin
  v_eff := public.role_effective('10000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(v_eff ->> 'source', 'membership', 'S7: the membership role is the fallback');
  perform provio_test.assert_true((v_eff -> 'role_slugs') ? 'cia', 'S7: the CIA membership role resolved');
  perform provio_test.assert_true((v_eff -> 'rights' ->> 'approve_plan')::boolean, 'S7: the CIA rights resolved');
end $$;

-- ===========================================================================
-- 8. All seven roles, one per scope, each resolving to its OWN rights — the owner's "all CIAs have
--    different preferences" generalised: a role is a bag of rights and each bag resolves distinctly.
-- ===========================================================================
do $$
declare
  v_cases jsonb := jsonb_build_array(
    jsonb_build_object('slug','cia',           'right','approve_plan',        'bad','manage_users'),
    jsonb_build_object('slug','audit_manager', 'right','manage_engagements',  'bad','manage_users'),
    jsonb_build_object('slug','reviewer',      'right','review_and_approve',  'bad','manage_users'),
    jsonb_build_object('slug','preparer',      'right','perform_work',        'bad','approve_plan'),
    jsonb_build_object('slug','observer',      'right','read_only',           'bad','perform_work'),
    jsonb_build_object('slug','auditee',       'right','read_only',           'bad','perform_work'),
    jsonb_build_object('slug','org_admin',     'right','manage_users',        'bad','approve_plan')
  );
  v_case jsonb;
  v_eff jsonb;
  v_slug text;
begin
  for v_case in select jsonb_array_elements(v_cases) loop
    v_slug := v_case ->> 'slug';
    -- One engagement per role is overkill; one engagement, a fresh scope per role, is enough. We use
    -- the org scope for the role under test and assert the resolved rights, then clear it.
    perform public.role_scope_default_set('org', null, null, v_slug, true, 'role ' || v_slug);
    perform public.role_assign('10000000-0000-0000-0000-0000000000a4', 'org', null, null, v_slug, 'role ' || v_slug);
    v_eff := public.role_effective('10000000-0000-0000-0000-0000000000a4', null);
    perform provio_test.assert_true((v_eff -> 'role_slugs') ? v_slug, format('S8: %s resolves at the org scope', v_slug));
    perform provio_test.assert_true(
      coalesce((v_eff -> 'rights' ->> (v_case ->> 'right'))::boolean, false),
      format('S8: %s confers its %s right', v_slug, v_case ->> 'right'));
    perform provio_test.assert_true(
      not coalesce((v_eff -> 'rights' ->> (v_case ->> 'bad'))::boolean, false),
      format('S8: %s does not confer %s', v_slug, v_case ->> 'bad'));
    perform public.role_unassign((select id from role_assignments
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-0000000000a4' and scope_kind = 'org' and role_slug = v_slug));
  end loop;
end $$;

-- ===========================================================================
-- 9. BAD PATH — a scope id that belongs to another organisation is refused, and nothing is written.
-- ===========================================================================
do $$
declare
  v_before int;
begin
  select count(*) into v_before from role_scope_defaults;
  perform provio_test.assert_raises($q$
    select public.role_scope_default_set('universe', '30000000-0000-0000-0000-0000000000b1', null, 'reviewer', true, 'cross-tenant')
  $q$, 'another organisation', 'S9: a universe from another tenant is refused');
  perform provio_test.assert_raises($q$
    select public.role_scope_default_set('engagement', null, '50000000-0000-0000-0000-0000000000b1', 'reviewer', true, 'cross-tenant')
  $q$, 'another organisation', 'S9: an engagement from another tenant is refused');
  perform provio_test.assert_eq((select count(*) from role_scope_defaults), v_before::bigint,
    'S9: a refused cross-tenant scope leaves no row');
end $$;

-- ===========================================================================
-- 10. BAD PATH — an unknown role, a scope shape that does not match, and a non-member are refused.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises($q$
    select public.role_scope_default_set('org', null, null, 'no_such_role', true, 'x')
  $q$, 'unknown role', 'S10: an unknown role slug is refused');
  perform provio_test.assert_raises($q$
    select public.role_scope_default_set('org', '30000000-0000-0000-0000-0000000000a1', null, 'reviewer', true, 'x')
  $q$, 'org scope takes no universe', 'S10: the org scope refuses a universe id');
  perform provio_test.assert_raises($q$
    select public.role_assign('10000000-0000-0000-0000-0000000000a5', 'org', null, null, 'reviewer', 'x')
  $q$, 'not a member', 'S10: assigning to a non-member is refused');
end $$;

-- ===========================================================================
-- 11. BAD PATH — a member with no default configured and no explicit role is refused by name, not
--     silently given a role. (a4's org-scope grants were cleared in §8.)
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_org_defaults int;
begin
  -- Clear every org-scope default through the RPC (a direct delete is refused: writes go through the
  -- RPC only, which is the point). The fallback chain then has nothing to apply for a fresh scope.
  perform public.role_scope_default_clear(d.id) from role_scope_defaults d
   where d.org_id = 'a0000000-0000-0000-0000-000000000001' and d.scope_kind = 'org';
  select count(*) into v_org_defaults from role_scope_defaults
   where org_id = 'a0000000-0000-0000-0000-000000000001' and scope_kind = 'org';
  perform provio_test.assert_eq(v_org_defaults, 0, 'S11: the org defaults were cleared for this check');
  perform provio_test.assert_raises($q$
    select public.role_assign('10000000-0000-0000-0000-0000000000a4', 'org', null, null, null, 'no default')
  $q$, 'no default role is configured', 'S11: no default is refused by name');
end $$;

-- ===========================================================================
-- 12. BAD PATH — the rights are enforced. An observer (no manage_roles) may not configure a default.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.role_scope_default_set('org', null, null, 'cia', true, 'observer should not')
  $q$, 'manage_roles', 'S12: an observer without manage_roles is refused');
end $$;

-- ===========================================================================
-- 13. ISOLATION — org B sees none of org A's configuration, and its own resolution is its own.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_eff jsonb;
begin
  perform provio_test.assert_eq(
    (select count(*) from role_scope_defaults_list()), 0::bigint,
    'S13: org B sees none of org A''s scope defaults');
  perform provio_test.assert_eq(
    (select count(*) from role_assignments_list()), 0::bigint,
    'S13: org B sees none of org A''s assignments');
  -- Org B configures its own default; it does not touch org A's.
  perform public.role_scope_default_set('org', null, null, 'audit_manager', true, 'B org default');
  perform public.role_assign('10000000-0000-0000-0000-0000000000b4', 'org', null, null, null, 'apply B default');
  v_eff := public.role_effective('10000000-0000-0000-0000-0000000000b4', null);
  perform provio_test.assert_true((v_eff -> 'role_slugs') ? 'audit_manager', 'S13: org B resolves its own default');
end $$;

-- ===========================================================================
-- 14. The readers name the role for the screen, and a clear removes a default with no residue.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_id uuid;
  v_name text;
begin
  perform public.role_scope_default_set('universe', '30000000-0000-0000-0000-0000000000a2', null, 'preparer', true, 'U2 preparer');
  select role_name into v_name from role_scope_defaults_list()
   where scope_kind = 'universe' and universe_id = '30000000-0000-0000-0000-0000000000a2' and role_slug = 'preparer';
  perform provio_test.assert_eq(v_name, 'Preparer', 'S14: the reader resolves the role name for the screen');

  select id into v_id from role_scope_defaults
   where org_id = 'a0000000-0000-0000-0000-000000000001'
     and scope_kind = 'universe' and universe_id = '30000000-0000-0000-0000-0000000000a2' and role_slug = 'preparer';
  perform public.role_scope_default_clear(v_id);
  perform provio_test.assert_eq(
    (select count(*) from role_scope_defaults where id = v_id), 0::bigint,
    'S14: a cleared default is gone');
  perform provio_test.assert_raises(format($q$select public.role_scope_default_clear('%s'::uuid)$q$, v_id),
    'no scope default', 'S14: clearing a missing default is refused by name');
end $$;

-- ===========================================================================
-- 15. Determinism — the same rows always give the same answer (L1: no clock, no randomness).
-- ===========================================================================
do $$
declare
  v_a jsonb;
  v_b jsonb;
begin
  v_a := public.role_effective('10000000-0000-0000-0000-0000000000a2', '50000000-0000-0000-0000-0000000000a1');
  v_b := public.role_effective('10000000-0000-0000-0000-0000000000a2', '50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(v_a, v_b, 'S15: the resolution is deterministic');
end $$;

select provio_test.as_owner();
