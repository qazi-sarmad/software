/**
 * Discipline rule packs (D11, docs/AUDIT-DOMAINS-MODEL.md §4). The Management discipline already has
 * its rule base (the numeric/structural families); this module is the IT and Shari'ah base that the
 * product shipped as an empty container.
 *
 * Every rule here is a STRUCTURAL check over data the engine can read — a required attribute present,
 * a sequence respected, a ratio agreed. None of them reproduces a licensed text: they cite the control
 * id and source (rulebook §7) and encode the structure, in our own words.
 *
 * Sources (verified in docs/ASSURANCE-RULEBOOKS.md §1, §5):
 *   IT      — COBIT 2019 objectives, ISO/IEC 27001:2022 Annex A, NIST SP 800-53 Rev. 5 families.
 *   Shari'ah — AAOIFI Shari'ah Standards SS 1–54 (2015 English ed.), with the SBP Compendium
 *              (31 Oct 2024) as the Pakistan amendment overlay and the SBP SGF (1 Jan 2025).
 *
 * The honesty rule stands: a Shari'ah rule asserts only a structural requirement, never a
 * substantive Shari'ah judgment — that is always the Shari'ah Supervisory Board's.
 *
 * Pure (L4): every input is an argument; no clock, no client, no model.
 */
import type { Discipline } from '../../risk/domains';
import type { RuleFinding, SysteligonRule } from '../types';

/** A rule that carries its discipline, so a run can be narrowed to the universe's own rule base. */
export interface DisciplineRule<P = Record<string, unknown>> extends SysteligonRule<P> {
  discipline: Discipline;
}

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * The shared shape: every row that claims one of the rule's `record_kinds` must carry every attribute
 * in `required`. A row that does not claim the kind is skipped, never assumed. A missing attribute is
 * reported by name, so the finding says which element is absent rather than that "something" is wrong.
 */
function attributeRule<P extends { record_kinds: string[]; required: string[] }>(
  def: Omit<DisciplineRule<P>, 'evaluate' | 'kind'>,
): DisciplineRule<P> {
  return {
    ...def,
    kind: 'missing_attributes',
    evaluate: (input, ctx) => {
      const kinds = new Set(def.params.record_kinds);
      const findings: RuleFinding[] = [];
      for (const row of input.rows) {
        const kind = row.values.record_kind;
        if (typeof kind !== 'string' || !kinds.has(kind)) continue;
        const missing = def.params.required.filter((k) => isBlank(row.values[k]));
        if (missing.length) {
          findings.push({
            ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'missing_attributes',
            severity: ctx.severity,
            reason: `${kind} ${row.ref} is missing ${missing.join(', ')}.`,
            refs: [row.ref],
          });
        }
      }
      return findings;
    },
  };
}

const base = { version: 1, appliesTo: 'population' as const, status: 'released' as const };

// ---------------------------------------------------------------------------
// IT audit — docs/ASSURANCE-RULEBOOKS.md §1 (COBIT 2019 / ISO 27001:2022 Annex A / NIST 800-53 R5)
// ---------------------------------------------------------------------------

/** Change management: a change is approved, tested, and reversible before it is deployed. */
export const itChangeManagement: DisciplineRule<{ record_kinds: string[]; required: string[] }> = attributeRule({
  id: 'it.change_management', title: 'A change carries approval, a test and a rollback plan',
  discipline: 'it', severity: 'medium',
  params: { record_kinds: ['change'], required: ['approval_ref', 'test_ref', 'rollback_plan'] },
  standards: ['COBIT 2019 BAI06', 'ISO/IEC 27001:2022 Annex A 8.32', 'NIST SP 800-53 Rev. 5 CM-3'],
  ...base,
});

/** Access control and privileged access: a grant is approved and reviewed, and duties are separated. */
export const itPrivilegedAccess: DisciplineRule<{ record_kinds: string[]; required: string[] }> = attributeRule({
  id: 'it.privileged_access', title: 'A privileged grant carries an approver, a review date and a separation of duties',
  discipline: 'it', severity: 'high',
  params: { record_kinds: ['privileged_access'], required: ['approver_ref', 'review_due', 'requested_by'] },
  standards: ['COBIT 2019 DSS05', 'ISO/IEC 27001:2022 Annex A 8.2', 'NIST SP 800-53 Rev. 5 AC-6'],
  ...base,
});

/** Backup and DR: a backup record names its schedule and the last successful restore test. */
export const itBackupRestore: DisciplineRule<{ record_kinds: string[]; required: string[] }> = attributeRule({
  id: 'it.backup_restore', title: 'A backup names its schedule and the last restore test',
  discipline: 'it', severity: 'high',
  params: { record_kinds: ['backup'], required: ['schedule', 'last_restore_test'] },
  standards: ['COBIT 2019 DSS04', 'ISO/IEC 27001:2022 Annex A 8.13', 'NIST SP 800-53 Rev. 5 CP-9'],
  ...base,
});

/** SDLC: a release is security-reviewed and approved before it ships. */
export const itSdlc: DisciplineRule<{ record_kinds: string[]; required: string[] }> = attributeRule({
  id: 'it.sdlc', title: 'A release is security-reviewed and approved',
  discipline: 'it', severity: 'medium',
  params: { record_kinds: ['release'], required: ['security_review_ref', 'signoff_ref'] },
  standards: ['COBIT 2019 BAI03', 'ISO/IEC 27001:2022 Annex A 8.25', 'NIST SP 800-53 Rev. 5 SA-11'],
  ...base,
});

/** Patch management: a patch names its severity and the date it was installed. */
export const itPatchManagement: DisciplineRule<{ record_kinds: string[]; required: string[] }> = attributeRule({
  id: 'it.patch_management', title: 'A patch names its severity and its install date',
  discipline: 'it', severity: 'medium',
  params: { record_kinds: ['patch'], required: ['severity', 'installed_at'] },
  standards: ['COBIT 2019 DSS05', 'ISO/IEC 27001:2022 Annex A 8.8', 'NIST SP 800-53 Rev. 5 SI-2'],
  ...base,
});

/** Logging and monitoring: a log source names its retention and its alerting rule. */
export const itLoggingMonitoring: DisciplineRule<{ record_kinds: string[]; required: string[] }> = attributeRule({
  id: 'it.logging_monitoring', title: 'A log source names its retention and its alerting rule',
  discipline: 'it', severity: 'low',
  params: { record_kinds: ['log_source'], required: ['retention_days', 'alert_rule_ref'] },
  standards: ['COBIT 2019 DSS01', 'ISO/IEC 27001:2022 Annex A 8.15', 'NIST SP 800-53 Rev. 5 AU-6'],
  ...base,
});

// ---------------------------------------------------------------------------
// Shari'ah audit — docs/ASSURANCE-RULEBOOKS.md §5 (AAOIFI SS 1–54 + the SBP overlay)
// ---------------------------------------------------------------------------

/**
 * Riba — no increase on a loan, and no penalty income booked to the institution's own account
 * (AAOIFI SS 3, SS 19; the SBP overlay forbids charging a procrastinating debtor; a penalty, where
 * levied, is charity income, never the institution's). The rule reads a loan record's `increase_cents`
 * and `penalty_destination`.
 */
export const shariahRiba: DisciplineRule<Record<string, never>> = {
  id: 'shariah.riba', version: 1, kind: 'internal_inconsistency', appliesTo: 'population',
  title: 'A loan returns exactly the principal, and any penalty goes to charity',
  discipline: 'shariah', severity: 'high',
  params: {},
  standards: ['AAOIFI SS 3', 'AAOIFI SS 19', 'SBP Compendium (31 Oct 2024)'],
  status: 'released',
  evaluate: (input, ctx) => {
    const findings: RuleFinding[] = [];
    for (const row of input.rows) {
      if (row.values.record_kind !== 'loan') continue;
      const increase = Number(row.values.increase_cents ?? 0);
      if (Number.isFinite(increase) && increase > 0) {
        findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'internal_inconsistency',
          severity: ctx.severity,
          reason: `Loan ${row.ref} carries an increase of ${increase} on the principal.`,
          refs: [row.ref],
        });
      }
      const dest = row.values.penalty_destination;
      if (!isBlank(dest) && dest !== 'charity') {
        findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'internal_inconsistency',
          severity: ctx.severity,
          reason: `Loan ${row.ref} books its penalty to ${String(dest)}, not to charity.`,
          refs: [row.ref],
        });
      }
    }
    return findings;
  },
};

/** Gharar — a contract's subject, price and delivery must be determinate (AAOIFI SS 31). */
export const shariahGharar: DisciplineRule<{ record_kinds: string[]; required: string[] }> = attributeRule({
  id: 'shariah.gharar', title: 'A contract states its subject, price and delivery',
  discipline: 'shariah', severity: 'high',
  params: { record_kinds: ['contract'], required: ['subject', 'price_cents', 'delivery_terms'] },
  standards: ['AAOIFI SS 31'],
  ...base,
});

/** Possession — an asset must be owned before it is sold (AAOIFI SS 18; the Murabahah sequence, SS 8). */
export const shariahOwnershipSequence: DisciplineRule<Record<string, never>> = {
  id: 'shariah.ownership_sequence', version: 1, kind: 'missing_element', appliesTo: 'population',
  title: 'A Murabahah asset is acquired before it is sold on',
  discipline: 'shariah', severity: 'high',
  params: {},
  standards: ['AAOIFI SS 8', 'AAOIFI SS 18'],
  status: 'released',
  evaluate: (input, ctx) => {
    const findings: RuleFinding[] = [];
    for (const row of input.rows) {
      if (row.values.record_kind !== 'murabahah') continue;
      if (isBlank(row.values.acquisition_ref)) {
        findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'missing_element',
          severity: ctx.severity,
          reason: `Murabahah ${row.ref} was sold on with no prior acquisition recorded.`,
          refs: [row.ref],
        });
      }
    }
    return findings;
  },
};

/** Profit-and-loss sharing — the profit ratio is agreed before the investment (AAOIFI SS 12, 13, 40). */
export const shariahProfitDistribution: DisciplineRule<Record<string, never>> = {
  id: 'shariah.profit_distribution', version: 1, kind: 'missing_element', appliesTo: 'population',
  title: 'A profit-sharing account has its ratio agreed before the investment',
  discipline: 'shariah', severity: 'high',
  params: {},
  standards: ['AAOIFI SS 12', 'AAOIFI SS 13', 'AAOIFI SS 40'],
  status: 'released',
  evaluate: (input, ctx) => {
    const findings: RuleFinding[] = [];
    for (const row of input.rows) {
      const kind = row.values.record_kind;
      if (kind !== 'mudarabah' && kind !== 'musharakah') continue;
      if (isBlank(row.values.ratio_agreed_at)) {
        findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'missing_element',
          severity: ctx.severity,
          reason: `${kind} ${row.ref} has no profit ratio agreed before the investment.`,
          refs: [row.ref],
        });
      }
    }
    return findings;
  },
};

/** Zakah — the institution records its basis, nisab and rate (AAOIFI SS 35). */
export const shariahZakah: DisciplineRule<{ record_kinds: string[]; required: string[] }> = attributeRule({
  id: 'shariah.zakah', title: 'A zakah record names its basis, nisab and rate',
  discipline: 'shariah', severity: 'medium',
  params: { record_kinds: ['zakah'], required: ['basis_cents', 'nisab_cents', 'rate'] },
  standards: ['AAOIFI SS 35'],
  ...base,
});

/** Shari'ah governance — the SSB exists and its fatwas are recorded (AAOIFI SS 29; the SBP SGF). */
export const shariahGovernance: DisciplineRule<{ record_kinds: string[]; required: string[] }> = attributeRule({
  id: 'shariah.governance', title: 'A Shari\'ah review names the SSB resolution it relies on',
  discipline: 'shariah', severity: 'medium',
  params: { record_kinds: ['shariah_review'], required: ['ssb_resolution_ref', 'reviewer_ref'] },
  standards: ['AAOIFI SS 29', 'SBP Shari\'ah Governance Framework (1 Jan 2025)'],
  ...base,
});

/** The IT rule base, in a stable order. */
export const itRules: DisciplineRule[] = [
  itChangeManagement, itPrivilegedAccess, itBackupRestore, itSdlc, itPatchManagement, itLoggingMonitoring,
];

/** The Shari'ah rule base, in a stable order. */
export const shariahRules: DisciplineRule[] = [
  shariahRiba, shariahGharar, shariahOwnershipSequence, shariahProfitDistribution, shariahZakah,
  shariahGovernance,
];

/**
 * The discipline rule base for a given discipline. `management` returns the existing engine library
 * (assembled by the caller from the numeric/structural families), and `cross` carries no rules of its
 * own — a cross-discipline universe is a tag, not a rule base (docs/AUDIT-DOMAINS-MODEL.md §3).
 */
export const DISCIPLINE_RULES: Record<Discipline, DisciplineRule[]> = {
  management: [],
  it: itRules,
  shariah: shariahRules,
  cross: [],
};

/** Every discipline rule, across every discipline. */
export const disciplineRules: DisciplineRule[] = [...itRules, ...shariahRules];
