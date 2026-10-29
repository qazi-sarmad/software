import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { holdToConfirm } from '../../test/holdToConfirm';

const composeFn = vi.fn();
const freezeFn = vi.fn();
const issueFn = vi.fn();
const listVersions = vi.fn();
const listBlocks = vi.fn();
const listComments = vi.fn();
const addComment = vi.fn();
const resolveComment = vi.fn();
const openCount = vi.fn();

vi.mock('../../data/reports', () => ({
  composeReport: (...a: unknown[]) => composeFn(...a),
  freezeReport: (...a: unknown[]) => freezeFn(...a),
  issueReport: (...a: unknown[]) => issueFn(...a),
  listReportVersions: () => listVersions(),
  listReportBlocks: () => listBlocks(),
  listReportComments: () => listComments(),
  addReportComment: (...a: unknown[]) => addComment(...a),
  resolveReportComment: (...a: unknown[]) => resolveComment(...a),
  openReportCommentCount: () => openCount(),
}));

const listCapsFn = vi.fn();
const updateCapFn = vi.fn();
const closeCapFn = vi.fn();
const checkCapFn = vi.fn();

vi.mock('../../data/caps', () => ({
  listCaps: () => listCapsFn(),
  updateCap: (...a: unknown[]) => updateCapFn(...a),
  closeCap: (...a: unknown[]) => closeCapFn(...a),
  checkCapReconciliation: () => checkCapFn(),
}));

const listAcksFn = vi.fn();
const ackFn = vi.fn();
const listPreflightItemsFn = vi.fn();
const listPreflightBlockingFn = vi.fn();
vi.mock('../../data/preflight', () => ({
  listPreflightAcknowledgements: () => listAcksFn(),
  acknowledgePreflight: (...a: unknown[]) => ackFn(...a),
  listPreflightItems: () => listPreflightItemsFn(),
  listPreflightBlocking: () => listPreflightBlockingFn(),
}));

// The claim-graph readback (getReportGraph) and the footer preview (reportFooterPreview) are the two
// reads this panel gained; mock them so the wiring is asserted without the real renderers.
const commitGraphFn = vi.fn();
const getGraphFn = vi.fn();
vi.mock('../../data/reportGraph', () => ({
  commitReportGraph: (...a: unknown[]) => commitGraphFn(...a),
  getReportGraph: (...a: unknown[]) => getGraphFn(...a),
}));

const renderStoreFn = vi.fn();
const footerPreviewFn = vi.fn();
vi.mock('../../data/reportFiles', () => ({
  renderAndStoreReportFiles: (...a: unknown[]) => renderStoreFn(...a),
  reportFooterPreview: (...a: unknown[]) => footerPreviewFn(...a),
}));

const userRef = { current: { role: 'cia', orgId: 'org-1', rights: { perform_work: true, review_and_approve: true, approve_plan: true } } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { ReportEditorPanel } from './ReportEditorPanel';
import { CapRegisterPanel } from './CapRegisterPanel';

const approver = { role: 'cia', orgId: 'org-1', rights: { perform_work: true, review_and_approve: true, approve_plan: true } };
const preparer = { role: 'preparer', orgId: 'org-1', rights: { perform_work: true } };

const version = { id: 'v1', engagementId: 'e1', versionNumber: 1, status: 'draft' as const, frozenAt: null, issuedAt: null, createdAt: null };
const block = { id: 'b1', reportVersionId: 'v1', sectionType: 'executive_summary', blockType: 'text' as const, content: { findings: 2 }, position: 0, isPlaceholder: false, editedAt: null, editedBy: null };
const placeholderBlock = { ...block, id: 'b2', sectionType: 'opinion', content: { missing: 'overall_opinion' }, position: 1, isPlaceholder: true };

describe('Phase 6 UI panels (6H)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = approver as never;
    composeFn.mockResolvedValue({ ok: true });
    freezeFn.mockResolvedValue({ ok: true });
    issueFn.mockResolvedValue({ ok: true });
    listVersions.mockResolvedValue([version]);
    listBlocks.mockResolvedValue([block, placeholderBlock]);
    listComments.mockResolvedValue([]);
    addComment.mockResolvedValue({ ok: true });
    resolveComment.mockResolvedValue({ ok: true });
    openCount.mockResolvedValue(0);
    checkCapFn.mockResolvedValue(true);
    listCapsFn.mockResolvedValue([]);
    updateCapFn.mockResolvedValue({ ok: true });
    closeCapFn.mockResolvedValue({ ok: true });
    listAcksFn.mockResolvedValue([]);
    ackFn.mockResolvedValue({ ok: true });
    listPreflightItemsFn.mockResolvedValue([]);
    listPreflightBlockingFn.mockResolvedValue([]);
    commitGraphFn.mockResolvedValue(undefined);
    getGraphFn.mockResolvedValue({ graphs: [], claims: [] });
    renderStoreFn.mockResolvedValue({
      pdf: { path: 'org/reports/v1.pdf', sha256: 'a'.repeat(64), bytes: 1200 },
      docx: { path: 'org/reports/v1.docx', sha256: 'b'.repeat(64), bytes: 3400 },
    });
    footerPreviewFn.mockReturnValue('Engagement · exported 2026-10-27 · auditor · bbbbbbbbbbbb');
  });

  describe('ReportEditorPanel', () => {
    it('shows a designed empty state when there is no version', async () => {
      listVersions.mockResolvedValue([]);
      render(<ReportEditorPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('report-empty')).toBeTruthy());
    });

    it('renders section tabs, blocks and highlights a placeholder in cinnabar', async () => {
      render(<ReportEditorPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('report-block-b1')).toBeTruthy());
      fireEvent.click(screen.getByTestId('report-section-opinion'));
      await waitFor(() => expect(screen.getByTestId('report-block-b2')).toBeTruthy());
      expect(screen.getByTestId('report-placeholder-b2').textContent).toContain('overall_opinion');
    });

    it('lists versions and switches the active version', async () => {
      const v2 = { ...version, id: 'v2', versionNumber: 2, status: 'frozen' as const };
      listVersions.mockResolvedValue([v2, version]);
      render(<ReportEditorPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('report-version-v1')).toBeTruthy());
      fireEvent.click(screen.getByTestId('report-version-v1'));
      await waitFor(() => expect(listBlocks).toHaveBeenCalled());
    });

    it('blocks freeze while comments are open and shows the pre-flight banner', async () => {
      openCount.mockResolvedValue(2);
      render(<ReportEditorPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('report-freeze-blocked')).toBeTruthy());
      expect((screen.getByTestId('report-freeze') as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId('report-preflight-comments').textContent).toContain('2 open');
    });

    it('issues the report and shows the queued-email notice', async () => {
      listVersions.mockResolvedValue([{ ...version, status: 'frozen' as const }]);
      render(<ReportEditorPanel engagementId="e1" />);
      // The panel loads twice: once with no version selected, then again once it selects the first
      // version. Wait for both loads to finish (listCaps is each load's last call) and for the
      // button to be enabled, or the hold can land on a button a re-render is about to unmount.
      await waitFor(() => expect(listCapsFn).toHaveBeenCalledTimes(2));
      let btn!: HTMLButtonElement;
      await waitFor(() => {
        btn = screen.getByTestId('report-issue') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
      });
      vi.useFakeTimers();
      holdToConfirm(btn);
      vi.useRealTimers();
      await waitFor(() => expect(issueFn).toHaveBeenCalledWith('v1'));
      await waitFor(() => expect(screen.getByTestId('report-notice').textContent).toContain('Email queued'));
    });

    it('adds a management comment', async () => {
      render(<ReportEditorPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('report-comment-input')).toBeTruthy());
      fireEvent.change(screen.getByTestId('report-comment-input'), { target: { value: 'Tighten the wording' } });
      fireEvent.click(screen.getByTestId('report-comment-add'));
      await waitFor(() => expect(addComment).toHaveBeenCalledWith('v1', null, 'Tighten the wording'));
    });

    it('requires a resolution reason before incorporating a comment', async () => {
      listComments.mockResolvedValue([
        { id: 'c1', reportVersionId: 'v1', blockId: null, commentText: 'Fix', commenterId: 'u1', status: 'open' as const, resolutionReason: null, createdAt: null, resolvedAt: null, resolvedBy: null },
      ]);
      openCount.mockResolvedValue(1);
      render(<ReportEditorPanel engagementId="e1" />);
      const inc = await screen.findByTestId('report-incorporate-c1');
      fireEvent.click(inc);
      await waitFor(() => expect(screen.getByTestId('report-error').textContent).toContain('resolution reason'));
      expect(resolveComment).not.toHaveBeenCalled();
    });

    it('disables freeze and issue without the approve_plan right', async () => {
      userRef.current = preparer as never;
      render(<ReportEditorPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('report-rights-note')).toBeTruthy());
      expect((screen.getByTestId('report-freeze') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId('report-issue') as HTMLButtonElement).disabled).toBe(true);
    });

    it('§11.4 records a pre-flight acknowledgement with a reason and shows it', async () => {
      listAcksFn.mockResolvedValue([{ check: 'missing_evidence', itemId: 'ev-1', reason: 'waived by the manager', acknowledgedBy: 'u1', acknowledgedAt: '2026-10-26T00:00:00Z' }]);
      render(<ReportEditorPanel engagementId="e1" />);
      // The panel loads twice (see the note above): wait for both loads so the form is not unmounted
      // for `report-loading` between the change events, which loses the item value on a slow runner.
      await waitFor(() => expect(listCapsFn).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByTestId('report-preflight-ack-form')).toBeTruthy());
      // The count reflects the store.
      expect(screen.getByTestId('report-preflight-acks').textContent).toContain('1 acknowledged');
      fireEvent.change(screen.getByTestId('report-preflight-ack-check'), { target: { value: 'unresolved_flags' } });
      fireEvent.change(screen.getByTestId('report-preflight-ack-item'), { target: { value: 'f-1' } });
      fireEvent.change(screen.getByTestId('report-preflight-ack-reason'), { target: { value: 'accepted by the manager' } });
      fireEvent.click(screen.getByTestId('report-preflight-ack-submit'));
      await waitFor(() => expect(ackFn).toHaveBeenCalledWith('e1', 'unresolved_flags', 'f-1', 'accepted by the manager'));
    });

    it('§11.4 keeps the acknowledgement disabled until a long-enough reason is present', async () => {
      render(<ReportEditorPanel engagementId="e1" />);
      await waitFor(() => expect(listCapsFn).toHaveBeenCalledTimes(2));
      const submit = await screen.findByTestId('report-preflight-ack-submit');
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByTestId('report-preflight-ack-item'), { target: { value: 'f-1' } });
      fireEvent.change(screen.getByTestId('report-preflight-ack-reason'), { target: { value: 'short' } });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByTestId('report-preflight-ack-reason'), { target: { value: 'a sufficiently long reason' } });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
    });

    it('§15.6 reads back the committed claim graph and shows its root and claims', async () => {
      getGraphFn.mockResolvedValue({
        graphs: [{
          id: 'g1', modelId: 'm1', formality: 3, tone: 3, voice: 'active', locale: 'en-GB',
          graphRoot: 'f'.repeat(64), renderHash: 'f'.repeat(64), engineVersion: 'v1',
          templateVersion: 't1', phraseLibraryVersion: 'p1', fixedTimestamp: '2026-10-27T00:00:00Z',
          claimCount: 2, ledgerSeq: 41,
        }],
        claims: [
          { claimId: 'c1', sectionId: 'findings', position: 0, kind: 'count', claimLevel: 'section', phraseId: null, phraseVersion: null, claimHash: '1'.repeat(64) },
          { claimId: 'c2', sectionId: 'opinion', position: 1, kind: 'text', claimLevel: 'section', phraseId: null, phraseVersion: null, claimHash: '2'.repeat(64) },
        ],
      });
      render(<ReportEditorPanel engagementId="e1" />);
      // The read is issued for the selected version; it is the drilldown from the report to its claims.
      await waitFor(() => expect(getGraphFn).toHaveBeenCalledWith('v1'));
      await waitFor(() => expect(screen.getByTestId('report-graph-root')).toBeTruthy());
      expect(screen.getByTestId('report-graph-root').textContent).toContain('ledger #41');
      expect(screen.getByTestId('report-graph-claim-count').textContent).toContain('2 claims');
      expect(screen.getByTestId('report-graph-claim-c1')).toBeTruthy();
      expect(screen.getByTestId('report-graph-claim-c2')).toBeTruthy();
    });

    it('§15.6 shows a designed empty state when no graph has been committed', async () => {
      render(<ReportEditorPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('report-graph-empty')).toBeTruthy());
    });

    it('§18 shows the exact printed footer after a freeze renders the files', async () => {
      render(<ReportEditorPanel engagementId="e1" />);
      await waitFor(() => expect(listCapsFn).toHaveBeenCalledTimes(2));
      let btn!: HTMLButtonElement;
      await waitFor(() => {
        btn = screen.getByTestId('report-freeze') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
      });
      vi.useFakeTimers();
      holdToConfirm(btn);
      vi.useRealTimers();
      await waitFor(() => expect(renderStoreFn).toHaveBeenCalledTimes(1));
      // The preview is derived from the same input and the stored DOCX hash, so the screen and the
      // file's printed footer cannot disagree.
      await waitFor(() => expect(screen.getByTestId('report-footer-preview')).toBeTruthy());
      expect(footerPreviewFn).toHaveBeenCalledWith(expect.objectContaining({ reportVersionId: 'v1' }), 'b'.repeat(64));
      expect(screen.getByTestId('report-footer-preview').textContent).toContain('Printed footer:');
    });
  });

  describe('CapRegisterPanel', () => {
    const cap = {
      id: 'cap1', reportId: 'r1', engagementId: 'e1', findingId: 'f1', issueId: null,
      responsibleDept: 'Finance', dueDate: '2026-03-01', actionDescription: null,
      remediationEvidence: null, status: 'open' as const, verifiedAt: null, verifiedBy: null,
    };

    it('shows a designed empty state', async () => {
      render(<CapRegisterPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('cap-empty')).toBeTruthy());
    });

    it('records an update', async () => {
      listCapsFn.mockResolvedValue([cap]);
      render(<CapRegisterPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getByTestId('cap-cap1')).toBeTruthy());
      fireEvent.change(screen.getByTestId('cap-action-cap1'), { target: { value: 'Approved' } });
      fireEvent.click(screen.getByTestId('cap-update-cap1'));
      await waitFor(() => expect(updateCapFn).toHaveBeenCalledWith('cap1', 'Approved', ''));
    });

    it('closes a CAP with review and refuses without the right', async () => {
      listCapsFn.mockResolvedValue([cap]);
      render(<CapRegisterPanel engagementId="e1" />);
      const btn = await screen.findByTestId('cap-close-cap1');
      vi.useFakeTimers();
      holdToConfirm(btn);
      vi.useRealTimers();
      await waitFor(() => expect(closeCapFn).toHaveBeenCalledWith('cap1', true, false));

      userRef.current = preparer as never;
      render(<CapRegisterPanel engagementId="e1" />);
      await waitFor(() => expect(screen.getAllByTestId('cap-close-cap1')[1] as HTMLButtonElement).toBeTruthy());
      expect((screen.getAllByTestId('cap-close-cap1')[1] as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
