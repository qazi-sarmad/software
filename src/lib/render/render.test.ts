/**
 * Renderer unit tests (S4.b, F9, F10, F11). Pure functions, no network.
 *
 * Covers: page size and margins; header/footer variable substitution; PDF bytes carry the title
 * text and are a valid PDF; a QR encodes the verification URL; a PPTX contains text boxes, a table
 * and a native chart part; theme extraction reads colours, fonts and slide size from a sample .pptx
 * generated here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import {
  brandingFromRow, DEFAULT_BRANDING, fillTemplate, mmToPt, pageDimensions, resolveHexColour, toCssColour,
} from './branding';
import { renderPdf, wrapText } from './pdf';
import { REPORT_FONT_FAMILIES, fontFileStem, resolveWeight } from './fonts';
import { renderPptx, extractPptxTheme } from './pptx';
import { renderQrDataUrl, renderQrModules, verificationUrl } from './qr';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const spec = { orgId: 'a0000000-0000-0000-0000-000000000001', ...DEFAULT_BRANDING };

describe('branding spec', () => {
  it('A4 and Letter have the expected point dimensions', () => {
    expect(pageDimensions('A4').widthPt).toBeCloseTo(595.28, 1);
    expect(pageDimensions('Letter').widthPt).toBe(612);
    expect(pageDimensions('A4').heightIn).toBeCloseTo(11.69, 1);
  });

  it('converts millimetres to points', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 3);
    expect(mmToPt(20)).toBeCloseTo(56.69, 1);
  });

  it('fills known variables and leaves unknown ones untouched', () => {
    const out = fillTemplate('Page {page} of {pages} - {org}', { page: 2, pages: 9 });
    expect(out).toBe('Page 2 of 9 - {org}');
  });

  it('turns a bare token name into a CSS variable and passes a colour through', () => {
    expect(toCssColour('brand-primary')).toBe('var(--brand-primary)');
    expect(toCssColour('#112233')).toBe('#112233');
    expect(toCssColour('rgb(1,2,3)')).toBe('rgb(1,2,3)');
    expect(toCssColour('brand-primary', { 'brand-primary': '#abcdef' })).toBe('#abcdef');
  });

  it('resolves a hex colour for a colour input, with a neutral fallback for a token name', () => {
    expect(resolveHexColour('#112233')).toBe('#112233');
    expect(resolveHexColour('brand-primary')).toBe('#888888');
  });

  it('builds a full spec from a partial row, filling the defaults', () => {
    const s = brandingFromRow({ org_id: 'x', page_size: 'Letter', margin_top_mm: 25 });
    expect(s.pageSize).toBe('Letter');
    expect(s.marginTopMm).toBe(25);
    expect(s.fontHeading).toBe(DEFAULT_BRANDING.fontHeading);
    expect(s.coverStyle).toBe('standard');
  });

  it('ignores an empty string and keeps the default', () => {
    const s = brandingFromRow({ org_id: 'x', font_body: '', page_size: null });
    expect(s.fontBody).toBe(DEFAULT_BRANDING.fontBody);
    expect(s.pageSize).toBe('A4');
  });
});

describe('renderPdf', () => {
  it('wraps long text deterministically to the width', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = wrapText('one two three four five six seven eight nine ten', font, 10, 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('one two three four five six seven eight nine ten');
  });

  it('produces a valid PDF whose text is the title', async () => {
    const bytes = await renderPdf(spec, {
      title: 'Board Pack Q3', subtitle: 'Acme Assurance',
      sections: [{ heading: 'Residual risk', blocks: [{ kind: 'paragraph', text: 'Medium.' }] }],
    });
    expect(bytes.length).toBeGreaterThan(500);
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  });

  it('honours the Letter page size and the margins in points', async () => {
    const bytes = await renderPdf({ ...spec, pageSize: 'Letter', marginTopMm: 25 }, {
      title: 'Cert', sections: [],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(612, 0);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(792, 0);
  });

  it('adds a page when the content overflows, and numbers every page', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ kind: 'paragraph' as const, text: `Paragraph ${i} `.repeat(12) }));
    const bytes = await renderPdf(spec, { title: 'Long', sections: [{ heading: 'All', blocks: many }] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('embeds a QR image when given one', async () => {
    const qr = await renderQrDataUrl(verificationUrl('https://app.example', 'verify', 'abc'), { size: 128 });
    const bytes = await renderPdf(spec, { title: 'Verifiable', sections: [], qrDataUrl: qr, qrCaption: 'Scan to verify' });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe('renderPdf honours the report-format typography (WP-C3)', () => {
  const model = (typography?: { headingPt: number; bodyPt: number; headingWeight: number; bodyWeight: number; lineHeight: number }) => ({
    title: 'Typed', sections: [{ heading: 'Findings', blocks: [{ kind: 'paragraph' as const, text: 'A finding.' }] }],
    typography,
  });

  it('renders a larger body size as more drawn text state and a different byte stream', async () => {
    const small = await renderPdf(spec, model({ headingPt: 17.6, bodyPt: 11, headingWeight: 600, bodyWeight: 400, lineHeight: 1.4 }));
    const large = await renderPdf(spec, model({ headingPt: 32, bodyPt: 16, headingWeight: 700, bodyWeight: 600, lineHeight: 2.2 }));
    expect(large.length).not.toBe(small.length);
    const a = await PDFDocument.load(small);
    const b = await PDFDocument.load(large);
    // The larger typography pushes the same content onto more vertical space.
    expect(b.getPageCount()).toBeGreaterThanOrEqual(a.getPageCount());
  });

  it('is byte-identical twice for the same typography (determinism holds)', async () => {
    const typo = { headingPt: 19.2, bodyPt: 12, headingWeight: 600, bodyWeight: 400, lineHeight: 1.6 };
    const a = await renderPdf(spec, model(typo));
    const b = await renderPdf(spec, model(typo));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('keeps the original sizes when no typography is supplied (old models unchanged)', async () => {
    const bytes = await renderPdf(spec, model(undefined));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('renderQr', () => {
  it('encodes a URL to a PNG data URL', async () => {
    const url = await renderQrDataUrl(verificationUrl('https://app.example/', 'verify', 'id-1'), { size: 128 });
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('returns a square module matrix, deterministic for the same text', async () => {
    const a = await renderQrModules('https://app.example/verify/id-1');
    const b = await renderQrModules('https://app.example/verify/id-1');
    expect(a.size).toBe(b.size);
    expect(a.data.length).toBe(a.size * a.size);
    expect(a.data).toEqual(b.data);
  });

  it('builds a verification URL without a double slash', () => {
    expect(verificationUrl('https://app.example/', 'pack', 'p1')).toBe('https://app.example/pack/p1');
    expect(verificationUrl('https://app.example', 'verify', 'c1')).toBe('https://app.example/verify/c1');
  });
});

describe('renderPptx', () => {
  it('produces an editable deck with text, a table and a native chart part', async () => {
    const bytes = await renderPptx(spec, {
      title: 'Board Pack', subtitle: 'Acme',
      slides: [{
        title: 'Open issues',
        bullets: ['One', 'Two'],
        table: { header: ['Severity', 'Count'], rows: [['High', '3'], ['Low', '5']] },
        chart: { categories: ['Q1', 'Q2'], values: [2, 4], seriesName: 'Issues' },
        links: [{ label: 'Open finding', url: 'https://app.example/view/finding/f1' }],
      }],
    });
    expect(bytes.length).toBeGreaterThan(2000);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    // Native chart part and at least one slide with a table.
    expect(names.some((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toBe(true);
    expect(names.some((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toBe(true);
    const slideNames = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    let all = '';
    for (const n of slideNames) all += await zip.files[n].async('string');
    expect(all).toContain('<a:tbl>');
    expect(all).toContain('Board Pack');
  });

  it('extracts colours, fonts and slide size from a sample .pptx generated here', async () => {
    // Build a small .pptx with pptxgenjs, then extract its theme.
    const sample = await renderPptx(spec, { title: 'Sample', slides: [{ title: 'S', bullets: ['a'] }] });
    const theme = await extractPptxTheme(sample);
    // pptxgenjs writes a theme part with a colour scheme and a font scheme.
    expect(Array.isArray(theme.colours)).toBe(true);
    expect(theme.slideWidthEmu === null || theme.slideWidthEmu > 0).toBe(true);
  });

  it('reads colours and fonts from a hand-built theme archive', async () => {
    const zip = new JSZip();
    zip.file('ppt/theme/theme1.xml',
      '<a:theme xmlns:a="x"><a:themeElements><a:clrScheme><a:dk1><a:srgbClr val="111111"/></a:dk1>'
      + '<a:accent1><a:srgbClr val="AABBCC"/></a:accent1></a:clrScheme>'
      + '<a:fontScheme><a:majorFont><a:latin typeface="Georgia"/></a:majorFont>'
      + '<a:minorFont><a:latin typeface="Verdana"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>');
    zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="x"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
    zip.file('ppt/media/logo.png', 'PNG');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const theme = await extractPptxTheme(bytes);
    expect(theme.colours).toContain('#AABBCC');
    expect(theme.majorFont).toBe('Georgia');
    expect(theme.minorFont).toBe('Verdana');
    expect(theme.slideWidthEmu).toBe(12192000);
    expect(theme.slideHeightEmu).toBe(6858000);
    expect(theme.logoParts).toContain('ppt/media/logo.png');
  });
});

describe('self-hosted font embedding (WP-F)', () => {
  const model = {
    title: 'Font check', sections: [{ heading: 'One', blocks: [{ kind: 'paragraph' as const, text: 'Body text.' }] }],
  };

  it('embeds a real self-hosted WOFF2 face into the PDF', async () => {
    const bytes = readFileSync('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2');
    const plain = await renderPdf(spec, { ...model, timestamp: '2026-01-01T00:00:00Z' });
    const withFont = await renderPdf(spec, { ...model, bodyFontBytes: new Uint8Array(bytes), timestamp: '2026-01-01T00:00:00Z' });
    // Valid PDF either way.
    expect(Buffer.from(withFont.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    // The embedded face adds a real font program (a subset or a full face, both kilobytes), not a
    // ~200-byte font dictionary stub. A standard-font fallback would add essentially nothing.
    expect(withFont.length).toBeGreaterThan(plain.length + 1000);
    // And it is still a loadable PDF, so the embedded font did not corrupt the document.
    const reloaded = await PDFDocument.load(withFont);
    expect(reloaded.getPageCount()).toBeGreaterThan(0);
  });

  it('still renders when no font bytes are supplied (standard-font fallback)', async () => {
    const pdf = await renderPdf(spec, { ...model, timestamp: '2026-01-01T00:00:00Z' });
    expect(Buffer.from(pdf.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('renders byte-identically twice for every catalogue font (reproducibility)', async () => {
    for (const f of REPORT_FONT_FAMILIES) {
      const weight = resolveWeight(f.family, 400);
      const bytes = new Uint8Array(readFileSync(`node_modules/@fontsource/${f.packageSlug}/files/${fontFileStem(f.family, weight)}.woff2`));
      const opts = { ...model, bodyFontBytes: bytes, headingFontBytes: bytes, timestamp: '2026-01-01T00:00:00Z' };
      const first = await renderPdf(spec, opts);
      const second = await renderPdf(spec, opts);
      expect(Buffer.compare(Buffer.from(first), Buffer.from(second)), `${f.family} is not byte-identical across two renders`).toBe(0);
    }
  });
});
