import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  decodeMasterKey, decryptSecret, encryptSecret, maskValue, type CryptoLike,
} from '../../supabase/functions/_shared/secretsCrypto';

const crypto = webcrypto as unknown as CryptoLike;
const KEY = new Uint8Array(32).fill(7);
const KEY_B64 = Buffer.from(KEY).toString('base64');

describe('decodeMasterKey', () => {
  it('decodes a 32-byte base64 key', () => {
    expect(Array.from(decodeMasterKey(KEY_B64))).toEqual(Array.from(KEY));
  });
  it('rejects a key of the wrong length', () => {
    expect(() => decodeMasterKey(Buffer.from(new Uint8Array(16)).toString('base64')))
      .toThrow(/must decode to 32 bytes/);
  });
  it('rejects non-base64 text', () => {
    expect(() => decodeMasterKey('!!!not base64!!!')).toThrow(/not valid base64/);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a value', async () => {
    const stored = await encryptSecret('re_abcdef123456', KEY, crypto);
    expect(await decryptSecret(stored, KEY, crypto)).toBe('re_abcdef123456');
  });

  it('never stores the plaintext', async () => {
    const stored = await encryptSecret('super-secret-password', KEY, crypto);
    expect(stored).not.toContain('super-secret-password');
    expect(stored).not.toContain('password');
  });

  it('uses a fresh nonce each time, so equal values differ', async () => {
    const a = await encryptSecret('same-value', KEY, crypto);
    const b = await encryptSecret('same-value', KEY, crypto);
    expect(a).not.toBe(b);
  });

  it('fails closed on a wrong key', async () => {
    const stored = await encryptSecret('value', KEY, crypto);
    await expect(decryptSecret(stored, new Uint8Array(32).fill(9), crypto)).rejects.toThrow();
  });

  it('fails closed when one byte of the ciphertext is tampered with', async () => {
    const stored = await encryptSecret('value', KEY, crypto);
    const bytes = Buffer.from(stored, 'base64');
    bytes[bytes.length - 1] ^= 0xff;
    await expect(decryptSecret(bytes.toString('base64'), KEY, crypto)).rejects.toThrow();
  });

  it('rejects a malformed stored value', async () => {
    await expect(decryptSecret(Buffer.from(new Uint8Array(4)).toString('base64'), KEY, crypto))
      .rejects.toThrow(/malformed/);
  });
});

describe('maskValue', () => {
  it('shows only the last four characters', () => {
    expect(maskValue('re_abcdef123456')).toBe('•••• 3456');
  });
  it('does not leak the middle of a short value', () => {
    expect(maskValue('ab')).toBe('•••• ab');
    expect(maskValue('ab')).not.toContain('abcdef');
  });
  it('handles an empty value', () => {
    expect(maskValue('')).toBe('•••• not set');
    expect(maskValue(null)).toBe('•••• not set');
    expect(maskValue(undefined)).toBe('•••• not set');
  });
});
