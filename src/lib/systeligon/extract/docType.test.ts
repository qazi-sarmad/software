import { describe, expect, it } from 'vitest';
import {
  assessDocType, docTypeMismatch, docTypeRules, DOC_KINDS, DOC_TYPE_MARKERS, ASSESSABLE_DOC_KINDS,
} from './docType';
import { runRules } from '../runner';
import type { ParsedDocument, RuleInput } from '../types';

/**
 * S7 — the declared-type check. The owner's clarification: a document the auditor files as minutes
 * that is actually a rule or regulation must be highlighted. These tests prove the check is
 * deterministic, that it refuses to invent a disagreement it cannot support, and that the mismatch
 * reaches the auditor as a finding through the real `runRules` path.
 */

const MINUTES = `Minutes of Meeting
Present: A. Chairman, B. Director, C. Secretary
Apologies: D. Member
Quorum: present
Matters arising: the prior budget action item remains open.
Action: obtain the missing invoice
Owner: C. Secretary
Due: 2026-11-30`;

const REGULATION = `Regulation 12 — Financial Records
Article 4 requires that every institution shall comply with the statutory retention period.
Clause 9 sets out the penalty for non-compliance.
Regulation 15 amends Article 4.`;

const POLICY = `Records Retention Policy
Policy statement: the firm retains records for seven years.
This policy applies to all staff.
The policy is reviewed annually.`;

describe('S7 declared-type check — the marker table', () => {
  it('is a declared table of regexes, and every entry names a kind it can detect', () => {
    expect(DOC_TYPE_MARKERS.length).toBeGreaterThan(20);
    for (const m of DOC_TYPE_MARKERS) {
      expect(DOC_KINDS).toContain(m.kind);
      expect(m.weight).toBeGreaterThan(0);
      expect(m.re).toBeInstanceOf(RegExp);
    }
  });

  it('every kind except "other" is assessable; "other" is a no-claim', () => {
    expect(ASSESSABLE_DOC_KINDS).not.toContain('other');
    expect(ASSESSABLE_DOC_KINDS.length).toBe(DOC_KINDS.length - 1);
  });
});

describe('S7 declared-type check — the verdicts', () => {
  it('confirms a document that matches its declared type', () => {
    const a = assessDocType(MINUTES, 'minutes');
    expect(a.verdict).toBe('confirmed');
    expect(a.inferred).toBe('minutes');
    expect(a.reason).toContain('reads as minutes');
  });

  it('flags the owner’s case: declared minutes, actually a regulation', () => {
    const a = assessDocType(REGULATION, 'minutes');
    expect(a.verdict).toBe('discrepant');
    expect(a.inferred).toBe('regulation');
    expect(a.reason).toContain('Declared minutes');
    expect(a.reason).toContain('reads as regulation');
    // The evidence the auditor sees: the marker that led the verdict, with its line.
    expect(a.inferredSignals[0].kind).toBe('regulation');
    expect(a.inferredSignals[0].line).toBeGreaterThan(0);
  });

  it('flags the reverse: declared a regulation, actually minutes', () => {
    const a = assessDocType(MINUTES, 'regulation');
    expect(a.verdict).toBe('discrepant');
    expect(a.inferred).toBe('minutes');
  });

  it('distinguishes a policy from a procedure by their own declared shapes', () => {
    expect(assessDocType(POLICY, 'policy').verdict).toBe('confirmed');
    expect(assessDocType(POLICY, 'procedure').verdict).toBe('discrepant');
  });

  it('says unconfirmable — never a fabricated disagreement — for text it cannot recognise', () => {
    const a = assessDocType('XYZ 123 qqq wwww zzzz', 'minutes');
    expect(a.verdict).toBe('unconfirmable');
    expect(a.inferred).toBe('other');
    expect(a.reason).toContain('could not be confirmed');
  });

  it('is deterministic: the same text and claim always give the same verdict', () => {
    const first = assessDocType(REGULATION, 'minutes');
    const second = assessDocType(REGULATION, 'minutes');
    expect(second).toEqual(first);
  });

  it('breaks a tie by the fixed kind order, not by map iteration', () => {
    // "clause 4" (regulation, w1) and "step 1" (procedure, w1) are both present and weigh the same.
    const tied = 'clause 4 applies.\nstep 1 begins.';
    const a = assessDocType(tied, 'other');
    // DOC_KINDS puts procedure before regulation, so procedure wins the tie deterministically.
    expect(a.inferred).toBe('procedure');
    expect(assessDocType(tied, 'other').inferred).toBe('procedure');
  });
});

describe('S7 declared-type check — through the engine', () => {
  const doc = (ref: string, kind: ParsedDocument['kind']): ParsedDocument => ({ ref, kind, elements: [] });

  it('emits a finding for a discrepant document and none for a confirmed one', () => {
    const input: RuleInput = {
      rows: [],
      documents: [doc('min.docx', 'minutes'), doc('reg.pdf', 'regulation')],
      scope: { 'docText:min.docx': REGULATION, 'docText:reg.pdf': REGULATION },
    };
    const result = runRules(docTypeRules, input, { evaluatedAt: '2026-10-30T00:00:00.000Z' });
    expect(result.ran.map((r) => r.id)).toEqual(['doc.type_mismatch']);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].refs).toEqual(['min.docx']);
    expect(result.findings[0].reason).toContain('Declared minutes');
  });

  it('skips a document declared "other" — no claim, no check', () => {
    const input: RuleInput = {
      rows: [],
      documents: [doc('mystery.bin', 'other')],
      scope: { 'docText:mystery.bin': REGULATION },
    };
    const result = runRules(docTypeRules, input, { evaluatedAt: '2026-10-30T00:00:00.000Z' });
    expect(result.findings).toEqual([]);
  });

  it('emits no finding when the text is unconfirmable', () => {
    const input: RuleInput = {
      rows: [],
      documents: [doc('blob.pdf', 'minutes')],
      scope: { 'docText:blob.pdf': 'qqq zzz wwww' },
    };
    expect(runRules(docTypeRules, input, { evaluatedAt: '2026-10-30T00:00:00.000Z' }).findings).toEqual([]);
  });

  it('names its scope, severity and status, so the run is reproducible', () => {
    expect(docTypeMismatch.appliesTo).toBe('document');
    expect(docTypeMismatch.status).toBe('released');
    expect(docTypeMismatch.version).toBe(1);
  });
});
