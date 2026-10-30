import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applicableDefaults,
  explainAccess,
  resolveAccess,
  rightsForSlug,
  rolesAt,
  rightsInOrder,
  unionRights,
  type RightsByRole,
  type RoleAssignment,
  type ScopeDefault,
} from './roleAccess';
import { rightsForRole, type Right } from './rights';
import type { Role } from '../types';

const ROLES: Role[] = ['org_admin', 'cia', 'audit_manager', 'reviewer', 'preparer', 'observer', 'auditee'];

const RIGHTS_BY_ROLE: RightsByRole = Object.fromEntries(ROLES.map((r) => [r, rightsForRole(r)]));

function assignment(a: Partial<RoleAssignment> & { roleSlug: string }): RoleAssignment {
  return {
    id: a.id ?? `a-${a.roleSlug}-${a.scopeKind ?? 'org'}`,
    userId: a.userId ?? 'u1',
    scopeKind: a.scopeKind ?? 'org',
    universeId: a.universeId ?? null,
    engagementId: a.engagementId ?? null,
    isDefault: a.isDefault ?? false,
    roleSlug: a.roleSlug,
  };
}

function scopedDefault(d: Partial<ScopeDefault> & { roleSlug: string }): ScopeDefault {
  return {
    id: d.id ?? `d-${d.roleSlug}-${d.scopeKind ?? 'org'}`,
    scopeKind: d.scopeKind ?? 'org',
    universeId: d.universeId ?? null,
    engagementId: d.engagementId ?? null,
    roleSlug: d.roleSlug,
    isDefault: d.isDefault ?? true,
  };
}

describe('scoped role resolution (owner 2026-10-30: every role configurable per org/universe/engagement)', () => {
  it('the most specific scope wins: engagement, then universe, then org', () => {
    const assignments = [
      assignment({ roleSlug: 'auditee', scopeKind: 'org' }),
      assignment({ roleSlug: 'observer', scopeKind: 'universe', universeId: 'U1' }),
      assignment({ roleSlug: 'reviewer', scopeKind: 'engagement', engagementId: 'E1' }),
    ];
    const atEngagement = resolveAccess(assignments, 'cia', RIGHTS_BY_ROLE, 'u1', 'U1', 'E1');
    expect(atEngagement.source).toBe('engagement');
    expect(atEngagement.roleSlugs).toEqual(['reviewer']);

    const atUniverseOnly = resolveAccess(assignments, 'cia', RIGHTS_BY_ROLE, 'u1', 'U1', 'E2');
    expect(atUniverseOnly.source).toBe('universe');
    expect(atUniverseOnly.roleSlugs).toEqual(['observer']);

    const atOtherUniverse = resolveAccess(assignments, 'cia', RIGHTS_BY_ROLE, 'u1', 'U2', null);
    expect(atOtherUniverse.source).toBe('org');
    expect(atOtherUniverse.roleSlugs).toEqual(['auditee']);
  });

  it('with no scoped grant the membership role stands — an org that configures nothing is unchanged', () => {
    const access = resolveAccess([], 'cia', RIGHTS_BY_ROLE, 'u1', 'U1', 'E1');
    expect(access.source).toBe('membership');
    expect(access.roleSlugs).toEqual(['cia']);
    expect(access.rights.approve_plan).toBe(true);
    expect(access.rights.manage_users).toBeUndefined();
  });

  it('a person with no role and no grant holds nothing', () => {
    const access = resolveAccess([], null, RIGHTS_BY_ROLE, 'u1', 'U1', 'E1');
    expect(access.source).toBe('none');
    expect(access.rights).toEqual({});
  });

  it('two roles at one scope add up rather than one winning', () => {
    const assignments = [
      assignment({ roleSlug: 'reviewer', scopeKind: 'engagement', engagementId: 'E1' }),
      assignment({ roleSlug: 'preparer', scopeKind: 'engagement', engagementId: 'E1' }),
    ];
    const access = resolveAccess(assignments, 'cia', RIGHTS_BY_ROLE, 'u1', 'U1', 'E1');
    expect(access.roleSlugs).toEqual(['preparer', 'reviewer']);
    expect(access.rights.perform_work).toBe(true);
    expect(access.rights.review_and_approve).toBe(true);
    expect(access.rights.manage_users).toBeUndefined();
  });

  it('every one of the seven roles resolves to its own rights, never another role’s', () => {
    const expected: Record<Role, Right> = {
      org_admin: 'manage_users',
      cia: 'approve_plan',
      audit_manager: 'manage_engagements',
      reviewer: 'review_and_approve',
      preparer: 'perform_work',
      observer: 'read_only',
      auditee: 'read_only',
    };
    for (const role of ROLES) {
      const assignments = [assignment({ roleSlug: role, scopeKind: 'org' })];
      const access = resolveAccess(assignments, null, RIGHTS_BY_ROLE, 'u1', null, null);
      expect(access.roleSlugs).toEqual([role]);
      expect(access.rights[expected[role]], `${role} should confer ${expected[role]}`).toBe(true);
      // The rights are exactly the role's own, not a superset.
      expect(access.rights).toEqual(rightsForRole(role));
    }
  });

  it('rolesAt only sees the exact scope, so a universe grant never leaks to a sibling universe', () => {
    const assignments = [
      assignment({ roleSlug: 'reviewer', scopeKind: 'universe', universeId: 'U1' }),
      assignment({ roleSlug: 'observer', scopeKind: 'universe', universeId: 'U2' }),
    ];
    expect(rolesAt(assignments, 'u1', 'universe', 'U1', null)).toEqual(['reviewer']);
    expect(rolesAt(assignments, 'u1', 'universe', 'U2', null)).toEqual(['observer']);
    expect(rolesAt(assignments, 'u1', 'universe', 'U3', null)).toEqual([]);
  });

  it('unionRights unions only true rights and keeps the closed RIGHTS order elsewhere', () => {
    const union = unionRights(['reviewer', 'preparer'], RIGHTS_BY_ROLE);
    expect(union.review_and_approve).toBe(true);
    expect(union.perform_work).toBe(true);
    expect(union.manage_users).toBeUndefined();
    expect(rightsInOrder(['reviewer', 'preparer'], RIGHTS_BY_ROLE)).toEqual(['review_and_approve', 'perform_work']);
  });

  it('an unknown slug confers nothing rather than throwing', () => {
    expect(rightsForSlug('no_such_role', {})).toEqual({});
    expect(unionRights(['no_such_role'], RIGHTS_BY_ROLE)).toEqual({});
  });
});

describe('applicableDefaults — the default a new assignment would inherit', () => {
  const defaults = [
    scopedDefault({ roleSlug: 'auditee', scopeKind: 'org' }),
    scopedDefault({ roleSlug: 'observer', scopeKind: 'universe', universeId: 'U1' }),
    scopedDefault({ roleSlug: 'reviewer', scopeKind: 'engagement', engagementId: 'E1' }),
  ];

  it('chooses the nearest scope that has an enabled default', () => {
    expect(applicableDefaults(defaults, 'U1', 'E1')).toEqual({ source: 'engagement', roleSlugs: ['reviewer'] });
    expect(applicableDefaults(defaults, 'U1', 'E2')).toEqual({ source: 'universe', roleSlugs: ['observer'] });
    expect(applicableDefaults(defaults, 'U2', null)).toEqual({ source: 'org', roleSlugs: ['auditee'] });
  });

  it('a disabled default does not apply', () => {
    const disabled = defaults.map((d) => (d.scopeKind === 'engagement' ? { ...d, isDefault: false } : d));
    expect(applicableDefaults(disabled, 'U1', 'E1')).toEqual({ source: 'universe', roleSlugs: ['observer'] });
  });

  it('with nothing configured there is no default to inherit', () => {
    expect(applicableDefaults([], 'U1', 'E1')).toBeNull();
  });
});

describe('explainAccess — the reason names the winning scope, never a bare verdict', () => {
  const label = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

  it('names the scope and the roles for each source', () => {
    expect(explainAccess({ source: 'engagement', roleSlugs: ['reviewer'], rights: {} }, label))
      .toBe('Held at this engagement: Reviewer.');
    expect(explainAccess({ source: 'universe', roleSlugs: ['observer'], rights: {} }, label))
      .toContain('universe');
    expect(explainAccess({ source: 'org', roleSlugs: ['auditee'], rights: {} }, label))
      .toContain('organisation default');
    expect(explainAccess({ source: 'membership', roleSlugs: ['cia'], rights: {} }, label))
      .toContain('membership role');
    expect(explainAccess({ source: 'none', roleSlugs: [], rights: {} }, label))
      .toContain('No role');
  });
});

describe('the scoped model agrees with migration 0199 (the SQL resolution)', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/0199_role_scope_config.sql'), 'utf8');

  it('the migration defines the same three scopes and the same resolution order', () => {
    expect(sql).toContain("scope_kind in ('org','universe','engagement')");
    // The order of the resolution: engagement, then universe, then org, then the membership role.
    const engagement = sql.indexOf("v_source := 'engagement'");
    const universe = sql.indexOf("v_source := 'universe'");
    const org = sql.indexOf("v_source := 'org'");
    const membership = sql.indexOf("v_source := 'membership'");
    expect(engagement).toBeGreaterThan(-1);
    expect(universe).toBeGreaterThan(engagement);
    expect(org).toBeGreaterThan(universe);
    expect(membership).toBeGreaterThan(org);
  });

  it('the migration unions the roles at the winning scope rather than picking one', () => {
    expect(sql).toMatch(/jsonb_object_agg\(e\.key, \(e\.value\)::boolean\)/);
  });

  it('the rights predicate is the resolution, so no caller compares a role name', () => {
    expect(sql).toMatch(/role_effective_has_right/);
    expect(sql).toContain("-> 'rights' ->> p_right");
  });
});
