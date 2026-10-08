import React from 'react';
import { CheckCircle2 } from '../common/Icons';

/**
 * Pending Tasks (Guide v7 §5.2). Stub: sections, review comments and the
 * time-machine calendar are built in a later batch.
 */
export const PendingTasksTab: React.FC = () => (
  <section
    data-testid="tab-pending"
    className="max-w-7xl mx-auto px-6 py-8 min-h-[60vh] flex flex-col gap-3"
  >
    <div className="flex items-center gap-2 text-secondary text-apple-12 font-medium uppercase tracking-wider">
      <CheckCircle2 className="w-4 h-4 stroke-[1.3]" />
      <span>Coming online</span>
    </div>
    <h1 className="font-serif-title text-apple-28 font-bold text-primary tracking-tight">
      Pending Tasks
    </h1>
    <p className="text-apple-15 text-secondary max-w-2xl">
      Your in-progress, overdue and upcoming audits, open review comments and items awaiting your
      sign-off will appear here.
    </p>
  </section>
);
