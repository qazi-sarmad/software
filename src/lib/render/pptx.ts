/**
 * renderPptx (F9, F10): a fully editable PowerPoint the Board Pack and the certificate produce. All
 * text is native editable text, tables are native tables and charts are native charts, so the owner
 * can edit the deck. Pure — it takes a BrandingSpec and a document model and returns bytes.
 *
 * PPTX theme extraction (F9): an org may upload a .pptx or .potx; v1 EXTRACTS its theme (colours,
 * fonts, slide size, logo images) with JSZip and XML parsing and applies them to pptxgenjs masters.
 * It does NOT reuse the file's slide layouts, and the UI says so.
 */
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import { mmToPt, pageDimensions, type BrandingSpec } from './branding';

export interface PptxSlide {
  title: string;
  bullets: string[];
  /** A native table (rows of strings), when the slide shows figures. */
  table?: { header: string[]; rows: string[][] };
  /** A native bar chart, when the slide shows a trend. */
  chart?: { categories: string[]; values: number[]; seriesName: string };
  /** Figure hyperlinks: label plus target URL, drawn as clickable text (F10 drill-down). */
  links?: { label: string; url: string }[];
}

export interface PptxDocumentModel {
  title: string;
  subtitle?: string;
  slides: PptxSlide[];
}

/** The theme extracted from an uploaded .pptx/.potx (F9). */
export interface PptxTheme {
  colours: string[];
  majorFont: string | null;
  minorFont: string | null;
  slideWidthEmu: number | null;
  slideHeightEmu: number | null;
  logoParts: string[];
}

const EMU_PER_INCH = 914400;

function firstTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? m[1] : null;
}

/**
 * Extract a theme from a .pptx/.potx archive (F9). Deterministic: it reads the fixed OOXML part
 * names and the first theme XML, in order. No slide layouts are read.
 */
export async function extractPptxTheme(bytes: Uint8Array): Promise<PptxTheme> {
  const zip = await JSZip.loadAsync(bytes);
  const themePath = Object.keys(zip.files).find((p) => /^ppt\/theme\/theme1\.xml$/i.test(p))
    ?? Object.keys(zip.files).find((p) => /^ppt\/theme\/.*\.xml$/i.test(p));
  const themeXml = themePath ? await zip.files[themePath].async('string') : '';

  const colourScheme = themeXml ? firstTag(themeXml, 'a:clrScheme') ?? '' : '';
  const colours: string[] = [];
  if (colourScheme) {
    const re = /<a:(dk1|lt1|dk2|lt2|accent1|accent2|accent3|accent4|accent5|accent6)>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(colourScheme)) !== null) colours.push(`#${m[2].toUpperCase()}`);
  }

  const fontScheme = themeXml ? firstTag(themeXml, 'a:fontScheme') ?? '' : '';
  const majorMatch = /<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(fontScheme);
  const minorMatch = /<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(fontScheme);

  let slideWidthEmu: number | null = null;
  let slideHeightEmu: number | null = null;
  const presPath = Object.keys(zip.files).find((p) => /^ppt\/presentation\.xml$/i.test(p));
  if (presPath) {
    const pres = await zip.files[presPath].async('string');
    const w = /<p:sldSz[^>]*\bcx="(\d+)"/.exec(pres);
    const h = /<p:sldSz[^>]*\bcy="(\d+)"/.exec(pres);
    if (w) slideWidthEmu = Number(w[1]);
    if (h) slideHeightEmu = Number(h[1]);
  }

  const logoParts = Object.keys(zip.files).filter((p) => /^ppt\/media\/.*\.(png|jpe?g|svg)$/i.test(p));

  return {
    colours,
    majorFont: majorMatch ? majorMatch[1] : null,
    minorFont: minorMatch ? minorMatch[1] : null,
    slideWidthEmu,
    slideHeightEmu,
    logoParts,
  };
}

/** A safe pptxgenjs colour: a #RRGGBB value; a token name becomes a neutral default. */
function pptxColour(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.replace('#', '').toUpperCase() : fallback;
}

export async function renderPptx(spec: BrandingSpec, model: PptxDocumentModel): Promise<Uint8Array> {
  const pptx = new pptxgen();
  const dims = pageDimensions(spec.pageSize);
  const theme = spec.pptxTheme as unknown as PptxTheme | null;

  const wIn = theme?.slideWidthEmu ? theme.slideWidthEmu / EMU_PER_INCH : dims.widthIn;
  const hIn = theme?.slideHeightEmu ? theme.slideHeightEmu / EMU_PER_INCH : dims.heightIn;
  pptx.defineLayout({ name: 'PROVIO', width: wIn, height: hIn });
  pptx.layout = 'PROVIO';

  const headingFont = theme?.majorFont || spec.fontHeading || 'Helvetica';
  const bodyFont = theme?.minorFont || spec.fontBody || 'Helvetica';
  const themeColour = theme?.colours?.[4] ?? theme?.colours?.[0];
  const primary = themeColour ? pptxColour(themeColour, '1F3A5F') : pptxColour(spec.colourPrimary, '1F3A5F');

  // Cover.
  const cover = pptx.addSlide();
  cover.addText(model.title, { x: 0.5, y: 1.2, w: wIn - 1, h: 1, fontSize: 30, bold: true, fontFace: headingFont, color: primary });
  if (model.subtitle) {
    cover.addText(model.subtitle, { x: 0.5, y: 2.2, w: wIn - 1, h: 0.6, fontSize: 16, fontFace: bodyFont, color: '444444' });
  }

  for (const slide of model.slides) {
    const s = pptx.addSlide();
    s.addText(slide.title, { x: 0.4, y: 0.3, w: wIn - 0.8, h: 0.7, fontSize: 20, bold: true, fontFace: headingFont, color: primary });

    let bodyTop = 1.1;
    if (slide.bullets.length) {
      s.addText(slide.bullets.map((b) => ({ text: b, options: { bullet: true } })),
        { x: 0.5, y: bodyTop, w: wIn - 1, h: 0.5 + 0.35 * slide.bullets.length, fontSize: 14, fontFace: bodyFont, color: '222222' });
      bodyTop += 0.5 + 0.35 * slide.bullets.length;
    }

    if (slide.table) {
      const rows = [slide.table.header, ...slide.table.rows].map((r) =>
        r.map((c) => ({ text: c, options: { fontFace: bodyFont, fontSize: 11 } }))
      );
      s.addTable(rows, { x: 0.5, y: bodyTop, w: wIn - 1, colW: new Array(slide.table.header.length).fill((wIn - 1) / slide.table.header.length) });
      bodyTop += 0.4 * rows.length + 0.3;
    }

    if (slide.chart) {
      s.addChart(pptx.ChartType.bar, [{ name: slide.chart.seriesName, labels: slide.chart.categories, values: slide.chart.values }],
        { x: 0.5, y: bodyTop, w: wIn - 1, h: hIn - bodyTop - 0.6, showLegend: false });
    }

    if (slide.links?.length) {
      slide.links.forEach((link, i) => {
        s.addText(link.label, { x: 0.5, y: hIn - 0.6 - 0.05 * i, w: wIn - 1, h: 0.3, fontSize: 10, fontFace: bodyFont, color: '1155CC', hyperlink: { url: link.url } });
      });
    }
  }

  const out = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  return new Uint8Array(out);
}
