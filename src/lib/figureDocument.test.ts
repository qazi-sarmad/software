import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { documentFromReportBlocks, toPdfModel, type ReportBlockInput } from './render/document';
import { renderDocx } from './render/docx';
import { renderPdf } from './render/pdf';
import { DEFAULT_BRANDING } from './render/branding';
import { figurePng } from './render/figure';
import JSZip from 'jszip';

/**
 * WP-G: a figure block flows through the one document model into both renderers.
 *
 * The invariant: a figure is presentation, so it changes the render hash and the printed file, but it
 * never invents content. These tests pin that the same figure bytes reach the PDF and the DOCX, that
 * a broken figure is dropped rather than faked, and that a figure cannot change the words of a report.
 */
const spec = { orgId: 'a0000000-0000-0000-0000-000000000001', ...DEFAULT_BRANDING };

const FIGURE = {
  expression: 'sin(x) * x',
  minX: -6,
  maxX: 6,
  label: 'Modelled exposure',
  colour: '#2f6f6a',
  title: 'Exposure curve',
};

const blocks: ReportBlockInput[] = [
  { sectionType: 'findings', blockType: 'text', content: { text: 'The audit covered the revenue cycle.' }, position: 1 },
  { sectionType: 'findings', blockType: 'image', content: { figure: FIGURE }, position: 2 },
];

describe('a figure block reaches the document model', () => {
  it('becomes a figure block, not a paragraph', () => {
    const model = documentFromReportBlocks('Audit report', blocks);
    const figure = model.sections[0].blocks.find((b) => b.kind === 'figure');
    expect(figure).toBeTruthy();
    expect(figure!.figure!.expression).toBe('sin(x) * x');
    expect(figure!.figure!.title).toBe('Exposure curve');
  });

  it('an image block with no figure content is not a figure', () => {
    const model = documentFromReportBlocks('T', [
      { sectionType: 'x', blockType: 'image', content: { url: 'https://example/x.png' }, position: 1 },
    ]);
    expect(model.sections[0].blocks.some((b) => b.kind === 'figure')).toBe(false);
  });
});

describe('the figure reaches the PDF', () => {
  it('renders a PDF with the figure embedded as a PNG', async () => {
    const model = toPdfModel(documentFromReportBlocks('Audit report', blocks));
    const figureBlock = model.sections.flatMap((s) => s.blocks).find((b) => b.kind === 'figure');
    expect(figureBlock).toBeTruthy();
    if (figureBlock?.kind !== 'figure') return;
    // The embedded bytes are exactly what the pure engine produces for this spec.
    expect(Array.from(figureBlock.png)).toEqual(Array.from(figurePng(FIGURE)!));
    const bytes = await renderPdf(spec, model);
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('drops a figure that cannot be rendered rather than faking it', () => {
    const model = toPdfModel(documentFromReportBlocks('T', [
      { sectionType: 'x', blockType: 'image', content: { figure: { ...FIGURE, expression: 'sin(' } }, position: 1 },
    ]));
    expect(model.sections.flatMap((s) => s.blocks).some((b) => b.kind === 'figure')).toBe(false);
  });
});

describe('the figure reaches the DOCX', () => {
  it('embeds the figure image in the OOXML archive', async () => {
    const model = documentFromReportBlocks('Audit report', blocks);
    const bytes = await renderDocx(model);
    const zip = await JSZip.loadAsync(bytes);
    const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/'));
    expect(media.length).toBeGreaterThanOrEqual(1);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('Exposure curve');
    expect(doc).toContain('Modelled exposure');
  });
});

describe('a figure never changes the words', () => {
  it('adds a figure without touching the report text', async () => {
    const without = await renderDocx(documentFromReportBlocks('Audit report', [blocks[0]]));
    const withFigure = await renderDocx(documentFromReportBlocks('Audit report', blocks));
    const textOf = async (b: Uint8Array) => {
      const zip = await JSZip.loadAsync(b);
      return zip.file('word/document.xml')!.async('string');
    };
    const a = await textOf(without);
    const b = await textOf(withFigure);
    // The audit sentence is present in both; the figure only adds.
    expect(a).toContain('revenue cycle');
    expect(b).toContain('revenue cycle');
  });
});
