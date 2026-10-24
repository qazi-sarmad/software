import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import { CheckCircle2, Clock, GitCommit, Plus, XCircle } from '../common/Icons';

export interface PlanItemView {
  id: string;
  title: string;
  isAdhoc: boolean;
  justification: string | null;
  status: 'proposed' | 'pending_adhoc' | 'approved' | 'removed';
}

export interface PlanVersionView {
  version: number;
  reason: string | null;
  createdAt: string;
}

/**
 * Audit plan items and version history (spec §9). An ad-hoc item requires a justification of at
 * least 10 characters and is pending until decided; every change creates a version. Renders inside
 * the sliding inspector.
 */
export const PlanItemsPanel: React.FC<{
  items: PlanItemView[];
  versions: PlanVersionView[];
  onAdd?: (title: string, adhoc: boolean, justification?: string) => void;
}> = ({ items, versions, onAdd }) => {
  const { currentUser } = useApp();
  const canAdd = hasRight(currentUser, 'manage_engagements');
  const canApprove = hasRight(currentUser, 'approve_plan');

  const [title, setTitle] = useState('');
  const [adhoc, setAdhoc] = useState(false);
  const [justification, setJustification] = useState('');

  const justificationTooShort = adhoc && justification.trim().length < 10;

  return (
    <div data-testid="plan-items" className="space-y-5 p-1">
      <div className="space-y-2">
        <h3 className="text-apple-15 font-semibold text-primary">Plan items</h3>
        {items.length === 0 ? (
          <p data-testid="plan-items-empty" className="text-apple-13 text-tertiary">No items in this plan yet.</p>
        ) : (
          <ul data-testid="plan-item-list" className="divide-y divide-hairline rounded-xl border border-hairline overflow-hidden">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="flex items-center gap-2 text-apple-13 text-primary">
                  {i.status === 'approved' ? (
                    <CheckCircle2 className="w-4 h-4 text-verdigris stroke-[1.5]" />
                  ) : i.status === 'pending_adhoc' ? (
                    <Clock className="w-4 h-4 text-secondary stroke-[1.5]" />
                  ) : i.status === 'removed' ? (
                    <XCircle className="w-4 h-4 text-cinnabar stroke-[1.5]" />
                  ) : (
                    <Plus className="w-4 h-4 text-secondary stroke-[1.5]" />
                  )}
                  {i.title}
                  {i.isAdhoc && (
                    <span className="px-2 py-0.5 rounded-full text-apple-11 font-semibold uppercase bg-cinnabar-subtle text-cinnabar">
                      ad-hoc
                    </span>
                  )}
                </span>
                <span
                  data-testid={`plan-item-status-${i.id}`}
                  className="text-apple-11 font-semibold uppercase text-secondary"
                >
                  {i.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canAdd && (
        <div data-testid="plan-add" className="space-y-2 rounded-xl border border-hairline p-3">
          <input
            aria-label="Item title"
            placeholder="Item title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-9 w-full px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent"
          />
          <label className="flex items-center gap-2 text-apple-12 text-secondary">
            <input type="checkbox" aria-label="Ad-hoc item" checked={adhoc} onChange={(e) => setAdhoc(e.target.checked)} />
            Ad-hoc engagement (requires justification and approval)
          </label>
          {adhoc && (
            <input
              aria-label="Ad-hoc justification"
              placeholder="Justification (min 10 chars)"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              className="h-9 w-full px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent"
            />
          )}
          <button
            type="button"
            data-testid="plan-add-button"
            disabled={title.trim() === '' || justificationTooShort}
            onClick={() => {
              onAdd?.(title, adhoc, justification);
              setTitle('');
              setJustification('');
            }}
            className="px-3 py-1.5 rounded-lg bg-primary text-canvas text-apple-13 font-semibold disabled:opacity-40"
          >
            Add item
          </button>
          {justificationTooShort && (
            <p data-testid="plan-justification-hint" className="text-apple-11 text-cinnabar">
              An ad-hoc justification must be at least 10 characters.
            </p>
          )}
        </div>
      )}

      {!canAdd && !canApprove && (
        <p className="text-apple-11 text-tertiary">{rightReason('approve_plan')}</p>
      )}

      <div>
        <h3 className="text-apple-12 font-semibold text-primary mb-2 flex items-center gap-1.5">
          <GitCommit className="w-4 h-4 stroke-[1.5]" /> Version history
        </h3>
        {versions.length === 0 ? (
          <p data-testid="plan-versions-empty" className="text-apple-12 text-tertiary">No versions yet.</p>
        ) : (
          <ul data-testid="plan-versions" className="space-y-1 text-apple-12">
            {versions.map((v) => (
              <li key={v.version} className="flex justify-between gap-3 border-b border-hairline pb-1">
                <span className="text-primary">v{v.version}{v.reason ? ` · ${v.reason}` : ''}</span>
                <span className="text-tertiary tabular-nums">{new Date(v.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
