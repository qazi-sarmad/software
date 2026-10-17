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
import { hasRight } from '../../lib/rights';
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
    else await load();
    setBusy(false);
  };

  const issue = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    if (!activeId) return setBusy(false);
    const res = await issueReport(activeId);
    if (!res.ok) setError(res.reason);
    else {
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
  const canFreeze = openComments === 0 && capOk === true;

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
          No report version exists yet. Compose one once the conclusion is signed off.
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
                    <pre className="text-apple-12 text-primary whitespace-pre-wrap font-mono break-words">
                      {JSON.stringify(b.content)}
                    </pre>
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
              </ul>
              {!canFreeze && (
                <div className="px-3 py-2 rounded-xl text-apple-12 text-cinnabar bg-cinnabar-subtle border border-cinnabar flex items-start gap-2" data-testid="report-freeze-blocked">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Freeze is blocked until there are no open comments and CAP reconciliation passes.</span>
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
                <button
                  type="button"
                  data-testid="report-issue"
                  onClick={issue}
                  disabled={busy || !canApprove || active?.status !== 'frozen'}
                  className="px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Issue report
                </button>
              </div>
              {!canApprove && (
                <div className="text-apple-11 text-secondary" data-testid="report-rights-note">
                  Freeze and issue need the approve_plan right.
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
