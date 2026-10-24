import { describe, expect, it } from 'vitest';
import { isUuid } from './ids';

describe('isUuid', () => {
  it('accepts a canonical uuid in either case', () => {
    expect(isUuid('02af9314-9781-5bde-b8a7-d46bfee07783')).toBe(true);
    expect(isUuid('02AF9314-9781-5BDE-B8A7-D46BFEE07783')).toBe(true);
  });

  it('rejects the development seed ids', () => {
    expect(isUuid('u-gbm')).toBe(false);
    expect(isUuid('ent-treasury')).toBe(false);
  });

  it('rejects empty, null and malformed values', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid('02af9314-9781-5bde-b8a7')).toBe(false);
    expect(isUuid('02af9314-9781-5bde-b8a7-d46bfee0778z')).toBe(false);
  });
});
