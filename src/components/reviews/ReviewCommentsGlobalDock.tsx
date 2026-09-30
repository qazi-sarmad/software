import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { ReviewComment, WorkingPaper } from '../../types';
import {
  MessageSquare,
  Minus,
  Paperclip,
  Send,
  X,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle2,
} from '../common/Icons';

interface AttachedFile {
  name: string;
  size: string;
}

export const ReviewCommentsGlobalDock: React.FC = () => {
  const { openInspector, currentUser } = useApp();
  const { scopedComments, scopedWorkpapers, scopedEngagements } = useScopedData();

  // Floating dock open / minimize state
  const [isOpen, setIsOpen] = useState(false);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);

  // Composer reply state per thread
  const [replyText, setReplyText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // In-progress audits filter for dock (§ 3.5: "Dock lists current in-progress audits; history lists all")
  const inProgressWorkpapers = scopedWorkpapers.filter((w) => {
    const eng = scopedEngagements.find((e) => e.id === w.engagementId);
    return eng?.status === 'in_progress' || w.status === 'in_progress';
  });
  const inProgressWpIds = new Set(inProgressWorkpapers.map((w) => w.id));

  // Dock comments: comments on currently active audits
  const activeDockComments = scopedComments.filter((c) =>
    inProgressWpIds.has(c.workpaperId)
  );

  const awaitingResponseCount = activeDockComments.filter(
    (c) => c.status === 'open'
  ).length;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const newFiles: AttachedFile[] = Array.from(e.target.files).map((f) => ({
      name: f.name,
      size: `${Math.round(f.size / 1024)} KB`,
    }));
    setAttachedFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (fileName: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.name !== fileName));
  };

  const handleSendReply = (cmt: ReviewComment) => {
    if (!replyText.trim() && attachedFiles.length === 0) return;

    const reply = {
      id: `rep-${Date.now()}`,
      authorName: currentUser.name,
      text: replyText.trim() + (attachedFiles.length > 0 ? ` [Attached: ${attachedFiles.map(f => f.name).join(', ')}]` : ''),
      createdAt: new Date().toISOString(),
    };

    if (!cmt.replies) {
      cmt.replies = [];
    }
    cmt.replies.push(reply);
    setReplyText('');
    setAttachedFiles([]);
  };

  return (
    <>
      {/* Global Floating Launcher Bubble (56px, comment icon, cinnabar unread badge per § 3.5) */}
      <div className="fixed bottom-6 right-6 z-40 select-none">
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={() => setIsOpen(true)}
              className="w-14 h-14 rounded-full bg-primary text-canvas shadow-apple flex items-center justify-center hover:scale-105 active:scale-95 transition-transform relative focus:outline-none focus:ring-2 focus:ring-accent"
              title="Four-eyes Review Comments Dock"
              aria-label="Open review comments dock"
            >
              <MessageSquare className="w-6 h-6 stroke-[1.5]" />
              {/* Cinnabar Unread Badge */}
              {awaitingResponseCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-cinnabar text-canvas font-bold text-apple-11 flex items-center justify-center shadow-xs border-2 border-canvas tabular-nums">
                  {awaitingResponseCount}
                </span>
              )}
            </motion.button>
          )}
        </AnimatePresence>

        {/* 420px Dock Panel (max 620px, origin bottom-right per § 3.5) */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.88, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              style={{ transformOrigin: 'bottom right' }}
              className="w-[420px] max-w-[calc(100vw-32px)] max-h-[620px] bg-glass border border-hairline shadow-apple rounded-3xl flex flex-col overflow-hidden text-primary"
            >
              {/* Header */}
              <div className="px-5 py-4 border-b border-hairline flex items-center justify-between bg-surface-elevated shrink-0">
                <div>
                  <h4 className="text-apple-15 font-bold text-primary flex items-center gap-2">
                    <span>Review Comments</span>
                    <span className="px-2 py-0.5 rounded-full text-apple-11 font-medium bg-accent-subtle text-accent border border-accent">
                      Active Audits
                    </span>
                  </h4>
                  <p className="text-apple-11 text-secondary mt-0.5">
                    {awaitingResponseCount} awaiting preparer response
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
                    title="Minimize dock"
                    aria-label="Minimize review comments dock"
                  >
                    <Minus className="w-4 h-4 stroke-[1.5]" />
                  </button>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
                    title="Close dock"
                    aria-label="Close review comments dock"
                  >
                    <X className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </div>
              </div>

              {/* Thread Rows Scroll Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {activeDockComments.length === 0 ? (
                  <div className="py-12 text-center text-apple-12 text-secondary">
                    No open queries awaiting clearance in current active audits.
                  </div>
                ) : (
                  activeDockComments.map((cmt) => {
                    const wp = scopedWorkpapers.find((w) => w.id === cmt.workpaperId);
                    const eng = scopedEngagements.find((e) => e.id === wp?.engagementId);
                    const isExpanded = expandedThreadId === cmt.id;
                    const repliesCount = cmt.replies ? cmt.replies.length : 0;

                    return (
                      <div
                        key={cmt.id}
                        className={`rounded-2xl border transition-all overflow-hidden ${
                          isExpanded
                            ? 'bg-surface border-accent shadow-soft'
                            : 'bg-surface-elevated border-hairline hover:bg-surface-hover'
                        }`}
                      >
                        {/* Summary Row */}
                        <div
                          onClick={() => setExpandedThreadId(isExpanded ? null : cmt.id)}
                          className="p-3.5 cursor-pointer flex items-start gap-3 select-none"
                        >
                          {/* Avatar */}
                          <div className="w-8 h-8 rounded-full bg-accent-subtle text-accent font-semibold flex items-center justify-center text-apple-11 shrink-0 mt-0.5">
                            {cmt.authorName
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .slice(0, 2)}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="text-apple-12 font-semibold text-primary truncate">
                                  {cmt.authorName}
                                </span>
                                <span className="text-apple-11 uppercase font-semibold text-accent px-1 rounded bg-accent-subtle">
                                  {cmt.authorRole}
                                </span>
                              </div>
                              <span className="text-apple-11 text-tertiary tabular-nums shrink-0">
                                {new Date(cmt.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>

                            <p className="text-apple-12 text-primary mt-1 line-clamp-2">
                              {cmt.text}
                            </p>

                            {/* Document Reference Pill: Clicking document opens audit file (§ 3.5 requirement) */}
                            {wp && (
                              <div className="mt-2 flex items-center justify-between text-apple-11">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (eng) {
                                      openInspector('audit_file', { engagement: eng, workpaper: wp });
                                    }
                                  }}
                                  className="flex items-center gap-1.5 text-accent hover:underline font-medium truncate max-w-[240px]"
                                  title="Open in Permanent Audit File"
                                >
                                  <FileText className="w-3 h-3 stroke-[1.5] shrink-0" />
                                  <span className="truncate">on {wp.refCode} ({wp.title})</span>
                                  <ExternalLink className="w-2.5 h-2.5 stroke-[1.5] shrink-0" />
                                </button>

                                <div className="flex items-center gap-2 text-secondary">
                                  {repliesCount > 0 && (
                                    <span className="text-apple-11 font-medium">
                                      {repliesCount} {repliesCount === 1 ? 'reply' : 'replies'}
                                    </span>
                                  )}
                                  {cmt.status === 'cleared' ? (
                                    <span className="text-verdigris font-semibold flex items-center gap-0.5">
                                      <CheckCircle2 className="w-3 h-3 stroke-[2]" />
                                      Cleared
                                    </span>
                                  ) : (
                                    <span className="text-cinnabar font-semibold">
                                      Open
                                    </span>
                                  )}
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5 stroke-[1.5]" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 stroke-[1.5]" />
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Expanded Dialogue View (§ 3.5: reply bubbles + composer) */}
                        {isExpanded && (
                          <div className="px-3.5 pb-3.5 pt-1 border-t border-hairline space-y-3 bg-surface-sunken">
                            {/* Previous Replies Bubbles */}
                            {cmt.replies && cmt.replies.length > 0 && (
                              <div className="space-y-2 pt-2 max-h-48 overflow-y-auto pr-1">
                                <div
                                  className="flex flex-col items-start"
                                >
                                  <span className="text-apple-11 text-tertiary mb-0.5 px-1">
                                    {cmt.authorName} • {new Date(cmt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <div className="max-w-[85%] p-2.5 rounded-2xl text-apple-12 bg-surface text-primary border border-hairline rounded-bl-xs">
                                    {cmt.text}
                                  </div>
                                </div>
                                {cmt.replies.map((rep) => {
                                  const isOwn = rep.authorName === currentUser.name;
                                  return (
                                    <div
                                      key={rep.id}
                                      className={`flex flex-col ${
                                        isOwn ? 'items-end' : 'items-start'
                                      }`}
                                    >
                                      <span className="text-apple-11 text-tertiary mb-0.5 px-1">
                                        {rep.authorName} • {new Date(rep.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                      <div
                                        className={`max-w-[85%] p-2.5 rounded-2xl text-apple-12 ${
                                          isOwn
                                            ? 'bg-accent text-canvas rounded-br-xs shadow-xs'
                                            : 'bg-surface text-primary border border-hairline rounded-bl-xs'
                                        }`}
                                      >
                                        {rep.text}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Attached files preview chips */}
                            {attachedFiles.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {attachedFiles.map((f) => (
                                  <span
                                    key={f.name}
                                    className="px-2 py-0.5 rounded-lg bg-surface border border-hairline text-apple-11 text-primary flex items-center gap-1 shadow-xs"
                                  >
                                    <Paperclip className="w-3 h-3 stroke-[1.5] text-accent" />
                                    <span className="truncate max-w-[120px]">{f.name}</span>
                                    <button
                                      onClick={() => removeFile(f.name)}
                                      className="text-secondary hover:text-cinnabar"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Composer */}
                            <div className="space-y-2">
                              <textarea
                                rows={2}
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder="Write response or clearance clarification…"
                                className="w-full p-2.5 text-apple-12 rounded-xl bg-surface border border-hairline text-primary placeholder:text-tertiary outline-none focus:border-accent resize-none"
                              />

                              <div className="flex items-center justify-between">
                                {/* Paperclip for Multi-file Upload */}
                                <div>
                                  <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    multiple
                                    className="hidden"
                                    accept=".pdf,.xlsx,.csv,.png,.docx"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface transition-colors flex items-center gap-1.5 text-apple-11"
                                    title="Attach supporting audit file"
                                  >
                                    <Paperclip className="w-3.5 h-3.5 stroke-[1.5]" />
                                    <span>Attach file</span>
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleSendReply(cmt)}
                                  disabled={!replyText.trim() && attachedFiles.length === 0}
                                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent text-canvas font-semibold text-apple-12 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
                                >
                                  <span>Reply</span>
                                  <Send className="w-3 h-3 stroke-[2]" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer: "View full comment history" opens Inspector Panel (§ 3.5 requirement) */}
              <div className="p-3 border-t border-hairline bg-surface-elevated text-center shrink-0">
                <button
                  onClick={() => {
                    openInspector('comment_history');
                    setIsOpen(false);
                  }}
                  className="w-full py-2 px-4 rounded-xl bg-surface hover:bg-surface-hover border border-hairline text-apple-12 font-semibold text-accent transition-colors flex items-center justify-center gap-2 shadow-xs"
                >
                  <Clock className="w-3.5 h-3.5 stroke-[1.5]" />
                  <span>View full comment history across all cycles</span>
                  <ExternalLink className="w-3.5 h-3.5 stroke-[1.5]" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};
