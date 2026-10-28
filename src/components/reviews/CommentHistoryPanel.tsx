import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { useDrilldown } from '../../hooks/useDrilldown';
import { ReviewComment, WorkingPaper } from '../../types';
import { commentPopout } from '../../lib/commentPopout';
import { getOrgLocalToday } from '../../lib/orgDate';
import { DrilldownPanel } from '../explain/DrilldownPanel';
import { CommentPopout } from './CommentPopout';
import {
  MessageSquare,
  Send,
  CheckCircle2,
  FileText,
  ExternalLink,
  Search,
} from '../common/Icons';

/**
 * Review comment history and popout (S21; docs/EXPLAIN-LAYER.md §2, §4).
 *
 * The live review-comment surface (the dead `ReviewCommentsDock` was deleted in U14). It renders
 * either one comment's dialogue or the full review trail, each row carrying the access-filtered
 * `CommentPopout`, and the status counts drill to the exact comments behind them via the shared
 * `DrilldownPanel`. Non-blocking throughout: no modal, no scrim.
 *
 * Every element carries a `CH-07-*` testid (S21 fixed the single bare `bubble-mine`/`bubble-other`).
 * The data comes from `useScopedData`, which has already filtered every row through
 * `src/lib/access.ts`, so the panel cannot show a comment the session may not see (Law L2).
 */
const SCREEN_ID = 'CH-07';

interface CommentPanelProps {
  data?: {
    comment?: ReviewComment;
    workpaper?: WorkingPaper;
  } | null;
  onClose?: () => void;
}

export const CommentHistoryPanel: React.FC<CommentPanelProps> = ({ data }) => {
  const { currentUser, openInspector } = useApp();
  const { scopedComments, scopedWorkpapers, scopedEngagements } = useScopedData();
  const drill = useDrilldown();
  const today = getOrgLocalToday();

  // If a single comment was passed in data, single mode; otherwise full history across all cycles (§ 3.5)
  const isSingleCommentMode = Boolean(data?.comment);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'cleared'>('all');
  const [cycleFilter, setCycleFilter] = useState<string>('all');
  const [expandedCommentId, setExpandedCommentId] = useState<string | null>(
    data?.comment ? data.comment.id : null
  );

  // Single comment reply state
  const [replyText, setReplyText] = useState('');

  // Cycle assignment derived from the comment date for multi-cycle history
  const getCycleTag = (dateStr: string) => {
    const d = new Date(dateStr);
    const m = d.getMonth();
    const y = d.getFullYear();
    if (y < 2026) return '2025 Annual Cycle';
    if (m >= 6 && m <= 8) return 'Q3 2026 Cycle';
    if (m >= 3 && m <= 5) return 'Q2 2026 Cycle';
    return 'Q1 2026 Cycle';
  };

  const handleSendReply = (cmt: ReviewComment) => {
    if (!replyText.trim()) return;

    const newReply = {
      id: `rep-${Date.now()}`,
      authorName: currentUser.name,
      text: replyText.trim(),
      createdAt: new Date().toISOString(),
    };

    if (!cmt.replies) {
      cmt.replies = [];
    }
    cmt.replies.push(newReply);
    setReplyText('');
  };

  // Filtered comments for full history mode
  const filteredComments = useMemo(
    () =>
      scopedComments.filter((c) => {
        if (statusFilter !== 'all') {
          const cleared = c.status === 'cleared' || (!c.status && c.resolved);
          if (statusFilter === 'cleared' && !cleared) return false;
          if (statusFilter === 'open' && cleared) return false;
        }
        const cycle = getCycleTag(c.createdAt);
        if (cycleFilter !== 'all' && cycle !== cycleFilter) return false;

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchesText = c.text.toLowerCase().includes(q);
          const matchesAuthor = c.authorName.toLowerCase().includes(q);
          const wp = scopedWorkpapers.find((w) => w.id === c.workpaperId);
          const matchesWp = wp ? wp.refCode.toLowerCase().includes(q) || wp.title.toLowerCase().includes(q) : false;
          if (!matchesText && !matchesAuthor && !matchesWp) return false;
        }
        return true;
      }),
    [scopedComments, scopedWorkpapers, statusFilter, cycleFilter, searchQuery]
  );

  const openCount = scopedComments.filter((c) => !(c.status === 'cleared' || (!c.status && c.resolved))).length;
  const clearedCount = scopedComments.length - openCount;

  const rows = isSingleCommentMode ? (data?.comment ? [data.comment] : []) : filteredComments;

  // The drilldown reads the SAME rows the counts are taken from, so a count and its drilldown
  // cannot disagree (E5/U1). The `comments` family is the exact filtered comments.
  const drillSource = useMemo(
    () => ({
      entities: [],
      engagements: scopedEngagements,
      issues: [],
      workpapers: scopedWorkpapers,
      caps: [],
      observations: [],
      comments: filteredComments,
    }),
    [scopedEngagements, scopedWorkpapers, filteredComments]
  );

  return (
    <div data-testid={`${SCREEN_ID}-comment-history`} className="space-y-6">
      {/* Header */}
      <div className="border-b border-hairline pb-4">
        <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">
          {isSingleCommentMode ? 'Reviewer Query & Dialogue' : 'Independent Review Trail'}
        </span>
        <h3 className="text-apple-20 font-bold text-primary mt-1">
          {isSingleCommentMode
            ? `Workpaper ${data?.workpaper?.refCode || data?.comment?.workpaperId}`
            : 'Comprehensive Review Comment History'}
        </h3>
        <p className="text-apple-12 text-secondary mt-1">
          {isSingleCommentMode
            ? data?.workpaper?.title
            : 'Permanent archive of supervisor notes, peer clearances, and auditor dialogues across all cycles.'}
        </p>
      </div>

      {/* Full History Mode Filters (§ 3.5: "cycle tag, resolved/open chips, replies") */}
      {!isSingleCommentMode && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2.5">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-secondary absolute left-3 top-2.5 stroke-[1.5]" />
              <input
                type="text"
                data-testid={`${SCREEN_ID}-comment-search`}
                placeholder="Search comments, author, or workpaper..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-apple-12 rounded-xl bg-surface-elevated border border-hairline text-primary placeholder:text-tertiary outline-none focus:border-accent"
              />
            </div>

            {/* Cycle Selector */}
            <select
              data-testid={`${SCREEN_ID}-comment-cycle-filter`}
              value={cycleFilter}
              onChange={(e) => setCycleFilter(e.target.value)}
              className="h-8 px-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-12 text-secondary outline-none cursor-pointer"
            >
              <option value="all">All Audit Cycles</option>
              <option value="Q3 2026 Cycle">Q3 2026 Cycle</option>
              <option value="Q2 2026 Cycle">Q2 2026 Cycle</option>
              <option value="2025 Annual Cycle">2025 Annual Cycle</option>
            </select>

            {/* Status Pills — the counts drill to the exact comments behind them (E5/U1) */}
            <div className="flex items-center gap-1 bg-surface-elevated p-0.5 rounded-xl border border-hairline">
              <button
                type="button"
                data-testid={`${SCREEN_ID}-comment-status-all`}
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-apple-11 font-medium transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-surface text-primary shadow-xs font-semibold'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                All ({scopedComments.length})
              </button>
              <button
                type="button"
                data-testid="CH-07-comment-status-open"
                data-drill-kind="comments"
                onClick={() =>
                  drill.open({
                    kind: 'comments',
                    label: 'Open review comments',
                    filterSummary: 'Review comments not yet cleared, within your scope.',
                  })
                }
                className={`px-2.5 py-1 rounded-lg text-apple-11 font-medium transition-colors ${
                  statusFilter === 'open'
                    ? 'bg-surface text-cinnabar shadow-xs font-semibold'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                Open ({openCount})
              </button>
              <button
                type="button"
                data-testid={`${SCREEN_ID}-comment-status-cleared`}
                onClick={() => setStatusFilter('cleared')}
                className={`px-2.5 py-1 rounded-lg text-apple-11 font-medium transition-colors ${
                  statusFilter === 'cleared'
                    ? 'bg-surface text-verdigris shadow-xs font-semibold'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                Cleared ({clearedCount})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The exact comments behind a count (E5/U1). Non-blocking: a complementary panel. */}
      {drill.target && (
        <DrilldownPanel
          target={drill.target}
          source={drillSource}
          screenId="CH-07"
          onOpenRecord={(_kind, id) => {
            const cmt = scopedComments.find((c) => c.id === id);
            const wp = cmt ? scopedWorkpapers.find((w) => w.id === cmt.workpaperId) : undefined;
            const eng = wp ? scopedEngagements.find((e) => e.id === wp.engagementId) : undefined;
            if (eng && wp) openInspector('audit_file', { engagement: eng, workpaper: wp });
            drill.close();
          }}
          onClose={drill.close}
        />
      )}

      {/* Comments List */}
      <div data-testid={`${SCREEN_ID}-comment-list`} className="space-y-4">
        {rows.map((cmt) => {
          const wp = scopedWorkpapers.find((w) => w.id === cmt.workpaperId);
          const eng = scopedEngagements.find((e) => e.id === wp?.engagementId);
          const cycleTag = getCycleTag(cmt.createdAt);
          const isExpanded = expandedCommentId === cmt.id || isSingleCommentMode;
          const model = commentPopout({ comment: cmt, workpaper: wp, engagement: eng, todayIso: today, viewer: currentUser });

          return (
            <div
              key={cmt.id}
              data-testid={`${SCREEN_ID}-comment-${cmt.id}`}
              className="p-4 rounded-2xl bg-surface-elevated border border-hairline shadow-xs space-y-3"
            >
              {/* Meta Header */}
              <div className="flex items-start justify-between gap-3">
                <CommentPopout model={model} screenId={SCREEN_ID} element={`comment-popout-${cmt.id}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-7 h-7 rounded-full bg-accent-subtle text-accent font-semibold flex items-center justify-center text-apple-11">
                      {cmt.authorName
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)}
                    </span>
                    <div>
                      <div className="text-apple-12 font-semibold text-primary">
                        {cmt.authorName}{' '}
                        <span className="text-apple-11 uppercase font-normal text-secondary">
                          ({cmt.authorRole})
                        </span>
                      </div>
                      <div
                        data-testid={`${SCREEN_ID}-comment-age-${cmt.id}`}
                        className="text-apple-11 text-tertiary tabular-nums"
                      >
                        {new Date(cmt.createdAt).toLocaleString()} · {model.ageLabel}
                      </div>
                    </div>
                  </div>
                </CommentPopout>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Cycle Tag (§ 3.5 requirement) */}
                  <span className="px-2 py-0.5 rounded-full text-apple-11 font-medium bg-surface text-secondary border border-hairline">
                    {cycleTag}
                  </span>
                  {/* Status Chip */}
                  {model.status === 'cleared' ? (
                    <span
                      data-testid={`${SCREEN_ID}-comment-state-${cmt.id}`}
                      className="px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-verdigris-subtle text-verdigris flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3 h-3 stroke-[2]" />
                      Cleared
                    </span>
                  ) : (
                    <span
                      data-testid={`${SCREEN_ID}-comment-state-${cmt.id}`}
                      className="px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar"
                    >
                      {model.statusLabel}
                    </span>
                  )}
                </div>
              </div>

              {/* Comment Text */}
              <p className={`text-apple-13 text-primary leading-relaxed p-3 rounded-2xl border max-w-[85%] ${cmt.authorId === currentUser.id ? 'ml-auto bg-accent-subtle border-accent rounded-br-md text-right' : 'mr-auto bg-surface border-hairline rounded-bl-md'}`}>
                {cmt.text}
              </p>

              {/* The resolution path, from the pure model — what has to happen to close it. */}
              <p data-testid={`${SCREEN_ID}-comment-resolution-${cmt.id}`} className="text-apple-11 text-tertiary">
                {model.resolutionPath}
              </p>

              {/* Linked Document Reference (§ 3.5: clicking document opens audit file) */}
              {wp && (
                <div className="flex items-center justify-between text-apple-12 pt-1 border-t border-hairline">
                  <div className="flex items-center gap-1.5 text-secondary truncate">
                    <FileText className="w-3.5 h-3.5 stroke-[1.5] text-accent shrink-0" />
                    <span className="truncate">
                      On <strong>{wp.refCode}</strong> • {wp.title}
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid={`${SCREEN_ID}-comment-open-${cmt.id}`}
                    onClick={() => {
                      if (eng) {
                        openInspector('audit_file', { engagement: eng, workpaper: wp });
                      }
                    }}
                    className="flex items-center gap-1 text-apple-11 text-accent font-semibold hover:underline shrink-0 ml-2"
                  >
                    <span>Open Audit File</span>
                    <ExternalLink className="w-3 h-3 stroke-[1.5]" />
                  </button>
                </div>
              )}

              {/* Replies Thread */}
              {cmt.replies && cmt.replies.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-hairline">
                  <div className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
                    Thread Clearance Responses ({cmt.replies.length})
                  </div>
                  {cmt.replies.map((rep) => {
                    const mine = rep.authorName === currentUser.name;
                    return (
                      <div
                        key={rep.id}
                        data-testid={`${SCREEN_ID}-${mine ? 'bubble-mine' : 'bubble-other'}`}
                        className={`p-3 rounded-2xl border max-w-[85%] space-y-1 ${mine ? 'ml-auto bg-accent-subtle border-accent rounded-br-md' : 'mr-auto bg-surface border-hairline rounded-bl-md'}`}
                      >
                        <div className="flex items-center justify-between gap-3 text-apple-11 text-secondary">
                          <span className="font-semibold text-primary">{rep.authorName}</span>
                          <span className="tabular-nums">
                            {new Date(rep.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className={`text-apple-12 text-primary ${mine ? 'text-right' : ''}`}>{rep.text}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Reply Composer */}
              <div className="pt-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    data-testid={`${SCREEN_ID}-comment-reply-input-${cmt.id}`}
                    value={expandedCommentId === cmt.id ? replyText : ''}
                    onChange={(e) => {
                      setExpandedCommentId(cmt.id);
                      setReplyText(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSendReply(cmt);
                      }
                    }}
                    placeholder="Add formal reviewer clearance note or reply…"
                    className="flex-1 h-8 px-3 rounded-xl bg-surface border border-hairline text-apple-12 text-primary placeholder:text-tertiary outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    data-testid={`${SCREEN_ID}-comment-reply-${cmt.id}`}
                    onClick={() => handleSendReply(cmt)}
                    disabled={expandedCommentId !== cmt.id || !replyText.trim()}
                    className="px-3 py-1 bg-accent text-canvas font-semibold rounded-xl text-apple-11 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shadow-xs flex items-center gap-1"
                  >
                    <Send className="w-3 h-3 stroke-[2]" />
                    <span>Reply</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {rows.length === 0 && (
          <div data-testid={`${SCREEN_ID}-comment-empty`} className="py-12 text-center text-apple-13 text-secondary flex flex-col items-center gap-2">
            <MessageSquare className="w-6 h-6 text-tertiary stroke-[1.5]" />
            <span>
              {isSingleCommentMode
                ? 'This comment is no longer available.'
                : 'No review comments found matching the current criteria.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
