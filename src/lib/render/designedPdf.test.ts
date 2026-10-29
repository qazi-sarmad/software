import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { renderDesignedPdf, pageNumberText } from './designedPdf';
import { renderDocx, docxPlainText } from './docx';
import type { DocumentModel } from './document';
import { DEFAULT_BRANDING } from './branding';
import { designFromFormat, hasDesign } from '../writing/renderDesign';
import { cloneLayout, DEFAULT_FORMAT_LAYOUT } from '../writing/reportFormat';
import { defaultShape } from '../writing/shapes';
import type { FormatLayout } from '../writing/reportFormat';

const design = (over: Partial<FormatLayout> = {}) => {
  const layout = { ...cloneLayout(DEFAULT_FORMAT_LAYOUT), ...over };
  return designFromFormat(layout, (v) => (v.startsWith('#') ? v : '#2f6f5e'), {
    org: 'Acme Ltd', engagement: 'FY24 audit', classification: 'Internal', date: '2026-01-01T00:00:00Z', user: 'A. Auditor',
  });
};

const model = (over: Partial<FormatLayout> = {}, sections = 2): DocumentModel => ({
  title: 'Audit report',
  subtitle: 'Formal',
  sections: Array.from({ length: sections }, (_, i) => ({
    heading: `Section ${i + 1}`,
    key: `sec-${i + 1}`,
    blocks: [{ kind: 'paragraph' as const, text: `Body text for section ${i + 1}. `.repeat(4) }],
  })),
  typography: { headingPt: 15, bodyPt: 11, lineHeight: 1.4, headingWeight: 600, bodyWeight: 400 },
  design: design(over),
});

/** The raw XML of a named part inside the DOCX archive. */
async function partXml(bytes: Uint8Array, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const f = zip.file(name);
  return f ? f.async('string') : '';
}

describe('renderDesignedPdf', () => {
  it('renders a designed page to a readable PDF', async () => {
    const bytes = await renderDesignedPdf({ orgId: 'o', ...DEFAULT_BRANDING }, model());
    expect(bytes.length).toBeGreaterThan(500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic: the same model yields byte-identical bytes', async () => {
    const spec = { orgId: 'o', ...DEFAULT_BRANDING };
    const a = await renderDesignedPdf(spec, model());
    const b = await renderDesignedPdf(spec, model());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('honours the orientation: a landscape design is wider than tall', async () => {
    const bytes = await renderDesignedPdf({ orgId: 'o', ...DEFAULT_BRANDING }, model({ orientation: 'landscape' }));
    const doc = await PDFDocument.load(bytes);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });

  it('prints every section on the page', async () => {
    const bytes = await renderDesignedPdf({ orgId: 'o', ...DEFAULT_BRANDING }, model({}, 1));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders with columns, shapes, links and cross-references without error', async () => {
    const layout: Partial<FormatLayout> = {
      columns: 2,
      shapes: [defaultShape('callout', 'c1', 1, 10, 10, 1)],
      links: [{ id: 'l1', label: 'Provio', url: 'https://example.test', underline: true }],
      crossReferences: [{ id: 'r1', kind: 'heading', targetKey: 'sec-1', label: 'see' }],
      numberedHeadings: true,
      defaultTableStyle: 'zebra',
    };
    const bytes = await renderDesignedPdf({ orgId: 'o', ...DEFAULT_BRANDING }, model(layout));
    expect(bytes.length).toBeGreaterThan(500);
  });
});

describe('pageNumberText', () => {
  it('prints each page-number style', () => {
    expect(pageNumberText('n', 3, 9)).toBe('3');
    expect(pageNumberText('page-n', 3, 9)).toBe('Page 3');
    expect(pageNumberText('n-of-total', 3, 9)).toBe('3 of 9');
    expect(pageNumberText('page-n-of-total', 3, 9)).toBe('Page 3 of 9');
    expect(pageNumberText('none', 3, 9)).toBe('');
  });
});

describe('renderDocx with a design', () => {
  it('prints the header and footer text into the document', async () => {
    const m = model({ chrome: { ...design().chrome, headerEnabled: true, footerEnabled: true, headerCentre: '{engagement}', footerLeft: '{org}' } });
    const bytes = await renderDocx(m);
    const header = await partXml(bytes, 'word/header1.xml');
    const footer = await partXml(bytes, 'word/footer1.xml');
    expect(header).toContain('FY24 audit');
    expect(footer).toContain('Acme Ltd');
    // The header carries a real page-number field in the footer.
    expect(footer).toMatch(/PAGE/);
  });

  it('sets the page size, orientation and column count from the design', async () => {
    const m = model({ orientation: 'landscape', columns: 2, columnGapMm: 8 });
    const bytes = await renderDocx(m);
    const doc = await partXml(bytes, 'word/document.xml');
    const sectPr = doc.slice(doc.lastIndexOf('<w:sectPr'));
    expect(sectPr).toContain('w:cols');
    expect(sectPr).toMatch(/w:num="2"/);
  });

  it('appends the link list and the cross-reference list', async () => {
    const m = model({
      links: [{ id: 'l1', label: 'Provio site', url: 'https://example.test', underline: true }],
      crossReferences: [{ id: 'r1', kind: 'heading', targetKey: 'sec-1', label: 'see' }],
    });
    const bytes = await renderDocx(m);
    const text = await docxPlainText(bytes);
    expect(text).toContain('Links');
    expect(text).toContain('Provio site');
    expect(text).toContain('References');
    expect(text).toContain('see Section 1');
  });

  it('stays deterministic with a design', async () => {
    const a = await renderDocx(model());
    const b = await renderDocx(model());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('hasDesign', () => {
  it('is false for the plain default and true for a designed format', () => {
    expect(hasDesign(cloneLayout(DEFAULT_FORMAT_LAYOUT))).toBe(false);
    expect(hasDesign({ ...cloneLayout(DEFAULT_FORMAT_LAYOUT), columns: 2 })).toBe(true);
    expect(hasDesign({ ...cloneLayout(DEFAULT_FORMAT_LAYOUT), defaultTableStyle: 'zebra' })).toBe(true);
    expect(hasDesign({ ...cloneLayout(DEFAULT_FORMAT_LAYOUT), chrome: { ...design().chrome, headerEnabled: true } })).toBe(true);
  });
});
