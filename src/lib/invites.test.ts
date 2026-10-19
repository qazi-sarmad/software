import { describe, expect, it } from 'vitest';
import {
  acceptanceLink, acceptanceRoute, evaluateInvitation, REJECTION_MESSAGES,
  type InvitationRow,
} from '../../supabase/functions/_shared/invites';

const NOW = new Date('2026-10-19T10:00:00.000Z');

function invitation(over: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: 'inv-1',
    org_id: 'org-a',
    email: 'new.auditor@example.test',
    role_slug: 'preparer',
    kind: 'member',
    expires_at: '2026-10-26T10:00:00.000Z',
    accepted_at: null,
    revoked_at: null,
    ...over,
  };
}

describe('invitation acceptance (S3, L1)', () => {
  it('accepts a fresh, unexpired, single-use invitation', () => {
    const d = evaluateInvitation('tok', invitation(), NOW);
    expect(d.ok).toBe(true);
  });

  it('refuses a missing or blank token', () => {
    expect(evaluateInvitation(null, invitation(), NOW)).toMatchObject({ ok: false, reason: 'token_required' });
    expect(evaluateInvitation('   ', invitation(), NOW)).toMatchObject({ ok: false, reason: 'token_required' });
  });

  it('refuses a token with no matching row', () => {
    expect(evaluateInvitation('tok', null, NOW)).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('refuses a used invitation', () => {
    const d = evaluateInvitation('tok', invitation({ accepted_at: '2026-10-19T09:00:00.000Z' }), NOW);
    expect(d).toMatchObject({ ok: false, reason: 'already_used' });
  });

  it('refuses a revoked invitation even before its expiry', () => {
    const d = evaluateInvitation('tok', invitation({ revoked_at: '2026-10-19T09:00:00.000Z' }), NOW);
    expect(d).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('refuses an expired invitation', () => {
    const d = evaluateInvitation('tok', invitation({ expires_at: '2026-10-19T09:59:59.000Z' }), NOW);
    expect(d).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('refuses a member invitation whose role no longer exists', () => {
    const d = evaluateInvitation('tok', invitation({ role_slug: null }), NOW);
    expect(d).toMatchObject({ ok: false, reason: 'no_role' });
  });

  it('an external-auditor invitation needs no org role', () => {
    const d = evaluateInvitation('tok', invitation({ kind: 'external_auditor', role_slug: null }), NOW);
    expect(d.ok).toBe(true);
  });

  it('revocation is checked before use, so a revoked-and-used row reports revoked', () => {
    const row = invitation({ accepted_at: '2026-10-19T09:00:00.000Z', revoked_at: '2026-10-19T09:30:00.000Z' });
    expect(evaluateInvitation('tok', row, NOW)).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('is deterministic: the same row and time always give the same answer', () => {
    const row = invitation();
    const first = evaluateInvitation('tok', row, NOW);
    const second = evaluateInvitation('tok', row, NOW);
    expect(first).toEqual(second);
  });

  it('every rejection carries a plain-language message', () => {
    const reasons = ['token_required', 'not_found', 'already_used', 'revoked', 'expired', 'no_role'] as const;
    for (const reason of reasons) {
      expect(REJECTION_MESSAGES[reason].length).toBeGreaterThan(10);
    }
  });

  it('routes members to the workspace and external auditors to their portal', () => {
    expect(acceptanceRoute('member')).toBe('/');
    expect(acceptanceRoute('external_auditor')).toBe('/external');
  });

  it('builds an acceptance link from the app base url, encoding the token', () => {
    expect(acceptanceLink('https://app.example/', 'a b')).toBe('https://app.example/invite/accept?token=a%20b');
    expect(acceptanceLink('https://app.example', 'tok')).toBe('https://app.example/invite/accept?token=tok');
  });
});
