// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseDocumentStructure, hasSignature } from './structured';
import { needsOcr, runOcr, type OcrEngine, type ExtractionHint } from './ocr';

describe('structured extraction, tier 3 (S7, spec §5)', () => {
  it('parses declared fields, clauses, action items and signatures with their line numbers', () => {
    const text = [
      'Vendor: Acme Ltd',
      'Invoice No: INV-42',
      'Amount: 1,000.00',
      'Date: 2026-10-29',
      '1. The supplier must deliver within 30 days (see 2.1).',
      'Action: Review invoice, Owner: Ada, Due: 2026-11-05',
      'Signed: R. Jones',
    ].join('\n');
    const { document, coverage } = parseDocumentStructure(text, 'invoice', 'inv-42');
    const labels = document.elements.filter((e) => e.role === 'field').map((e) => e.label);
    expect(labels).toEqual(['vendor', 'reference', 'amount', 'date']);
    const clause = document.elements.find((e) => e.role === 'clause');
    expect(clause?.label).toBe('1');
    expect(clause?.crossRefs).toContain('2.1');
    const action = document.elements.find((e) => e.role === 'action_item');
    expect(action?.label).toBe('Ada');
    expect(action?.value).toBe('2026-11-05');
    expect(hasSignature(document)).toBe(true);
    expect(document.elements.every((e) => e.line >= 1)).toBe(true);
    expect(coverage.parsed).toBe(document.elements.length);
  });

  it('counts uninterpreted lines rather than silently dropping them (spec §3.3 coverage)', () => {
    const text = 'Vendor: Acme\nthis line is prose that matches no declared shape.\n';
    const { coverage } = parseDocumentStructure(text, 'contract', 'c1');
    expect(coverage.lines).toBe(2);
    expect(coverage.parsed).toBe(1);
    expect(coverage.uninterpreted).toBe(1);
  });

  it('reports the cross-reference a clause cites so a coverage rule can match it', () => {
    const { document } = parseDocumentStructure('2. The operator shall record every step (4.1).', 'procedure', 'p1');
    expect(document.elements[0].crossRefs).toEqual(['4.1']);
  });
});

const scan: ExtractionHint = { status: 'unsupported', text: null, kind: 'pdf' };

describe('OCR seam, tier 2 (S7, spec §5)', () => {
  it('needs OCR only for a scan with no text layer', () => {
    expect(needsOcr(scan)).toBe(true);
    expect(needsOcr({ status: 'done', text: 'hello', kind: 'pdf' })).toBe(false);
    expect(needsOcr({ status: 'legacy_not_extracted', text: null, kind: 'legacy' })).toBe(false);
    expect(needsOcr({ status: 'failed', text: null, kind: 'pdf' })).toBe(false);
    expect(needsOcr({ status: 'unsupported', text: null, kind: 'csv' })).toBe(false);
  });

  it('fails closed with no engine: the scan is stored, not invented', async () => {
    const r = await runOcr(new Uint8Array([1]), scan, null);
    expect(r.status).toBe('unsupported');
    expect(r.text).toBeNull();
    expect(r.reason).toMatch(/no OCR engine/);
  });

  it('refuses a remote engine so nothing leaves the tenant (L2)', async () => {
    const remote: OcrEngine = { name: 'cloud-ocr', remote: true, recognize: async () => ({ text: 'leaked', confidence: 1 }) };
    const r = await runOcr(new Uint8Array([1]), scan, remote);
    expect(r.status).toBe('unsupported');
    expect(r.text).toBeNull();
    expect(r.reason).toMatch(/remote/);
  });

  it('runs a local engine and returns its text', async () => {
    const local: OcrEngine = { name: 'tesseract-wasm', remote: false, recognize: async () => ({ text: 'Scanned Invoice', confidence: 0.9 }) };
    const r = await runOcr(new Uint8Array([1]), scan, local);
    expect(r.status).toBe('done');
    expect(r.text).toBe('Scanned Invoice');
    expect(r.engine).toBe('tesseract-wasm');
  });

  it('does not run OCR when tier 1 already produced text', async () => {
    let called = false;
    const engine: OcrEngine = { name: 'x', remote: false, recognize: async () => { called = true; return { text: '', confidence: null }; } };
    const r = await runOcr(new Uint8Array([1]), { status: 'done', text: 'already', kind: 'pdf' }, engine);
    expect(called).toBe(false);
    expect(r.status).toBe('unsupported');
  });
});
