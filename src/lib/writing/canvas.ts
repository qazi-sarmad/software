/**
 * The live-canvas page model (WP-C2). A pure function that turns a report format and its plan into
 * the geometry a canvas draws: page size in pixels, the content box, and one placed block per
 * visible section with its own heading size, body size and line height. Deterministic: the same
 * format always yields the same model, and no clock is read. The canvas component renders this; the
 * PDF renderer reads the same typography through `resolveTypography`, so the canvas and the print
 * agree on sizes.
 *
 * There is no layout engine here: a block's height is estimated from its heading and a caller-supplied
 * count of body lines, so the preview shows real proportions without claiming to be a paginator.
 */
import {
  DEFAULT_FORMAT_LAYOUT, applyFormat, resolveTypography,
  type AppliedFormat, type FormatLayout, type FormatBlock, type RegisterChoice, type ReportFormat,
} from './reportFormat';
import { pageDimensions } from '../render/branding';

/** Pixels per millimetre at the canvas' own scale (a 96 dpi page shown at 1:1 in CSS pixels). */
const PX_PER_MM = 96 / 25.4;

export interface CanvasBlock {
  key: string;
  label: string;
  headingPt: number;
  bodyPt: number;
  bodyWeight: number;
  headingWeight: number;
  lineHeight: number;
  /** The number of body lines the caller says this block holds (0 for a heading-only block). */
  bodyLines: number;
  /** The estimated height of the block in canvas pixels. */
  heightPx: number;
}

export interface CanvasPage {
  pageSize: 'A4' | 'Letter';
  widthPx: number;
  heightPx: number;
  /** The content box: page minus margins, in pixels. */
  contentWidthPx: number;
  contentHeightPx: number;
  marginTopPx: number;
  marginRightPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  blocks: CanvasBlock[];
  /** True when the blocks overflow the first page (the canvas shows a page break marker). */
  overflowsFirstPage: boolean;
}

export interface CanvasInput {
  format: ReportFormat;
  plan: { key: string; role: FormatBlock['role']; label: string }[];
  modelDefault: RegisterChoice;
  /** Body-line counts by section key. A missing key counts as a heading plus one line. */
  bodyLines?: Record<string, number>;
}

/** Millimetres to canvas pixels, rounded to a whole pixel so two renders of the same page match. */
export function mmToPx(mm: number): number {
  return Math.round(mm * PX_PER_MM);
}

/** The estimated height of a block in pixels: heading + body lines, at the resolved sizes. */
export function blockHeightPx(headingPt: number, bodyPt: number, lineHeight: number, bodyLines: number): number {
  const heading = headingPt * 1.2;
  const body = bodyLines > 0 ? bodyPt * lineHeight * bodyLines : 0;
  return Math.round(heading + body + 16);
}

/** Build the page model the live canvas draws. Pure; the same input always yields the same page. */
export function buildCanvas(input: CanvasInput): CanvasPage {
  const { format, plan, modelDefault, bodyLines = {} } = input;
  const layout: FormatLayout = { ...DEFAULT_FORMAT_LAYOUT, ...format.layout };
  const typo = resolveTypography(layout);
  const dims = pageDimensions(layout.pageSize);

  const applied: AppliedFormat = applyFormat(format, plan, modelDefault);

  const blocks: CanvasBlock[] = applied.blocks.map((b) => {
    const lines = bodyLines[b.key] ?? 1;
    return {
      key: b.key,
      label: b.label,
      headingPt: typo.headingPt,
      bodyPt: typo.bodyPt,
      bodyWeight: typo.bodyWeight,
      headingWeight: typo.headingWeight,
      lineHeight: typo.lineHeight,
      bodyLines: lines,
      heightPx: blockHeightPx(typo.headingPt, typo.bodyPt, typo.lineHeight, lines),
    };
  });

  const widthPx = mmToPx(dims.widthIn * 25.4);
  const heightPx = mmToPx(dims.heightIn * 25.4);
  const contentWidthPx = widthPx - mmToPx(layout.marginLeftMm) - mmToPx(layout.marginRightMm);
  const contentHeightPx = heightPx - mmToPx(layout.marginTopMm) - mmToPx(layout.marginBottomMm);
  const used = blocks.reduce((sum, b) => sum + b.heightPx, 0);

  return {
    pageSize: layout.pageSize,
    widthPx,
    heightPx,
    contentWidthPx,
    contentHeightPx,
    marginTopPx: mmToPx(layout.marginTopMm),
    marginRightPx: mmToPx(layout.marginRightMm),
    marginBottomPx: mmToPx(layout.marginBottomMm),
    marginLeftPx: mmToPx(layout.marginLeftMm),
    blocks,
    overflowsFirstPage: used > contentHeightPx,
  };
}
