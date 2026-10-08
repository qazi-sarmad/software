import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGlassBoxTokenRecord,
  validateEvidenceFile,
  validateGlassBoxToken,
} from './glassbox';

describe('Task 5: Auditee Glass Box Token Verification & Dropzone Security', () => {
  it('Successfully creates and validates a fresh, valid token for the correct org', async () => {
    const { rawToken, record } = await createGlassBoxTokenRecord({
      workpaperId: 'wp-lcr-01',
      entityId: 'ent-treasury',
      orgId: 'org-alpha',
    });

    const store = [record];
    const validation = await validateGlassBoxToken(rawToken, 'org-alpha', store);
    expect(validation.valid).toBe(true);
    expect(validation.record?.workpaperId).toBe('wp-lcr-01');
    expect(validation.error).toBeUndefined();
  });

  it('Rejects tokens from a different organization (wrong-org)', async () => {
    const { rawToken, record } = await createGlassBoxTokenRecord({
      workpaperId: 'wp-lcr-01',
      entityId: 'ent-treasury',
      orgId: 'org-alpha',
    });

    const store = [record];
    // User / session is authenticated in org-beta attempting to use org-alpha token
    const validation = await validateGlassBoxToken(rawToken, 'org-beta', store);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('unauthorized organization');
  });

  it('Rejects expired tokens (> 7 days)', async () => {
    const { rawToken, record } = await createGlassBoxTokenRecord({
      workpaperId: 'wp-lcr-01',
      entityId: 'ent-treasury',
      orgId: 'org-alpha',
    });

    // Fast-forward 8 days into the future
    const eightDaysLater = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const store = [record];
    const validation = await validateGlassBoxToken(
      rawToken,
      'org-alpha',
      store,
      eightDaysLater
    );
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('expired');
  });

  it('Rejects reused tokens (single-use guarantee)', async () => {
    const { rawToken, record } = await createGlassBoxTokenRecord({
      workpaperId: 'wp-lcr-01',
      entityId: 'ent-treasury',
      orgId: 'org-alpha',
    });

    // Mark as used after first upload
    const usedRecord = { ...record, used: true, usedAt: new Date().toISOString() };
    const store = [usedRecord];
    const validation = await validateGlassBoxToken(rawToken, 'org-alpha', store);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('already been used');
  });

  it('Enforces file extension and maximum size constraints', async () => {
    const { record } = await createGlassBoxTokenRecord({
      workpaperId: 'wp-1',
      entityId: 'ent-1',
      orgId: 'org-alpha',
      allowedExtensions: ['.pdf', '.xlsx'],
      maxSizeBytes: 5 * 1024 * 1024, // 5 MB
    });

    // Allowed extension & valid size
    expect(validateEvidenceFile('report.xlsx', 1024 * 1024, record).allowed).toBe(true);

    // Disallowed extension (.exe)
    const badExt = validateEvidenceFile('payload.exe', 1024, record);
    expect(badExt.allowed).toBe(false);
    expect(badExt.error).toContain('not permitted');

    // Oversized file (6 MB > 5 MB)
    const oversized = validateEvidenceFile('huge.pdf', 6 * 1024 * 1024, record);
    expect(oversized.allowed).toBe(false);
    expect(oversized.error).toContain('exceeds the permitted cap');
  });
  describe('secure randomness', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('throws "Secure random unavailable" and never uses Math.random when crypto is missing', async () => {
      const mathSpy = vi.spyOn(Math, 'random');
      vi.stubGlobal('crypto', undefined);
      await expect(
        createGlassBoxTokenRecord({ workpaperId: 'wp-x', entityId: 'ent-x', orgId: 'org-x' })
      ).rejects.toThrow('Secure random unavailable');
      expect(mathSpy).not.toHaveBeenCalled();
    });

    it('produces a 64-hex-character token without touching Math.random', async () => {
      const mathSpy = vi.spyOn(Math, 'random');
      const { rawToken } = await createGlassBoxTokenRecord({
        workpaperId: 'wp-x',
        entityId: 'ent-x',
        orgId: 'org-x',
      });
      expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
      expect(mathSpy).not.toHaveBeenCalled();
    });
  });
});
