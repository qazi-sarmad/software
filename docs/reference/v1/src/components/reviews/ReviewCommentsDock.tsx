import React from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { useApp } from '../../context/AppContext';
import { HoverPreview } from '../common/HoverPreview';
import { MessageSquare, Check, ArrowRight } from 'lucide-react';

export const ReviewCommentsDock: React.FC = () => {
  const { scopedComments, scopedWorkpapers } = useScopedData();
  const { openInspector, setSelectedWorkpaperId, setActiveTab } = useApp();

  return (
    <div className="w-full bg-surface border border-hairline rounded-2xl p-5 shadow-apple space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-apple-15 font-semibold text-primary">Review Comments Dock</h3>
          <p className="text-apple-12 text-secondary">
            Four-eyes peer review queries and supervisor clearance notes
          </p>
        </div>
        <span className="px-2 py-0.5 rounded text-apple-11 font-medium bg-surface-elevated text-secondary border border-hairline tabular-nums">
          {scopedComments.length} Active Notes
        </span>
      </div>

      <div className="space-y-2.5">
        {scopedComments.length === 0 ? (
          <div className="py-8 text-center text-apple-12 text-secondary">
            No open review comments for your current scope.
          </div>
        ) : (
          scopedComments.map((cmt) => {
            const wp = scopedWorkpapers.find((w) => w.id === cmt.workpaperId);
            const previewData = {
              title: `Comment from ${cmt.authorName} (${cmt.authorRole.toUpperCase()})`,
              category: `Workpaper ${wp?.refCode || cmt.workpaperId}`,
              subtitle: cmt.text,
              status: cmt.status === 'cleared' ? 'Cleared' : 'Pending Preparer Action',
              statusType: cmt.status === 'cleared' ? ('verdigris' as const) : ('amber' as const),
              dueDate: new Date(cmt.createdAt).toLocaleDateString(),
              hint: 'Click to open comment thread in inspector',
            };

            return (
              <HoverPreview key={cmt.id} content={previewData} className="w-full">
                <div
                  onClick={() => openInspector('comment', { comment: cmt, workpaper: wp })}
                  className="w-full text-left p-3.5 rounded-xl bg-surface-elevated hover:bg-surface-hover transition-colors border border-hairline cursor-pointer flex items-start gap-3"
                >
                  <div className="p-2 rounded-lg bg-accent-subtle text-accent shrink-0 mt-0.5">
                    <MessageSquare className="w-4 h-4 stroke-[1.5]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-apple-12 font-semibold text-primary truncate">
                        {cmt.authorName}
                      </div>
                      <span className="text-apple-11 text-tertiary tabular-nums">
                        {new Date(cmt.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-apple-12 text-secondary line-clamp-2 mt-0.5">{cmt.text}</p>
                    {wp && (
                      <div className="mt-2 flex items-center gap-2 text-apple-11 text-accent font-medium">
                        <span>{wp.refCode}</span>
                        <span>•</span>
                        <span className="truncate">{wp.title}</span>
                      </div>
                    )}
                  </div>
                </div>
              </HoverPreview>
            );
          })
        )}
      </div>
    </div>
  );
};
