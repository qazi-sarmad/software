import { describe, it, expect } from 'vitest';

import { runOcrWithLanguages } from './ocr';

describe('runOcrWithLanguages — language-aware OCR seam', () => {
  const scanHint = { status: 'done' as const, text: null, kind: 'pdf' as const };

  it('configures the engine lang string and reports the languages loaded', async () => {
    const engine = { name: 'tesseract-wasm', remote: false, recognize: async () => ({ text: 'اردو متن', confidence: 0.8 }) };
    const out = await runOcrWithLanguages(new Uint8Array([1]), scanHint, engine, ['eng', 'urd'], ['core', 'extended']);
    expect(out.status).toBe('done');
    expect(out.lang).toBe('eng+urd');
    expect(out.text).toContain('اردو');
  });

  it('reports a language whose pack is not vendored, and still reads with what is loaded', async () => {
    const engine = { name: 'tesseract-wasm', remote: false, recognize: async () => ({ text: 'text', confidence: 0.9 }) };
    const out = await runOcrWithLanguages(new Uint8Array([1]), scanHint, engine, ['urd'], ['core']);
    expect(out.lang).toBe('eng');
    expect(out.missing).toEqual([{ code: 'urd', reason: expect.stringContaining('not vendored') }]);
  });

  it('still fails closed with no engine, carrying the language it would have used', async () => {
    const out = await runOcrWithLanguages(new Uint8Array([1]), scanHint, null, ['eng', 'ara'], ['core', 'extended']);
    expect(out.status).toBe('unsupported');
    expect(out.reason).toContain('no OCR engine is bundled');
    expect(out.lang).toBe('eng+ara');
  });
});
