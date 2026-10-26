/**
 * W1.1: the domain model of the deterministic writing engine.
 *
 * A report is a directed graph, not text. The nodes are claims; the edges are evidence,
 * dependency and structure. Two hashes fall out of the graph: the graph root covers the facts
 * and is identical across every register and locale; the render hash covers the exact words.
 *
 * Nothing here reads a clock or a random source. Time enters as an argument (`fixedTimestamp`).
 */
import type { Decimal } from './canonical';

/** How a claim's figure was produced. */
export type ClaimKind = 'calculated' | 'derived' | 'auditor';

/**
 * The confidence vocabulary. The lead-in wording of every sentence is fixed per level and per
 * register, never invented (W2.6).
 */
export type ClaimLevel =
  | 'verified'
  | 'calculated'
  | 'management_asserted'
  | 'unresolved';

/** The typed slot kinds. A deterministic claim carries a number, date or amount only through one. */
export type SlotKind = 'text' | 'number' | 'money' | 'date' | 'percent' | 'count' | 'ref' | 'list';

/** A reference to a record the claim derives from, by type, id and content hash. */
export interface Reference {
  type: string;
  id: string;
  contentHash: string;
}

/** A typed slot value. `kind` selects the realisation rule applied when the phrase is rendered. */
export interface Slot {
  name: string;
  kind: SlotKind;
  /** A money or number slot carries a fixed-scale `Decimal`; the other kinds carry a primitive. */
  value: string | number | boolean | string[] | Decimal | null;
}

/** Formality 1 (plain and conversational) to 5 (board and regulatory formal). */
export type Formality = 1 | 2 | 3 | 4 | 5;

/** Tone 1 (constructive) to 5 (urgent). Tone changes emphasis only, never a fact. */
export type Tone = 1 | 2 | 3 | 4 | 5;

/**
 * Grammatical voice. The owner asked for this during the run (D-W-VOICE). Voice is orthogonal to
 * formality and tone: a passive F4 sentence is still F4, and a passive T3 sentence is still direct.
 */
export type Voice = 'active' | 'passive';

/** The register: how a claim is worded. It never changes the facts. */
export interface Register {
  formality: Formality;
  tone: Tone;
  voice: Voice;
}

/** English variants. en-GB is primary and the default. */
export type Locale = 'en-GB' | 'en-US';

/** The rhetorical role a section plays in the document plan. */
export type RhetoricalRole =
  | 'lead_in'
  | 'context'
  | 'condition'
  | 'criteria'
  | 'cause'
  | 'effect'
  | 'recommendation'
  | 'management_response'
  | 'status'
  | 'exception_summary'
  | 'coverage'
  | 'scope'
  | 'limitation'
  | 'alert_summary'
  | 'numeric_summary'
  | 'summary'
  | 'findings'
  | 'appendices';

/** A section of the document plan. */
export interface Section {
  id: string;
  role: RhetoricalRole;
  order: number;
  /** The rhetorical roles (and so the claim families) that may appear in this section. */
  roles: RhetoricalRole[];
  /** True when the model declares the section cannot vary by register (a purely numeric section). */
  registerInvariant: boolean;
  heading: string;
}

/** The document plan: sections, order, roles, and which claim kinds appear. */
export interface DocumentPlan {
  modelId: string;
  sections: Section[];
  claimKinds: ClaimKind[];
}

/** A figure binding: every number in a report is one of these, never a typed literal (W4.1). */
export interface FigureBinding {
  figureId: string;
  figureVersion: number;
  parameters: Record<string, string | number | boolean | null>;
  result: string;
}

/** The lineage of a figure: what the function read and what it produced (W4.2). */
export interface FigureLineage {
  figureId: string;
  figureVersion: number;
  parameters: Record<string, string | number | boolean | null>;
  records: Reference[];
  rowCount: number;
  result: string;
  timeArgument: string;
  lineageHash: string;
}

/** Why a sentence reads the way it does (W6.1). */
export interface ProvenanceTrace {
  phraseId: string;
  phraseVersion: number;
  ruleId: string;
  ruleVersion: number;
  conditionValues: Record<string, string | number | boolean | null>;
  slots: Slot[];
  register: Register;
  locale: Locale;
  engineVersion: string;
}

/**
 * A claim: the node of the graph. It carries the facts, not the words. The phrase and rule that
 * word it are recorded, so the same claim renders differently in different registers.
 */
export interface Claim {
  id: string;
  kind: ClaimKind;
  claimLevel: ClaimLevel;
  slots: Slot[];
  phraseId: string;
  phraseVersion: number;
  ruleId: string;
  ruleVersion: number;
  references: Reference[];
  figures: FigureBinding[];
  modelId: string;
  sectionId: string;
  /** The approval of the observation this claim derives from, when it derives from one (W3.2). */
  approval: ClaimApproval | null;
  /** Present for auditor text; the wording is the auditor's own. */
  auditorText?: string;
  auditorAuthor?: string;
  auditorAt?: string;
}

/** The approval an observation carried when a claim was derived from it. */
export interface ClaimApproval {
  observationId: string;
  approvedBy: string;
  approvedAt: string;
  observationVersion: number;
  contentHash: string;
}

/** A phrase: a condition over typed data plus a template with typed slots. Never code. */
export interface Phrase {
  id: string;
  version: number;
  condition: PhraseCondition;
  template: string;
  claimLevel: ClaimLevel;
  modelScope: string[];
  register: Register;
  locale: Locale;
  bannedWords: string[];
  status: PhraseStatus;
  /** A hash over the phrase body, so a released phrase can be shown immutable. */
  bodyHash: string;
}

export type PhraseStatus = 'draft' | 'reviewed' | 'released';

/** A structured predicate over typed data. Evaluated by fixed rules, never by generated code. */
export interface PhraseCondition {
  /** All clauses must hold (a conjunction). An empty list holds always. */
  all: ConditionClause[];
}

export interface ConditionClause {
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: string | number | boolean | string[];
}

/** The report models, each a versioned template with its own document plan (W3.1). */
export interface ReportModel {
  id: string;
  version: number;
  title: string;
  plan: DocumentPlan;
  defaultRegister: Register;
  allowedRegisters: Register[];
  defaultLocale: Locale;
}

/** The version identifiers committed to the ledger with the graph root (W7.1, spec §15.6). */
export interface EngineVersion {
  engine: string;
  template: string;
  phraseLibrary: string;
}

/** The fixed definition of a figure function (W4.1). */
export interface FigureFunction {
  id: string;
  version: number;
  description: string;
  inputTables: string[];
  inputColumns: string[];
  parameters: string[];
  /** The pure computation, identified by hash. */
  bodyHash: string;
}

/** The whole graph for one report at one register and locale. */
export interface ClaimGraph {
  modelId: string;
  register: Register;
  locale: Locale;
  claims: Claim[];
  versions: EngineVersion;
}
