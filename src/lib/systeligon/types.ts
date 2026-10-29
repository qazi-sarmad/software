/**
 * Systeligon rule engine — the shared vocabulary (spec §4, S1).
 *
 * A rule engine, not a model. Every finding names the rule, its version, and the source rows that
 * triggered it, so any finding can be re-derived identically forever. This module defines the shape
 * the rest of the engine is built from: a rule, what it targets, the finding it produces, and the
 * result of running a set of rules over an input. Nothing here reads a clock or does I/O.
 */

/** The rule families (spec §3.1 numeric/structural, §3.2 document, §3.3 sequential). */
export type RuleKind =
  // §3.1 — numeric and structural forensics
  | 'benford'
  | 'duplicates'
  | 'near_duplicates'
  | 'sequence_gaps'
  | 'round_numbers'
  | 'outliers'
  | 'just_below_threshold'
  | 'out_of_hours'
  | 'segregation_of_duties'
  | 'reconciliation_break'
  | 'completeness'
  | 'missing_attributes'
  | 'rate_velocity'
  | 'cross_source'
  // §3.2 — structural document review
  | 'missing_element'
  | 'internal_inconsistency'
  | 'cross_document_inconsistency'
  | 'contradiction'
  | 'absent_follow_through'
  // §3.3 — sequential documents
  | 'action_item'
  | 'policy_procedure'
  // structural pattern rules
  | 'pattern';

/** What a rule is evaluated against. A rule declares one, so a pack can be filtered by audit type. */
export type RuleTarget = 'population' | 'journal' | 'document' | 'minutes' | 'policy' | 'config' | 'ledger';

/** Severity is a property of the rule, not a judgement the engine invents per finding. */
export type RuleSeverity = 'info' | 'low' | 'medium' | 'high';

/**
 * A rule's lifecycle. A pack ships rules as `draft`; releasing requires a qualified human (spec §11).
 * The engine will not run a `draft` rule unless the caller explicitly asks for drafts.
 */
export type RuleStatus = 'draft' | 'released';

/** The immutable identity of a rule version — what a sealed report records. */
export interface RuleRef {
  id: string;
  version: number;
}

/**
 * A rule. Pure: `evaluate` is a function of its arguments and returns findings; it never mutates the
 * input, never reads the clock (the evaluation time is in `ctx`), and never produces free text.
 */
export interface SysteligonRule<P = Record<string, unknown>> {
  /** Stable identifier, e.g. `numeric.benford_first_digit`. */
  id: string;
  /** Monotonic version, >= 1. Changing behaviour requires a new version, never an edit in place. */
  version: number;
  kind: RuleKind;
  /** What the rule is applied to. */
  appliesTo: RuleTarget;
  /** One-line description in plain words, shown beside a finding. */
  title: string;
  /** The parameters the rule was configured with. Part of the finding's provenance. */
  params: P;
  /** IIA standards this rule supports (see docs/iia-standards-reference.md). */
  standards: string[];
  status: RuleStatus;
  severity: RuleSeverity;
  /** Deterministic evaluation. Returns the matches; an empty array means "nothing matched". */
  evaluate: (input: RuleInput, ctx: RuleContext) => RuleFinding[];
}

/** The input a run is given. `rows` are opaque to the engine; each rule interprets what it needs. */
export interface RuleInput {
  /** The population/records under test. `ref` is the row identity a finding cites. */
  rows: ReadonlyArray<{ ref: string; values: Record<string, unknown> }>;
  /** Optional named sources for cross-source rules (e.g. gl vs tb). */
  sources?: Record<string, ReadonlyArray<{ ref: string; values: Record<string, unknown> }>>;
  /** Parsed document structure for §3.2/§3.3 rules. Absent for population-only runs. */
  documents?: ParsedDocument[];
  /** Free-form scope labels a rule may narrow on (period, entity). Never used to invent findings. */
  scope?: Record<string, string>;
}

/** A label/value pair parsed from a document (a heading, a field, a signature block). */
export interface DocumentElement {
  /** Stable id within the document, cited by a finding, e.g. `min:3.clause-2`. */
  ref: string;
  /** Structural role the parser assigned. A rule keys on this, never on free text. */
  role: 'heading' | 'clause' | 'field' | 'action_item' | 'signature' | 'reference' | 'table_row';
  /** 1-based line or clause number where it was found, for the side-by-side view. */
  line: number;
  label?: string;
  value?: string;
  /** Reference numbers / defined terms this element cites, for cross-document matching. */
  crossRefs?: string[];
}

/**
 * A document parsed into structure (spec §3.3). The engine matches on this structure; it never reads
 * the prose to "understand" it. `kind` is what the document claims to be.
 */
export interface ParsedDocument {
  /** Stable id for the document, e.g. a filename or an evidence id. */
  ref: string;
  kind: 'minutes' | 'policy' | 'procedure' | 'regulation' | 'contract' | 'invoice' | 'approval' | 'other';
  elements: DocumentElement[];
  /** ISO date the document is dated, if stated. */
  date?: string;
}

/** Passed to every `evaluate` call. The clock is here, never read inside a rule. */
export interface RuleContext {
  ruleId: string;
  ruleVersion: number;
  severity: RuleSeverity;
  /** ISO timestamp supplied by the caller. The engine never calls `Date.now()`. */
  evaluatedAt: string;
}

/** A single match. It carries the full provenance of the rule that produced it. */
export interface RuleFinding {
  ruleId: string;
  ruleVersion: number;
  kind: RuleKind;
  severity: RuleSeverity;
  /** Plain-words reason composed from the rule, never generated by a model. */
  reason: string;
  /** The rows that triggered it, by `ref`. The evidence. */
  refs: string[];
}

/** The result of running a set of rules. Records what ran, so a sealed report is reproducible. */
export interface RuleRunResult {
  findings: RuleFinding[];
  /** Every rule that ran, with its version — the provenance a sealed report stores. */
  ran: RuleRef[];
  /** Rules skipped because they were `draft` and drafts were not requested. */
  skipped: RuleRef[];
  evaluatedAt: string;
}

/** A named, versioned bundle of rules shipped per audit type (spec §4). */
export interface RulePack {
  name: string;
  version: number;
  target: RuleTarget;
  rules: SysteligonRule[];
}
