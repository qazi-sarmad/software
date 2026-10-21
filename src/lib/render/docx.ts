/**
 * renderDocx (C2.7, spec §18 "Report | editable DOCX", "Working papers | DOCX").
 *
 * Renders the same DocumentModel the PDF renderer takes, so the two files carry the same words. The
 * `docx` package (MIT, 9.5.1) builds an OOXML archive; the output is deterministic for the same model
 * apart from nothing at all — the package writes no timestamp unless one is supplied.
 */
import {
  AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun,
} from 'docx';
import JSZip from 'jszip';
import { footerLine, type DocumentModel } from './document';

const MONO_PLACEHOLDER = {
  font: 'Calibri',
  size: 22, // half-points: 11pt
};

/** A fixed OOXML timestamp. `docx` otherwise stamps `new Date()`, which would break determinism. */
const FIXED_DATE = '1980-01-01T00:00:00Z';

function paragraph(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, ...MONO_PLACEHOLDER })] });
}

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ heading: level, children: [new TextRun({ text, bold: true, ...MONO_PLACEHOLDER })] });
}

function tableFrom(headers: string[], rows: string[][]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, ...MONO_PLACEHOLDER })] })],
    })),
  });
  const bodyRows = rows.map((r) => new TableRow({
    children: r.map((c) => new TableCell({ children: [paragraph(c)] })),
  }));
  return new Table({ rows: [headerRow, ...bodyRows] });
}

/** Render the model to DOCX bytes. Deterministic: no creation timestamp is set. */
export async function renderDocx(model: DocumentModel): Promise<Uint8Array> {
  const children: Array<Paragraph | Table> = [new Paragraph({
    alignment: AlignmentType.CENTER,
    heading: HeadingLevel.TITLE,
    children: [new TextRun({ text: model.title, bold: true, ...MONO_PLACEHOLDER })],
  })];
  if (model.subtitle) children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: model.subtitle, ...MONO_PLACEHOLDER })],
  }));

  for (const section of model.sections) {
    children.push(heading(section.heading, HeadingLevel.HEADING_1));
    for (const block of section.blocks) {
      if (block.kind === 'table' && block.table) {
        children.push(paragraph(block.text ?? ''));
        children.push(tableFrom(block.table.headers, block.table.rows));
      } else if (block.kind === 'heading') {
        children.push(heading(block.text ?? '', HeadingLevel.HEADING_2));
      } else {
        children.push(paragraph(block.text ?? ''));
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
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', date: new Date(Date.UTC(1980, 0, 1)) } as JSZip.JSZipGeneratorOptions<'uint8array'>);
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
