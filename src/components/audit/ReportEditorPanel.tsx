import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  composeReport,
  freezeReport,
  issueReport,
  listReportVersions,
  listReportBlocks,
  listReportComments,
  addReportComment,
  resolveReportComment,
  openReportCommentCount,
  type ReportVersionRow,
  type ReportBlockRow,
  type ReportCommentRow,
} from '../../data/reports';
import { checkCapReconciliation, type CapRow, listCaps } from '../../data/caps';
import { renderAndStoreReportFiles, type StoredReportFiles } from '../../data/reportFiles';
import { getActiveReportLayout } from '../../data/writing';
import type { FormatLayout } from '../../lib/writing/reportFormat';
import { acknowledgePreflight, listPreflightAcknowledgements, listPreflightBlocking, listPreflightItems, type PreflightItemRow } from '../../data/preflight';
import { PREFLIGHT_CHECKS, type PreflightAcknowledgement } from '../../lib/preflight';
import { hasRight } from '../../lib/rights';
import { rightReason, rightReasonFor } from '../../lib/rightLabels';
import { formatFieldPairs } from '../../lib/readable';
import { InlineError } from '../common/InlineError';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { AlertTriangle, CheckCircle2, FileText, Layers, Send } from '../common/Icons';

const SECTION_LABELS: Record<string, string> = {
  executive_summary: 'Executive Summary',
  scope: 'Scope',
  findings: 'Findings',
  opinion: 'Opinion',
  appendices: 'Appendices',
};
const SECTION_ORDER = ['executive_summary', 'scope', 'findings', 'opinion', 'appendices'];

/**
 * Report editor (6H, spec §15). Section tabs, per-block view with placeholder blocks highlighted in
 * Cinnabar, a version-history sidebar, a management-comments thread and a freeze/issue flow. The
 * open-comment gate, the CAP reconciliation gate and the hash-chained ledger live in the database
 * (0036, 0037, 0040); this panel only reads and calls the RPCs. Non-blocking throughout.
 */
export const ReportEditorPanel: React.FC<{ engagementId: string }> = ({ engagementId }) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const engagementLabel = engagementId;
  const [reportHashes, setReportHashes] = useState<StoredReportFiles | null>(null);
  const [versions, setVersions] = useState<ReportVersionRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ReportBlockRow[]>([]);
  const [comments, setComments] = useState<ReportCommentRow[]>([]);
  const [openComments, setOpenComments] = useState(0);
  const [capOk, setCapOk] = useState<boolean | null>(null);
  const [caps, setCaps] = useState<CapRow[]>([]);
  const [section, setSection] = useState('executive_summary');
  const [commentText, setCommentText] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preflightAcks, setPreflightAcks] = useState<PreflightAcknowledgement[]>([]);
  const [preflightItems, setPreflightItems] = useState<PreflightItemRow[]>([]);
  const [preflightBlocking, setPreflightBlocking] = useState<PreflightItemRow[]>([]);
  const [ackCheck, setAckCheck] = useState<string>(PREFLIGHT_CHECKS[0]);
  const [ackItem, setAckItem] = useState('');
  const [ackReason, setAckReason] = useState('');

  const canApprove = hasRight(currentUser, 'approve_plan');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vs = await listReportVersions(engagementId);
      setVersions(vs);
      const current = activeId && vs.some((v) => v.id === activeId) ? activeId : vs[0]?.id ?? null;
      setActiveId(current);
      if (current) {
        const [bs, cs, oc] = await Promise.all([
          listReportBlocks(current),
          listReportComments(current),
          openReportCommentCount(current),
        ]);
        setBlocks(bs);
        setComments(cs);
        setOpenComments(oc);
        setCapOk(await checkCapReconciliation(current));
      } else {
        setBlocks([]);
        setComments([]);
        setOpenComments(0);
        setCapOk(null);
      }
      setCaps(await listCaps(engagementId));
      setPreflightAcks(await listPreflightAcknowledgements(engagementId));
      const [items, blocking] = await Promise.all([
        listPreflightItems(engagementId),
        listPreflightBlocking(engagementId),
      ]);
      setPreflightItems(items);
      setPreflightBlocking(blocking);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the report.');
    } finally {
      setLoading(false);
    }
  }, [engagementId, activeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => versions.find((v) => v.id === activeId) ?? null, [versions, activeId]);
  const sections = useMemo(() => {
    const present = new Set(blocks.map((b) => b.sectionType));
    return SECTION_ORDER.filter((s) => present.has(s) || s === section);
  }, [blocks, section]);
  const sectionBlocks = blocks.filter((b) => b.sectionType === section);
  const placeholders = blocks.filter((b) => b.isPlaceholder);

  const compose = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await composeReport(engagementId);
    if (!res.ok) setError(res.reason);
    else {
      setActiveId(null);
      await load();
    }
    setBusy(false);
  };

  const freeze = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    if (!activeId) return setBusy(false);
    const res = await freezeReport(activeId);
    if (!res.ok) setError(res.reason);
    else {
      // §18: the frozen report is a real PDF and a real DOCX from the one block model. Store them and
      // record both hashes; a failure here is reported but the freeze itself already stands.
      try {
        await storeReportFiles(activeId);
        setNotice('Frozen. The PDF and DOCX have been rendered and their hashes recorded.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The report files could not be rendered.');
      }
      await load();
    }
    setBusy(false);
  };

  /** §11.4: record an acknowledgement of one pre-flight item, with the reason. Append-only. */
  const acknowledge = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await acknowledgePreflight(engagementId, ackCheck, ackItem.trim(), ackReason.trim());
    if (!res.ok) setError(res.reason);
    else {
      setNotice('Acknowledgement recorded.');
      setAckItem('');
      setAckReason('');
      await load();
    }
    setBusy(false);
  };

  /** Render, upload and record the frozen report's files from the current blocks. The org's active
   *  report format supplies the printed typography (WP-C3), so the frozen PDF matches the canvas. */
  const storeReportFiles = async (reportVersionId: string) => {
    if (!orgId) throw new Error('no organisation in the session');
    let layout: FormatLayout | undefined;
    try {
      layout = await getActiveReportLayout(orgId);
    } catch {
      layout = undefined;
    }
    const stored = await renderAndStoreReportFiles({
      reportVersionId,
      orgId,
      title: engagementLabel || 'Audit report',
      blocks: blocks.map((b) => ({
        sectionType: b.sectionType, blockType: b.blockType, content: b.content, position: b.position,
      })),
      engagementLabel: engagementLabel || 'Engagement',
      userLabel: currentUser?.name ?? currentUser?.email ?? 'auditor',
      frozenAt: new Date().toISOString(),
      layout,
    });
    setReportHashes(stored);
    return stored;
  };

  const issue = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    if (!activeId) return setBusy(false);
    const res = await issueReport(activeId);
    if (!res.ok) setError(res.reason);
    else {
      // §18: issuance stores the PDF and the DOCX and the ledger entry carries both hashes. The files
      // are written here as well as at freeze, so an issued report always has its binaries recorded.
      try {
        await storeReportFiles(activeId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The report files could not be rendered.');
      }
      setNotice('Email queued (pending dispatch).');
      await load();
    }
    setBusy(false);
  };

  const addComment = async () => {
    const text = commentText.trim();
    if (text.length === 0 || !activeId) return;
    setBusy(true);
    setError(null);
    const res = await addReportComment(activeId, null, text);
    if (!res.ok) setError(res.reason);
    else {
      setCommentText('');
      await load();
    }
    setBusy(false);
  };

  const resolve = async (commentId: string, status: 'incorporated' | 'rejected') => {
    const reason = reasonText.trim();
    if (reason.length === 0) {
      setError('A resolution reason is required.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await resolveReportComment(commentId, status, reason);
    if (!res.ok) setError(res.reason);
    else {
      setReasonText('');
      await load();
    }
    setBusy(false);
  };

  if (loading) {
    return <div className="h-24 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" data-testid="report-loading" />;
  }

  const frozen = active?.status === 'frozen' || active?.status === 'issued_v1';
  const canFreeze = openComments === 0 && capOk === true && preflightBlocking.length === 0;

  return (
    <div className="space-y-5" data-testid="report-editor">
      <InlineError message={error} testId="report-error" />
      {notice && (
        <div className="px-3 py-2 rounded-xl text-apple-12 bg-verdigris-subtle text-verdigris border border-verdigris" data-testid="report-notice">
          {notice}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
          <FileText className="w-3.5 h-3.5" /> Report
        </h3>
        <button
          type="button"
          data-testid="report-compose"
          onClick={compose}
          disabled={busy || !hasRight(currentUser, 'perform_work')}
          className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 flex items-center gap-1.5"
        >
          <Layers className="w-3.5 h-3.5" /> Compose new version
        </button>
      </div>

      {versions.length === 0 ? (
        <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="report-empty">
          No report version exists yet. Compose one once the conclusion is sealed.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
          <div className="space-y-4 min-w-0">
            {/* Section tabs */}
            <div role="tablist" aria-label="Report sections" className="flex flex-wrap items-center gap-1 border-b border-hairline pb-2">
              {sections.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={section === s}
                  data-testid={`report-section-${s}`}
                  onClick={() => setSection(s)}
                  className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold transition-colors ${
                    section === s ? 'bg-surface-hover text-primary' : 'text-secondary hover:text-primary'
                  }`}
                >
                  {SECTION_LABELS[s] ?? s}
                </button>
              ))}
            </div>

            {sectionBlocks.length === 0 ? (
              <div className="p-5 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="report-section-empty">
                This section has no blocks in this version.
              </div>
            ) : (
              <div className="space-y-2">
                {sectionBlocks.map((b) => (
                  <div
                    key={b.id}
                    data-testid={`report-block-${b.id}`}
                    className={`p-3 rounded-xl border ${
                      b.isPlaceholder ? 'border-cinnabar bg-cinnabar-subtle' : 'border-hairline bg-surface'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
                        {b.blockType}
                      </span>
                      {b.isPlaceholder && (
                        <span className="text-apple-11 font-semibold text-cinnabar" data-testid={`report-placeholder-${b.id}`}>
                          Missing: {String(b.content.missing ?? 'value')}
                        </span>
                      )}
                    </div>
                    <p className="text-apple-12 text-primary whitespace-pre-wrap break-words" data-testid={`report-block-content-${b.id}`}>
                      {formatFieldPairs(b.content)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Management comments */}
            <div className="p-4 rounded-2xl bg-surface border border-hairline space-y-3" data-testid="report-comments">
              <div className="text-apple-13 font-semibold text-primary flex items-center gap-2">
                Management comments
                {openComments > 0 && (
                  <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar" data-testid="report-open-comments">
                    {openComments} open
                  </span>
                )}
              </div>
              {comments.length === 0 ? (
                <div className="text-apple-12 text-secondary" data-testid="report-comments-empty">No comments yet.</div>
              ) : (
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li key={c.id} className="px-3 py-2 rounded-xl bg-surface-sunken" data-testid={`report-comment-${c.id}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-apple-12 text-primary">{c.commentText}</span>
                        <span className={`text-apple-11 font-semibold ${c.status === 'open' ? 'text-cinnabar' : 'text-verdigris'}`}>
                          {c.status}
                        </span>
                      </div>
                      {c.status === 'open' && (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            data-testid={`report-reason-${c.id}`}
                            value={reasonText}
                            onChange={(e) => setReasonText(e.target.value)}
                            placeholder="Resolution reason"
                            className="flex-1 px-2 py-1 rounded-lg bg-surface border border-hairline text-apple-12 text-primary"
                          />
                          <button type="button" data-testid={`report-incorporate-${c.id}`} onClick={() => resolve(c.id, 'incorporated')} disabled={busy} className="px-2 py-1 rounded-lg bg-surface border border-hairline text-apple-11 font-semibold text-primary disabled:opacity-50">
                            Incorporate
                          </button>
                          <button type="button" data-testid={`report-reject-${c.id}`} onClick={() => resolve(c.id, 'rejected')} disabled={busy} className="px-2 py-1 rounded-lg bg-surface border border-hairline text-apple-11 font-semibold text-primary disabled:opacity-50">
                            Reject
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-end gap-2">
                <input
                  data-testid="report-comment-input"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a management comment"
                  className="flex-1 px-3 py-2 rounded-xl bg-surface-sunken border border-hairline text-apple-12 text-primary"
                />
                <button type="button" data-testid="report-comment-add" onClick={addComment} disabled={busy || commentText.trim().length === 0} className="px-3 py-2 rounded-lg bg-surface border border-hairline text-apple-12 font-semibold text-primary disabled:opacity-50">
                  Comment
                </button>
              </div>
            </div>

            {/* Freeze / issue pre-flight */}
            <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-3" data-testid="report-freeze-panel">
              <div className="text-apple-13 font-semibold text-primary">Freeze &amp; issue</div>
              <ul className="space-y-1 text-apple-12">
                <li className={openComments === 0 ? 'text-verdigris' : 'text-cinnabar'} data-testid="report-preflight-comments">
                  {openComments === 0 ? '✓' : '✗'} {openComments} open comment{openComments === 1 ? '' : 's'}
                </li>
                <li className={capOk ? 'text-verdigris' : 'text-cinnabar'} data-testid="report-preflight-caps">
                  {capOk ? '✓' : '✗'} CAP reconciliation {capOk === null ? 'unknown' : capOk ? 'complete' : 'incomplete'}
                </li>
                <li className={preflightAcks.length === 0 ? 'text-secondary' : 'text-verdigris'} data-testid="report-preflight-acks">
                  {preflightAcks.length} acknowledged pre-flight item{preflightAcks.length === 1 ? '' : 's'}
                </li>
                <li className={preflightBlocking.length === 0 ? 'text-verdigris' : 'text-cinnabar'} data-testid="report-preflight-blocking">
                  {preflightBlocking.length === 0 ? '✓' : '✗'} {preflightItems.length} open pre-flight item{preflightItems.length === 1 ? '' : 's'}
                  {preflightBlocking.length > 0 ? `, ${preflightBlocking.length} unacknowledged` : ''}
                </li>
              </ul>
              {/* §11.4: the live open items, computed by the database (migration 0102). Clicking one
                  fills the waive form so an acknowledgement names the exact item. */}
              {preflightItems.length > 0 && (
                <ul className="space-y-1" data-testid="report-preflight-item-list">
                  {preflightItems.map((it) => {
                    const acked = !preflightBlocking.some((b) => b.check === it.check && b.itemId === it.itemId);
                    return (
                      <li key={`${it.check}:${it.itemId}`} className="flex items-start gap-2 text-apple-11">
                        <span className={acked ? 'text-verdigris' : 'text-cinnabar'}>{acked ? '✓' : '✗'}</span>
                        <button
                          type="button"
                          data-testid={`report-preflight-item-${it.check}-${it.itemId}`}
                          onClick={() => { setAckCheck(it.check); setAckItem(it.itemId); }}
                          className="text-left text-primary hover:underline"
                        >
                          <span className="font-semibold">{it.check}</span>
                          <span className="text-secondary"> — {it.detail} ({it.itemId.slice(0, 8)})</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* §11.4: an open item may be waived with a logged reason instead of blocking. */}
              <div className="space-y-2 rounded-xl border border-hairline p-3" data-testid="report-preflight-ack-form">
                <div className="text-apple-11 text-secondary">
                  Waive a pre-flight item with a reason (recorded, append-only).
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    data-testid="report-preflight-ack-check"
                    value={ackCheck}
                    onChange={(e) => setAckCheck(e.target.value)}
                    className="px-2 py-1.5 rounded-lg bg-surface-sunken border border-hairline text-apple-12 text-primary"
                  >
                    {PREFLIGHT_CHECKS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    data-testid="report-preflight-ack-item"
                    value={ackItem}
                    onChange={(e) => setAckItem(e.target.value)}
                    placeholder="Item id"
                    className="px-2 py-1.5 rounded-lg bg-surface-sunken border border-hairline text-apple-12 text-primary"
                  />
                  <input
                    data-testid="report-preflight-ack-reason"
                    value={ackReason}
                    onChange={(e) => setAckReason(e.target.value)}
                    placeholder="Reason (min 10 characters)"
                    className="flex-1 px-2 py-1.5 rounded-lg bg-surface-sunken border border-hairline text-apple-12 text-primary"
                  />
                  <button
                    type="button"
                    data-testid="report-preflight-ack-submit"
                    onClick={acknowledge}
                    disabled={busy || ackItem.trim().length === 0 || ackReason.trim().length < 10}
                    className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50"
                  >
                    Record acknowledgement
                  </button>
                </div>
              </div>
              {!canFreeze && (
                <div className="px-3 py-2 rounded-xl text-apple-12 text-cinnabar bg-cinnabar-subtle border border-cinnabar flex items-start gap-2" data-testid="report-freeze-blocked">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Freeze is blocked until there are no open comments, CAP reconciliation passes and every pre-flight item is acknowledged.</span>
                </div>
              )}
              {caps.length === 0 && (
                <div className="text-apple-11 text-secondary" data-testid="report-caps-note">
                  No CAP rows exist for this engagement yet.
                </div>
              )}
              <div className="flex items-center gap-2">
                <HoldToConfirm
                  label="Hold to freeze"
                  testId="report-freeze"
                  disabled={busy || !canApprove || !canFreeze || frozen}
                  onConfirm={freeze}
                />
                <HoldToConfirm
                  label="Issue report"
                  testId="report-issue"
                  durationMs={2000}
                  onConfirm={issue}
                  disabled={busy || !canApprove || active?.status !== 'frozen'}
                  className="relative overflow-hidden px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" /> Issue report
                </HoldToConfirm>
              </div>
              {!canApprove && (
                <div className="text-apple-11 text-secondary" data-testid="report-rights-note">
                  Freeze and issue: {rightReason('approve_plan')}
                </div>
              )}
              {reportHashes && (
                <div className="space-y-0.5 text-apple-11 text-secondary" data-testid="report-files">
                  <div data-testid="report-file-pdf">
                    Frozen PDF: {reportHashes.pdf.sha256.slice(0, 16)}… ({reportHashes.pdf.bytes} bytes)
                  </div>
                  <div data-testid="report-file-docx">
                    Editable DOCX: {reportHashes.docx.sha256.slice(0, 16)}… ({reportHashes.docx.bytes} bytes)
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Version history sidebar */}
          <aside className="border border-hairline rounded-xl bg-surface overflow-hidden h-fit" data-testid="report-versions">
            <div className="px-3 py-2 text-apple-11 font-semibold text-secondary uppercase tracking-wider border-b border-hairline">
              Versions
            </div>
            <ul className="divide-y divide-hairline">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    data-testid={`report-version-${v.id}`}
                    onClick={() => setActiveId(v.id)}
                    className={`w-full text-left px-3 py-2 text-apple-12 transition-colors ${
                      activeId === v.id ? 'bg-surface-hover text-primary' : 'text-secondary hover:text-primary'
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <span>v{v.versionNumber}</span>
                      <span className="text-apple-11 capitalize">{v.status.replace(/_/g, ' ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {placeholders.length > 0 && (
              <div className="px-3 py-2 border-t border-hairline text-apple-11 text-cinnabar flex items-center gap-1.5" data-testid="report-placeholder-count">
                <CheckCircle2 className="w-3 h-3" /> {placeholders.length} placeholder block{placeholders.length === 1 ? '' : 's'}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};
