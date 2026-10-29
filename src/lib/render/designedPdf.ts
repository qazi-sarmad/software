/**
 * renderDesignedPdf (WP-D): the PDF for a DESIGNED report page.
 *
 * The plain `renderPdf` prints a single flowing column. This renderer prints the page design the
 * designer set: the orientation, the header/footer chrome, one to three text columns, free x/y block
 * placement, design shapes, the brand-derived colours (heading, rule, link, cross-reference), the
 * table shades and the resolved cross-reference page numbers.
 *
 * It reuses `renderPdf`'s primitives (page dimensions, colour parsing, text wrapping, font embedding)
 * so the two paths agree on units and metrics; it is a separate function because a designed page is a
 * different traversal, not a flag. Pure and deterministic: the metadata timestamp is an argument.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fillTemplate, mmToPt, pageDimensions, type BrandingSpec } from './branding';
import { wrapText } from './pdf';
import type { DocumentDesign, DocumentModel } from './document';
import { buildContents } from './document';
import {
  buildPages, mmToPtLocal, pageBlocks, pageShapes, pageSizeMm,
  type BlockBox, type PageBox, type ShapeBox,
} from '../writing/pageDesign';
import { tableStyle, type TableStyle } from '../writing/tableStyles';
import { figurePng, FIGURE_SIZE_PT } from './figure';
import { resolveReference, referenceTargets, type ReferenceTarget } from '../writing/links';

const FIXED_PDF_EPOCH = '2000-01-01T00:00:00Z';

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

async function embedFont(pdf: PDFDocument, bytes: Uint8Array | undefined, fallback: StandardFonts): Promise<PDFFont> {
  if (!bytes) return pdf.embedFont(fallback);
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

/** The block geometry the page model needs: a label and an estimated body-line count per section. */
function blockGeometry(model: DocumentModel) {
  return model.sections.map((s) => {
    const lines = s.blocks.reduce((n, b) => {
      if (b.kind === 'table' && b.table) return n + 1 + b.table.rows.length;
      if (b.kind === 'figure') return n + 4;
      return n + Math.max(1, Math.ceil((b.text?.length ?? 0) / 90));
    }, 0);
    return { key: s.heading, label: s.heading, bodyLines: lines };
  });
}

/** Every section's text, keyed by its heading, so a placed block prints its own content. */
function sectionText(model: DocumentModel, heading: string): string[] {
  const s = model.sections.find((x) => x.heading === heading);
  if (!s) return [];
  return s.blocks.flatMap((b) => {
    if (b.kind === 'table' && b.table) {
      return [b.text ?? '', b.table.headers.join('  |  '), ...b.table.rows.map((r) => r.join('  |  '))];
    }
    return [b.text ?? ''];
  });
}

/** The table style a section's table uses, resolved from the design. */
function styleFor(design: DocumentDesign, key: string): TableStyle {
  const name = design.tableStyles.find((t) => t.key === key)?.style ?? design.defaultTableStyle;
  return tableStyle(name, {
    primary: design.theme.primary, accent: design.theme.accent,
    text: design.theme.text, background: design.theme.background,
    tableBorder: design.tableBorder, tableRowAlternate: design.tableRowAlternate,
  });
}

export async function renderDesignedPdf(spec: BrandingSpec, model: DocumentModel): Promise<Uint8Array> {
  const design = model.design;
  if (!design) throw new Error('renderDesignedPdf needs a design');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const stamp = new Date(FIXED_PDF_EPOCH);
  pdf.setCreationDate(stamp);
  pdf.setModificationDate(stamp);
  pdf.setProducer('Provio');
  pdf.setCreator('Provio');

  const headingFont = await embedFont(pdf, model.fontBytes?.heading, StandardFonts.HelveticaBold);
  const bodyFont = await embedFont(pdf, model.fontBytes?.body, StandardFonts.Helvetica);

  const typo = model.typography;
  const headingPt = typo?.headingPt ?? 15;
  const bodyPt = typo?.bodyPt ?? 10.5;
  const leading = (size: number) => (typo ? size * typo.lineHeight : size + 5);

  const { widthMm, heightMm } = pageSizeMm(design.setup);
  const widthPt = mmToPt(widthMm);
  const heightPt = mmToPt(heightMm);

  const blocks = blockGeometry(model);
  const pages = buildPages({
    setup: design.setup,
    grid: design.grid,
    chrome: design.chrome,
    columns: design.columns,
    columnGapMm: design.columnGapMm,
    theme: design.theme,
    typography: { headingPt, bodyPt, lineHeight: typo?.lineHeight ?? 1.4 },
    blocks,
    placed: design.placed,
    shapes: design.shapes,
    numberedHeadings: design.numberedHeadings,
  });

  // Cross-reference targets: the page each section and figure actually landed on.
  const allBoxes = pages.pages.flatMap((p) => pageBlocks(p).map((b) => ({ key: b.label, label: b.displayLabel, page: p.index })));
  const targets: ReferenceTarget[] = referenceTargets(allBoxes, []);

  const pdfPages: PDFPage[] = pages.pages.map(() => pdf.addPage([widthPt, heightPt]));

  const drawChrome = (page: PDFPage, pageNo: number) => {
    const chrome = design.chrome;
    const localVars = { ...design.chromeVars, page: pageNo, pages: pages.pageCount };
    const marginLeft = mmToPt(design.setup.marginLeftMm);
    const marginRight = mmToPt(design.setup.marginRightMm);
    const contentWidth = widthPt - marginLeft - marginRight;
    const topY = heightPt - mmToPt(design.setup.marginTopMm);
    const bottomY = mmToPt(design.setup.marginBottomMm);
    const size = 8;
    if (chrome.headerEnabled) {
      const y = topY + mmToPt(3);
      if (chrome.headerLeft) page.drawText(fillTemplate(chrome.headerLeft, localVars), { x: marginLeft, y, size, font: bodyFont, color: toRgb(design.theme.text) });
      if (chrome.headerCentre) {
        const t = fillTemplate(chrome.headerCentre, localVars);
        page.drawText(t, { x: marginLeft + (contentWidth - bodyFont.widthOfTextAtSize(t, size)) / 2, y, size, font: bodyFont, color: toRgb(design.theme.text) });
      }
      if (chrome.headerRight) {
        const t = fillTemplate(chrome.headerRight, localVars);
        page.drawText(t, { x: marginLeft + contentWidth - bodyFont.widthOfTextAtSize(t, size), y, size, font: bodyFont, color: toRgb(design.theme.text) });
      }
      if (chrome.rule) {
        page.drawLine({ start: { x: marginLeft, y: topY - mmToPt(1) }, end: { x: marginLeft + contentWidth, y: topY - mmToPt(1) }, thickness: 0.5, color: toRgb(design.theme.rule) });
      }
    }
    if (chrome.footerEnabled) {
      const y = bottomY - mmToPt(4);
      if (chrome.footerLeft) page.drawText(fillTemplate(chrome.footerLeft, localVars), { x: marginLeft, y, size, font: bodyFont, color: toRgb(design.theme.text) });
      if (chrome.footerCentre) {
        const t = fillTemplate(chrome.footerCentre, localVars);
        page.drawText(t, { x: marginLeft + (contentWidth - bodyFont.widthOfTextAtSize(t, size)) / 2, y, size, font: bodyFont, color: toRgb(design.theme.text) });
      }
      const right = chrome.footerRight || pageNumberText(chrome.pageNumber, pageNo, pages.pageCount);
      if (right) {
        const t = fillTemplate(right, localVars);
        page.drawText(t, { x: marginLeft + contentWidth - bodyFont.widthOfTextAtSize(t, size), y, size, font: bodyFont, color: toRgb(design.theme.text) });
      }
      if (chrome.rule) {
        page.drawLine({ start: { x: marginLeft, y: bottomY + mmToPt(2) }, end: { x: marginLeft + contentWidth, y: bottomY + mmToPt(2) }, thickness: 0.5, color: toRgb(design.theme.rule) });
      }
    }
  };

  // Shapes are drawn first (behind the text), in z order.
  pages.pages.forEach((page, i) => {
    const pdfPage = pdfPages[i];
    for (const box of pageShapes(page)) drawShape(pdfPage, box, design, heightMm);
  });

  // The blocks, in reading order per page.
  for (const page of pages.pages) {
    const pdfPage = pdfPages[page.index - 1];
    const marginLeft = mmToPt(design.setup.marginLeftMm);
    for (const box of pageBlocks(page)) {
      const x = marginLeft + mmToPt(box.xMm);
      const topY = heightPt - mmToPt(box.yMm);
      const widthPtBox = mmToPt(box.wMm);
      const isHeading = /^(\d+\.\s)/.test(box.displayLabel) || box.label === box.displayLabel;
      let cursor = topY;
      if (isHeading) {
        for (const line of wrapText(box.displayLabel, headingFont, headingPt, widthPtBox)) {
          pdfPage.drawText(line, { x, y: cursor - headingPt, size: headingPt, font: headingFont, color: toRgb(design.theme.heading) });
          cursor -= leading(headingPt);
        }
        cursor -= 2;
      }
      for (const text of sectionText(model, box.key)) {
        for (const line of wrapText(text, bodyFont, bodyPt, widthPtBox)) {
          pdfPage.drawText(line, { x, y: cursor - bodyPt, size: bodyPt, font: bodyFont, color: toRgb(design.theme.body) });
          cursor -= leading(bodyPt);
        }
        cursor -= 2;
      }
      // A table in this section prints with its resolved shades.
      const section = model.sections.find((s) => s.heading === box.key);
      const table = section?.blocks.find((b) => b.kind === 'table' && b.table);
      if (table?.table) {
        const st = styleFor(design, box.key);
        cursor = drawTable(pdfPage, table.table, x, cursor, widthPtBox, st, bodyFont, headingFont, bodyPt, leading);
      }
      // A figure in this section prints through the one engine.
      const fig = section?.blocks.find((b) => b.kind === 'figure' && b.figure);
      if (fig?.figure) {
        const png = figurePng(fig.figure);
        if (png) {
          const img = await pdf.embedPng(png);
          const w = Math.min(widthPtBox, FIGURE_SIZE_PT.widthPt);
          const h = w * (FIGURE_SIZE_PT.heightPt / FIGURE_SIZE_PT.widthPt);
          pdfPage.drawImage(img, { x, y: cursor - h, width: w, height: h });
          cursor -= h + 4;
        }
      }
    }
  }

  // Cross-references print as a resolved list on the page they were placed, or after the body.
  if (design.crossReferences.length > 0 && pdfPages.length > 0) {
    const last = pdfPages[pdfPages.length - 1];
    let y = mmToPt(design.setup.marginBottomMm) + mmToPt(20);
    const x = mmToPt(design.setup.marginLeftMm);
    for (const ref of design.crossReferences) {
      const r = resolveReference(ref, targets);
      last.drawText(r.text, { x, y, size: bodyPt, font: bodyFont, color: toRgb(design.theme.reference) });
      y -= leading(bodyPt);
    }
  }

  // Hyperlinks: printed on the last page's link list, with a real PDF link annotation.
  if (design.links.length > 0 && pdfPages.length > 0) {
    const last = pdfPages[pdfPages.length - 1];
    const x = mmToPt(design.setup.marginLeftMm);
    let y = mmToPt(design.setup.marginBottomMm) + mmToPt(12);
    for (const link of design.links) {
      const w = bodyFont.widthOfTextAtSize(link.label, bodyPt);
      last.drawText(link.label, { x, y, size: bodyPt, font: bodyFont, color: toRgb(design.theme.link) });
      if (link.underline) {
        last.drawLine({ start: { x, y: y - 2 }, end: { x: x + w, y: y - 2 }, thickness: 0.5, color: toRgb(design.theme.link) });
      }
      const annot = pdf.context.obj({
        Type: 'Annot', Subtype: 'Link',
        Rect: [x, y - 3, x + w, y + bodyPt],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: link.url },
      });
      last.node.addAnnot(pdf.context.register(annot));
      y -= leading(bodyPt);
    }
  }

  pdfPages.forEach((p, i) => {
    const first = i === 0;
    if (design.chrome.onFirstPage || !first) drawChrome(p, i + 1);
    else if (design.chrome.footerEnabled) drawChrome(p, i + 1);
  });

  return pdf.save();
}

/** The page-number text for a style. Pure. */
export function pageNumberText(style: string, page: number, total: number): string {
  switch (style) {
    case 'n': return String(page);
    case 'page-n': return `Page ${page}`;
    case 'n-of-total': return `${page} of ${total}`;
    case 'page-n-of-total': return `Page ${page} of ${total}`;
    case 'none': return '';
    default: return `Page ${page} of ${total}`;
  }
}

/** Draw one shape. Coordinates are in millimetres from the page's top-left; PDF y grows upward. */
function drawShape(page: PDFPage, box: ShapeBox, design: DocumentDesign, heightMm: number): void {
  const s = box.shape;
  const x = mmToPt(box.xMm);
  const topY = mmToPt(heightMm - box.yMm);
  const w = mmToPt(box.wMm);
  const h = mmToPt(box.hMm);
  const fill = resolveFill(s.fill, design);
  const strokeColour = s.stroke === 'none' ? null : (s.stroke || design.theme.rule);
  if (s.kind === 'ellipse') {
    page.drawEllipse({
      x: x + w / 2, y: topY - h / 2, xScale: w / 2, yScale: h / 2,
      color: fill ?? undefined,
      borderColor: strokeColour ? toRgb(strokeColour) : undefined,
      borderWidth: strokeColour ? s.strokePt : undefined,
    });
    return;
  }
  page.drawRectangle({
    x, y: topY - h, width: w, height: h,
    color: fill ?? undefined,
    borderColor: strokeColour ? toRgb(strokeColour) : undefined,
    borderWidth: strokeColour ? s.strokePt : undefined,
  });
}

function resolveFill(fill: string, design: DocumentThemeLike) {
  if (fill === 'none') return null;
  if (fill === 'brand') return toRgb(design.theme.primary);
  if (fill === 'accent') return toRgb(design.theme.accent);
  if (fill === 'surface') return toRgb(design.theme.surface);
  if (fill === 'callout') return toRgb(design.theme.calloutFill);
  return toRgb(fill);
}

interface DocumentThemeLike { theme: DocumentDesign['theme'] }

/** Draw a table with its resolved style. Returns the y cursor after the table. */
function drawTable(
  page: PDFPage, table: { headers: string[]; rows: string[][] }, x: number, topY: number, widthPt: number,
  style: TableStyle, bodyFont: PDFFont, headingFont: PDFFont, bodyPt: number, leading: (n: number) => number,
): number {
  const cols = Math.max(1, table.headers.length || table.rows[0]?.length || 1);
  const colWidth = widthPt / cols;
  const rowH = leading(bodyPt) + 2;
  let y = topY;
  const drawRow = (cells: string[], background: string | null, bold: boolean, textColour: string) => {
    if (background) {
      page.drawRectangle({ x, y: y - rowH, width: widthPt, height: rowH, color: toRgb(background) });
    }
    cells.forEach((cell, i) => {
      const cx = x + i * colWidth + 3;
      page.drawText(cell.slice(0, 60), { x: cx, y: y - bodyPt - 2, size: bodyPt, font: bold ? headingFont : bodyFont, color: toRgb(textColour) });
    });
    if (style.borderPt > 0 && style.border !== 'none') {
      page.drawLine({ start: { x, y: y - rowH }, end: { x: x + widthPt, y: y - rowH }, thickness: style.borderPt, color: toRgb(style.border) });
    }
    y -= rowH;
  };
  drawRow(table.headers, style.headerBackground, true, style.headerText);
  table.rows.forEach((row, i) => {
    const bg = style.rowAlternate && i % 2 === 1 ? style.rowAlternate : null;
    drawRow(row, bg, false, style.headerText === '#ffffff' ? '#14161b' : style.headerText);
  });
  return y - 2;
}
