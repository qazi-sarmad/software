/**
 * Report formats (WRITE-1, owner instruction 2026-10-26): the interactive, per-client, versioned
 * format editor.
 *
 * A FORMAT is the client's own presentation of a report: which blocks appear, in what order, which
 * register and locale each block renders at, and the print layout. It is DATA, not code, and it is
 * held PER ORGANISATION (a client is one tenant organisation, spec §3) and VERSIONED like every
 * other piece of configuration (L5).
 *
 * Two invariants keep a format honest:
 *   1. A format may only choose among what the report model already allows. It can hide a section,
 *      reorder one, or pick a register from `allowedRegisters` — it can never invent a section, a
 *      claim or a figure. The block catalogue is derived from the model, so the editor offers only
 *      real choices.
 *   2. Editing a format never changes the facts. The graph root is invariant across every format,
 *      because a format changes wording and layout only — exactly the same guarantee the register
 *      matrix carries (W2.2). Only the render hash moves.
 *
 * The module is pure: no database client, no clock, no randomness. The tables and RPCs live in
 * migration 0091; the screen is ReportFormatPanel.
 */
import { canonicalise, hashCanonical, normaliseText } from './canonical';
import { DEFAULT_FONT_BODY, DEFAULT_FONT_HEADING, isAllowedFontFamily, resolveWeight } from '../render/fonts';
import type { Formality, Locale, RhetoricalRole, Tone, Voice } from './types';
import type { ContentsSpec } from '../render/document';
import { DEFAULT_GRID, GRID_LIMITS, type GridSpec } from './grid';
import {
  DEFAULT_CHROME, DEFAULT_PAGE_SETUP, PAGE_NUMBER_STYLES, PAGE_SETUP_LIMITS, defaultPlacedBlock,
  type ChromeSpec, type PageSetup, type PlacedBlock,
} from './pageDesign';
import { SHAPE_LIMITS, shapeFromRow, type ShapeSpec } from './shapes';
import { LINK_LIMITS, hyperlinkError, type CrossReferenceSpec, type HyperlinkSpec } from './links';
import { DEFAULT_TABLE_STYLE, TABLE_STYLE_NAMES, type TableStyleName } from './tableStyleDefaults';

/** Every rhetorical role a plan section may carry. The editor offers exactly these. */
export const RHETORICAL_ROLES: RhetoricalRole[] = [
  'lead_in', 'context', 'condition', 'criteria', 'cause', 'effect', 'recommendation',
  'management_response', 'status', 'exception_summary', 'coverage', 'scope', 'limitation',
  'alert_summary', 'numeric_summary', 'summary', 'findings', 'appendices',
];

export const FORMAT_STATUSES = ['draft', 'published'] as const;
export type FormatStatus = (typeof FORMAT_STATUSES)[number];

/** A block's rhetorical role is the model's own role vocabulary, so a format cannot invent one. */
export type BlockRole = RhetoricalRole;

/** A section as the format presents it. `key` names a section the model's plan already defines. */
export interface FormatBlock {
  /** The plan section id this block presents. The format cannot invent one. */
  key: string;
  label: string;
  role: BlockRole;
  /** Whether the block appears at all. Hiding is the only removal a format may do. */
  visible: boolean;
  /** A register chosen from the model's allowed set, or null to use the model default. */
  register: RegisterChoice | null;
}

export interface RegisterChoice {
  formality: Formality;
  tone: Tone;
  voice: Voice;
}

/** The print layout: sizes in millimetres, and the tokens the renderers already consume. */
export interface FormatLayout {
  pageSize: 'A4' | 'Letter';
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  /** A design-token name, or a curated palette value. Never a bare hex literal in a component. */
  colourPrimary: string;
  colourAccent: string;
  colourText: string;
  colourBackground: string;
  fontHeading: string;
  fontBody: string;
  /** Body text size in points (WP-C1). The heading size is this × headingScale. */
  fontSizePt: number;
  /** Line height as an integer percentage of the font size (140 = 1.4). Integer, because the
   *  canonical ledger has no floats: the scale is explicit, not implied. */
  lineHeightPct: number;
  /** The heading size as an integer percentage of the body size (160 = 1.6). */
  headingScalePct: number;
  /** Heading and body weights, chosen from the weights the font family ships (WP-C1). */
  fontWeightHeading: number;
  fontWeightBody: number;
  /** Whether the footer line carrying the hashes is printed. */
  showFooter: boolean;
  /** The table of contents (WP-T). A formal report carries one; a format decides its design. */
  contents: ContentsStyle;
  // ------------------------------------------------------------------------------------------
  // The page design (WP-D): the parts of the layout a designer sets on the canvas.
  // ------------------------------------------------------------------------------------------
  /** Portrait or landscape. `pageSize` gives the paper; this gives the way up it is printed. */
  orientation: 'portrait' | 'landscape';
  /** The number of text columns the flowing body uses (1..3). */
  columns: number;
  /** The gap between two columns, in millimetres. */
  columnGapMm: number;
  /** The snap grid and the rulers. */
  grid: GridSpec;
  /** The header and footer. */
  chrome: ChromeSpec;
  /** Number the section headings (`1. Scope`). */
  numberedHeadings: boolean;
  /** Where each block sits: flowing, or free at an x/y the designer chose. */
  placed: PlacedBlock[];
  /** The shapes the designer dropped on the page. */
  shapes: ShapeSpec[];
  /** The hyperlinks the report carries. */
  links: HyperlinkSpec[];
  /** The cross-references the report carries, resolved to the target's page. */
  crossReferences: CrossReferenceSpec[];
  /** The table style applied to a table the designer does not style itself. */
  defaultTableStyle: TableStyleName;
  /** Per-table style choices, keyed by the table's section key. */
  tableStyles: { key: string; style: TableStyleName }[];
  /** The border and alternate-row colours a table style derives its shades from. */
  tableBorder: string;
  tableRowAlternate: string;
}

/**
 * The design of the printed table of contents (WP-T). Every field is presentation only: the entries
 * themselves are always the report's own headings, in the report's own order, so the contents page
 * can never disagree with the body.
 */
export interface ContentsStyle {
  /** Whether the format prints a contents page at all. */
  enabled: boolean;
  /** The contents page's own title. */
  title: string;
  /** 1 lists section headings only; 2 also lists each section's own sub-headings. */
  depth: 1 | 2;
  /** Print an entry number against each level-1 entry. */
  numbered: boolean;
  /** Dot leaders, so a printed page reads as a formal contents page. */
  dotLeaders: boolean;
  /** Indent level-2 entries under their section. */
  indentSubheadings: boolean;
  /** The contents title's size as a percentage of the report's heading size. */
  titleScalePct: number;
}

export const CONTENTS_LIMITS = {
  titleMaxLength: 60,
  titleScalePct: { min: 80, max: 200 },
} as const;

export const DEFAULT_CONTENTS_STYLE: ContentsStyle = {
  enabled: true,
  title: 'Contents',
  depth: 2,
  numbered: true,
  dotLeaders: true,
  indentSubheadings: true,
  titleScalePct: 120,
};

/** A heading a client may put on a block (WP-H). Presentation only: the label names the section, it
 *  never states a fact, and it is validated against the same rules whether typed or chosen. */
export const HEADING_LABEL_LIMITS = {
  maxLength: 80,
} as const;

/**
 * Whether a heading label is acceptable (WP-H). A label is presentation, so it must be plain words:
 * non-empty, short, one line, and free of markup. Returns the reason when it is not, so the editor
 * can say precisely what is wrong. Pure.
 */
export function validateHeadingLabel(label: string): { ok: boolean; reason?: string } {
  const v = (label ?? '').trim();
  if (v === '') return { ok: false, reason: 'a heading needs a label' };
  if (v.length > HEADING_LABEL_LIMITS.maxLength) {
    return { ok: false, reason: `a heading may be at most ${HEADING_LABEL_LIMITS.maxLength} characters` };
  }
  if (/[\r\n\t]/.test(v)) return { ok: false, reason: 'a heading must be a single line' };
  if (/[<>{}]/.test(v)) return { ok: false, reason: 'a heading must be plain text, without markup' };
  return { ok: true };
}

/** The bounds a format's typography may take. Outside these the page stops being readable, so the
 *  editor and the validator agree on one set of numbers (WP-C1). */
export const TYPOGRAPHY_LIMITS = {
  fontSizePt: { min: 8, max: 16 },
  /** Percent. 100% = single spacing; 250% = the loosest the page allows. */
  lineHeightPct: { min: 100, max: 250 },
  /** Percent. 100% = a heading the same size as the body; 250% = the largest. */
  headingScalePct: { min: 100, max: 250 },
  fontWeight: [400, 500, 600, 700] as number[],
} as const;

/**
 * A curated palette of pickable colours (WP-C1). The report format's four colours default to the
 * design tokens (`brand-*`); a client may instead pick one of these values, or type a value of their
 * own. The values live here, in a pure module, so a component never writes a colour literal — the
 * token guard would reject one in a component. This is what makes the editor's colour picker real
 * without weakening the "colours are data" rule.
 */
export const REPORT_PALETTE: { name: string; value: string }[] = [
  { name: 'Ink', value: '#14161B' },
  { name: 'Graphite', value: '#3A3F4A' },
  { name: 'Slate', value: '#5F6573' },
  { name: 'Verdigris', value: '#2F6F5E' },
  { name: 'Deep verdigris', value: '#1F4A3E' },
  { name: 'Cinnabar', value: '#C2410C' },
  { name: 'Brass', value: '#C9A227' },
  { name: 'Bone', value: '#F6F5F2' },
  { name: 'Porcelain', value: '#EFEDE8' },
  { name: 'Paper', value: '#FFFFFF' },
];

/** A colour is valid when it is a design token name or a hex value. */
export function isValidColour(value: string): boolean {
  const v = (value || '').trim();
  return /^brand-[a-z]+$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v);
}

/** One role that may apply a format, and whether it may edit it. Rights, never role names, gate
 *  this in the database; this is the client's declared intent, stored as data. */
export interface FormatAudience {
  roleSlug: string;
  canView: boolean;
  canEdit: boolean;
}

export interface ReportFormat {
  id: string;
  orgId: string;
  /** A stable key the client chooses, e.g. `board-quarterly`. */
  formatKey: string;
  version: number;
  label: string;
  status: FormatStatus;
  /** The report model this format is built for (M1..M12). */
  modelId: string;
  blocks: FormatBlock[];
  layout: FormatLayout;
  /** The default locale for this format; overridable per report (W2.3). */
  defaultLocale: Locale;
  audiences: FormatAudience[];
  createdBy: string;
  createdAt: string;
  /** The hash of the format body, so a published version can be shown to be unchanged. */
  bodyHash: string;
}

/** The body that is hashed. The hash moves only when the format genuinely changes. */
export function formatBody(
  format: Omit<ReportFormat, 'bodyHash' | 'id' | 'createdAt' | 'createdBy'>,
): unknown {
  return {
    orgId: format.orgId,
    formatKey: format.formatKey,
    version: format.version,
    label: format.label,
    status: format.status,
    modelId: format.modelId,
    blocks: format.blocks,
    layout: format.layout,
    defaultLocale: format.defaultLocale,
    audiences: [...format.audiences].sort((a, z) => a.roleSlug.localeCompare(z.roleSlug)),
  };
}

export function formatBodyHash(
  format: Omit<ReportFormat, 'bodyHash' | 'id' | 'createdAt' | 'createdBy'>,
): Promise<string> {
  return hashCanonical(formatBody(format) as never);
}

// ---------------------------------------------------------------------------
// Validation. Every rule names what is wrong so the editor can show it precisely.
// ---------------------------------------------------------------------------

export interface FormatIssue {
  code: string;
  field: string;
  message: string;
}

/** The model a format is validated against: only what it really allows. */
export interface FormatModelScope {
  modelId: string;
  /** The plan section ids the model defines. A format may only reference these. */
  sectionIds: string[];
  defaultLocale: Locale;
  allowedRegisters: RegisterChoice[];
}

const sameRegister = (a: RegisterChoice, b: RegisterChoice) =>
  a.formality === b.formality && a.tone === b.tone && a.voice === b.voice;

/**
 * Validate a format against its model. The checks are the ones a client could otherwise use to
 * smuggle a fact in through presentation:
 *   - a block key that the model does not define (inventing content);
 *   - a register outside the model's allowed set (a model that forbids a register means it);
 *   - a layout whose margins leave no room for content;
 *   - a locale other than the two supported;
 *   - an audience naming a role that may edit but not view (contradictory).
 */
export function validateFormat(format: ReportFormat, scope: FormatModelScope): FormatIssue[] {
  const issues: FormatIssue[] = [];
  if (format.modelId !== scope.modelId) {
    issues.push({ code: 'model_mismatch', field: 'modelId', message: `the format targets ${format.modelId} but is validated against ${scope.modelId}` });
  }
  const known = new Set(scope.sectionIds);
  const seen = new Set<string>();
  format.blocks.forEach((b, i) => {
    if (!known.has(b.key)) {
      issues.push({ code: 'unknown_section', field: `blocks[${i}].key`, message: `the model does not define a section "${b.key}"` });
    }
    if (seen.has(b.key)) {
      issues.push({ code: 'duplicate_section', field: `blocks[${i}].key`, message: `section "${b.key}" appears twice` });
    }
    seen.add(b.key);
    if (b.register && !scope.allowedRegisters.some((r) => sameRegister(r, b.register!))) {
      issues.push({ code: 'register_not_allowed', field: `blocks[${i}].register`, message: `the model does not allow formality ${b.register.formality}/tone ${b.register.tone}/${b.register.voice} for "${b.key}"` });
    }
    if (b.visible && normaliseText(b.label).trim() === '') {
      issues.push({ code: 'empty_label', field: `blocks[${i}].label`, message: `a visible block needs a label` });
    }
    // WP-H: a client may set a block's heading. It must be plain, short, single-line text.
    if (b.visible && normaliseText(b.label).trim() !== '') {
      const label = validateHeadingLabel(b.label);
      if (!label.ok) {
        issues.push({ code: 'bad_heading_label', field: `blocks[${i}].label`, message: label.reason ?? 'the heading is not usable' });
      }
    }
  });
  if (format.defaultLocale !== 'en-GB' && format.defaultLocale !== 'en-US') {
    issues.push({ code: 'bad_locale', field: 'defaultLocale', message: `locale must be en-GB or en-US, not "${format.defaultLocale}"` });
  }
  const l = format.layout;
  if (l.marginLeftMm + l.marginRightMm >= 200) {
    issues.push({ code: 'margins_too_wide', field: 'layout', message: 'the left and right margins leave no room for content' });
  }
  if (l.marginTopMm + l.marginBottomMm >= 280) {
    issues.push({ code: 'margins_too_tall', field: 'layout', message: 'the top and bottom margins leave no room for content' });
  }
  for (const [k, v] of Object.entries(l)) {
    if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) {
      issues.push({ code: 'bad_measure', field: `layout.${k}`, message: `${k} must be zero or more` });
    }
  }
  // Typography bounds (WP-C1). The editor and the validator share TYPOGRAPHY_LIMITS.
  const typo = TYPOGRAPHY_LIMITS;
  if (typeof l.fontSizePt === 'number' && (l.fontSizePt < typo.fontSizePt.min || l.fontSizePt > typo.fontSizePt.max)) {
    issues.push({ code: 'font_size_out_of_range', field: 'layout.fontSizePt', message: `the body size must be between ${typo.fontSizePt.min} and ${typo.fontSizePt.max} pt` });
  }
  if (typeof l.lineHeightPct === 'number' && (l.lineHeightPct < typo.lineHeightPct.min || l.lineHeightPct > typo.lineHeightPct.max)) {
    issues.push({ code: 'line_height_out_of_range', field: 'layout.lineHeightPct', message: `the line height must be between ${typo.lineHeightPct.min}% and ${typo.lineHeightPct.max}%` });
  }
  if (typeof l.headingScalePct === 'number' && (l.headingScalePct < typo.headingScalePct.min || l.headingScalePct > typo.headingScalePct.max)) {
    issues.push({ code: 'heading_scale_out_of_range', field: 'layout.headingScalePct', message: `the heading scale must be between ${typo.headingScalePct.min}% and ${typo.headingScalePct.max}%` });
  }
  for (const key of ['fontSizePt', 'lineHeightPct', 'headingScalePct'] as const) {
    if (typeof l[key] === 'number' && !Number.isInteger(l[key])) {
      issues.push({ code: 'non_integer_measure', field: `layout.${key}`, message: `${key} must be a whole number` });
    }
  }
  for (const key of ['fontWeightHeading', 'fontWeightBody'] as const) {
    if (typeof l[key] === 'number' && !typo.fontWeight.includes(l[key])) {
      issues.push({ code: 'font_weight_not_available', field: `layout.${key}`, message: `${l[key]} is not one of the available weights` });
    }
  }
  // A colour must be a token name or a hex value, never arbitrary text.
  for (const key of ['colourPrimary', 'colourAccent', 'colourText', 'colourBackground'] as const) {
    if (typeof l[key] === 'string' && !isValidColour(l[key])) {
      issues.push({ code: 'bad_colour', field: `layout.${key}`, message: `"${l[key]}" is not a colour token or hex value` });
    }
  }
  // A font must be one of the self-hosted families, so the canvas and the PDF agree and nothing is
  // fetched from an external host (WP-F, WP-C1).
  for (const key of ['fontHeading', 'fontBody'] as const) {
    if (typeof l[key] === 'string' && l[key] !== '' && !isAllowedFontFamily(l[key])) {
      issues.push({ code: 'font_not_available', field: `layout.${key}`, message: `"${l[key]}" is not one of the self-hosted fonts` });
    }
  }
  // WP-T: the contents design. Its numbers are bounded, and its title obeys the same plain-text rule
  // as a heading label, so a contents page can never carry markup or an unreadable size.
  const c = l.contents;
  if (c) {
    const t = validateHeadingLabel(c.title);
    if (!t.ok) {
      issues.push({ code: 'bad_contents_title', field: 'layout.contents.title', message: t.reason ?? 'the contents title is not usable' });
    }
    if (c.depth !== 1 && c.depth !== 2) {
      issues.push({ code: 'bad_contents_depth', field: 'layout.contents.depth', message: 'the contents depth must be 1 or 2' });
    }
    if (typeof c.titleScalePct === 'number'
      && (c.titleScalePct < CONTENTS_LIMITS.titleScalePct.min || c.titleScalePct > CONTENTS_LIMITS.titleScalePct.max)) {
      issues.push({ code: 'contents_title_out_of_range', field: 'layout.contents.titleScalePct', message: `the contents title size must be between ${CONTENTS_LIMITS.titleScalePct.min}% and ${CONTENTS_LIMITS.titleScalePct.max}%` });
    }
    if (typeof c.titleScalePct === 'number' && !Number.isInteger(c.titleScalePct)) {
      issues.push({ code: 'non_integer_measure', field: 'layout.contents.titleScalePct', message: 'titleScalePct must be a whole number' });
    }
  }
  format.audiences.forEach((a, i) => {
    if (a.canEdit && !a.canView) {
      issues.push({ code: 'audience_contradiction', field: `audiences[${i}]`, message: `role "${a.roleSlug}" may edit but not view` });
    }
  });
  // WP-D: the page design. Every check names the field so the designer's editor can show it precisely.
  if (l.orientation !== 'portrait' && l.orientation !== 'landscape') {
    issues.push({ code: 'bad_orientation', field: 'layout.orientation', message: 'the orientation must be portrait or landscape' });
  }
  if (typeof l.columns === 'number'
    && (l.columns < PAGE_SETUP_LIMITS.columns.min || l.columns > PAGE_SETUP_LIMITS.columns.max)) {
    issues.push({ code: 'columns_out_of_range', field: 'layout.columns', message: `the column count must be between ${PAGE_SETUP_LIMITS.columns.min} and ${PAGE_SETUP_LIMITS.columns.max}` });
  }
  if (typeof l.columns === 'number' && !Number.isInteger(l.columns)) {
    issues.push({ code: 'non_integer_measure', field: 'layout.columns', message: 'columns must be a whole number' });
  }
  if (l.columnGapMm > PAGE_SETUP_LIMITS.columnGapMm.max) {
    issues.push({ code: 'column_gap_out_of_range', field: 'layout.columnGapMm', message: `the column gap must be ${PAGE_SETUP_LIMITS.columnGapMm.max} mm or less` });
  }
  if (l.grid.sizeMm < GRID_LIMITS.sizeMm.min || l.grid.sizeMm > GRID_LIMITS.sizeMm.max) {
    issues.push({ code: 'grid_size_out_of_range', field: 'layout.grid.sizeMm', message: `the grid step must be between ${GRID_LIMITS.sizeMm.min} and ${GRID_LIMITS.sizeMm.max} mm` });
  }
  for (const key of ['tableBorder', 'tableRowAlternate'] as const) {
    if (typeof l[key] === 'string' && l[key] !== '' && !isValidColour(l[key])) {
      issues.push({ code: 'bad_colour', field: `layout.${key}`, message: `"${l[key]}" is not a colour token or hex value` });
    }
  }
  if (!(TABLE_STYLE_NAMES as readonly string[]).includes(l.defaultTableStyle)) {
    issues.push({ code: 'bad_table_style', field: 'layout.defaultTableStyle', message: `"${l.defaultTableStyle}" is not a table style` });
  }
  const sectionIds = new Set(format.blocks.map((b) => b.key));
  l.tableStyles.forEach((t, i) => {
    if (!(TABLE_STYLE_NAMES as readonly string[]).includes(t.style)) {
      issues.push({ code: 'bad_table_style', field: `layout.tableStyles[${i}].style`, message: `"${t.style}" is not a table style` });
    }
    if (!sectionIds.has(t.key)) {
      issues.push({ code: 'unknown_section', field: `layout.tableStyles[${i}].key`, message: `the format has no block "${t.key}" to style` });
    }
  });
  l.links.forEach((link, i) => {
    const err = hyperlinkError(link);
    if (err) issues.push({ code: 'bad_link', field: `layout.links[${i}]`, message: err });
  });
  l.crossReferences.forEach((ref, i) => {
    if (ref.targetKey.trim() === '') {
      issues.push({ code: 'bad_reference', field: `layout.crossReferences[${i}].targetKey`, message: 'a cross-reference needs a target' });
    } else if (!sectionIds.has(ref.targetKey) && !l.shapes.some((s) => s.id === ref.targetKey)) {
      issues.push({ code: 'unknown_reference', field: `layout.crossReferences[${i}].targetKey`, message: `nothing in this format is called "${ref.targetKey}"` });
    }
  });
  l.shapes.forEach((s, i) => {
    if (s.id.trim() === '') {
      issues.push({ code: 'bad_shape', field: `layout.shapes[${i}].id`, message: 'a shape needs an id' });
    }
    if (s.wMm < SHAPE_LIMITS.sizeMm.min || s.hMm < SHAPE_LIMITS.sizeMm.min) {
      issues.push({ code: 'bad_shape', field: `layout.shapes[${i}]`, message: 'a shape must be at least 1 mm across' });
    }
    if (s.fill !== 'none' && !isValidColour(s.fill) && !/^(brand|accent|surface|callout)$/.test(s.fill)) {
      issues.push({ code: 'bad_colour', field: `layout.shapes[${i}].fill`, message: `"${s.fill}" is not a colour` });
    }
    if (s.stroke !== 'none' && !isValidColour(s.stroke)) {
      issues.push({ code: 'bad_colour', field: `layout.shapes[${i}].stroke`, message: `"${s.stroke}" is not a colour` });
    }
    if (s.kind === 'callout' && s.text.length > SHAPE_LIMITS.textMaxLength) {
      issues.push({ code: 'callout_text_too_long', field: `layout.shapes[${i}].text`, message: `a callout holds at most ${SHAPE_LIMITS.textMaxLength} characters` });
    }
  });
  const placedKeys = new Set<string>();
  l.placed.forEach((p, i) => {
    if (!sectionIds.has(p.key)) {
      issues.push({ code: 'unknown_section', field: `layout.placed[${i}].key`, message: `the format has no block "${p.key}" to place` });
    }
    if (placedKeys.has(p.key)) {
      issues.push({ code: 'duplicate_placement', field: `layout.placed[${i}].key`, message: `block "${p.key}" is placed twice` });
    }
    placedKeys.add(p.key);
    if ((p.xMm === null) !== (p.yMm === null)) {
      issues.push({ code: 'half_placement', field: `layout.placed[${i}]`, message: `block "${p.key}" has only one of x and y; a free block needs both` });
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Application: a format turns a model plan into the ordered block list a render uses, and reports
// the registers it applies. It changes no claim.
// ---------------------------------------------------------------------------

export interface AppliedFormat {
  /** The visible blocks, in format order, with the register each renders at resolved. */
  blocks: { key: string; label: string; role: BlockRole; register: RegisterChoice }[];
  /** The blocks the format hides, so the screen can list them and the record is explicit. */
  hidden: string[];
  /** The blocks the format never mentioned, kept in plan order at the model default. */
  untouched: string[];
}

/** Resolve a format against a model's plan and default register. Pure and total: a section the
 *  format omits is simply untouched, not dropped, so a format never silently loses content. */
export function applyFormat(
  format: ReportFormat,
  plan: { key: string; role: BlockRole; label: string }[],
  modelDefault: RegisterChoice,
): AppliedFormat {
  const byKey = new Map(format.blocks.map((b) => [b.key, b]));
  const ordered: AppliedFormat['blocks'] = [];
  const hidden: string[] = [];
  const mentioned = new Set<string>();

  // The format's own order first, for the blocks it names.
  for (const b of format.blocks) {
    mentioned.add(b.key);
    const inPlan = plan.find((p) => p.key === b.key);
    if (!inPlan) continue; // validateFormat already reports this; application skips it.
    if (!b.visible) {
      hidden.push(b.key);
      continue;
    }
    ordered.push({ key: b.key, label: b.label || inPlan.label, role: inPlan.role, register: b.register ?? modelDefault });
  }
  // Then the plan's own sections the format did not mention, in plan order.
  const untouched: string[] = [];
  for (const p of plan) {
    if (mentioned.has(p.key)) continue;
    untouched.push(p.key);
    ordered.push({ key: p.key, label: p.label, role: p.role, register: modelDefault });
  }
  return { blocks: ordered, hidden, untouched };
}

/** The register a format resolves to for a block, for the render-hash computation. */
export function resolvedRegisters(applied: AppliedFormat): Record<string, RegisterChoice> {
  const out: Record<string, RegisterChoice> = {};
  for (const b of applied.blocks) out[b.key] = b.register;
  return out;
}

// ---------------------------------------------------------------------------
// The default format for a model: every section visible, in plan order, at the model default.
// ---------------------------------------------------------------------------

export function defaultFormat(
  orgId: string, formatKey: string, modelId: string, plan: { key: string; role: BlockRole; label: string }[],
  defaultLocale: Locale, layout: FormatLayout,
): Omit<ReportFormat, 'bodyHash' | 'id' | 'createdAt' | 'createdBy'> {
  return {
    orgId, formatKey, version: 1, label: formatKey, status: 'draft', modelId,
    blocks: plan.map((p) => ({ key: p.key, label: p.label, role: p.role, visible: true, register: null })),
    layout: cloneLayout(layout), defaultLocale, audiences: [],
  };
}

/** A deep copy of a layout, so a draft edit can never mutate the format it was copied from. */
export function cloneLayout(layout: FormatLayout): FormatLayout {
  return {
    ...layout,
    contents: { ...layout.contents },
    grid: { ...layout.grid },
    chrome: { ...layout.chrome },
    placed: layout.placed.map((p) => ({ ...p })),
    shapes: layout.shapes.map((s) => ({ ...s })),
    links: layout.links.map((l) => ({ ...l })),
    crossReferences: layout.crossReferences.map((r) => ({ ...r })),
    tableStyles: layout.tableStyles.map((t) => ({ ...t })),
  };
}

/** The default layout, expressed in design tokens (no hex literal anywhere in the product code). */
export const DEFAULT_FORMAT_LAYOUT: FormatLayout = {
  pageSize: 'A4',
  orientation: 'portrait',
  marginTopMm: 20,
  marginRightMm: 20,
  marginBottomMm: 20,
  marginLeftMm: 20,
  colourPrimary: 'brand-primary',
  colourAccent: 'brand-accent',
  colourText: 'brand-text',
  colourBackground: 'brand-background',
  fontHeading: DEFAULT_FONT_HEADING,
  fontBody: DEFAULT_FONT_BODY,
  fontSizePt: 11,
  lineHeightPct: 140,
  headingScalePct: 160,
  fontWeightHeading: 600,
  fontWeightBody: 400,
  showFooter: true,
  contents: { ...DEFAULT_CONTENTS_STYLE },
  columns: 1,
  columnGapMm: 6,
  grid: { ...DEFAULT_GRID },
  chrome: { ...DEFAULT_CHROME },
  numberedHeadings: false,
  placed: [],
  shapes: [],
  links: [],
  crossReferences: [],
  defaultTableStyle: DEFAULT_TABLE_STYLE,
  tableStyles: [],
  tableBorder: 'brand-rule',
  tableRowAlternate: 'brand-surface',
};

/** A stable, canonical key for the report-format review/compare surfaces. */
export function formatCanonicalKey(format: ReportFormat): string {
  return canonicalise(formatBody(format) as never);
}

/**
 * The resolved typography for a layout (WP-C1): the heading and body sizes, weights and line height,
 * with the weight snapped to what the chosen family actually ships. The canvas and the PDF renderer
 * both read this, so what the editor shows is what the document prints. Pure; no clock, no IO.
 */
export interface ResolvedTypography {
  bodyPt: number;
  headingPt: number;
  bodyWeight: number;
  headingWeight: number;
  lineHeight: number;
}

export function resolveTypography(layout: FormatLayout): ResolvedTypography {
  const bodyPt = clamp(layout.fontSizePt, TYPOGRAPHY_LIMITS.fontSizePt.min, TYPOGRAPHY_LIMITS.fontSizePt.max);
  const scalePct = clamp(layout.headingScalePct, TYPOGRAPHY_LIMITS.headingScalePct.min, TYPOGRAPHY_LIMITS.headingScalePct.max);
  const linePct = clamp(layout.lineHeightPct, TYPOGRAPHY_LIMITS.lineHeightPct.min, TYPOGRAPHY_LIMITS.lineHeightPct.max);
  return {
    bodyPt,
    headingPt: round1(bodyPt * (scalePct / 100)),
    bodyWeight: resolveWeight(layout.fontBody, layout.fontWeightBody),
    headingWeight: resolveWeight(layout.fontHeading, layout.fontWeightHeading),
    lineHeight: linePct / 100,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The report-format typography in the shape the PDF renderer consumes (WP-C3). The renderer already
 * resolves the same numbers through `resolveTypography` for the canvas; this adapts them to the
 * printer's model so the frozen PDF matches the page the editor shows. Pure.
 */
export function toPdfTypography(layout: FormatLayout): {
  headingPt: number; bodyPt: number; headingWeight: number; bodyWeight: number; lineHeight: number;
  headingFamily: string; bodyFamily: string;
} {
  const t = resolveTypography(layout);
  return {
    headingPt: t.headingPt,
    bodyPt: t.bodyPt,
    headingWeight: t.headingWeight,
    bodyWeight: t.bodyWeight,
    lineHeight: t.lineHeight,
    headingFamily: layout.fontHeading,
    bodyFamily: layout.fontBody,
  };
}

/** The format's contents design in the shape the renderers consume (WP-T). Pure. */
export function toContentsSpec(layout: FormatLayout): ContentsSpec | undefined {
  const c = layout.contents;
  if (!c || !c.enabled) return undefined;
  return {
    title: c.title,
    depth: c.depth,
    numbered: c.numbered,
    includeSections: true,
    includeSubheadings: c.depth >= 2,
  };
}

/**
 * Merge a stored layout row (a plain object from `report_formats.layout`) onto the defaults, so a
 * format saved before a field existed still yields a complete, valid layout. Pure; unknown keys are
 * ignored. Used by the report editor to hand the printed typography to the renderer (WP-C3).
 */
export function layoutFromRow(row: Record<string, unknown> | null | undefined): FormatLayout {
  const out: FormatLayout = {
    ...DEFAULT_FORMAT_LAYOUT,
    contents: { ...DEFAULT_CONTENTS_STYLE },
    grid: { ...DEFAULT_GRID },
    chrome: { ...DEFAULT_CHROME },
  };
  if (!row) return out;
  const str = (k: keyof FormatLayout, allowed?: readonly string[]) => {
    const v = row[k as string];
    if (typeof v === 'string' && v.trim() !== '' && (!allowed || allowed.includes(v))) {
      (out[k] as unknown as string) = v;
    }
  };
  const num = (k: keyof FormatLayout, min: number, max: number) => {
    const v = row[k as string];
    if (typeof v === 'number' && Number.isFinite(v)) (out[k] as unknown as number) = clamp(v, min, max);
  };
  str('pageSize', ['A4', 'Letter']);
  str('orientation', ['portrait', 'landscape']);
  str('colourPrimary'); str('colourAccent'); str('colourText'); str('colourBackground');
  str('fontHeading'); str('fontBody');
  str('tableBorder'); str('tableRowAlternate');
  num('marginTopMm', 0, 60); num('marginRightMm', 0, 60); num('marginBottomMm', 0, 60); num('marginLeftMm', 0, 60);
  num('fontSizePt', TYPOGRAPHY_LIMITS.fontSizePt.min, TYPOGRAPHY_LIMITS.fontSizePt.max);
  num('lineHeightPct', TYPOGRAPHY_LIMITS.lineHeightPct.min, TYPOGRAPHY_LIMITS.lineHeightPct.max);
  num('headingScalePct', TYPOGRAPHY_LIMITS.headingScalePct.min, TYPOGRAPHY_LIMITS.headingScalePct.max);
  num('columns', PAGE_SETUP_LIMITS.columns.min, PAGE_SETUP_LIMITS.columns.max);
  num('columnGapMm', PAGE_SETUP_LIMITS.columnGapMm.min, PAGE_SETUP_LIMITS.columnGapMm.max);
  if (typeof row.numberedHeadings === 'boolean') out.numberedHeadings = row.numberedHeadings;
  if (typeof row.defaultTableStyle === 'string' && (TABLE_STYLE_NAMES as readonly string[]).includes(row.defaultTableStyle)) {
    out.defaultTableStyle = row.defaultTableStyle as TableStyleName;
  }
  if (typeof row.fontWeightHeading === 'number') out.fontWeightHeading = resolveWeight(out.fontHeading, row.fontWeightHeading);
  if (typeof row.fontWeightBody === 'number') out.fontWeightBody = resolveWeight(out.fontBody, row.fontWeightBody);
  if (typeof row.showFooter === 'boolean') out.showFooter = row.showFooter;
  // WP-D: the grid, chrome, shapes, placement, links, references and table styles are merged field by
  // field, so a format saved before a field existed still yields a complete, valid design.
  out.grid = mergeGrid(row.grid);
  out.chrome = mergeChrome(row.chrome);
  out.placed = mergePlaced(row.placed);
  out.shapes = mergeShapes(row.shapes);
  out.links = mergeLinks(row.links);
  out.crossReferences = mergeReferences(row.crossReferences);
  out.tableStyles = mergeTableStyles(row.tableStyles);
  // WP-T: merge a stored contents design onto the defaults, field by field, so a format saved before
  // a field existed still yields a complete, valid contents style.
  const rawContents = row.contents;
  if (rawContents && typeof rawContents === 'object') {
    const c = rawContents as Record<string, unknown>;
    const out2 = out.contents;
    if (typeof c.enabled === 'boolean') out2.enabled = c.enabled;
    if (typeof c.title === 'string' && c.title.trim() !== '') out2.title = c.title.slice(0, HEADING_LABEL_LIMITS.maxLength);
    if (c.depth === 1 || c.depth === 2) out2.depth = c.depth;
    if (typeof c.numbered === 'boolean') out2.numbered = c.numbered;
    if (typeof c.dotLeaders === 'boolean') out2.dotLeaders = c.dotLeaders;
    if (typeof c.indentSubheadings === 'boolean') out2.indentSubheadings = c.indentSubheadings;
    if (typeof c.titleScalePct === 'number' && Number.isFinite(c.titleScalePct)) {
      out2.titleScalePct = clamp(c.titleScalePct, CONTENTS_LIMITS.titleScalePct.min, CONTENTS_LIMITS.titleScalePct.max);
    }
  }
  return out;
}

function mergeGrid(raw: unknown): GridSpec {
  const g: GridSpec = { ...DEFAULT_GRID };
  if (!raw || typeof raw !== 'object') return g;
  const r = raw as Record<string, unknown>;
  if (typeof r.visible === 'boolean') g.visible = r.visible;
  if (typeof r.snap === 'boolean') g.snap = r.snap;
  if (typeof r.rulers === 'boolean') g.rulers = r.rulers;
  if (typeof r.sizeMm === 'number' && Number.isFinite(r.sizeMm)) g.sizeMm = clamp(r.sizeMm, GRID_LIMITS.sizeMm.min, GRID_LIMITS.sizeMm.max);
  if (r.subdivisions === 1 || r.subdivisions === 2 || r.subdivisions === 4) g.subdivisions = r.subdivisions;
  return g;
}

function mergeChrome(raw: unknown): ChromeSpec {
  const c: ChromeSpec = { ...DEFAULT_CHROME };
  if (!raw || typeof raw !== 'object') return c;
  const r = raw as Record<string, unknown>;
  for (const k of ['headerLeft', 'headerCentre', 'headerRight', 'footerLeft', 'footerCentre', 'footerRight'] as const) {
    if (typeof r[k] === 'string') c[k] = (r[k] as string).slice(0, 200);
  }
  for (const k of ['headerEnabled', 'footerEnabled', 'rule', 'onFirstPage'] as const) {
    if (typeof r[k] === 'boolean') c[k] = r[k] as boolean;
  }
  if (typeof r.pageNumber === 'string' && (PAGE_NUMBER_STYLES as readonly string[]).includes(r.pageNumber)) {
    c.pageNumber = r.pageNumber as ChromeSpec['pageNumber'];
  }
  return c;
}

function mergePlaced(raw: unknown): PlacedBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
    .map((p) => {
      const key = typeof p.key === 'string' ? p.key : '';
      const base = defaultPlacedBlock(key);
      const n = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
      return {
        key,
        page: Math.max(1, Math.round(n(p.page, base.page))),
        column: Math.max(1, Math.round(n(p.column, base.column))),
        xMm: typeof p.xMm === 'number' && Number.isFinite(p.xMm) ? Math.max(0, p.xMm) : null,
        yMm: typeof p.yMm === 'number' && Number.isFinite(p.yMm) ? Math.max(0, p.yMm) : null,
        wMm: Math.max(0, n(p.wMm, base.wMm)),
      };
    })
    .filter((p) => p.key !== '');
}

function mergeShapes(raw: unknown): ShapeSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s, i) => shapeFromRow(s, i))
    .filter((s) => s.id !== '');
}

function mergeLinks(raw: unknown): HyperlinkSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === 'object')
    .map((l, i) => ({
      id: typeof l.id === 'string' && l.id ? l.id : `link-${i + 1}`,
      label: typeof l.label === 'string' ? l.label.slice(0, LINK_LIMITS.labelMaxLength) : '',
      url: typeof l.url === 'string' ? l.url.slice(0, LINK_LIMITS.urlMaxLength) : '',
      underline: typeof l.underline === 'boolean' ? l.underline : true,
    }))
    .filter((l) => l.label !== '' || l.url !== '');
}

function mergeReferences(raw: unknown): CrossReferenceSpec[] {
  if (!Array.isArray(raw)) return [];
  const kinds: CrossReferenceSpec['kind'][] = ['heading', 'figure', 'table'];
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
    .map((r, i) => ({
      id: typeof r.id === 'string' && r.id ? r.id : `ref-${i + 1}`,
      kind: kinds.includes(r.kind as CrossReferenceSpec['kind']) ? (r.kind as CrossReferenceSpec['kind']) : 'heading',
      targetKey: typeof r.targetKey === 'string' ? r.targetKey.slice(0, LINK_LIMITS.targetMaxLength) : '',
      label: typeof r.label === 'string' ? r.label.slice(0, LINK_LIMITS.labelMaxLength) : 'see',
    }))
    .filter((r) => r.targetKey !== '');
}

function mergeTableStyles(raw: unknown): { key: string; style: TableStyleName }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map((t) => ({
      key: typeof t.key === 'string' ? t.key : '',
      style: (typeof t.style === 'string' && (TABLE_STYLE_NAMES as readonly string[]).includes(t.style))
        ? (t.style as TableStyleName) : DEFAULT_TABLE_STYLE,
    }))
    .filter((t) => t.key !== '');
}

/** The format hash used in a report's metadata: the published version's body hash. A report records
 *  which format produced it, so an old report can be re-rendered from the format it was built with
 * (W8.2), exactly as it records its phrase and engine versions.
 */
export async function formatHashForReport(format: ReportFormat): Promise<string> {
  return formatBodyHash(format);
}
