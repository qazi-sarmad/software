import { describe, expect, it } from 'vitest';
import {
  RIGHTS,
  hasAnyAuditRight,
  hasRight,
  isReadOnly,
  rightsForRole,
  rightsOf,
  roleLabel,
} from './rights';
import type { Role, User } from '../types';

function user(role: Role, extra: Partial<User> = {}): User {
  return {
    id: `u-${role}`,
    name: role,
    email: `${role}@test.invalid`,
    avatar: 'XX',
    role,
    universeIds: [],
    entityIds: [],
    ...extra,
  };
}

describe('rights model (2F-2b)', () => {
  it('exposes the closed fourteen-key vocabulary', () => {
    expect(RIGHTS).toHaveLength(14);
    expect(new Set(RIGHTS).size).toBe(14);
    for (const key of ['view_board_pack', 'generate_board_pack', 'view_insights']) {
      expect(RIGHTS).toContain(key);
    }
  });

  it('maps every role to a default rights bag', () => {
    for (const r of ['cia', 'audit_manager', 'reviewer', 'preparer', 'observer', 'org_admin', 'auditee'] as Role[]) {
      expect(rightsForRole(r)).toBeTypeOf('object');
    }
  });

  it('a session right cannot be dropped by an incomplete map (defaults are unioned)', () => {
    const u = user('cia', { rights: {} });
    // An empty map falls back to the role defaults.
    expect(hasRight(u, 'approve_plan')).toBe(true);
    // A partial map keeps the role defaults it does not mention.
    const partial = user('cia', { rights: { manage_engagements: false } });
    expect(hasRight(partial, 'manage_engagements')).toBe(false);
    expect(hasRight(partial, 'approve_plan')).toBe(true);
  });

  it('an explicit right can be added to a role that does not hold it by default', () => {
    const u = user('preparer', { rights: { manage_users: true } });
    expect(hasRight(u, 'manage_users')).toBe(true);
    expect(hasRight(u, 'perform_work')).toBe(true);
  });

  it('hasRight is false for a null session and an unknown right key', () => {
    expect(hasRight(null, 'can_reopen')).toBe(false);
    expect(hasRight(user('cia'), 'not_a_right' as never)).toBe(false);
  });

  it('a configuration-only principal holds no audit right', () => {
    const admin = user('org_admin');
    expect(hasAnyAuditRight(admin)).toBe(false);
    expect(hasRight(admin, 'edit_config')).toBe(true);
  });

  it('audit principals hold at least one audit right', () => {
    for (const r of ['cia', 'audit_manager', 'reviewer', 'preparer', 'observer', 'auditee'] as Role[]) {
      expect(hasAnyAuditRight(user(r))).toBe(true);
    }
  });

  it('isReadOnly distinguishes a pure reader from a scoped auditee and from workers', () => {
    expect(isReadOnly(user('observer'))).toBe(true);
    expect(isReadOnly(user('auditee'))).toBe(true);
    expect(isReadOnly(user('preparer'))).toBe(false);
    expect(isReadOnly(user('cia'))).toBe(false);
    expect(isReadOnly(null)).toBe(false);
  });

  it('observer and auditee differ only by the all-scope right', () => {
    const observer = rightsOf(user('observer'));
    const auditee = rightsOf(user('auditee'));
    expect(observer.read_only).toBe(true);
    expect(auditee.read_only).toBe(true);
    expect(observer.view_all_scopes).toBe(true);
    expect(auditee.view_all_scopes).not.toBe(true);
  });

  it('only cia holds approve_plan and can_reopen by default', () => {
    for (const r of ['audit_manager', 'reviewer', 'preparer', 'observer', 'org_admin', 'auditee'] as Role[]) {
      expect(hasRight(user(r), 'approve_plan')).toBe(false);
      expect(hasRight(user(r), 'can_reopen')).toBe(false);
    }
    expect(hasRight(user('cia'), 'approve_plan')).toBe(true);
    expect(hasRight(user('cia'), 'can_reopen')).toBe(true);
  });

  it('names every seeded role for display, never the raw slug', () => {
    // The labels are the `roles.name` values the database seeds (migration 0097 seed_role_matrix).
    expect(roleLabel('cia')).toBe('CIA');
    expect(roleLabel('org_admin')).toBe('Org Admin');
    expect(roleLabel('audit_manager')).toBe('Audit Manager');
    expect(roleLabel('reviewer')).toBe('Reviewer');
    expect(roleLabel('preparer')).toBe('Preparer');
    expect(roleLabel('observer')).toBe('Observer');
    expect(roleLabel('auditee')).toBe('Auditee');
    // No label equals its own slug: a raw `ORG_ADMIN` never reaches a person.
    for (const r of ['cia', 'org_admin', 'audit_manager', 'reviewer', 'preparer', 'observer', 'auditee'] as Role[]) {
      expect(roleLabel(r)).not.toBe(r);
    }
  });

  it('falls back to a title-cased form for a tenant role and blanks for an absent one', () => {
    expect(roleLabel('quality_lead')).toBe('Quality Lead');
    expect(roleLabel('')).toBe('');
    expect(roleLabel(null)).toBe('');
    expect(roleLabel(undefined)).toBe('');
  });
});
