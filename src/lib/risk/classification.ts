/**
 * D10 — client classification at onboarding, and the ICFR trigger (F139).
 *
 * Sources (docs/PAKISTAN-ASSURANCE-REGIMES.md §2, §3): the C1–C8 matrix, quoted exactly. The
 * classification is a switch, not a label: it decides whether internal audit is mandatory, whether
 * ICFR is mandatory and at what rigour, which frameworks are permitted, which artifacts are required,
 * whose numbering is cited, and whether a Shari'ah pack is offered.
 *
 * L1/L4: pure. Every input is an argument; the module reads no clock, no client, no model. A
 * classification the matrix does not name is REFUSED (throws) — never guessed. Every obligation
 * carries a citation; an obligation without one is refused.
 */
import type { Discipline } from './domains';

/** The ICFR rigour ladder the matrix names, weakest first. */
export type IcfrRigour = 'none' | 'basic' | 'statement' | 'full' | 'highest';

export interface ClassificationProfile {
  /** C1..C8, the matrix's own numbering. */
  code: string;
  name: string;
  regulator: string;
  governingLaw: string;
  /** true = mandatory, false = exempt, null = conditional (the matrix's "No, unless…" rows). */
  internalAuditMandatory: boolean | null;
  icfrRigour: IcfrRigour;
  /** The frameworks the regime permits or mandates, named exactly. */
  frameworks: string[];
  /** The reporting artifacts the regime requires, named exactly. */
  artifacts: string[];
  /** Whose numbering the product cites for this class. */
  regulatorNumbering: string;
  /** The matrix's own confidence: 'verified' against the primary instrument, or 'reported'. */
  verification: 'verified' | 'reported';
  /** The exact source, so nothing is asserted without one. */
  citation: string;
}

/**
 * The C1–C8 matrix (docs/PAKISTAN-ASSURANCE-REGIMES.md §2). Frameworks and artifacts are the exact
 * names the document gives; nothing is added.
 */
export const CLASSIFICATIONS: ClassificationProfile[] = [
  {
    code: 'C1', name: 'Listed public companies', regulator: 'SECP + PSX',
    governingLaw: 'Companies Act, 2017; Listed Companies (Code of Corporate Governance) Regulations, 2019',
    internalAuditMandatory: true, icfrRigour: 'statement',
    frameworks: ['COSO ICIF-2013'],
    artifacts: ["directors' statement on the adequacy of internal financial controls"],
    regulatorNumbering: 'SECP / Companies Act 2017 s.227 / COCG 2019',
    verification: 'verified',
    citation: 'Companies Act 2017 s.227; COCG 2019 (SECP)',
  },
  {
    code: 'C2', name: 'Public unlisted companies', regulator: 'SECP',
    governingLaw: 'Companies Act, 2017; Public Sector Companies (Corporate Governance) Rules, 2013 (if state-tied)',
    internalAuditMandatory: false, icfrRigour: 'statement',
    frameworks: ['COSO ICIF-2013'],
    artifacts: ['board comment on the adequacy of internal financial controls'],
    regulatorNumbering: 'SECP / Companies Act 2017',
    verification: 'reported',
    citation: 'Companies Act, 2017; Public Sector Companies (Corporate Governance) Rules, 2013 (SECP gated)',
  },
  {
    code: 'C3', name: 'Private limited (paid-up > PKR 1m)', regulator: 'SECP',
    governingLaw: 'Companies Act, 2017',
    internalAuditMandatory: false, icfrRigour: 'basic',
    frameworks: [],
    artifacts: ['statutory audit under ss.223/226'],
    regulatorNumbering: 'SECP / Companies Act 2017 ss.223/226',
    verification: 'reported',
    citation: 'Companies Act, 2017 ss.223/226',
  },
  {
    code: 'C4', name: 'Private limited (paid-up ≤ PKR 1m)', regulator: 'SECP',
    governingLaw: 'Companies Act, 2017',
    internalAuditMandatory: false, icfrRigour: 'none',
    frameworks: [], artifacts: [],
    regulatorNumbering: 'SECP / Companies Act 2017',
    verification: 'reported',
    citation: 'Companies Act, 2017',
  },
  {
    code: 'C5', name: 'Single member company (SMC)', regulator: 'SECP',
    governingLaw: 'Companies Act, 2017',
    internalAuditMandatory: false, icfrRigour: 'none',
    frameworks: [], artifacts: [],
    regulatorNumbering: 'SECP / Companies Act 2017',
    verification: 'reported',
    citation: 'Companies Act, 2017',
  },
  {
    code: 'C6', name: 'Banking companies & DFIs', regulator: 'State Bank of Pakistan (SBP)',
    governingLaw: 'Banking Companies Ordinance, 1962; SBP Guidelines on Internal Controls; SBP ICFR Roadmap',
    internalAuditMandatory: true, icfrRigour: 'highest',
    frameworks: ['COSO ICIF-2013', 'SBP ICFR Roadmap'],
    artifacts: ['annual management assessment', 'board endorsement', 'Long Form Report (LFR) by the external auditor'],
    regulatorNumbering: 'SBP BSD Circular No. 7 of 2004; BSD Circular No. 5 of 2009',
    verification: 'verified',
    citation: 'SBP BSD Circular No. 7 of 27 May 2004 (Guidelines on Internal Controls); BSD Circular No. 5 of 24 Feb 2009 (the ICFR roadmap, structured as eight stages)',
  },
  {
    code: 'C7', name: 'State-owned enterprises (SOEs)', regulator: 'Ministry of Finance / AGP',
    governingLaw: 'SOE (Governance and Operations) Act, 2023; SOE (Audit Committee, Internal Control and Risk Management) Regulations, 2024',
    internalAuditMandatory: true, icfrRigour: 'full',
    frameworks: ['COSO ERM', 'ISO 31000', 'COBIT'],
    artifacts: ["directors' statement", 'LFR', 'ICFR annual assessment', 'SoA', 'board report'],
    regulatorNumbering: 'SOE Regulations 2024 (Finance Division) / AGP',
    verification: 'verified',
    citation: 'SOE (Audit Committee, Internal Control and Risk Management) Regulations, 2024, issued under the SOE (Ownership and Management) Policy, 2023 (Finance Division)',
  },
  {
    code: 'C8', name: 'Non-profit organisations (s.42 / NPOs)', regulator: 'SECP',
    governingLaw: 'Companies Act, 2017 (s.42); Associations with Charitable and Not-for-Profit Objects Regulations, 2018',
    internalAuditMandatory: null, icfrRigour: 'statement',
    frameworks: ['COSO ICIF-2013'],
    artifacts: ['AML internal financial controls'],
    regulatorNumbering: 'SECP / Companies Act 2017 s.42',
    verification: 'verified',
    citation: 'Companies Act, 2017 (s.42); Associations with Charitable and Not-for-Profit Objects Regulations, 2018',
  },
];

export const CLASSIFICATION_CODES: string[] = CLASSIFICATIONS.map((c) => c.code);

/** The rigour at which ICFR is mandatory: a bare statutory audit ('basic') or 'none' is not ICFR. */
export function icfrMandatory(rigour: IcfrRigour): boolean {
  return rigour === 'statement' || rigour === 'full' || rigour === 'highest';
}

export interface Obligation {
  obligationId: string;
  /** The clause or instrument that creates the obligation. Never empty. */
  sourceClause: string;
  subject: string;
}

const OBLIGATIONS: Record<string, Obligation[]> = {
  C1: [
    { obligationId: 'IA-01', sourceClause: 'COCG 2019 — dedicated independent IA function reporting to the Audit Committee', subject: 'Maintain a dedicated independent internal-audit function' },
    { obligationId: 'IFCR-01', sourceClause: 'Companies Act 2017 s.227', subject: "State the adequacy of internal financial controls in the directors' report" },
  ],
  C2: [
    { obligationId: 'IFCR-01', sourceClause: "Companies Act 2017 — directors' report comment", subject: 'The board must comment on the adequacy of internal financial controls' },
  ],
  C3: [
    { obligationId: 'AUD-01', sourceClause: 'Companies Act 2017 ss.223/226', subject: 'Statutory audit (no formal ICFR declaration)' },
  ],
  C4: [],
  C5: [],
  C6: [
    { obligationId: 'IA-01', sourceClause: 'SBP BSD Circular No. 7 of 2004 — Guidelines on Internal Controls', subject: 'A specialised internal-audit function routing to the Board Audit Committee' },
    { obligationId: 'IFCR-02', sourceClause: 'SBP BSD Circular No. 5 of 24 Feb 2009 — the ICFR roadmap (eight stages)', subject: 'Annual management assessment, board endorsement and a Long Form Report (LFR) by the external auditor' },
  ],
  C7: [
    { obligationId: 'IA-01', sourceClause: 'SOE (Governance and Operations) Act, 2023', subject: 'An independent Chief Internal Auditor with reporting separation from executive management' },
    { obligationId: 'IFCR-02', sourceClause: 'SOE (Audit Committee, Internal Control and Risk Management) Regulations, 2024', subject: 'Implement COSO ERM, ISO 31000 and COBIT; be double-audited by external firms and the AGP' },
  ],
  C8: [
    { obligationId: 'IFCR-03', sourceClause: 'Companies Act, 2017 (s.42) — internal financial controls must address AML risk', subject: 'Internal financial controls that address AML risk' },
  ],
};

/** The obligations for a classification. Throws if any obligation lacks a citation. */
export function obligationsFor(code: string): Obligation[] {
  const profile = CLASSIFICATIONS.find((c) => c.code === code);
  if (!profile) {
    throw new Error(`classification: ${code} is not a classification the matrix names`);
  }
  const rows = OBLIGATIONS[code] ?? [];
  for (const o of rows) {
    if (!o.sourceClause || !o.sourceClause.trim()) {
      throw new Error(`classification: obligation ${o.obligationId} carries no citation and is refused`);
    }
  }
  return rows.map((o) => ({ ...o }));
}

export interface ClassificationInput {
  classification: string;
  isIslamic: boolean;
  hasItScope: boolean;
}

export interface ClassificationDecision {
  profile: ClassificationProfile;
  internalAuditMandatory: boolean;
  /** True when the matrix marks the class conditional (C8's "mandatory if foreign-funded…"). */
  internalAuditConditional: boolean;
  icfrMandatory: boolean;
  icfrRigour: IcfrRigour;
  frameworks: string[];
  artifacts: string[];
  regulatorNumbering: string;
  obligations: Obligation[];
  /** The audit disciplines offered (docs/AUDIT-DOMAINS-MODEL.md §4). Never exactly three by assumption. */
  offeredDisciplines: Discipline[];
}

/**
 * Classify a client. Refuses a class the matrix does not name — a classification is never guessed.
 *
 * Offered disciplines (docs/AUDIT-DOMAINS-MODEL.md §4): C1–C5 and C8 (non-Islamic) offer Management,
 * and IT when the tenant has technology scope; Shari'ah is not offered. C6–C7 offer all three. An
 * `isIslamic` tenant is offered Shari'ah regardless of class.
 */
export function classifyClient(input: ClassificationInput): ClassificationDecision {
  const profile = CLASSIFICATIONS.find((c) => c.code === input.classification);
  if (!profile) {
    throw new Error(`classification: ${input.classification} is not a classification the matrix names`);
  }

  const offered: Discipline[] = ['management'];
  const bankOrSoe = profile.code === 'C6' || profile.code === 'C7';
  if (input.hasItScope) offered.push('it');
  if (bankOrSoe || input.isIslamic) offered.push('shariah');

  return {
    profile,
    internalAuditMandatory: profile.internalAuditMandatory === true,
    internalAuditConditional: profile.internalAuditMandatory === null,
    icfrMandatory: icfrMandatory(profile.icfrRigour),
    icfrRigour: profile.icfrRigour,
    frameworks: [...profile.frameworks],
    artifacts: [...profile.artifacts],
    regulatorNumbering: profile.regulatorNumbering,
    obligations: obligationsFor(profile.code),
    offeredDisciplines: offered,
  };
}
