import React from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { CheckCircle2, Clock, Plus, XCircle } from '../common/Icons';

export interface SiraCycleView {
  id: string;
  year: number;
  status: 'draft' | 'published';
  publishedAt: string | null;
}

export interface EmergentRiskView {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  decisionReason: string | null;
}

/**
 * SIRA cycles and the emergent-risk queue (spec §8.3). Publishing freezes a cycle; each emergent
 * risk is accepted or rejected with a mandatory reason. Renders inside the sliding inspector.
 */
export const SiraCyclePanel: React.FC<{
  cycles: SiraCycleView[];
  emergent: EmergentRiskView[];
  onCreateCycle?: (year: number) => void;
  onPublishCycle?: (cycleId: string) => void;
}> = ({ cycles, emergent, onCreateCycle, onPublishCycle }) => {
  const { currentUser } = useApp();
  const canManage = hasRight(currentUser, 'manage_engagements');
  const canDecide = hasRight(currentUser, 'review_and_approve');

  return (
    <div data-testid="sira-cycle-panel" className="space-y-5 p-1">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-apple-15 font-semibold text-primary">Annual cycles</h3>
          {canManage && (
            <button
              type="button"
              data-testid="sira-create-cycle"
              onClick={() => onCreateCycle?.(new Date().getFullYear())}
              className="px-3 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5 stroke-[1.5]" /> New cycle
            </button>
          )}
        </div>
        {cycles.length === 0 ? (
          <p data-testid="sira-cycles-empty" className="text-apple-13 text-tertiary">No cycles yet.</p>
        ) : (
          <ul data-testid="sira-cycles" className="divide-y divide-hairline rounded-xl border border-hairline overflow-hidden">
            {cycles.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="flex items-center gap-2 text-apple-13 text-primary">
                  {c.status === 'published' ? (
                    <CheckCircle2 className="w-4 h-4 text-verdigris stroke-[1.5]" />
                  ) : (
                    <Clock className="w-4 h-4 text-secondary stroke-[1.5]" />
                  )}
                  {c.year}
                  <span className="px-2 py-0.5 rounded-full text-apple-11 font-semibold uppercase bg-surface-sunken text-secondary">
                    {c.status}
                  </span>
                </span>
                {c.status === 'draft' && canManage && (
                  <button
                    type="button"
                    data-testid={`sira-publish-${c.id}`}
                    onClick={() => onPublishCycle?.(c.id)}
                    className="px-3 py-1 rounded-lg bg-primary text-canvas text-apple-12 font-semibold"
                  >
                    Publish
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-apple-15 font-semibold text-primary">Emergent risks</h3>
        {emergent.length === 0 ? (
          <p data-testid="emergent-empty" className="text-apple-13 text-tertiary">No emergent risks in the queue.</p>
        ) : (
          <ul data-testid="emergent-risks" className="space-y-2">
            {emergent.map((r) => (
              <li key={r.id} className="rounded-xl border border-hairline p-3 space-y-1">
                <div className="flex items-center gap-2">
                  {r.status === 'accepted' ? (
                    <CheckCircle2 className="w-4 h-4 text-verdigris stroke-[1.5]" />
                  ) : r.status === 'rejected' ? (
                    <XCircle className="w-4 h-4 text-cinnabar stroke-[1.5]" />
                  ) : (
                    <Clock className="w-4 h-4 text-secondary stroke-[1.5]" />
                  )}
                  <span className="text-apple-13 font-semibold text-primary">{r.title}</span>
                  <span
                    data-testid={`emergent-status-${r.id}`}
                    className="px-2 py-0.5 rounded-full text-apple-11 font-semibold uppercase bg-surface-sunken text-secondary"
                  >
                    {r.status}
                  </span>
                </div>
                {r.description && <p className="text-apple-12 text-secondary">{r.description}</p>}
                {r.decisionReason && (
                  <p data-testid={`emergent-reason-${r.id}`} className="text-apple-11 text-tertiary">
                    Reason: {r.decisionReason}
                  </p>
                )}
                {r.status === 'pending' && !canDecide && (
                  <p className="text-apple-11 text-tertiary">Requires the review and approve right to decide.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
