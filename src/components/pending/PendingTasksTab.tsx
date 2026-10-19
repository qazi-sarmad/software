import React from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { CheckCircle2 } from '../common/Icons';
import { buildWorkQueue, myComments } from '../../lib/workQueue';
import { getOrgLocalToday } from '../../lib/orgDate';
import { EscalationCards } from './EscalationCards';

/**
 * Work Queue (SPEC-v10 §5), user-specific: my workpapers, what awaits my sign-off, what awaits my
 * approval, and (for a manager) the team's open work. The section logic is pure and lives in
 * src/lib/workQueue.ts so it is unit-tested without the UI.
 */
export const PendingTasksTab: React.FC = () => {
  const { openInspector } = useApp();
  const { currentUser, scopedEngagements, scopedWorkpapers, scopedCapItems, scopedComments } =
    useScopedData();

  const TODAY = getOrgLocalToday();
  const input = {
    user: currentUser,
    engagements: scopedEngagements,
    workpapers: scopedWorkpapers,
    capItems: scopedCapItems,
    comments: scopedComments,
  };
  const sections = buildWorkQueue(input).filter((s) => s.key !== 'team' || s.items.length > 0);
  const comments = myComments(input);
  const overdue = scopedEngagements.filter((e) => e.status !== 'signed_off' && e.dueDate < TODAY);

  return (
    <section data-testid="tab-pending" className="max-w-7xl mx-auto px-6 py-8 min-h-[60vh] space-y-8">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-secondary text-apple-12 font-medium uppercase tracking-wider">
          <CheckCircle2 className="w-4 h-4 stroke-[1.3]" /><span>Work Queue</span>
        </div>
        <h1 className="font-serif-title text-apple-28 font-bold text-primary tracking-tight">What needs you</h1>
        <p className="text-apple-13 text-secondary">
          {comments.length} review comments awaiting a response · {overdue.length} overdue audits
        </p>
      </div>

      <EscalationCards />

      <div className="rounded-2xl bg-surface border border-hairline shadow-apple p-5 space-y-3" data-testid="pending-comments">
        <h2 className="text-apple-15 font-semibold text-primary">Review comments to address</h2>
        {comments.length === 0 ? (
          <p className="text-apple-13 text-tertiary">Nothing awaiting a response.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {comments.map((c) => {
              const eng = scopedEngagements.find((e) => e.id === c.engagementId);
              const wp = scopedWorkpapers.find((w) => w.id === c.workpaperId);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => eng && openInspector('audit_file', { engagement: eng, workpaper: wp })}
                    className="w-full text-left py-3 flex items-start justify-between gap-4 hover:bg-surface-hover rounded-lg px-2 -mx-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-apple-13 text-primary">{c.title}</span>
                      <span className="block text-apple-11 text-tertiary">{c.subtitle}</span>
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
              <span className="text-apple-12 tabular-nums text-secondary">{sec.items.length}</span>
            </div>
            {sec.items.length === 0 ? (
              <p className="text-apple-12 text-tertiary">Nothing here right now.</p>
            ) : (
              <ul className="space-y-1">
                {sec.items.map((item) => {
                  const e = scopedEngagements.find((x) => x.id === item.engagementId);
                  const wp = item.workpaperId
                    ? scopedWorkpapers.find((w) => w.id === item.workpaperId)
                    : undefined;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => e && openInspector('audit_file', { engagement: e, workpaper: wp })}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-surface-hover flex justify-between gap-3"
                      >
                        <span className="text-apple-13 text-primary truncate">{item.title}</span>
                        <span className="text-apple-11 text-tertiary tabular-nums shrink-0">{item.subtitle}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};
