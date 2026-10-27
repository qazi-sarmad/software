import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, withheldReason } from './claims';

/** Build an unsigned JWT with the given payload, so the decoder has a real base64url segment. */
function token(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('decodeJwtPayload', () => {
  it('decodes the payload segment', () => {
    expect(decodeJwtPayload(token({ org_id: 'o', user_role: 'cia' }))).toMatchObject({ org_id: 'o', user_role: 'cia' });
  });

  it('returns null for a null, empty or malformed token', () => {
    expect(decodeJwtPayload(null)).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
  });
});

describe('withheldReason', () => {
  it('is null when the org claim is present', () => {
    expect(withheldReason({ org_id: 'o', mfa_required: true })).toBeNull();
  });

  it('reports mfa_required when the claim is set and the org claim is absent', () => {
    expect(withheldReason({ mfa_required: true })).toBe('mfa_required');
  });

  it('reports sso_required when the claim is set and the org claim is absent', () => {
    expect(withheldReason({ sso_required: true })).toBe('sso_required');
  });

  it('prefers mfa over sso when both are set', () => {
    expect(withheldReason({ mfa_required: true, sso_required: true })).toBe('mfa_required');
  });

  it('is null for an ordinary token and for an empty payload', () => {
    expect(withheldReason({ user_role: 'cia' })).toBeNull();
    expect(withheldReason(null)).toBeNull();
  });

  it('does not treat a false flag as withheld', () => {
    expect(withheldReason({ mfa_required: false })).toBeNull();
  });
});
