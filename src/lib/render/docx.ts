/**
 * renderDocx (C2.7, spec §18 "Report | editable DOCX", "Working papers | DOCX").
 *
 * Renders the same DocumentModel the PDF renderer takes, so the two files carry the same words. The
 * `docx` package (MIT, 9.5.1) builds an OOXML archive; the output is deterministic for the same model
 * apart from nothing at all — the package writes no timestamp unless one is supplied.
 */
import {
  AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun,
} from 'docx';
import JSZip from 'jszip';
import { buildContents, footerLine, type DocumentModel, type DocumentTypography } from './document';
import { figurePng } from './figure';

const MONO_PLACEHOLDER = {
  font: 'Calibri',
  size: 22, // half-points: 11pt
};

/** A fixed OOXML timestamp. `docx` otherwise stamps `new Date()`, which would break determinism. */
const FIXED_DATE = '1980-01-01T00:00:00Z';

/** The style each run prints with: the format's typography when present, the original fixed sizes
 *  otherwise (WP-C4), so a model built before this change renders exactly as before. */
interface DocxStyles {
  bodyHalfPt: number;
  bodyBold: boolean;
  bodyFont: string;
  headingHalfPt: number;
  headingFont: string;
  lineSpacing: number;
}

const DEFAULT_STYLES: DocxStyles = {
  bodyHalfPt: MONO_PLACEHOLDER.size,
  bodyBold: false,
  bodyFont: MONO_PLACEHOLDER.font,
  headingHalfPt: MONO_PLACEHOLDER.size,
  headingFont: MONO_PLACEHOLDER.font,
  lineSpacing: 240,
};

/** Map the format's resolved typography to DOCX run properties. Pure. */
export function docxStyles(typography?: DocumentTypography): DocxStyles {
  if (!typography) return DEFAULT_STYLES;
  return {
    bodyHalfPt: Math.round(typography.bodyPt * 2),
    bodyBold: typography.bodyWeight >= 600,
    bodyFont: typography.bodyFamily || MONO_PLACEHOLDER.font,
    headingHalfPt: Math.round(typography.headingPt * 2),
    headingFont: typography.headingFamily || MONO_PLACEHOLDER.font,
    lineSpacing: Math.round(typography.lineHeight * 240),
  };
}

function bodyRun(text: string, s: DocxStyles): TextRun {
  return new TextRun({ text, font: s.bodyFont, size: s.bodyHalfPt, bold: s.bodyBold });
}

function headingRun(text: string, s: DocxStyles): TextRun {
  return new TextRun({ text, font: s.headingFont, size: s.headingHalfPt, bold: true });
}

function paragraph(text: string, s: DocxStyles = DEFAULT_STYLES): Paragraph {
  return new Paragraph({ spacing: { line: s.lineSpacing }, children: [bodyRun(text, s)] });
}

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel], s: DocxStyles = DEFAULT_STYLES): Paragraph {
  return new Paragraph({ heading: level, spacing: { line: s.lineSpacing }, children: [headingRun(text, s)] });
}

function tableFrom(headers: string[], rows: string[][], s: DocxStyles = DEFAULT_STYLES): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, font: s.bodyFont, size: s.bodyHalfPt })] })],
    })),
  });
  const bodyRows = rows.map((r) => new TableRow({
    children: r.map((c) => new TableCell({ children: [paragraph(c, s)] })),
  }));
  return new Table({ rows: [headerRow, ...bodyRows] });
}

/** Render the model to DOCX bytes. Deterministic: no creation timestamp is set. */
export async function renderDocx(model: DocumentModel): Promise<Uint8Array> {
  const s = docxStyles(model.typography);
  const children: Array<Paragraph | Table> = [new Paragraph({
    alignment: AlignmentType.CENTER,
    heading: HeadingLevel.TITLE,
    children: [new TextRun({ text: model.title, bold: true, font: s.headingFont, size: s.headingHalfPt })],
  })];
  if (model.subtitle) children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [bodyRun(model.subtitle, s)],
  }));

  // WP-T: the contents page, built from the model's own headings so it cannot disagree with the body.
  const contents = buildContents(model);
  if (contents.length > 0) {
    children.push(heading(model.contents?.title ?? 'Contents', HeadingLevel.HEADING_1, s));
    for (const e of contents) {
      children.push(paragraph(`${e.number ? `${e.number}. ` : ''}${e.level === 2 ? '   ' : ''}${e.label}`, s));
    }
  }

  for (const section of model.sections) {
    children.push(heading(section.heading, HeadingLevel.HEADING_1, s));
    for (const block of section.blocks) {
      if (block.kind === 'table' && block.table) {
        children.push(paragraph(block.text ?? '', s));
        children.push(tableFrom(block.table.headers, block.table.rows, s));
      } else if (block.kind === 'figure' && block.figure) {
        // WP-G: the same pure figure the PDF and the canvas show, embedded as a PNG run.
        const png = figurePng(block.figure);
        if (png) {
          children.push(heading(block.figure.title, HeadingLevel.HEADING_2, s));
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ type: 'png', data: png, transformation: { width: 468, height: 216 } })],
          }));
          if (block.figure.label) children.push(paragraph(block.figure.label, s));
        }
      } else if (block.kind === 'heading') {
        children.push(heading(block.text ?? '', HeadingLevel.HEADING_2, s));
      } else {
        children.push(paragraph(block.text ?? '', s));
      }
    }
  }

  const line = footerLine(model.footer);
  const doc = new Document({
    creator: 'Provio',
    description: model.title,
    sections: [{
      children,
      ...(line ? { footers: { default: undefined } } : {}),
    }],
  });
  // The docx packer returns a Buffer in Node and a Uint8Array in the browser; normalise to bytes.
  const blob = await Packer.toBuffer(doc);
  // `docx` stamps the core properties with `new Date()`. Rewrite the two timestamps and re-pack with a
  // fixed archive date, so the same model always produces the same bytes (the determinism test).
  return normaliseDocx(new Uint8Array(blob));
}

/** Replace the two OOXML core timestamps and re-pack with a fixed date, for byte reproducibility. */
export async function normaliseDocx(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const core = zip.file('docProps/core.xml');
  if (core) {
    const xml = await core.async('string');
    const patched = xml
      .replace(/<dcterms:created[^>]*>[^<]*<\/dcterms:created>/, `<dcterms:created xsi:type="dcterms:W3CDTF">${FIXED_DATE}</dcterms:created>`)
      .replace(/<dcterms:modified[^>]*>[^<]*<\/dcterms:modified>/, `<dcterms:modified xsi:type="dcterms:W3CDTF">${FIXED_DATE}</dcterms:modified>`);
    zip.file('docProps/core.xml', patched);
  }
  // `docx` stamps every ZIP entry with `new Date()`. JSZip keeps those per-entry dates on re-pack, so
  // two renders a second apart would differ. Pin each entry, then pack.
  const fixed = new Date(Date.UTC(1980, 0, 1));
  for (const name of Object.keys(zip.files)) zip.files[name].date = fixed;
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    date: fixed,
  } as JSZip.JSZipGeneratorOptions<'uint8array'>);
}

/** The visible text of a DOCX, read from word/document.xml — used by the PDF/DOCX parity test. */
export async function docxPlainText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const doc = zip.file('word/document.xml');
  if (!doc) return '';
  const xml = await doc.async('string');
  // Each `<w:t>` run holds text; paragraphs end with `</w:p>` and table rows with `</w:tr>`.
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .split('\n')
    .map((p) => [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(''))
    .map((s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
    .filter((s, i, arr) => s.length > 0 || i < arr.length - 1)
    .join('\n')
    .trim();
}

/** The plain text of a model — used by the parity test and by text-oriented exports. */
export function documentPlainText(model: DocumentModel): string {
  const lines: string[] = [model.title];
  if (model.subtitle) lines.push(model.subtitle);
  for (const section of model.sections) {
    lines.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === 'table' && block.table) {
        if (block.text) lines.push(block.text);
        lines.push(block.table.headers.join(' | '));
        for (const row of block.table.rows) lines.push(row.join(' | '));
      } else {
        lines.push(block.text ?? '');
      }
    }
  }
  return lines.join('\n');
}
