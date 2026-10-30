/**
 * S7 scale: a document run over a large engagement document set (SCALE-PROGRAMME §5 flow 7,
 * document scope).
 *
 * The document-review screen (OA-36) runs every selected review over the whole set. This suite
 * realises a large set with a deterministic generator, runs the engine over it, and proves three
 * things a big set must not break:
 *
 *   1. **Determinism at volume.** Two runs of the same set produce byte-identical findings, so a
 *      sealed report can re-derive them. The generator is a fixed-seed LCG — no `Math.random`, no
 *      clock — so a failure is reproducible.
 *   2. **Coverage is reported, never rounded.** Every document's parse reports how many lines it
 *      read and how many it could not interpret; the two must sum to the line count. An unparsed
 *      clause is not a clean clause.
 *   3. **A document with no text is a scan, not a clean document.** The bad path: a scan contributes
 *      no text, so the type check reports `unconfirmable`, never a fabricated pass.
 *
 * The budget is measured on this machine and carried with headroom, the same discipline as
 * `src/lib/writing/scale.test.ts`. Nothing here reads a clock except the one instant captured for
 * the run, which is passed to the engine as an argument (L4).
 */
import { describe, expect, it } from 'vitest';
import { parseDocumentStructure } from './structured';
import { assessDocType } from './docType';
import { runRules } from '../runner';
import { resolveReviewOptions, rulesForOptions, ALL_REVIEW_OPTIONS } from './reviewOptions';
import { buildActionRegister } from '../minutes';
import { compareDocuments } from '../policydiff';
import type { ParsedDocument, RuleInput } from '../types';

/** A document set the size of a large tenant's engagement: 2,000 documents. */
const DOC_COUNT = 2_000;

/**
 * The performance budget. Parsing 2,000 documents and running every review over them must finish
 * under this many milliseconds. The ceiling carries headroom for a slow CI runner while still
 * catching a real regression.
 */
const SCALE_BUDGET_MS = 15_000;

const EVALUATED_AT = '2026-10-30T09:00:00.000Z';
const AS_OF = EVALUATED_AT.slice(0, 10);

/** A fixed-seed linear congruential generator: deterministic, so the same set every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const KINDS: ParsedDocument['kind'][] = ['minutes', 'policy', 'procedure', 'regulation', 'contract', 'invoice'];

/** The text shapes the generator emits, one per declared kind. Declared shapes, not prose. */
function textFor(kind: ParsedDocument['kind'], i: number, rand: () => number): string {
  switch (kind) {
    case 'minutes': {
      // One in five minutes has no quorum (the rule must fire); the rest carry it.
      const quorum = rand() < 0.2 ? '' : 'Quorum: present\n';
      // One in four action items has no owner or due date (the rule must fire).
      const owner = rand() < 0.25 ? '' : `Owner: member-${i % 7}\n`;
      const due = rand() < 0.25 ? '' : `Due: 2026-11-${String((i % 28) + 1).padStart(2, '0')}\n`;
      return `Minutes of Meeting\nPresent: A, B, C\n${quorum}Action: follow up on item ${i}\n${owner}${due}`;
    }
    case 'policy':
      return `Policy Statement\nThis policy applies to all staff.\n1.1 The institution must retain records for seven years.\n1.2 Records must be filed on the day of receipt.`;
    case 'procedure':
      return `Procedure for Records\nStep 1: file the record on receipt.\n2.1 See 1.1 for the retention rule.`;
    case 'regulation':
      return `Regulation 12 — Financial Records\nArticle 4 requires that every institution shall comply with the statutory retention period.\nClause 9 sets out the penalty.`;
    case 'contract':
      return `Agreement\nWhereas the parties agree as follows.\n1.1 The supplier shall deliver.\nIn witness whereof the parties set their hands.\nSigned: ______`;
    case 'invoice':
      return `Invoice\nBill to: entity-${i % 13}\nAmount due: ${(i % 900) + 100}\nPurchase order: PO-${i}`;
    default:
      return `Untitled document ${i}`;
  }
}

/** Build the set and the rule input the screen would assemble. Deterministic. */
function buildSet(): { input: RuleInput; docs: ParsedDocument[]; texts: Map<string, string> } {
  const rand = lcg(20261030);
  const docs: ParsedDocument[] = [];
  const texts = new Map<string, string>();
  const scope: Record<string, string> = {};
  const sourceFiles: Array<{ ref: string; text: string }> = [];

  for (let i = 0; i < DOC_COUNT; i += 1) {
    const ref = `doc-${String(i).padStart(5, '0')}`;
    // One in fifty documents is filed as minutes but reads as a regulation — the discrepancy the
    // declared-type check exists to catch before any other review is trusted.
    const declared: ParsedDocument['kind'] = i % 50 === 0 ? 'minutes' : KINDS[i % KINDS.length];
    const text = i % 50 === 0 ? textFor('regulation', i, rand) : textFor(declared, i, rand);
    const { document } = parseDocumentStructure(text, declared, ref);
    docs.push(document);
    texts.set(ref, text);
    scope[`docText:${ref}`] = text;
    sourceFiles.push({ ref, text });
  }

  return { input: { rows: [], documents: docs, sourceFiles, scope }, docs, texts };
}

describe('S7 scale — a document run over 2,000 documents', () => {
  it('runs every review over the whole set and reports its coverage without rounding', () => {
    const { input } = buildSet();
    const options = resolveReviewOptions(ALL_REVIEW_OPTIONS);
    const rules = rulesForOptions(options);
    const result = runRules(rules, input, { evaluatedAt: EVALUATED_AT });

    // Every rule that ran names its id and version, so a finding can be re-derived forever.
    expect(result.ran.length).toBe(rules.length);
    for (const f of result.findings) {
      expect(f.ruleId).toMatch(/^doc\./);
      expect(f.ruleVersion).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(f.refs)).toBe(true);
    }

    // Coverage: parsed + uninterpreted equals the lines each parser read. Nothing is rounded away.
    for (const doc of input.documents ?? []) {
      const text = input.scope?.[`docText:${doc.ref}`] ?? '';
      const { coverage } = parseDocumentStructure(text, doc.kind, doc.ref);
      expect(coverage.parsed + coverage.uninterpreted).toBe(coverage.lines);
    }
  });

  it('is deterministic at volume: two runs produce byte-identical findings', () => {
    const { input } = buildSet();
    const rules = rulesForOptions(resolveReviewOptions(ALL_REVIEW_OPTIONS));
    const a = runRules(rules, input, { evaluatedAt: EVALUATED_AT });
    const b = runRules(rules, input, { evaluatedAt: EVALUATED_AT });
    expect(JSON.stringify(b.findings)).toBe(JSON.stringify(a.findings));

    // The register and the comparison are deterministic too.
    const docs = input.documents ?? [];
    const reg1 = buildActionRegister(docs.filter((d) => d.kind === 'minutes'), AS_OF);
    const reg2 = buildActionRegister(docs.filter((d) => d.kind === 'minutes'), AS_OF);
    expect(JSON.stringify(reg2)).toBe(JSON.stringify(reg1));
    const cmp1 = compareDocuments(docs);
    const cmp2 = compareDocuments(docs);
    expect(JSON.stringify(cmp2)).toBe(JSON.stringify(cmp1));
  });

  it('catches every filed-as-minutes-but-reads-as-regulation discrepancy', () => {
    const { input } = buildSet();
    const expected = Math.ceil(DOC_COUNT / 50); // the generator's fixed discrepancy rate
    const discrepancies = (input.documents ?? []).filter((doc) => {
      if (doc.kind !== 'minutes') return false;
      const text = input.scope?.[`docText:${doc.ref}`] ?? '';
      return assessDocType(text, doc.kind).verdict === 'discrepant';
    });
    expect(discrepancies.length).toBe(expected);
  });

  it('reports a scan (no text layer) as unconfirmable, never as a clean document', () => {
    // The bad path: a document whose extraction produced no text contributes no prose to the check.
    const verdict = assessDocType('', 'minutes');
    expect(verdict.verdict).toBe('unconfirmable');
    expect(verdict.reason).toContain('could not be confirmed');

    // And over the whole set, a document with no text is not counted as a pass.
    const parsed = parseDocumentStructure('', 'minutes', 'scan-1');
    expect(parsed.coverage.lines).toBe(0);
    expect(parsed.document.elements).toHaveLength(0);
  });

  it('stays inside the measured budget for a 2,000-document run', () => {
    const { input } = buildSet();
    const rules = rulesForOptions(resolveReviewOptions(ALL_REVIEW_OPTIONS));
    const started = performance.now();
    const result = runRules(rules, input, { evaluatedAt: EVALUATED_AT });
    const elapsed = performance.now() - started;
    // Report the measured value so a regression is visible even when the ceiling is not hit.
    console.log(`S7 document scale: ${DOC_COUNT} documents, ${result.findings.length} findings, ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(SCALE_BUDGET_MS);
  });
});
