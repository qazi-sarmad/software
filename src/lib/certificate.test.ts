import { describe, expect, it } from 'vitest';
import {
  canonicalDocument,
  canonicalValue,
  certificateHash,
  certificateVerifyUrl,
  enabledFields,
  isVerifiable,
  matchesHash,
  parseDroppedDocument,
  sha256Hex,
  statusLabel,
} from './certificate';

const DOC = {
  engagement_id: '50000000-0000-0000-0000-0000000000a1',
  engagement_title: 'Treasury review 2026',
  organisation_id: 'a0000000-0000-0000-0000-000000000001',
  engagement_root_hash: 'ab'.repeat(32),
  version: 1,
  issued_at: '2026-10-19T00:00:00Z',
  sealed_workpapers: 12,
  findings_count: 3,
  sealing_actors: ['10000000-0000-0000-0000-0000000000a1'],
  extra: {},
};

describe('canonicalValue mirrors public.canonical_value (0006)', () => {
  it('sorts object keys by C order and emits no whitespace', () => {
    expect(canonicalValue({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('keeps array order', () => {
    expect(canonicalValue([3, 1, 2])).toBe('[3,1,2]');
  });

  it('JSON-escapes strings the way the database does', () => {
    expect(canonicalValue('a"b')).toBe('"a\\"b"');
    expect(canonicalValue('line\nbreak')).toBe('"line\\nbreak"');
  });

  it('renders booleans and null', () => {
    expect(canonicalValue(true)).toBe('true');
    expect(canonicalValue(null)).toBe('null');
    expect(canonicalValue(undefined)).toBe('null');
  });

  it('handles nested objects and arrays', () => {
    expect(canonicalValue({ z: [{ y: 1 }], a: null })).toBe('{"a":null,"z":[{"y":1}]}');
  });

  it('drops undefined members rather than writing null', () => {
    expect(canonicalValue({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('is stable across key insertion order', () => {
    const first = { b: 1, a: 2 };
    const second = { a: 2, b: 1 };
    expect(canonicalValue(first)).toBe(canonicalValue(second));
  });

  it('is empty for null and undefined documents', () => {
    expect(canonicalDocument(null)).toBe('{}');
    expect(canonicalDocument(undefined)).toBe('{}');
  });
});

describe('sha256Hex and certificateHash', () => {
  it('hashes the empty string to the known SHA-256', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('hashes "abc" to the known SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('hashes the canonical document, not the raw object', async () => {
    const one = await certificateHash({ b: 1, a: 2 });
    const two = await certificateHash({ a: 2, b: 1 });
    expect(one).toBe(two);
  });

  it('produces a 64-character hex string', async () => {
    expect(await certificateHash(DOC)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('matchesHash compares a dropped document against the recorded hash', () => {
  it('matches when the document is unchanged', async () => {
    const expected = await certificateHash(DOC);
    expect(await matchesHash(DOC, expected)).toEqual({ matches: true, computed: expected });
  });

  it('does not match when a field changes', async () => {
    const expected = await certificateHash(DOC);
    const tampered = { ...DOC, findings_count: 4 };
    const result = await matchesHash(tampered, expected);
    expect(result.matches).toBe(false);
    expect(result.computed).not.toBe(expected);
  });

  it('compares hashes case-insensitively', async () => {
    const expected = (await certificateHash(DOC)).toUpperCase();
    expect((await matchesHash(DOC, expected)).matches).toBe(true);
  });
});

describe('parseDroppedDocument reads a dropped JSON or PDF text', () => {
  it('reads a bare JSON document', () => {
    expect(parseDroppedDocument(JSON.stringify(DOC))).toEqual(DOC);
  });

  it('reads JSON embedded in surrounding text', () => {
    expect(parseDroppedDocument(`Certificate\n${JSON.stringify(DOC)}\nend`)).toEqual(DOC);
  });

  it('returns null for text with no object', () => {
    expect(parseDroppedDocument('no certificate here')).toBeNull();
  });

  it('returns null for a JSON array', () => {
    expect(parseDroppedDocument('[1,2,3]')).toBeNull();
  });

  it('returns null for a broken object', () => {
    expect(parseDroppedDocument('{ "a": ')).toBeNull();
  });
});

describe('status helpers', () => {
  it('labels every status in plain words', () => {
    expect(statusLabel('valid')).toBe('Valid');
    expect(statusLabel('superseded')).toBe('Superseded');
    expect(statusLabel('revoked')).toBe('Revoked');
    expect(statusLabel('not_found')).toBe('Not found');
  });

  it('falls back to the raw key for an unknown status', () => {
    expect(statusLabel('weird')).toBe('weird');
  });

  it('treats only valid as verifiable', () => {
    expect(isVerifiable('valid')).toBe(true);
    expect(isVerifiable('revoked')).toBe(false);
    expect(isVerifiable('superseded')).toBe(false);
    expect(isVerifiable('not_found')).toBe(false);
  });
});

describe('enabledFields', () => {
  it('keeps only enabled fields, in ordinal order', () => {
    const fields = [
      { fieldKey: 'b', label: 'B', ordinal: 2, enabled: true },
      { fieldKey: 'a', label: 'A', ordinal: 1, enabled: true },
      { fieldKey: 'c', label: 'C', ordinal: 3, enabled: false },
    ];
    expect(enabledFields(fields).map((f) => f.fieldKey)).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const fields = [
      { fieldKey: 'b', label: 'B', ordinal: 2, enabled: true },
      { fieldKey: 'a', label: 'A', ordinal: 1, enabled: true },
    ];
    enabledFields(fields);
    expect(fields.map((f) => f.fieldKey)).toEqual(['b', 'a']);
  });
});

describe('certificateVerifyUrl', () => {
  it('builds the public verification route', () => {
    expect(certificateVerifyUrl('https://app.invalid', 'cert-1')).toBe('https://app.invalid/verify/cert-1');
  });

  it('trims a trailing slash from the base url', () => {
    expect(certificateVerifyUrl('https://app.invalid/', 'cert-1')).toBe('https://app.invalid/verify/cert-1');
  });
});
