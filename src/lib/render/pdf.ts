/**
 * renderPdf (F9, F10, F11): one deterministic PDF builder the Board Pack, the certificate and the
 * issued report all share. Pure — it takes a BrandingSpec and a document model and returns bytes.
 * No data leaves the tenant boundary: everything here runs in the browser.
 *
 * Colours and sizes come from the BrandingSpec (data) or from the design tokens read at runtime;
 * no hex literal is written in this file except the standard black/white defaults a PDF needs.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fillTemplate, mmToPt, pageDimensions, type BrandingSpec } from './branding';

export interface PdfTextBlock {
  kind: 'heading' | 'paragraph';
  text: string;
}

/** WP-G: a figure the PDF renderer draws as an embedded PNG. The PNG is produced by the same pure
 *  chart renderer the SVG and the DOCX use, so the printed figure is the figure the canvas showed. */
export interface PdfFigureBlock {
  kind: 'figure';
  title: string;
  caption: string;
  /** PNG bytes for the figure, ready to embed. */
  png: Uint8Array;
  widthPt: number;
  heightPt: number;
}

export type PdfBlock = PdfTextBlock | PdfFigureBlock;

export interface PdfLink {
  label: string;
  url: string;
}

export interface PdfSection {
  heading: string;
  blocks: PdfBlock[];
  links?: PdfLink[];
}

export interface PdfDocumentModel {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  /** The QR image (a PNG data URL) and its target, when the document is verifiable (F10, F11). */
  qrDataUrl?: string;
  qrCaption?: string;
  /** Variables for the header/footer templates (F9). */
  templateVars?: Record<string, string | number>;
  /** Embedded font bytes, when the org uploaded a licensed font (branding_custom_fonts). */
  headingFontBytes?: Uint8Array;
  bodyFontBytes?: Uint8Array;
  /**
   * The resolved report-format typography (WP-C3). When present the PDF prints the same heading and
   * body sizes, weights and line height the live canvas shows; when absent the renderer keeps its
   * original fixed sizes, so an old model renders exactly as before.
   */
  typography?: {
    headingPt: number;
    bodyPt: number;
    headingWeight: number;
    bodyWeight: number;
    lineHeight: number;
  };
  /**
   * The fixed timestamp for the PDF's own metadata, passed in as an argument.
   *
   * pdf-lib's constructor calls `updateInfoDict()`, which writes `new Date()` into CreationDate and
   * ModDate. Two renders of the same document therefore differ whenever they straddle a second
   * boundary — the identical class of defect C2.7 fixed for DOCX. Pinning both dates (and the
   * producer) to an argument makes the bytes reproducible; the engine reads no clock.
   */
  timestamp?: string;
}

/** The fallback stamp when a caller passes none, so the bytes are still reproducible. */
const FIXED_PDF_EPOCH = '2000-01-01T00:00:00Z';

/** Parse a CSS-ish colour value into rgb() components; falls back to black. Only for rendering. */
function parseColour(value: string): { r: number; g: number; b: number } {
  const v = (value || '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return {
      r: parseInt(full.slice(0, 2), 16) / 255,
      g: parseInt(full.slice(2, 4), 16) / 255,
      b: parseInt(full.slice(4, 6), 16) / 255,
    };
  }
  return { r: 0, g: 0, b: 0 };
}

function toRgb(value: string) {
  const { r, g, b } = parseColour(value);
  return rgb(r, g, b);
}

/**
 * Embed a caller-supplied font (a self-hosted WOFF2, or an org-uploaded licensed face).
 *
 * pdf-lib's subsetter only understands raw TrueType; a WOFF2 container throws inside fontkit. So we
 * try the subset first (smallest bytes, the right choice for an uploaded TTF/OTF) and fall back to a
 * full embed, which fontkit handles for WOFF2. Either way the face is embedded, so the printed page
 * uses the font the canvas showed. If both fail, fall back to the standard font rather than fail the
 * render: a report must always be producible.
 */
async function embedCustomFont(
  pdf: PDFDocument, bytes: Uint8Array, fallback: StandardFonts,
): Promise<PDFFont> {
  try {
    return await pdf.embedFont(bytes, { subset: true });
  } catch {
    try {
      return await pdf.embedFont(bytes, { subset: false });
    } catch {
      return pdf.embedFont(fallback);
    }
  }
}

/** Wrap a string to a width in points, using the font's own metrics. Deterministic. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export async function renderPdf(spec: BrandingSpec, model: PdfDocumentModel): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  // Pin the metadata that pdf-lib would otherwise take from the clock, so the same model always
  // produces the same bytes (W7.1). The timestamp is an argument; no clock is read here.
  const stamp = new Date(model.timestamp ?? FIXED_PDF_EPOCH);
  pdf.setCreationDate(stamp);
  pdf.setModificationDate(stamp);
  pdf.setProducer('Provio');
  pdf.setCreator('Provio');

  let heading: PDFFont;
  let body: PDFFont;
  if (model.headingFontBytes) {
    heading = await embedCustomFont(pdf, model.headingFontBytes, StandardFonts.HelveticaBold);
  } else {
    heading = await pdf.embedFont(StandardFonts.HelveticaBold);
  }
  if (model.bodyFontBytes) {
    body = await embedCustomFont(pdf, model.bodyFontBytes, StandardFonts.Helvetica);
  } else {
    body = await pdf.embedFont(StandardFonts.Helvetica);
  }

  // WP-C3: the report-format typography, when the caller supplies it, decides the printed sizes and
  // line height, so the frozen PDF matches the live canvas. Without it the renderer keeps the sizes
  // it has always used, so a model built before this change still renders identically.
  const typo = model.typography;
  const sectionHeadingPt = typo ? typo.headingPt : 15;
  const blockHeadingPt = typo ? typo.headingPt : 12;
  const bodyPt = typo ? typo.bodyPt : 10.5;
  /** The baseline-to-baseline distance for a run at `size`. */
  const leadingFor = (size: number) => (typo ? size * typo.lineHeight : size + 5);

  const dims = pageDimensions(spec.pageSize);
  const marginTop = mmToPt(spec.marginTopMm);
  const marginRight = mmToPt(spec.marginRightMm);
  const marginBottom = mmToPt(spec.marginBottomMm);
  const marginLeft = mmToPt(spec.marginLeftMm);
  const contentWidth = dims.widthPt - marginLeft - marginRight;
  const vars = model.templateVars ?? {};

  let page: PDFPage = pdf.addPage([dims.widthPt, dims.heightPt]);
  let cursorY = dims.heightPt - marginTop;

  const drawChrome = (p: PDFPage, pageNumber: number, pageCount: number) => {
    const localVars = { ...vars, page: pageNumber, pages: pageCount };
    if (spec.headerText) {
      p.drawText(fillTemplate(spec.headerText, localVars), {
        x: marginLeft, y: dims.heightPt - marginTop + mmToPt(4), size: 8, font: body,
        color: toRgb('#666666'),
      });
    }
    if (spec.footerText) {
      p.drawText(fillTemplate(spec.footerText, localVars), {
        x: marginLeft, y: marginBottom - mmToPt(4), size: 8, font: body, color: toRgb('#666666'),
      });
    }
  };

  // Cover: title, subtitle and the QR when the document is verifiable.
  const titleLines = wrapText(model.title, heading, 24, contentWidth);
  for (const line of titleLines) {
    page.drawText(line, { x: marginLeft, y: cursorY - 24, size: 24, font: heading, color: toRgb('#000000') });
    cursorY -= 30;
  }
  if (model.subtitle) {
    for (const line of wrapText(model.subtitle, body, 12, contentWidth)) {
      page.drawText(line, { x: marginLeft, y: cursorY - 12, size: 12, font: body, color: toRgb('#444444') });
      cursorY -= 16;
    }
  }
  cursorY -= 12;

  if (model.qrDataUrl) {
    const png = await pdf.embedPng(model.qrDataUrl);
    const qrSize = 120;
    page.drawImage(png, { x: marginLeft, y: cursorY - qrSize, width: qrSize, height: qrSize });
    cursorY -= qrSize + 8;
    if (model.qrCaption) {
      page.drawText(model.qrCaption, { x: marginLeft, y: cursorY, size: 9, font: body, color: toRgb('#444444') });
      cursorY -= 14;
    }
  }

  const ensureSpace = (needed: number) => {
    if (cursorY - needed < marginBottom) {
      page = pdf.addPage([dims.widthPt, dims.heightPt]);
      cursorY = dims.heightPt - marginTop;
    }
  };

  for (const section of model.sections) {
    ensureSpace(40);
    cursorY -= 8;
    for (const line of wrapText(section.heading, heading, sectionHeadingPt, contentWidth)) {
      ensureSpace(sectionHeadingPt);
      page.drawText(line, { x: marginLeft, y: cursorY - sectionHeadingPt, size: sectionHeadingPt, font: heading, color: toRgb('#000000') });
      cursorY -= leadingFor(sectionHeadingPt);
    }
    cursorY -= 4;
    for (const block of section.blocks) {
      if (block.kind === 'figure') {
        // WP-G: draw the figure's own PNG, then its caption, exactly as the canvas showed it.
        const img = await pdf.embedPng(block.png);
        ensureSpace(block.heightPt + 26);
        cursorY -= 4;
        for (const line of wrapText(block.title, heading, blockHeadingPt - 1, contentWidth)) {
          ensureSpace(blockHeadingPt);
          page.drawText(line, { x: marginLeft, y: cursorY - blockHeadingPt, size: blockHeadingPt - 1, font: heading, color: toRgb('#000000') });
          cursorY -= leadingFor(blockHeadingPt - 1);
        }
        page.drawImage(img, { x: marginLeft, y: cursorY - block.heightPt, width: block.widthPt, height: block.heightPt });
        cursorY -= block.heightPt + 4;
        if (block.caption) {
          for (const line of wrapText(block.caption, body, 9, contentWidth)) {
            ensureSpace(12);
            page.drawText(line, { x: marginLeft, y: cursorY - 9, size: 9, font: body, color: toRgb('#444444') });
            cursorY -= 12;
          }
        }
        cursorY -= 4;
        continue;
      }
      const size = block.kind === 'heading' ? blockHeadingPt : bodyPt;
      const font = block.kind === 'heading' ? heading : body;
      const lineHeight = leadingFor(size);
      for (const line of wrapText(block.text, font, size, contentWidth)) {
        ensureSpace(lineHeight);
        page.drawText(line, { x: marginLeft, y: cursorY - size, size, font, color: toRgb('#222222') });
        cursorY -= lineHeight;
      }
      cursorY -= 2;
    }
    if (section.links?.length) {
      for (const link of section.links) {
        ensureSpace(14);
        const w = body.widthOfTextAtSize(link.label, 10);
        page.drawText(link.label, { x: marginLeft, y: cursorY - 10, size: 10, font: body, color: toRgb('#1155cc') });
        page.drawLine({
          start: { x: marginLeft, y: cursorY - 12 }, end: { x: marginLeft + w, y: cursorY - 12 },
          thickness: 0.5, color: toRgb('#1155cc'),
        });
        const annot = pdf.context.obj({
          Type: 'Annot', Subtype: 'Link',
          Rect: [marginLeft, cursorY - 13, marginLeft + w, cursorY - 1],
          Border: [0, 0, 0],
          A: { Type: 'Action', S: 'URI', URI: link.url },
        });
        page.node.addAnnot(pdf.context.register(annot));
        cursorY -= 16;
      }
    }
    cursorY -= 6;
  }

  // Chrome is drawn last, once the page count is known.
  const pages = pdf.getPages();
  pages.forEach((p, i) => drawChrome(p, i + 1, pages.length));

  return pdf.save();
}
