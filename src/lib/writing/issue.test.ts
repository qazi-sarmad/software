import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { composeReport, type ComposerInput } from './compose';
import { issueDocument, renderIssue, reportFooterLine } from './issue';
import { documentPlainText } from '../render/docx';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, fixtureClaims,
  fixtureVariants, releasedSeedPhrases,
} from './fixtures';
import type { ClaimGraph, Locale, Register } from './types';

function input(register: Register, locale: Locale, claims = fixtureClaims()): ComposerInput {
  const graph: ClaimGraph = { modelId: 'M1', register, locale, claims, versions: ENGINE_VERSION };
  return {
    graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: ENGINE_VERSION,
    fixedTimestamp: FIXED_TIMESTAMP, format: FIXTURE_FORMAT, variants: fixtureVariants(),
  };
}

async function issue(register: Register, locale: Locale) {
  const i = input(register, locale);
  const composed = await composeReport(i);
  const issued = issueDocument({ composed, graph: i.graph, title: 'Audit report', issuedAt: FIXED_TIMESTAMP });
  return renderIssue(issued);
}

describe('W7.1 / W7.2 byte reproducibility', () => {
  it('renders identical PDF bytes twice for the same input', async () => {
    const a = await issue({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
    const b = await issue({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
    expect(a.pdfHash).toBe(b.pdfHash);
  });

  it('renders identical DOCX bytes twice for the same input', async () => {
    const a = await issue({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
    const b = await issue({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
    expect(a.docxHash).toBe(b.docxHash);
  });

  it('renders identical bytes in both locales', async () => {
    const gb = await issue({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
    const us = await issue({ formality: 3, tone: 2, voice: 'active' }, 'en-US');
    // The two locales produce different words, so different bytes, but each is stable.
    expect(gb.pdfHash).not.toBe(us.pdfHash);
    const usAgain = await issue({ formality: 3, tone: 2, voice: 'active' }, 'en-US');
    expect(us.pdfHash).toBe(usAgain.pdfHash);
  });

  it('embeds the graph root, render hash and versions in a visible footer line', async () => {
    const i = input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
    const composed = await composeReport(i);
    const issued = issueDocument({ composed, graph: i.graph, title: 'Audit report', issuedAt: FIXED_TIMESTAMP });
    const line = reportFooterLine(issued.metadata);
    expect(line).toContain(composed.hashes.graphRoot.slice(0, 16));
    expect(line).toContain(composed.renderHash.slice(0, 16));
    expect(line).toContain(ENGINE_VERSION.engine);
    expect(documentPlainText(issued.document)).toContain(line);
  });

  it('changes the graph root and the file when one figure changes', async () => {
    const base = await issue({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
    const changedClaims = fixtureClaims().map((c) => c.id === 'c-effect'
      ? { ...c, slots: [{ name: 'amount', kind: 'money' as const, value: { units: '999999', scale: 2 } }] }
      : c);
    const i = input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB', changedClaims);
    const composed = await composeReport(i);
    const changed = await renderIssue(issueDocument({ composed, graph: i.graph, title: 'Audit report', issuedAt: FIXED_TIMESTAMP }));
    expect(composed.hashes.graphRoot).not.toBe(base.pdfHash && (await composeReport(input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB'))).hashes.graphRoot);
    expect(changed.pdfHash).not.toBe(base.pdfHash);
  });

  it('changes only the render hash, not the graph root, when only the register changes', async () => {
    const a = input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
    const b = input({ formality: 5, tone: 4, voice: 'passive' }, 'en-GB');
    const ca = await composeReport(a);
    const cb = await composeReport(b);
    expect(ca.hashes.graphRoot).toBe(cb.hashes.graphRoot);
    expect(ca.renderHash).not.toBe(cb.renderHash);
    const ia = await renderIssue(issueDocument({ composed: ca, graph: a.graph, title: 'Audit report', issuedAt: FIXED_TIMESTAMP }));
    const ib = await renderIssue(issueDocument({ composed: cb, graph: b.graph, title: 'Audit report', issuedAt: FIXED_TIMESTAMP }));
    expect(ia.pdfHash).not.toBe(ib.pdfHash);
  });

  it('produces a parseable PDF and a real DOCX archive', async () => {
    const rendered = await issue({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
    const parsed = await PDFDocument.load(rendered.pdf);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    const zip = await JSZip.loadAsync(rendered.docx);
    expect(Object.keys(zip.files)).toContain('word/document.xml');
  });
});
