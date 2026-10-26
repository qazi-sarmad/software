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
import type { Formality, Locale, RhetoricalRole, Tone, Voice } from './types';

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
  /** A design-token name, never a hex literal (the token guard enforces this). */
  colourPrimary: string;
  colourAccent: string;
  colourText: string;
  colourBackground: string;
  fontHeading: string;
  fontBody: string;
  /** Whether the footer line carrying the hashes is printed. */
  showFooter: boolean;
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
    layout, defaultLocale, audiences: [],
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
  fontHeading: 'Helvetica',
  fontBody: 'Helvetica',
  showFooter: true,
};

/** A stable, canonical key for the report-format review/compare surfaces. */
export function formatCanonicalKey(format: ReportFormat): string {
  return canonicalise(formatBody(format) as never);
}

/**
 * The format hash used in a report's metadata: the published version's body hash. A report records
 * which format produced it, so an old report can be re-rendered from the format it was built with
 * (W8.2), exactly as it records its phrase and engine versions.
 */
export async function formatHashForReport(format: ReportFormat): Promise<string> {
  return formatBodyHash(format);
}
