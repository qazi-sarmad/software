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
    layout: { ...layout, contents: { ...layout.contents } }, defaultLocale, audiences: [],
  };
}

/** The default layout, expressed in design tokens (no hex literal anywhere in the product code). */
export const DEFAULT_FORMAT_LAYOUT: FormatLayout = {
  pageSize: 'A4',
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
  const out: FormatLayout = { ...DEFAULT_FORMAT_LAYOUT, contents: { ...DEFAULT_CONTENTS_STYLE } };
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
  str('colourPrimary'); str('colourAccent'); str('colourText'); str('colourBackground');
  str('fontHeading'); str('fontBody');
  num('marginTopMm', 0, 60); num('marginRightMm', 0, 60); num('marginBottomMm', 0, 60); num('marginLeftMm', 0, 60);
  num('fontSizePt', TYPOGRAPHY_LIMITS.fontSizePt.min, TYPOGRAPHY_LIMITS.fontSizePt.max);
  num('lineHeightPct', TYPOGRAPHY_LIMITS.lineHeightPct.min, TYPOGRAPHY_LIMITS.lineHeightPct.max);
  num('headingScalePct', TYPOGRAPHY_LIMITS.headingScalePct.min, TYPOGRAPHY_LIMITS.headingScalePct.max);
  if (typeof row.fontWeightHeading === 'number') out.fontWeightHeading = resolveWeight(out.fontHeading, row.fontWeightHeading);
  if (typeof row.fontWeightBody === 'number') out.fontWeightBody = resolveWeight(out.fontBody, row.fontWeightBody);
  if (typeof row.showFooter === 'boolean') out.showFooter = row.showFooter;
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

/** The format hash used in a report's metadata: the published version's body hash. A report records
 *  which format produced it, so an old report can be re-rendered from the format it was built with
 * (W8.2), exactly as it records its phrase and engine versions.
 */
export async function formatHashForReport(format: ReportFormat): Promise<string> {
  return formatBodyHash(format);
}
