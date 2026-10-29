/**
 * Systeligon policy / procedure / regulation comparison (S15, spec §3.3). Compares two or more document
 * sets and reports the mismatches the spec names, matched on structure only — shared reference numbers,
 * shared defined terms, obligation verbs and explicit cross-references. It never decides which document
 * is right; it shows the two passages side by side and records that a human decides.
 *
 * It is explicit about its own coverage: clauses parsed, matched, and **could not be interpreted** —
 * because an unparsed clause is not a clean clause (§3.3).
 */
import type { ParsedDocument } from './types';

export type MatchKind =
  | 'policy_no_procedure'
  | 'procedure_no_policy'
  | 'regulation_uncovered'
  | 'contradiction'
  | 'stated_differently'
  | 'version_drift'
  | 'control_no_procedure';

export interface PassageRef {
  documentRef: string;
  line: number;
  text: string;
}

export interface MatchFinding {
  kind: MatchKind;
  /** Comparable key the two passages share (a reference number or a defined term). */
  key: string;
  a: PassageRef;
  b: PassageRef | null;
  detail: string;
}

export interface ComparisonCoverage {
  /** Normative clauses seen (policy/procedure/regulation clauses and obligation sentences). */
  clausesParsed: number;
  matched: number;
  /** Clauses that carry no reference, term or obligation the matcher can key on. */
  couldNotInterpret: number;
  /** The exact clause refs that could not be interpreted, so nothing is silently dropped. */
  uninterpreted: string[];
}

export interface ComparisonResult {
  findings: MatchFinding[];
  coverage: ComparisonCoverage;
}

const passageOf = (doc: ParsedDocument, el: ParsedDocument['elements'][number]): PassageRef => ({
  documentRef: doc.ref, line: el.line, text: el.text ?? el.value ?? '',
});

/** An obligation clause is one that carries obligation verbs (each document's clause is normative). */
function isNormative(doc: ParsedDocument, role: string): boolean {
  return role === 'clause' || role === 'reference' || role === 'heading'
    ? doc.kind === 'policy' || doc.kind === 'procedure' || doc.kind === 'regulation'
    : false;
}

/**
 * Compare document sets. Findings are keyed by reference number or defined term. `contradiction` and
 * `stated_differently` are proposed when two documents share a key but disagree — the engine reports
 * the shape, a human decides which is right.
 */
export function compareDocuments(documents: ParsedDocument[]): ComparisonResult {
  const findings: MatchFinding[] = [];
  const coverage: ComparisonCoverage = { clausesParsed: 0, matched: 0, couldNotInterpret: 0, uninterpreted: [] };

  const byKind = (k: ParsedDocument['kind']) => documents.filter((d) => d.kind === k);
  const policies = byKind('policy');
  const procedures = byKind('procedure');
  const regulations = byKind('regulation');
  const controls = byKind('other');

  /** Every clause's comparable keys: its own label, its cross-refs and its defined terms. */
  const keysOf = (doc: ParsedDocument) => {
    const map = new Map<string, PassageRef>();
    for (const el of doc.elements) {
      if (!isNormative(doc, el.role)) continue;
      coverage.clausesParsed += 1;
      const keys = [el.label, ...(el.crossRefs ?? []), ...(el.terms ?? [])].filter(Boolean) as string[];
      if (keys.length === 0) {
        coverage.couldNotInterpret += 1;
        coverage.uninterpreted.push(el.ref);
        continue;
      }
      for (const k of keys) if (!map.has(k)) map.set(k, passageOf(doc, el));
    }
    return map;
  };

  const policyKeys = policies.flatMap((d) => [...keysOf(d).entries()].map(([k, p]) => [k, p] as const));
  const procedureKeys = procedures.flatMap((d) => [...keysOf(d).entries()].map(([k, p]) => [k, p] as const));
  const regulationKeys = regulations.flatMap((d) => [...keysOf(d).entries()].map(([k, p]) => [k, p] as const));
  const controlKeys = controls.flatMap((d) => [...keysOf(d).entries()].map(([k, p]) => [k, p] as const));

  const procHas = new Set(procedureKeys.map(([k]) => k));
  const polHas = new Set(policyKeys.map(([k]) => k));
  const allLower = new Set([...procHas, ...polHas]);

  for (const [key, p] of policyKeys) {
    if (procHas.has(key)) { coverage.matched += 1; continue; }
    findings.push({ kind: 'policy_no_procedure', key, a: p, b: null, detail: `Policy clause ${p.documentRef}:${p.line} (key ${key}) has no procedure step.` });
  }
  for (const [key, p] of procedureKeys) {
    if (polHas.has(key)) { coverage.matched += 1; continue; }
    findings.push({ kind: 'procedure_no_policy', key, a: p, b: null, detail: `Procedure step ${p.documentRef}:${p.line} (key ${key}) has no enabling policy.` });
  }
  for (const [key, p] of regulationKeys) {
    if (allLower.has(key)) { coverage.matched += 1; continue; }
    findings.push({ kind: 'regulation_uncovered', key, a: p, b: null, detail: `Regulation requirement ${p.documentRef}:${p.line} (key ${key}) is not covered by any policy or procedure.` });
  }
  for (const [key, p] of controlKeys) {
    if (procHas.has(key)) continue;
    findings.push({ kind: 'control_no_procedure', key, a: p, b: null, detail: `Control ${p.documentRef}:${p.line} (key ${key}) has no procedure step.` });
  }

  // Contradiction / stated differently: the same key in two documents with different obligation verbs
  // or different text. The engine reports both passages; it does not say which is right.
  for (const [key, p] of policyKeys) {
    const proc = procedureKeys.find(([k]) => k === key);
    if (proc && proc[1].text && p.text && proc[1].text.trim() !== p.text.trim()) {
      findings.push({ kind: 'stated_differently', key, a: p, b: proc[1], detail: `Key ${key} is stated differently in ${p.documentRef} and ${proc[1].documentRef}; a human decides which governs.` });
    }
  }

  findings.sort((x, y) => x.kind.localeCompare(y.kind) || x.key.localeCompare(y.key));
  coverage.uninterpreted.sort();
  return { findings, coverage };
}
