/**
 * renderDocx (C2.7, spec §18 "Report | editable DOCX", "Working papers | DOCX").
 *
 * Renders the same DocumentModel the PDF renderer takes, so the two files carry the same words. The
 * `docx` package (MIT, 9.5.1) builds an OOXML archive; the output is deterministic for the same model
 * apart from nothing at all — the package writes no timestamp unless one is supplied.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, PageNumber, PageOrientation,
  Packer, Paragraph, ShadingType, Table, TableCell, TableRow, Tab, TabStopType, TextRun, convertMillimetersToTwip,
  ExternalHyperlink,
} from 'docx';
import JSZip from 'jszip';
import { buildContents, footerLine, type DocumentModel, type DocumentTypography } from './document';
import { fillTemplate } from './branding';
import { figurePng } from './figure';
import { resolveReference, referenceTargets, type ReferenceTarget } from '../writing/links';
import { tableStyle, type TableStyle } from '../writing/tableStyles';
import { pageSizeMm, type PageBox } from '../writing/pageDesign';

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

function shading(style: TableStyle, alternate: boolean): { fill: string; type: (typeof ShadingType)['CLEAR'] } | undefined {
  const fill = alternate ? style.rowAlternate : style.headerBackground;
  if (!fill) return undefined;
  return { fill: hexNoHash(fill), type: ShadingType.CLEAR };
}

function hexNoHash(value: string): string {
  const v = (value || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) return v.split('').map((c) => c + c).join('').toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  return 'FFFFFF';
}

/** A table with its resolved style (WP-D): header shade, alternate rows and a border width. */
function tableFrom(headers: string[], rows: string[][], s: DocxStyles = DEFAULT_STYLES, style?: TableStyle): Table {
  const headerShade = style ? shading(style, false) : undefined;
  const border = style && style.borderPt > 0 && style.border !== 'none'
    ? { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(style.borderPt * 8)), color: hexNoHash(style.border) }
    : undefined;
  const borders = border ? { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border } : undefined;
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) => new TableCell({
      shading: headerShade,
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, font: s.bodyFont, size: s.bodyHalfPt, color: style ? hexNoHash(style.headerText) : undefined })] })],
    })),
  });
  const bodyRows = rows.map((r, i) => new TableRow({
    children: r.map((c) => new TableCell({ children: [paragraph(c, s)] })),
    ...(style?.rowAlternate && i % 2 === 1 ? { shading: shading(style, true) } : {}),
  }));
  return new Table({ rows: [headerRow, ...bodyRows], ...(borders ? { borders } : {}) });
}

/**
 * Turn a chrome template into runs, substituting `{page}` and `{pages}` with real Word page-number
 * fields and every other token from the design's own vars. A template with no page token yields one
 * plain run. Pure.
 */
function chromeRuns(template: string, vars: Record<string, string | number>, s: DocxStyles, colour: string): TextRun[] {
  const filled = fillTemplate(template, vars);
  const parts = filled.split(/(\{page\}|\{pages\})/);
  const runs: TextRun[] = [];
  parts.forEach((part) => {
    if (part === '') return;
    if (part === '{page}') {
      runs.push(new TextRun({ children: [PageNumber.CURRENT], font: s.bodyFont, size: 16, color: colour }));
    } else if (part === '{pages}') {
      runs.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], font: s.bodyFont, size: 16, color: colour }));
    } else {
      runs.push(new TextRun({ text: part, font: s.bodyFont, size: 16, color: colour }));
    }
  });
  return runs.length > 0 ? runs : [new TextRun({ text: '', font: s.bodyFont, size: 16 })];
}

/** The header/footer chrome for the DOCX (WP-D). Every token is filled from the design's own vars. */
function chromeParts(model: DocumentModel, s: DocxStyles): { header?: Header; footer?: Footer } {
  const design = model.design;
  if (!design) return {};
  const vars = design.chromeVars;
  const colour = hexNoHash(design.theme.text);
  const out: { header?: Header; footer?: Footer } = {};
  if (design.chrome.headerEnabled) {
    out.header = new Header({
      children: [new Paragraph({
        tabStops: [{ type: TabStopType.CENTER, position: 4500 }, { type: TabStopType.RIGHT, position: 9000 }],
        border: design.chrome.rule ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: hexNoHash(design.theme.rule) } } : undefined,
        children: [
          ...chromeRuns(`${design.chrome.headerLeft}\t${design.chrome.headerCentre}\t${design.chrome.headerRight}`, vars, s, colour),
        ],
      })],
    });
  }
  if (design.chrome.footerEnabled) {
    // A footer with no right template still gets a page number when the style asks for one.
    const right = design.chrome.footerRight
      || (design.chrome.pageNumber === 'none' ? '' : `Page {page} of {pages}`);
    out.footer = new Footer({
      children: [new Paragraph({
        tabStops: [{ type: TabStopType.CENTER, position: 4500 }, { type: TabStopType.RIGHT, position: 9000 }],
        children: chromeRuns(`${design.chrome.footerLeft}\t${design.chrome.footerCentre}\t${right}`, vars, s, colour),
      })],
    });
  }
  return out;
}

/** The link and cross-reference lists the DOCX appends (WP-D), resolved against the target pages. */
function linkAndReferenceBlocks(model: DocumentModel, s: DocxStyles): Paragraph[] {
  const design = model.design;
  if (!design) return [];
  const out: Paragraph[] = [];
  if (design.links.length > 0) {
    out.push(heading('Links', HeadingLevel.HEADING_2, s));
    for (const link of design.links) {
      out.push(new Paragraph({
        children: [new ExternalHyperlink({
          children: [new TextRun({ text: link.label, font: s.bodyFont, size: s.bodyHalfPt, style: 'Hyperlink', underline: link.underline ? {} : undefined, color: hexNoHash(design.theme.link) })],
          link: link.url,
        })],
      }));
    }
  }
  if (design.crossReferences.length > 0) {
    out.push(heading('References', HeadingLevel.HEADING_2, s));
    // The DOCX does not paginate in this pass, so a reference prints its target by name; the number
    // a reader follows is the target's own heading number, which the body already carries.
    const targets: ReferenceTarget[] = referenceTargets(
      model.sections.map((sec, i) => ({ key: sec.key ?? sec.heading, label: sec.heading, page: i + 1 })), [],
    );
    for (const ref of design.crossReferences) {
      const r = resolveReference(ref, targets);
      out.push(new Paragraph({ children: [new TextRun({ text: r.text.replace(/, page \d+$/, ''), font: s.bodyFont, size: s.bodyHalfPt, color: hexNoHash(design.theme.reference) })] }));
    }
  }
  return out;
}

/** Render the model to DOCX bytes. Deterministic: no creation timestamp is set. */
export async function renderDocx(model: DocumentModel): Promise<Uint8Array> {
  const s = docxStyles(model.typography);
  const design = model.design;
  const styleFor = (key: string): TableStyle | undefined => design
    ? tableStyle(design.tableStyles.find((t) => t.key === key)?.style ?? design.defaultTableStyle, {
      primary: design.theme.primary, accent: design.theme.accent, text: design.theme.text,
      background: design.theme.background, tableBorder: design.tableBorder, tableRowAlternate: design.tableRowAlternate,
    })
    : undefined;
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
    const sectionKey = section.key ?? section.heading;
    const headingText = design?.numberedHeadings
      ? `${model.sections.indexOf(section) + 1}. ${section.heading}`
      : section.heading;
    children.push(heading(headingText, HeadingLevel.HEADING_1, s));
    for (const block of section.blocks) {
      if (block.kind === 'table' && block.table) {
        children.push(paragraph(block.text ?? '', s));
        children.push(tableFrom(block.table.headers, block.table.rows, s, styleFor(sectionKey)));
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

  // WP-D: the link list and the cross-reference list, both resolved from the format's design.
  children.push(...linkAndReferenceBlocks(model, s));

  const line = footerLine(model.footer);
  const chrome = chromeParts(model, s);
  const dims = design ? pageSizeMm(design.setup) : null;
  const properties = design && dims ? {
    page: {
      size: {
        width: convertMillimetersToTwip(dims.widthMm),
        height: convertMillimetersToTwip(dims.heightMm),
        orientation: design.setup.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
      },
      margin: {
        top: convertMillimetersToTwip(design.setup.marginTopMm),
        right: convertMillimetersToTwip(design.setup.marginRightMm),
        bottom: convertMillimetersToTwip(design.setup.marginBottomMm),
        left: convertMillimetersToTwip(design.setup.marginLeftMm),
      },
    },
    // WP-D: the flowing text uses the format's column count, so a two-column design prints as two.
    ...(design.columns > 1 ? { column: { count: design.columns, space: convertMillimetersToTwip(design.columnGapMm), equalWidth: true } } : {}),
  } : null;

  const doc = new Document({
    creator: 'Provio',
    description: model.title,
    sections: [{
      children,
      ...(properties ? { properties } : {}),
      ...(chrome.header ? { headers: { default: chrome.header } } : {}),
      ...(chrome.footer ? { footers: { default: chrome.footer } } : (line ? { footers: { default: undefined } } : {})),
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
