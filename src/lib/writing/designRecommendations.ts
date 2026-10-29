/**
 * The design recommendation engine (WP-D, the "smart recommendations" of the canvas).
 *
 * A deterministic adviser, not a model. It reads a report format's layout and the organisation's brand
 * colours and returns ranked, explained suggestions — never a generated design, never free text. The
 * same layout always yields the same list, so a recommendation can be cited in a review and re-derived
 * later. It is the rule engine's ethic applied to typography: the machine proposes, the designer
 * disposes, and every suggestion says *why* in the language of an audit report.
 *
 * Every suggestion carries a patch (`apply`) that the format editor applies verbatim, so a suggestion
 * is never advice the designer must hand-translate into settings. Colour suggestions compute their
 * value through `colourMath` at run time; no hex literal is written here.
 */
import type { DesignTheme } from './designTheme';
import { contrastRatio, darken } from './colourMath';

/** What the report is for. Drives the reading conditions the advice assumes. */
export type ReportPurpose =
  | 'audit_report'
  | 'financial_statements'
  | 'board_presentation'
  | 'working_paper'
  | 'management_letter';

export const REPORT_PURPOSE_LABELS: Record<ReportPurpose, string> = {
  audit_report: 'Audit report',
  financial_statements: 'Financial statements',
  board_presentation: 'Board presentation',
  working_paper: 'Working paper',
  management_letter: 'Management letter',
};

/** The subset of a format's layout the adviser reads. A caller passes the live layout. */
export interface DesignRecommendationInput {
  purpose: ReportPurpose;
  layout: {
    pageSize: 'A4' | 'Letter';
    marginTopMm: number;
    marginRightMm: number;
    marginBottomMm: number;
    marginLeftMm: number;
    fontSizePt: number;
    lineHeightPct: number;
    headingScalePct: number;
    columns: number;
    columnGapMm: number;
    grid: { sizeMm: number };
    /** The full header/footer spec, so a patch can spread it without dropping a template field. */
    chrome: {
      headerEnabled: boolean;
      headerLeft: string;
      headerCentre: string;
      headerRight: string;
      footerEnabled: boolean;
      footerLeft: string;
      footerCentre: string;
      footerRight: string;
      rule: boolean;
      onFirstPage: boolean;
      pageNumber: string;
    };
    numberedHeadings: boolean;
    shapes: { kind: string }[];
  };
  /** The derived theme, so contrast is checked against the page the report actually prints on. */
  theme: DesignTheme;
}

export type RecommendationCategory = 'page' | 'typography' | 'colour' | 'structure' | 'branding';
/** `defect` breaks a stated requirement, `warning` hurts readability, `advice` is a refinement. */
export type RecommendationSeverity = 'defect' | 'warning' | 'advice';

export interface DesignRecommendation {
  /** Stable id, so a designer's dismissal of one suggestion is remembered by id, not by text. */
  id: string;
  category: RecommendationCategory;
  severity: RecommendationSeverity;
  title: string;
  /** Why, in audit terms: what the reader loses if it is not applied. */
  rationale: string;
  /** The layout patch to apply. Empty when the fix is a brand-colour change the adviser cannot make. */
  apply: Record<string, unknown>;
}

/** Page width in millimetres, so the adviser measures the real content box. */
function pageWidthMm(pageSize: 'A4' | 'Letter'): number {
  return pageSize === 'Letter' ? 215.9 : 210;
}

/** Content-box width in millimetres for a single column. */
function contentWidthMm(input: DesignRecommendationInput): number {
  const { layout } = input;
  return pageWidthMm(layout.pageSize) - layout.marginLeftMm - layout.marginRightMm;
}

/**
 * The approximate characters per line, from the content width and the body size. An average character
 * is about half the em width; the constant is fixed so the estimate is deterministic and comparable
 * between formats, which is all the adviser needs to say "this line is too long".
 */
export function charactersPerLine(input: DesignRecommendationInput): number {
  const { layout } = input;
  const emMm = layout.fontSizePt * (25.4 / 72);
  const columnWidth = layout.columns > 1
    ? (contentWidthMm(input) - layout.columnGapMm * (layout.columns - 1)) / layout.columns
    : contentWidthMm(input);
  return Math.round(columnWidth / (emMm * 0.5));
}

const WEIGHT: Record<RecommendationSeverity, number> = { defect: 12, warning: 6, advice: 2 };
const RANK: Record<RecommendationSeverity, number> = { defect: 0, warning: 1, advice: 2 };
const CATEGORY_ORDER: RecommendationCategory[] = ['colour', 'typography', 'page', 'structure', 'branding'];

/**
 * Produce the ranked recommendations. Pure and total: a layout that satisfies every rule returns an
 * empty list, and the quality score is 100.
 */
export function recommendDesign(input: DesignRecommendationInput): DesignRecommendation[] {
  const { layout, theme } = input;
  const out: DesignRecommendation[] = [];
  const cpl = charactersPerLine(input);

  // ---- Typography ---------------------------------------------------------------------------
  if (layout.fontSizePt < 10) {
    out.push({
      id: 'type.body_too_small',
      category: 'typography',
      severity: 'warning',
      title: `Body text is ${layout.fontSizePt}pt`,
      rationale: 'Below 10pt an audit report is hard to read on paper, and a finding a reader squints at is a finding they may miss.',
      apply: { fontSizePt: 11 },
    });
  }
  if (layout.lineHeightPct < 125) {
    out.push({
      id: 'type.leading_tight',
      category: 'typography',
      severity: 'warning',
      title: `Line height is ${(layout.lineHeightPct / 100).toFixed(2)}`,
      rationale: 'Tight leading makes dense paragraphs hard to scan; 1.40 is the comfortable floor for a formal report.',
      apply: { lineHeightPct: 140 },
    });
  }
  if (layout.headingScalePct < 130) {
    out.push({
      id: 'type.heading_scale_small',
      category: 'typography',
      severity: 'advice',
      title: `Headings are only ${(layout.headingScalePct / 100).toFixed(2)}× the body`,
      rationale: 'A heading that barely exceeds its body text does not let a reader find a section at a glance.',
      apply: { headingScalePct: 160 },
    });
  }
  if (cpl > 90) {
    out.push({
      id: 'type.line_too_long',
      category: 'typography',
      severity: 'warning',
      title: `About ${cpl} characters per line`,
      rationale: 'Past ~90 characters the eye loses the line start on the return; two columns or a larger body size restores it.',
      apply: layout.columns === 1 ? { columns: 2, columnGapMm: 8 } : { fontSizePt: 12 },
    });
  }

  // ---- Page ---------------------------------------------------------------------------------
  if (layout.marginLeftMm < 18) {
    out.push({
      id: 'page.binding_margin',
      category: 'page',
      severity: 'advice',
      title: `Left margin is ${layout.marginLeftMm}mm`,
      rationale: 'A bound report needs a wider inner margin or the text runs into the spine.',
      apply: { marginLeftMm: 22 },
    });
  }
  if (layout.grid.sizeMm > 10) {
    out.push({
      id: 'page.grid_coarse',
      category: 'page',
      severity: 'advice',
      title: `Snap grid is ${layout.grid.sizeMm}mm`,
      rationale: 'A coarse grid cannot place a rule or a caption where the design needs it; 5mm keeps the page aligned and still lets a block be placed precisely.',
      apply: { grid: { ...layout.grid, sizeMm: 5 } },
    });
  }
  if (!layout.chrome.headerEnabled && !layout.chrome.footerEnabled) {
    out.push({
      id: 'page.no_running_head',
      category: 'page',
      severity: 'warning',
      title: 'No header or footer',
      rationale: 'An audit report should carry the engagement and its classification on every page, so a loose page still says what it is and who may read it.',
      // A complete ChromeSpec, so applying the patch never leaves a template field undefined.
      apply: {
        chrome: {
          headerEnabled: true,
          headerLeft: '{engagement}',
          headerCentre: '',
          headerRight: '{classification}',
          footerEnabled: true,
          footerLeft: '{org}',
          footerCentre: '',
          footerRight: 'Page {page} of {pages}',
          rule: true,
          onFirstPage: false,
          pageNumber: layout.chrome.pageNumber === 'none' ? 'page-n-of-total' : layout.chrome.pageNumber,
        },
      },
    });
  }
  if (layout.chrome.pageNumber === 'none') {
    out.push({
      id: 'page.no_page_number',
      category: 'page',
      severity: 'warning',
      title: 'Pages are not numbered',
      rationale: 'A workpaper with no page number cannot be cited in a finding, and a finding that cannot cite a page cannot be reviewed.',
      apply: { chrome: { ...layout.chrome, pageNumber: 'page-n-of-total' } },
    });
  }

  // ---- Structure ----------------------------------------------------------------------------
  if (!layout.numberedHeadings) {
    out.push({
      id: 'structure.unnumbered',
      category: 'structure',
      severity: 'advice',
      title: 'Section headings are unnumbered',
      rationale: 'Numbered headings let a finding cite "§4.2" and a cross-reference point at a stable target.',
      apply: { numberedHeadings: true },
    });
  }
  if (input.purpose === 'financial_statements' && layout.columns > 1) {
    out.push({
      id: 'structure.statements_one_column',
      category: 'structure',
      severity: 'warning',
      title: 'Statements set in columns',
      rationale: 'A statement of financial position reads down a single column; multi-column flow breaks the table-to-note alignment.',
      apply: { columns: 1 },
    });
  }
  if (input.purpose === 'board_presentation' && layout.fontSizePt < 12) {
    out.push({
      id: 'structure.board_larger_type',
      category: 'structure',
      severity: 'advice',
      title: 'Board slides use body text',
      rationale: 'A board presentation is read at a distance; a larger body size holds a room.',
      apply: { fontSizePt: 12, lineHeightPct: 150 },
    });
  }
  if (layout.shapes.length > 6) {
    out.push({
      id: 'structure.too_much_ornament',
      category: 'structure',
      severity: 'advice',
      title: `${layout.shapes.length} design shapes on the page`,
      rationale: 'Heavy ornament competes with the figures; a formal report reads better with four or fewer.',
      apply: {},
    });
  }

  // ---- Colour (branding) --------------------------------------------------------------------
  const bodyContrast = contrastRatio(theme.body, theme.background);
  if (bodyContrast < 4.5) {
    out.push({
      id: 'colour.body_contrast',
      category: 'colour',
      severity: 'defect',
      title: `Body text contrast is ${bodyContrast.toFixed(1)}:1`,
      rationale: 'Body text must reach 4.5:1 against the page; below it the report fails an accessibility requirement and prints faintly.',
      apply: { colourText: darken(theme.body, 0.35) },
    });
  }
  const headingContrast = contrastRatio(theme.heading, theme.background);
  if (headingContrast < 3) {
    out.push({
      id: 'colour.heading_contrast',
      category: 'colour',
      severity: 'warning',
      title: `Heading contrast is ${headingContrast.toFixed(1)}:1`,
      rationale: 'A brand colour too pale to read as a heading should be darkened for the page while staying on brand.',
      apply: { colourPrimary: darken(theme.primary, 0.25) },
    });
  }
  const ruleContrast = contrastRatio(theme.rule, theme.background);
  if (ruleContrast > 1.6) {
    out.push({
      id: 'colour.rule_too_loud',
      category: 'colour',
      severity: 'advice',
      title: 'Section rules are strong',
      rationale: 'A rule is a hairline; when it reads as a bar it competes with the headings it separates.',
      apply: { colourAccent: darken(theme.accent, 0.1) },
    });
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.id.localeCompare(b.id));
}

/** The counts, for a header line. */
export function summariseRecommendations(recs: DesignRecommendation[]): { defects: number; warnings: number; advice: number; total: number } {
  return {
    defects: recs.filter((r) => r.severity === 'defect').length,
    warnings: recs.filter((r) => r.severity === 'warning').length,
    advice: recs.filter((r) => r.severity === 'advice').length,
    total: recs.length,
  };
}

/** A 0–100 quality score: 100 minus a fixed weight per open recommendation, floored at 0. */
export function designQualityScore(recs: DesignRecommendation[]): number {
  const penalty = recs.reduce((sum, r) => sum + WEIGHT[r.severity], 0);
  return Math.max(0, 100 - penalty);
}

/**
 * The default purpose for a report model id, so the adviser reads the right conditions without the
 * designer choosing. M1–M6 are audit deliverables; M9 the management letter; M10–M12 the board and
 * statement packs. Pure and total: an unknown model defaults to `audit_report`.
 */
export function purposeForModel(modelId: string): ReportPurpose {
  const map: Record<string, ReportPurpose> = {
    M1: 'audit_report', M2: 'audit_report', M3: 'audit_report',
    M4: 'audit_report', M5: 'audit_report', M6: 'audit_report',
    M7: 'working_paper', M8: 'working_paper',
    M9: 'management_letter',
    M10: 'board_presentation', M11: 'board_presentation',
    M12: 'financial_statements',
  };
  return map[modelId] ?? 'audit_report';
}
