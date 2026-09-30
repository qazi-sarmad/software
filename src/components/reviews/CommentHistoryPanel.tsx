import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { ReviewComment, WorkingPaper } from '../../types';
import {
  MessageSquare,
  Send,
  CheckCircle2,
  FileText,
  ExternalLink,
  Search,
  Filter,
  Clock,
  ChevronDown,
  ChevronUp,
} from '../common/Icons';

interface CommentPanelProps {
  data?: {
    comment?: ReviewComment;
    workpaper?: WorkingPaper;
  } | null;
  onClose?: () => void;
}

export const CommentHistoryPanel: React.FC<CommentPanelProps> = ({ data, onClose }) => {
  const { currentUser, openInspector } = useApp();
  const { scopedComments, scopedWorkpapers, scopedEngagements } = useScopedData();

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

  // Cycle assignment mock based on comment date for multi-cycle history
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
  const filteredComments = scopedComments.filter((c) => {
    if (statusFilter !== 'all') {
      if (statusFilter === 'cleared' && c.status !== 'cleared') return false;
      if (statusFilter === 'open' && c.status === 'cleared') return false;
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
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-hairline pb-4">
        <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">
          {isSingleCommentMode ? 'Reviewer Query & Dialogue' : 'Four-Eyes Assurance Audit Trail'}
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
                placeholder="Search comments, author, or workpaper..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-apple-12 rounded-xl bg-surface-elevated border border-hairline text-primary placeholder:text-tertiary outline-none focus:border-accent"
              />
            </div>

            {/* Cycle Selector */}
            <select
              value={cycleFilter}
              onChange={(e) => setCycleFilter(e.target.value)}
              className="h-8 px-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-12 text-secondary outline-none cursor-pointer"
            >
              <option value="all">All Audit Cycles</option>
              <option value="Q3 2026 Cycle">Q3 2026 Cycle</option>
              <option value="Q2 2026 Cycle">Q2 2026 Cycle</option>
              <option value="2025 Annual Cycle">2025 Annual Cycle</option>
            </select>

            {/* Status Pills */}
            <div className="flex items-center gap-1 bg-surface-elevated p-0.5 rounded-xl border border-hairline">
              <button
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
                onClick={() => setStatusFilter('open')}
                className={`px-2.5 py-1 rounded-lg text-apple-11 font-medium transition-colors ${
                  statusFilter === 'open'
                    ? 'bg-surface text-cinnabar shadow-xs font-semibold'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                Open
              </button>
              <button
                onClick={() => setStatusFilter('cleared')}
                className={`px-2.5 py-1 rounded-lg text-apple-11 font-medium transition-colors ${
                  statusFilter === 'cleared'
                    ? 'bg-surface text-verdigris shadow-xs font-semibold'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                Cleared
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comments List */}
      <div className="space-y-4">
        {(isSingleCommentMode ? (data?.comment ? [data.comment] : []) : filteredComments).map(
          (cmt) => {
            const wp = scopedWorkpapers.find((w) => w.id === cmt.workpaperId);
            const eng = scopedEngagements.find((e) => e.id === wp?.engagementId);
            const cycleTag = getCycleTag(cmt.createdAt);
            const isExpanded = expandedCommentId === cmt.id || isSingleCommentMode;

            return (
              <div
                key={cmt.id}
                className="p-4 rounded-2xl bg-surface-elevated border border-hairline shadow-xs space-y-3"
              >
                {/* Meta Header */}
                <div className="flex items-start justify-between gap-3">
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
                      <div className="text-apple-11 text-tertiary tabular-nums">
                        {new Date(cmt.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Cycle Tag (§ 3.5 requirement) */}
                    <span className="px-2 py-0.5 rounded-full text-apple-11 font-medium bg-surface text-secondary border border-hairline">
                      {cycleTag}
                    </span>
                    {/* Status Chip */}
                    {cmt.status === 'cleared' ? (
                      <span className="px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-verdigris-subtle text-verdigris flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 stroke-[2]" />
                        Cleared
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar">
                        Open
                      </span>
                    )}
                  </div>
                </div>

                {/* Comment Text */}
                <p className="text-apple-13 text-primary leading-relaxed bg-surface p-3 rounded-xl border border-hairline">
                  {cmt.text}
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
                    {cmt.replies.map((rep) => (
                      <div
                        key={rep.id}
                        className="p-3 rounded-xl bg-surface border border-hairline ml-3 space-y-1"
                      >
                        <div className="flex items-center justify-between text-apple-11 text-secondary">
                          <span className="font-semibold text-primary">{rep.authorName}</span>
                          <span className="tabular-nums">
                            {new Date(rep.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-apple-12 text-primary">{rep.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply Composer */}
                <div className="pt-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
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
          }
        )}

        {!isSingleCommentMode && filteredComments.length === 0 && (
          <div className="py-12 text-center text-apple-13 text-secondary">
            No review comments found matching the current criteria.
          </div>
        )}
      </div>
    </div>
  );
};
