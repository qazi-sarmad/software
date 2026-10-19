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

const userRef = { current: { role: 'cia', rights: { perform_work: true, review_and_approve: true, approve_plan: true } } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { ReportEditorPanel } from './ReportEditorPanel';
import { CapRegisterPanel } from './CapRegisterPanel';

const approver = { role: 'cia', rights: { perform_work: true, review_and_approve: true, approve_plan: true } };
const preparer = { role: 'preparer', rights: { perform_work: true } };

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
