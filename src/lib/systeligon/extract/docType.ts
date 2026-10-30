/**
 * Systeligon document-type check (spec §3.2, S7). The auditor says what a document IS when they attach
 * it; this module checks that claim against the document's own declared shape and reports a mismatch.
 *
 * It is a *matcher*, not a classifier in the learned sense: a fixed table of declared markers, each a
 * deterministic regular expression over the text, each carrying a weight. The marker with the highest
 * total is the detected kind; the auditor's claim is compared to it. Nothing here reads a clock, calls
 * a model or touches the network. When the text carries no marker at all the verdict is
 * `unconfirmable` — "I cannot tell" — never a fabricated disagreement, because an unrecognised
 * document is not a wrong one (the same discipline as "an unparsed clause is not a clean clause").
 */
import type { ParsedDocument, RuleFinding, SysteligonRule } from '../types';

export type DocKind = ParsedDocument['kind'];

/** The kinds the check can detect, in a fixed order so a tie is broken deterministically. */
export const DOC_KINDS: DocKind[] = [
  'minutes', 'policy', 'procedure', 'regulation', 'contract', 'invoice', 'approval', 'other',
];

/** A declared marker. `label` is what the auditor sees; the regex is the declared shape. */
interface Marker {
  kind: DocKind;
  label: string;
  weight: number;
  re: RegExp;
}

/**
 * The marker table. Data, not control flow: the set of shapes the check recognises is explicit and
 * reviewable. Weights favour a document that names itself ("Minutes of meeting") over a word that
 * appears in many documents ("present").
 */
export const DOC_TYPE_MARKERS: Marker[] = [
  // minutes
  { kind: 'minutes', label: 'minutes of meeting', weight: 3, re: /\bminutes of (?:the )?meeting\b/i },
  { kind: 'minutes', label: 'quorum', weight: 2, re: /\bquorum\b/i },
  { kind: 'minutes', label: 'apologies', weight: 2, re: /\bapologies\b/i },
  { kind: 'minutes', label: 'attendees', weight: 2, re: /\battendees?\b/i },
  { kind: 'minutes', label: 'matters arising', weight: 2, re: /\bmatters arising\b/i },
  { kind: 'minutes', label: 'action item', weight: 2, re: /\baction item\b/i },
  { kind: 'minutes', label: 'present', weight: 1, re: /^\s*present\b/im },
  // policy
  { kind: 'policy', label: 'policy statement', weight: 3, re: /\bpolicy statement\b/i },
  { kind: 'policy', label: 'policy', weight: 2, re: /\bpolic(?:y|ies)\b/i },
  { kind: 'policy', label: 'applies to', weight: 1, re: /\bapplies to\b/i },
  // procedure
  { kind: 'procedure', label: 'procedure', weight: 3, re: /\bprocedure\b/i },
  { kind: 'procedure', label: 'responsibility', weight: 2, re: /\bresponsibilit(?:y|ies)\b/i },
  { kind: 'procedure', label: 'step', weight: 1, re: /\bstep \d/i },
  { kind: 'procedure', label: 'instructions', weight: 1, re: /\binstructions?\b/i },
  // regulation
  { kind: 'regulation', label: 'regulation', weight: 3, re: /\bregulations?\b/i },
  { kind: 'regulation', label: 'article', weight: 2, re: /\barticle \d/i },
  { kind: 'regulation', label: 'statutory', weight: 2, re: /\bstatutory\b/i },
  { kind: 'regulation', label: 'shall comply', weight: 2, re: /\bshall comply\b/i },
  { kind: 'regulation', label: 'clause', weight: 1, re: /\bclause \d/i },
  // contract
  { kind: 'contract', label: 'in witness whereof', weight: 3, re: /\bin witness whereof\b/i },
  { kind: 'contract', label: 'agreement', weight: 3, re: /\bagreement\b/i },
  { kind: 'contract', label: 'whereas', weight: 3, re: /\bwhereas\b/i },
  { kind: 'contract', label: 'parties', weight: 2, re: /\bpart(?:y|ies)\b/i },
  { kind: 'contract', label: 'terms and conditions', weight: 2, re: /\bterms and conditions\b/i },
  // invoice
  { kind: 'invoice', label: 'invoice', weight: 3, re: /\binvoice\b/i },
  { kind: 'invoice', label: 'amount due', weight: 3, re: /\bamount due\b/i },
  { kind: 'invoice', label: 'bill to', weight: 2, re: /\bbill to\b/i },
  { kind: 'invoice', label: 'purchase order', weight: 2, re: /\bpurchase order\b/i },
  { kind: 'invoice', label: 'vat', weight: 1, re: /\bvat\b/i },
  // approval
  { kind: 'approval', label: 'approved by', weight: 3, re: /\bapproved by\b/i },
  { kind: 'approval', label: 'authorised by', weight: 3, re: /\bauthoris(?:ed|zed) by\b/i },
  { kind: 'approval', label: 'approval', weight: 2, re: /\bapproval\b/i },
];

/** One matched marker, with the 1-based line it was first seen on. */
export interface DocTypeSignal {
  kind: DocKind;
  label: string;
  line: number;
  weight: number;
}

/**
 * The verdict. `confirmed` — the claim matches the detected kind. `discrepant` — the text clearly
 * reads as a different kind, so the claim is wrong. `unconfirmable` — the text carries no marker the
 * check knows, so it can neither confirm nor deny the claim.
 */
export type DocTypeVerdict = 'confirmed' | 'discrepant' | 'unconfirmable';

export interface DocTypeAssessment {
  declared: DocKind;
  inferred: DocKind;
  verdict: DocTypeVerdict;
  /** Signals supporting the detected kind, best first. */
  inferredSignals: DocTypeSignal[];
  /** Signals supporting the auditor's claim, so the conflict is visible when they disagree. */
  declaredSignals: DocTypeSignal[];
  /** Plain-words sentence for the auditor; never generated text, always composed from the signals. */
  reason: string;
}

/** Total weight per kind and the first signal of each, computed in one deterministic pass. */
function collect(text: string): { scores: Map<DocKind, number>; signals: DocTypeSignal[] } {
  const lines = text.split(/\r?\n/);
  const scores = new Map<DocKind, number>();
  const signals: DocTypeSignal[] = [];
  for (const marker of DOC_TYPE_MARKERS) {
    let found = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (marker.re.test(lines[i])) { found = i + 1; break; }
    }
    if (found < 0) continue;
    scores.set(marker.kind, (scores.get(marker.kind) ?? 0) + marker.weight);
    signals.push({ kind: marker.kind, label: marker.label, line: found, weight: marker.weight });
  }
  return { scores, signals };
}

/** Best-first: weight desc, then line asc, then label asc — a stable, reproducible order. */
function byStrength(a: DocTypeSignal, b: DocTypeSignal): number {
  return b.weight - a.weight || a.line - b.line || a.label.localeCompare(b.label);
}

/**
 * Assess whether `declared` matches the document's own shape. Deterministic and total: any text and
 * any declared kind produce a verdict, and the tie-break is the fixed `DOC_KINDS` order.
 */
export function assessDocType(text: string, declared: DocKind): DocTypeAssessment {
  const { scores, signals } = collect(text);
  let inferred: DocKind = 'other';
  let best = 0;
  for (const kind of DOC_KINDS) {
    const score = scores.get(kind) ?? 0;
    if (score > best) { best = score; inferred = kind; }
  }
  const inferredSignals = signals.filter((s) => s.kind === inferred).sort(byStrength);
  const declaredSignals = signals.filter((s) => s.kind === declared).sort(byStrength);

  if (best === 0) {
    return {
      declared, inferred: 'other', verdict: 'unconfirmable', inferredSignals, declaredSignals,
      reason: `The text carries no marker the check recognises, so the claim "${declared}" could not be confirmed.`,
    };
  }
  if (inferred === declared) {
    const lead = inferredSignals[0];
    return {
      declared, inferred, verdict: 'confirmed', inferredSignals, declaredSignals,
      reason: `The text reads as ${inferred} (${inferredSignals.length} marker(s), led by "${lead.label}" at line ${lead.line}).`,
    };
  }
  return {
    declared, inferred, verdict: 'discrepant', inferredSignals, declaredSignals,
    reason: `Declared ${declared} but the text reads as ${inferred} (${inferredSignals.length} marker(s), led by "${inferredSignals[0].label}" at line ${inferredSignals[0].line}).`,
  };
}

/** The document kinds the check can confirm or deny; `other` is "no claim", so it is never assessed. */
export const ASSESSABLE_DOC_KINDS: DocKind[] = DOC_KINDS.filter((k) => k !== 'other');

/**
 * The doc-type rule, so the check runs through the same `runRules` path as every other rule and its
 * finding is recorded with the engine's provenance. `input.documents` is the *declared* structure the
 * screen parsed; the raw text of each document is carried in `input.scope` under
 * `docText:<ref>`, because `ParsedDocument` holds structure, not the prose the marker table reads.
 *
 * A `discrepant` verdict is a finding; a `confirmed` or `unconfirmable` verdict is not. Silence on a
 * confirmed document is correct; silence on an unrecognised one is the documented `unconfirmable`
 * state, reported by the screen rather than invented as a finding here.
 */
export const docTypeMismatch: SysteligonRule<Record<string, never>> = {
  id: 'doc.type_mismatch', version: 1, kind: 'cross_document_inconsistency', appliesTo: 'document',
  title: 'A document’s declared type matches the shape of its text',
  params: {}, standards: [], status: 'released', severity: 'medium',
  evaluate: (input, ctx) => {
    const findings: RuleFinding[] = [];
    for (const doc of input.documents ?? []) {
      if (doc.kind === 'other') continue;
      const text = input.scope?.[`docText:${doc.ref}`];
      if (text === undefined) continue;
      const verdict = assessDocType(text, doc.kind);
      if (verdict.verdict !== 'discrepant') continue;
      findings.push({
        ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'cross_document_inconsistency',
        severity: ctx.severity, reason: `${doc.ref}: ${verdict.reason}`, refs: [doc.ref],
      });
    }
    return findings;
  },
};

/** The doc-type rule set, for a caller that wants the type check as a runnable rule. */
export const docTypeRules: SysteligonRule[] = [docTypeMismatch];
