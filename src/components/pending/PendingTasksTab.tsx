import React from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { CheckCircle2 } from '../common/Icons';
import { pendingComments } from '../../lib/comments';

const TODAY = '2026-09-30'; // demo clock, same as the rest of the app until the injected clock lands

/**
 * Pending Tasks (Guide v7 §5.2), first cut: my audits by state and review comments awaiting a response.
 * Time-machine calendar and manager roll-up are NOT built yet.
 */
export const PendingTasksTab: React.FC = () => {
  const { openInspector } = useApp();
  const { scopedEngagements, scopedWorkpapers, scopedComments } = useScopedData();

  const mine = scopedEngagements; // already scoped by role and entity
  const sections = [
    { key: 'progress', title: 'In progress', rows: mine.filter((e) => e.status === 'in_progress' && e.dueDate >= TODAY) },
    { key: 'overdue', title: 'Overdue', rows: mine.filter((e) => e.status !== 'signed_off' && e.dueDate < TODAY) },
    { key: 'upcoming', title: 'Upcoming', rows: mine.filter((e) => e.status !== 'signed_off' && e.status !== 'in_progress' && e.periodStart > TODAY) },
    { key: 'done', title: 'Completed', rows: mine.filter((e) => e.status === 'signed_off') },
  ];
  const comments = pendingComments(scopedComments, scopedWorkpapers, scopedEngagements);

  return (
    <section data-testid="tab-pending" className="max-w-7xl mx-auto px-6 py-8 min-h-[60vh] space-y-8">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-secondary text-apple-12 font-medium uppercase tracking-wider">
          <CheckCircle2 className="w-4 h-4 stroke-[1.3]" /><span>Pending Tasks</span>
        </div>
        <h1 className="font-serif-title text-apple-28 font-bold text-primary tracking-tight">What needs you</h1>
        <p className="text-apple-13 text-secondary">{comments.length} review comments awaiting a response · {sections[1].rows.length} overdue audits</p>
      </div>

      <div className="rounded-2xl bg-surface border border-hairline shadow-apple p-5 space-y-3" data-testid="pending-comments">
        <h2 className="text-apple-15 font-semibold text-primary">Review comments to address</h2>
        {comments.length === 0 ? (
          <p className="text-apple-13 text-tertiary">Nothing awaiting a response.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {comments.map((c) => {
              const wp = scopedWorkpapers.find((w) => w.id === c.workpaperId);
              const eng = scopedEngagements.find((e) => e.id === wp?.engagementId);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => eng && openInspector('audit_file', { engagement: eng, workpaper: wp })}
                    className="w-full text-left py-3 flex items-start justify-between gap-4 hover:bg-surface-hover rounded-lg px-2 -mx-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-apple-13 text-primary">{c.text}</span>
                      <span className="block text-apple-11 text-tertiary">{c.authorName} · on {wp?.refCode ?? 'paper'}{eng ? ` · ${eng.title}` : ''}</span>
                    </span>
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar">Open</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((sec) => (
          <div key={sec.key} className="rounded-2xl bg-surface border border-hairline p-5 space-y-3" data-testid={`pending-${sec.key}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-apple-15 font-semibold text-primary">{sec.title}</h2>
              <span className={`text-apple-12 tabular-nums ${sec.key === 'overdue' && sec.rows.length ? 'text-cinnabar font-semibold' : 'text-secondary'}`}>{sec.rows.length}</span>
            </div>
            {sec.rows.length === 0 ? <p className="text-apple-12 text-tertiary">None.</p> : (
              <ul className="space-y-1">
                {sec.rows.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => openInspector('audit_file', { engagement: e })} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-surface-hover flex justify-between gap-3">
                      <span className="text-apple-13 text-primary truncate">{e.title}</span>
                      <span className="text-apple-11 text-tertiary tabular-nums shrink-0">{e.stage} · {e.dueDate}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};
