import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { OCR_GLYPH_BITS, OCR_GLYPH_H, OCR_GLYPH_W } from '../../lib/systeligon/extract/ocrFont.generated';
import { encodePng, PixelCanvas } from '../../lib/render/png';

const listFiles = vi.fn();
const loadText = vi.fn();
const readBytes = vi.fn();
const recordFindings = vi.fn();

vi.mock('../../data/documentReview', () => ({
  listEvidenceFiles: (...a: unknown[]) => listFiles(...a),
  loadExtractionText: (...a: unknown[]) => loadText(...a),
  readEvidenceBytes: (...a: unknown[]) => readBytes(...a),
  recordDocumentReviewFindings: (...a: unknown[]) => recordFindings(...a),
}));

const userRef = {
  current: {
    id: 'u1', name: 'CIA', email: 'cia@example.test', avatar: '', role: 'cia',
    universeIds: ['*'], entityIds: ['*'],
    rights: { perform_work: true, review_and_approve: true },
  },
};
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: userRef.current }),
}));

import { DocumentReviewPanel } from './DocumentReviewPanel';

const MINUTES = `Minutes of Meeting
Present: A, B, C
Quorum: present
Action: obtain the invoice
Owner: C
Due: 2026-11-30`;

const REGULATION = `Regulation 12 — Financial Records
Article 4 requires that every institution shall comply with the statutory retention period.
Clause 9 sets out the penalty.`;

beforeEach(() => {
  listFiles.mockReset();
  loadText.mockReset();
  readBytes.mockReset();
  recordFindings.mockReset();
  userRef.current.rights = { perform_work: true, review_and_approve: true };
  (userRef.current as { role: string }).role = 'cia';
});

/** Render ASCII text into a PNG with the engine's own bitmap font, so the OCR round trip is honest. */
function renderTextPng(lines: string[]): Uint8Array {
  const pitch = OCR_GLYPH_W;
  const lineH = OCR_GLYPH_H + 2;
  const cols = Math.max(...lines.map((l) => l.length), 1);
  const width = cols * pitch + 8;
  const height = lines.length * lineH + 8;
  const canvas = new PixelCanvas(width, height, { r: 255, g: 255, b: 255 });
  lines.forEach((line, li) => {
    for (let ci = 0; ci < line.length; ci++) {
      const bits = OCR_GLYPH_BITS[line.charCodeAt(ci)];
      if (!bits) continue;
      const ox = 4 + ci * pitch;
      const oy = 4 + li * lineH;
      for (let gy = 0; gy < OCR_GLYPH_H; gy++) {
        for (let gx = 0; gx < OCR_GLYPH_W; gx++) {
          if (bits[gy * OCR_GLYPH_W + gx] === '1') canvas.fillRect(ox + gx, oy + gy, 1, 1, { r: 0, g: 0, b: 0 });
        }
      }
    }
  });
  return encodePng(canvas.data, width, height);
}

describe('OA-36 document review', () => {
  it('renders every review option and lets the auditor select all', async () => {
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'min.docx' }]);
    loadText.mockResolvedValue({ ok: true, text: MINUTES, status: 'done' });
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-options')).toBeTruthy());
    for (const id of ['doc_type', 'structural', 'minutes', 'policy', 'patterns']) {
      expect(screen.getByTestId(`docreview-option-${id}`)).toBeTruthy();
    }
  });

  it('highlights the owner’s case: filed as minutes, but the text is a regulation', async () => {
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'min.docx' }]);
    loadText.mockResolvedValue({ ok: true, text: REGULATION, status: 'done' });
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-file-0')).toBeTruthy());
    // The auditor says it is minutes.
    fireEvent.change(screen.getByTestId('docreview-declared-0'), { target: { value: 'minutes' } });
    fireEvent.click(screen.getByTestId('docreview-run'));

    await waitFor(() => expect(screen.getByTestId('docreview-verdicts')).toBeTruthy());
    const state = screen.getByTestId('docreview-verdict-state-min.docx');
    expect(state.textContent?.toLowerCase()).toBe('discrepant');
    // The warning is shown before any other finding.
    expect(screen.getByTestId('docreview-verdict-discrepant-note')).toBeTruthy();
    // And the mismatch is recorded as a real finding through the engine.
    expect(screen.getByTestId('docreview-findings')).toBeTruthy();
  });

  it('confirms a document that matches its declared type', async () => {
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'min.docx' }]);
    loadText.mockResolvedValue({ ok: true, text: MINUTES, status: 'done' });
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-file-0')).toBeTruthy());
    fireEvent.change(screen.getByTestId('docreview-declared-0'), { target: { value: 'minutes' } });
    fireEvent.click(screen.getByTestId('docreview-run'));

    await waitFor(() => expect(screen.getByTestId('docreview-verdict-state-min.docx')).toBeTruthy());
    expect(screen.getByTestId('docreview-verdict-state-min.docx').textContent?.toLowerCase()).toBe('confirmed');
  });

  it('runs only the option the auditor selected', async () => {
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'min.docx' }]);
    loadText.mockResolvedValue({ ok: true, text: MINUTES, status: 'done' });
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-options')).toBeTruthy());
    // Clear all, then select only the declared-type check.
    fireEvent.click(screen.getByTestId('docreview-option-toggle-all'));
    fireEvent.click(screen.getByTestId('docreview-option-doc_type'));
    fireEvent.change(screen.getByTestId('docreview-declared-0'), { target: { value: 'minutes' } });
    fireEvent.click(screen.getByTestId('docreview-run'));

    await waitFor(() => expect(screen.getByTestId('docreview-summary')).toBeTruthy());
    // One rule ran (doc.type_mismatch); the minutes/action-register section is absent.
    expect(screen.getByTestId('docreview-summary').textContent).toContain('1 rule(s) ran');
    expect(screen.queryByTestId('minutes-register')).toBeNull();
    expect(screen.queryByTestId('policydiff')).toBeNull();
  });

  it('runs the minutes register and the policy comparison when those options are selected', async () => {
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'min.docx' }]);
    loadText.mockResolvedValue({ ok: true, text: MINUTES, status: 'done' });
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-options')).toBeTruthy());
    fireEvent.change(screen.getByTestId('docreview-declared-0'), { target: { value: 'minutes' } });
    fireEvent.click(screen.getByTestId('docreview-run'));

    await waitFor(() => expect(screen.getByTestId('minutes-register')).toBeTruthy());
    expect(screen.getByTestId('policydiff')).toBeTruthy();
  });

  it('runs the structural document rules when that option is selected', async () => {
    // A minutes document whose action item never reappears: the structural document rules
    // (`documentRules`) include the absent-follow-through check, so this run must report it.
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'min.docx' }]);
    loadText.mockResolvedValue({ ok: true, text: MINUTES, status: 'done' });
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-options')).toBeTruthy());
    fireEvent.click(screen.getByTestId('docreview-option-toggle-all')); // clear all
    fireEvent.click(screen.getByTestId('docreview-option-structural'));
    fireEvent.change(screen.getByTestId('docreview-declared-0'), { target: { value: 'minutes' } });
    fireEvent.click(screen.getByTestId('docreview-run'));

    await waitFor(() => expect(screen.getByTestId('docreview-findings')).toBeTruthy());
    const rows = screen.getAllByTestId(/^docreview-finding-/);
    expect(rows.some((r) => r.textContent?.includes('doc.absent_follow_through'))).toBe(true);
  });

  it('records the run’s findings to the ledger through the data module', async () => {
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'min.docx' }]);
    loadText.mockResolvedValue({ ok: true, text: REGULATION, status: 'done' });
    recordFindings.mockResolvedValue({ ok: true });
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-file-0')).toBeTruthy());
    fireEvent.change(screen.getByTestId('docreview-declared-0'), { target: { value: 'minutes' } });
    fireEvent.click(screen.getByTestId('docreview-run'));
    await waitFor(() => expect(screen.getByTestId('docreview-record')).toBeTruthy());

    fireEvent.click(screen.getByTestId('docreview-record'));
    await waitFor(() => expect(recordFindings).toHaveBeenCalledTimes(1));
    // The engagement and the run instant are passed through; the findings are the engine's own.
    const [engagementId, evaluatedAt, findings] = recordFindings.mock.calls[0];
    expect(engagementId).toBe('e1');
    expect(typeof evaluatedAt).toBe('string');
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.map((f: { ruleId: string }) => f.ruleId)).toContain('doc.type_mismatch');
    await waitFor(() => expect(screen.getByTestId('docreview-recorded')).toBeTruthy());
  });

  it('refuses to run without perform_work, and says why', async () => {
    (userRef.current as { rights: Record<string, boolean> }).rights = {};
    (userRef.current as { role: string }).role = 'observer';
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'min.docx' }]);
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-rights-note')).toBeTruthy());
    expect((screen.getByTestId('docreview-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the empty state when the engagement has no documents', async () => {
    listFiles.mockResolvedValue([]);
    render(<DocumentReviewPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('docreview-empty')).toBeTruthy());
  });

  it('shows the no-engagement state when no engagement is selected', async () => {
    render(<DocumentReviewPanel engagementId={null} />);
    await waitFor(() => expect(screen.getByTestId('docreview-no-engagement')).toBeTruthy());
  });

  it('reports a scan (no text layer) as a scan rather than a finding', async () => {
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'scan.pdf' }]);
    loadText.mockResolvedValue({ ok: false, status: 'done', scan: true, reason: 'the extraction holds no text layer' });
    readBytes.mockResolvedValue(null);
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-file-0')).toBeTruthy());
    fireEvent.click(screen.getByTestId('docreview-run'));
    await waitFor(() => expect(screen.getByTestId('docreview-verdicts')).toBeTruthy());
    const verdict = screen.getByTestId('docreview-verdict-scan.pdf');
    expect(verdict.textContent).toContain('scan');
    expect(screen.getByTestId('docreview-verdict-state-scan.pdf').textContent?.toLowerCase()).toBe('unconfirmable');
  });

  it('reads a scan locally with the bundled OCR engine (tier 2), and flags the declared-type mismatch it reveals', async () => {
    // The stored bytes are a real PNG rendered with the engine's own font — no mock engine.
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'scan.pdf' }]);
    loadText.mockResolvedValue({ ok: false, status: 'done', scan: true, reason: 'the extraction holds no text layer' });
    readBytes.mockResolvedValue(renderTextPng(['REGULATION 12', 'CLAUSE 9']));
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-file-0')).toBeTruthy());
    // The auditor files the scan as minutes; the local read reveals it is a regulation.
    fireEvent.change(screen.getByTestId('docreview-declared-0'), { target: { value: 'minutes' } });
    fireEvent.click(screen.getByTestId('docreview-run'));

    await waitFor(() => expect(screen.getByTestId('docreview-verdict-state-scan.pdf')).toBeTruthy());
    expect(screen.getByTestId('docreview-verdict-state-scan.pdf').textContent?.toLowerCase()).toBe('discrepant');
    expect(readBytes).toHaveBeenCalledWith('f1');
  });

  it('leaves a scan unread when there are no stored bytes — never an empty document', async () => {
    listFiles.mockResolvedValue([{ id: 'f1', filename: 'scan.pdf' }]);
    loadText.mockResolvedValue({ ok: false, status: 'done', scan: true, reason: 'the extraction holds no text layer' });
    readBytes.mockResolvedValue(null);
    render(<DocumentReviewPanel engagementId="e1" />);

    await waitFor(() => expect(screen.getByTestId('docreview-file-0')).toBeTruthy());
    fireEvent.click(screen.getByTestId('docreview-run'));
    await waitFor(() => expect(screen.getByTestId('docreview-verdict-state-scan.pdf')).toBeTruthy());
    expect(screen.getByTestId('docreview-verdict-state-scan.pdf').textContent?.toLowerCase()).toBe('unconfirmable');
  });
});
