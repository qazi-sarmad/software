import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listObs = vi.fn();
const listIss = vi.fn();
const listSev = vi.fn();
const promote = vi.fn();
const createIss = vi.fn();
const missing = vi.fn();

vi.mock('../../data/observations', () => ({
  MANDATORY_SECTIONS: ['context', 'condition', 'effect', 'risk'],
  listObservations: () => listObs(),
  listIssues: () => listIss(),
  listSeverityLevels: () => listSev(),
  promoteToFinding: (...a: unknown[]) => promote(...a),
  createIssue: (...a: unknown[]) => createIss(...a),
  missingReadabilitySections: (...a: unknown[]) => missing(...a),
}));

const getConc = vi.fn();
const pullExc = vi.fn();
const signConc = vi.fn();
const testingOk = vi.fn();

vi.mock('../../data/conclusion', () => ({
  getConclusion: () => getConc(),
  pullExceptions: (...a: unknown[]) => pullExc(...a),
  signConclusion: (...a: unknown[]) => signConc(...a),
  testingSignedOff: () => testingOk(),
}));

const searchDocs = vi.fn();
const listFiles = vi.fn();
const requestExtract = vi.fn();

vi.mock('../../data/documents', () => ({
  isDocumentStage: (v: unknown) => v === 'planning' || v === 'testing' || v === 'conclusion',
  searchDocuments: (...a: unknown[]) => searchDocs(...a),
  listEvidenceFiles: () => listFiles(),
  requestExtraction: (...a: unknown[]) => requestExtract(...a),
}));

const userRef = { current: { role: 'cia', rights: { perform_work: true, review_and_approve: true } } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { FindingsPanel } from './FindingsPanel';
import { ConclusionPanel } from './ConclusionPanel';
import { DocumentViewerPanel } from './DocumentViewerPanel';

const writer = { role: 'cia', rights: { perform_work: true, review_and_approve: true } };
const reader = { role: 'observer', rights: { read_only: true } };

const obs = {
  id: 'o1', engagementId: 'e1', workpaperId: null, title: 'Missing approval',
  sections: { context: 'c', condition: 'k', effect: 'e', risk: 'r' },
  status: 'draft' as const, submittedAt: null, submittedBy: null,
};

describe('Phase 5 UI panels (5G)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = writer as never;
    listObs.mockResolvedValue([]);
    listIss.mockResolvedValue([]);
    listSev.mockResolvedValue([]);
    promote.mockResolvedValue({ ok: true });
    createIss.mockResolvedValue({ ok: true });
    missing.mockResolvedValue([]);
    getConc.mockResolvedValue(null);
    pullExc.mockResolvedValue({ ok: true });
    signConc.mockResolvedValue({ ok: true });
    testingOk.mockResolvedValue(true);
    searchDocs.mockResolvedValue([]);
    listFiles.mockResolvedValue([]);
    requestExtract.mockResolvedValue({ ok: true });
  });

  describe('FindingsPanel', () => {
    it('shows a designed empty state when there are no observations', async () => {
      render(<FindingsPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('findings-empty')).toBeTruthy());
      expect(screen.getByTestId('issues-empty')).toBeTruthy();
    });

    it('renders an observation card and promotes when readability passes', async () => {
      listObs.mockResolvedValue([obs]);
      render(<FindingsPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('observation-o1')).toBeTruthy());
      fireEvent.click(screen.getByTestId('observation-o1').querySelector('button')!);
      const btn = await screen.findByTestId('observation-promote-o1');
      expect((btn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(btn);
      await waitFor(() => expect(promote).toHaveBeenCalledWith('o1', null));
    });

    it('disables promote with an inline list of missing sections', async () => {
      listObs.mockResolvedValue([obs]);
      missing.mockResolvedValue(['effect', 'risk']);
      render(<FindingsPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('observation-o1')).toBeTruthy());
      fireEvent.click(screen.getByTestId('observation-o1').querySelector('button')!);
      await waitFor(() => expect(screen.getByTestId('observation-missing-o1')).toBeTruthy());
      expect((screen.getByTestId('observation-promote-o1') as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables promote without the perform_work right', async () => {
      userRef.current = reader as never;
      listObs.mockResolvedValue([obs]);
      render(<FindingsPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('observation-o1')).toBeTruthy());
      fireEvent.click(screen.getByTestId('observation-o1').querySelector('button')!);
      expect(((await screen.findByTestId('observation-promote-o1')) as HTMLButtonElement).disabled).toBe(true);
    });

    it('surfaces a load error inline', async () => {
      listObs.mockRejectedValue(new Error('nope'));
      render(<FindingsPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('findings-error').textContent).toContain('nope'));
    });
  });

  describe('ConclusionPanel', () => {
    it('blocks pull and sign when Testing is not signed off', async () => {
      testingOk.mockResolvedValue(false);
      render(<ConclusionPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('conclusion-panel')).toBeTruthy());
      expect(screen.getByTestId('conclusion-preflight').textContent).toContain('Testing must be signed off');
      expect((screen.getByTestId('conclusion-pull') as HTMLButtonElement).disabled).toBe(true);
    });

    it('pulls exceptions and lists them', async () => {
      getConc.mockResolvedValue({
        id: 'c1', engagementId: 'e1',
        exceptions: [{ workpaper_row_id: 'r1', row_ref: 'R-1', result: 'cross', rationale: 'no evidence' }],
        exceptionsPulledAt: '2026-01-01T00:00:00Z', overallOpinion: null,
        preparedBy: 'u1', signedOffAt: null, signedOffBy: null, lockedAt: null,
      });
      render(<ConclusionPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('conclusion-exceptions')).toBeTruthy());
      expect(screen.getByTestId('conclusion-exception-0').textContent).toContain('R-1');
    });

    it('signs the conclusion when Testing is signed off and exceptions exist', async () => {
      getConc.mockResolvedValue({
        id: 'c1', engagementId: 'e1', exceptions: [{ workpaper_row_id: 'r1' }],
        exceptionsPulledAt: null, overallOpinion: 'Adequate', preparedBy: 'u1',
        signedOffAt: null, signedOffBy: null, lockedAt: null,
      });
      render(<ConclusionPanel engagementId="e1" />);
      const btn = await screen.findByTestId('conclusion-sign');
      expect((btn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(btn);
      await waitFor(() => expect(signConc).toHaveBeenCalledWith('e1'));
    });

    it('shows the sealed state once locked', async () => {
      getConc.mockResolvedValue({
        id: 'c1', engagementId: 'e1', exceptions: [], exceptionsPulledAt: null,
        overallOpinion: 'Adequate', preparedBy: 'u1', signedOffAt: '2026-01-02T00:00:00Z',
        signedOffBy: 'u2', lockedAt: '2026-01-02T00:00:00Z',
      });
      render(<ConclusionPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('conclusion-locked')).toBeTruthy());
    });
  });

  describe('DocumentViewerPanel', () => {
    it('renders a non-blocking panel with a stage tablist and a toggleable list', async () => {
      render(<DocumentViewerPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('document-viewer')).toBeTruthy());
      expect(screen.getByTestId('document-list')).toBeTruthy();
      expect(screen.getByTestId('document-stage-planning').getAttribute('aria-selected')).toBe('true');
      fireEvent.click(screen.getByTestId('document-list-toggle'));
      await waitFor(() => expect(screen.queryByTestId('document-list')).not.toBeTruthy());
    });

    it('searches documents and lists hits', async () => {
      searchDocs.mockResolvedValue([
        { fileId: 'f1', extractionId: 'x1', filename: 'scope.pdf', pageCount: 3, status: 'done', snippet: 'scope' },
      ]);
      render(<DocumentViewerPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('document-hit-f1')).toBeTruthy());
      fireEvent.change(screen.getByTestId('document-search'), { target: { value: 'scope' } });
      await waitFor(() => expect(searchDocs).toHaveBeenLastCalledWith('e1', 'scope', 'planning'));
    });

    it('queues extraction for a pending document', async () => {
      searchDocs.mockResolvedValue([
        { fileId: 'f2', extractionId: null, filename: 'x.pdf', pageCount: null, status: 'pending', snippet: null },
      ]);
      render(<DocumentViewerPanel engagementId="e1" />);
      const btn = await screen.findByTestId('document-extract-f2');
      fireEvent.click(btn);
      await waitFor(() => expect(requestExtract).toHaveBeenCalledWith('f2'));
    });
  });
});
