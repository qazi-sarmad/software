import { describe, expect, it } from 'vitest';
import {
  getCertificate,
  getCertificateConfig,
  issueCertificate,
  listCertificates,
  revokeCertificate,
  saveCertificateConfig,
  verifyBoardPack,
  verifyCertificate,
} from './certificate';

/**
 * With no Supabase environment variables the certificate module is inert: every read returns empty
 * and every write reports that the module is not configured. No request leaves the process.
 */
describe('certificate data module (not configured)', () => {
  it('reads return empty', async () => {
    expect(await listCertificates('a0000000-0000-0000-0000-000000000001')).toEqual([]);
    expect(await getCertificate('c1')).toBeNull();
    expect(await getCertificateConfig('a0000000-0000-0000-0000-000000000001')).toEqual([]);
  });

  it('writes report not configured', async () => {
    expect(await issueCertificate('e1')).toEqual({
      ok: false, reason: 'The certificate module is not configured.',
    });
    expect(await revokeCertificate('c1', 'a real reason')).toEqual({
      ok: false, reason: 'The certificate module is not configured.',
    });
    expect(await saveCertificateConfig('a0000000-0000-0000-0000-000000000001', [])).toEqual({
      ok: false, reason: 'The certificate module is not configured.',
    });
  });

  it('the anonymous verification calls return null without a client', async () => {
    expect(await verifyCertificate('c1')).toBeNull();
    expect(await verifyBoardPack('p1')).toBeNull();
  });
});
