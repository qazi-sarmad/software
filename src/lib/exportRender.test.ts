/**
 * Binary export tests (C2.7, spec §18).
 *
 * The point of these tests is that an export is a real file: a PDF parses as a PDF, a DOCX unzips to
 * the OOXML parts a reader expects, an XLSX round trips through the vendored SheetJS parser, a ZIP
 * carries a manifest whose hashes match the bytes, and the content hash logged for an export is the
 * hash of exactly the bytes delivered. Determinism is asserted directly: the same input renders the
 * same bytes, so the recorded hash is reproducible.
 */
import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { renderExport, tabulate, downloadBytes } from './exportRender';
import { renderPdf } from './render/pdf';
import { renderDocx, documentPlainText, docxPlainText } from './render/docx';
import { renderXlsx, renderZip, zipManifest } from './render/xlsx';
import { renderChartPng, renderChartSvg, chartDrawList, type ChartModel } from './render/chart';
import { encodePng, parseHexColour, PixelCanvas } from './render/png';
import { pdfPlainText, pngInfo, inflatePngIdat } from './render/inspect';
import { documentFromReportBlocks, footerLine, toPdfModel, type ReportBlockInput } from './render/document';
import { DEFAULT_BRANDING } from './render/branding';
import { sha256Hex } from './population';

const spec = { orgId: 'a0000000-0000-0000-0000-000000000001', ...DEFAULT_BRANDING };

const fixtureBlocks: ReportBlockInput[] = [
  { sectionType: 'executive_summary', blockType: 'text', content: { text: 'The audit covered the revenue cycle.' }, position: 1 },
  {
    sectionType: 'findings', blockType: 'table', position: 2,
    content: { caption: 'Findings by severity', headers: ['Severity', 'Count'], rows: [['high', '2'], ['medium', '5']] },
  },
];

const fixtureData = [
  { ref: 'R1', result: 'tick', amount: 1200 },
  { ref: 'R2', result: 'exception', amount: 980 },
];

async function bytesHash(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return sha256Hex(buf);
}

describe('renderPdf produces a real PDF', () => {
  it('is parseable by a PDF reader and carries the title text', async () => {
    const bytes = await renderPdf(spec, toPdfModel(documentFromReportBlocks('Audit report', fixtureBlocks)));
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(await pdfPlainText(bytes)).toContain('Audit report');
  });

  it('is deterministic for the same model', async () => {
    const model = toPdfModel(documentFromReportBlocks('Audit report', fixtureBlocks));
    const a = await renderPdf(spec, model);
    const b = await renderPdf(spec, model);
    expect(await bytesHash(a)).toBe(await bytesHash(b));
  });
});

describe('renderDocx produces a real DOCX', () => {
  it('unzips to the OOXML parts and carries the same words as the PDF model', async () => {
    const model = documentFromReportBlocks('Audit report', fixtureBlocks);
    const bytes = await renderDocx(model);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('word/document.xml');
    // The DOCX text and the PDF text both contain every word of the shared model's plain text. The
    // ` | ` separators are the plain-text rendering of a real table, so they are not words to match.
    const docxText = await docxPlainText(bytes);
    const pdfText = await pdfPlainText(await renderPdf(spec, toPdfModel(model)));
    const words = documentPlainText(model).split(/[\s|]+/).filter((w) => w.length > 1);
    expect(words.length).toBeGreaterThan(4);
    for (const w of words) {
      expect(docxText).toContain(w);
      expect(pdfText).toContain(w);
    }
  });

  it('is deterministic for the same model', async () => {
    const model = documentFromReportBlocks('Audit report', fixtureBlocks);
    expect(await bytesHash(await renderDocx(model))).toBe(await bytesHash(await renderDocx(model)));
  });

  it('stamps no wall-clock date, so two renders in different seconds still match', async () => {
    // Regression: `docx` stamps every ZIP entry with `new Date()`; JSZip keeps those per-entry dates
    // on re-pack, so without pinning them the bytes differ whenever the two renders fall in different
    // seconds. Fake timers make `new Date()` return a fixed instant, so the test is deterministic.
    const model = documentFromReportBlocks('Audit report', fixtureBlocks);
    // DOS timestamps in a ZIP have 2-second resolution, so the two instants must be far enough apart
    // to land in different buckets, otherwise the test could pass by accident.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
      const a = await renderDocx(model);
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 10)));
      const b = await renderDocx(model);
      expect(await bytesHash(a)).toBe(await bytesHash(b));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('renderXlsx produces a real workbook', () => {
  it('round trips through the vendored SheetJS parser', async () => {
    const bytes = await renderXlsx([{ name: 'Findings', headers: ['Severity', 'Count'], rows: [['high', '2'], ['low', '7']] }]);
    const XLSX = await import('xlsx');
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toContain('Findings');
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Findings, { header: 1 });
    expect(rows[0]).toEqual(['Severity', 'Count']);
    expect(rows[2]).toEqual(['low', '7']);
  });

  it('is deterministic for the same sheets', async () => {
    const sheets = [{ name: 'S', headers: ['a'], rows: [['1']] }];
    expect(await bytesHash(await renderXlsx(sheets))).toBe(await bytesHash(await renderXlsx(sheets)));
  });

  it('makes a safe sheet name from an invalid one', async () => {
    const bytes = await renderXlsx([{ name: 'a/b[c]:d', headers: ['h'], rows: [] }]);
    const XLSX = await import('xlsx');
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames[0]).not.toMatch(/[\[\]:*?/\\]/);
  });
});

describe('renderZip bundle', () => {
  it('records a manifest whose hashes match the file bytes', async () => {
    const entries = [
      { path: 'data.csv', data: 'a,b\n1,2\n' },
      { path: 'notes.txt', data: 'hello' },
    ];
    const expected = await zipManifest(entries);
    const { bytes, hashes } = await renderZip(entries);
    expect(hashes).toEqual(expected);

    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.files).toEqual(expected);
    const csv = await zip.file('data.csv')!.async('string');
    expect(csv).toBe('a,b\n1,2\n');
    const csvHash = await bytesHash(new TextEncoder().encode(csv));
    expect(manifest.files.find((f: { path: string }) => f.path === 'data.csv').sha256).toBe(csvHash);
  });

  it('is deterministic (fixed archive date)', async () => {
    const entries = [{ path: 'a.txt', data: 'x' }];
    const one = await renderZip(entries);
    const two = await renderZip(entries);
    expect(await bytesHash(one.bytes)).toBe(await bytesHash(two.bytes));
  });
});

describe('chart rendering', () => {
  const chart: ChartModel = {
    title: 'Findings by severity',
    categories: ['high', 'medium', 'low'],
    series: [{ label: 'count', values: [2, 5, 7], colour: '#2f6f6a' }],
    kind: 'bar',
  };
  const colours = { background: '#ffffff', axis: '#888888', text: '#222222' };

  it('produces a PNG with the correct signature, dimensions and colour type', () => {
    const png = renderChartPng(chart, colours, { width: 320, height: 200 });
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const info = pngInfo(png);
    expect(info.width).toBe(320);
    expect(info.height).toBe(200);
    expect(info.colourType).toBe(6); // RGBA
  });

  it('is deterministic and produces an SVG with the same categories', async () => {
    const a = renderChartPng(chart, colours, { width: 320, height: 200 });
    const b = renderChartPng(chart, colours, { width: 320, height: 200 });
    expect([...a]).toEqual([...b]);
    // The pixel stream is identical, so the two images cannot differ in content.
    expect([...(await inflatePngIdat(a))]).toEqual([...(await inflatePngIdat(b))]);
    const svg = renderChartSvg(chart, colours);
    expect(svg).toContain('<svg');
    for (const c of chart.categories) expect(svg).toContain(`>${c}</text>`);
    expect(svg).toContain('#2f6f6a');
  });

  it('gives a PDF a draw list with one rectangle per bar', () => {
    const list = chartDrawList(chart);
    expect(list.rects).toHaveLength(3);
  });
});

describe('PNG encoder', () => {
  it('encodes a known pixel buffer deterministically', () => {
    const canvas = new PixelCanvas(4, 4, { r: 255, g: 255, b: 255 });
    canvas.fillRect(1, 1, 2, 2, { r: 0, g: 0, b: 0 });
    const png = canvas.png();
    expect(png[0]).toBe(0x89);
    expect(png.slice(0, 8)).toEqual(encodePng(canvas.data, 4, 4).slice(0, 8));
    expect([...png]).toEqual([...canvas.png()]);
  });

  it('parses a hex colour and falls back to black for anything else', () => {
    expect(parseHexColour('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHexColour('not-a-colour')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('renderExport: the delivered bytes and the logged hash agree', () => {
  it.each(['csv', 'json', 'text', 'pdf', 'docx', 'xlsx', 'png', 'svg', 'zip'] as const)(
    '%s returns bytes whose hash equals the recorded hash', async (format) => {
      const rendered = await renderExport({ objectType: 'workpaper', data: fixtureData, format });
      expect(rendered.bytes.length).toBeGreaterThan(0);
      expect(rendered.hash).toBe(await bytesHash(rendered.bytes));
      expect(rendered.extension).toBe(format === 'text' ? 'txt' : format);
    },
  );

  it('renders a PDF that parses and a DOCX whose text matches the PDF model', async () => {
    const pdf = await renderExport({ objectType: 'Findings', data: fixtureData, format: 'pdf' });
    const parsed = await PDFDocument.load(pdf.bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);

    const docx = await renderExport({ objectType: 'Findings', data: fixtureData, format: 'docx' });
    const text = await docxPlainText(docx.bytes);
    expect(text).toContain('ref');
    expect(text).toContain('R1');
    expect(text).toContain('1200');
  });

  it('puts the footer (engagement, time, user, hash) in the PDF bytes', async () => {
    const rendered = await renderExport({
      objectType: 'Report',
      data: fixtureData,
      format: 'pdf',
      footer: { engagement: 'A-Eng1', exportedAt: '2026-10-21T00:00:00Z', user: 'Auditor One', contentHash: 'abcdef1234567890' },
    });
    const text = await pdfPlainText(rendered.bytes);
    expect(text).toContain('A-Eng1');
    expect(text).toContain('Auditor One');
    expect(text).toContain('abcdef123456');
  });

  it('is deterministic for the same input', async () => {
    const a = await renderExport({ objectType: 'w', data: fixtureData, format: 'xlsx' });
    const b = await renderExport({ objectType: 'w', data: fixtureData, format: 'xlsx' });
    expect(a.hash).toBe(b.hash);
  });

  it('bundles extra files into the ZIP', async () => {
    const rendered = await renderExport({
      objectType: 'engagement', data: fixtureData, format: 'zip',
      extraFiles: [{ path: 'chart.png', data: renderChartPng(
        { title: 't', categories: ['a'], series: [{ label: 'v', values: [1], colour: '#000000' }], kind: 'bar' },
        { background: '#ffffff', axis: '#888888', text: '#222222' },
      ) }],
    });
    const zip = await JSZip.loadAsync(rendered.bytes);
    expect(Object.keys(zip.files)).toContain('chart.png');
    expect(Object.keys(zip.files)).toContain('manifest.json');
  });
});

describe('tabulate and document model', () => {
  it('flattens records with a sorted union of keys', () => {
    const sheet = tabulate([{ b: 1 }, { a: 2, b: 3 }]);
    expect(sheet.headers).toEqual(['a', 'b']);
    expect(sheet.rows).toEqual([['', '1'], ['2', '3']]);
  });

  it('builds sections in first-seen order and keeps a table as rows', () => {
    const model = documentFromReportBlocks('T', fixtureBlocks);
    expect(model.sections.map((s) => s.heading)).toEqual(['executive_summary', 'findings']);
    const table = model.sections[1].blocks[0];
    expect(table.table?.rows).toEqual([['high', '2'], ['medium', '5']]);
  });

  it('formats the footer line from the context', () => {
    expect(footerLine({ engagement: 'A-Eng1', exportedAt: 'now', user: 'u', contentHash: 'abcdef123456789' }))
      .toBe('A-Eng1 · exported now · u · abcdef123456');
  });
});

describe('downloadBytes', () => {
  it('does nothing when there is no document (server side)', () => {
    expect(() => downloadBytes(new Uint8Array([1, 2, 3]), 'x.bin', 'application/octet-stream')).not.toThrow();
  });
});
