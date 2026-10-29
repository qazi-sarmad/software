import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { Plus } from '../common/Icons';

/**
 * Create a working paper in the engagement (Phase 6, migration 0116). The testing workspace's
 * sampling and row-testing panels are gated on a workpaper, so this is the entry point that makes
 * the testing stage reachable at all. Non-blocking: the form opens in place, and the database's
 * refusals (no perform_work, a sealed engagement, planning not signed off) are shown inline.
 */
export const WorkpaperCreatePanel: React.FC<{
  engagementId: string;
  controlId?: string | null;
  onCreated?: (id: string) => void;
}> = ({ engagementId, controlId = null, onCreated }) => {
  const { currentUser, createWorkpaper } = useApp();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = hasRight(currentUser, 'perform_work');

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await createWorkpaper(engagementId, title, controlId);
    if (!res.ok) setError(res.reason);
    else {
      setTitle('');
      setOpen(false);
      onCreated?.(res.id);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3" data-testid="workpaper-create-panel">
      <InlineError message={error} testId="workpaper-create-error" />

      {open ? (
        <div className="p-4 rounded-2xl bg-surface-elevated border border-hairline space-y-3">
          <label className="block text-apple-11 text-secondary" htmlFor="workpaper-title">
            Working paper title. A workpaper is the container for a population, its sample and its row
            tests; it is created in the testing stage and locked once signed off.
          </label>
          <input
            id="workpaper-title"
            data-testid="workpaper-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Bank reconciliation — March"
            className="w-full px-3 py-2 rounded-xl bg-surface-sunken border border-hairline text-apple-12 text-primary"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="workpaper-create-submit"
              onClick={submit}
              disabled={busy || title.trim().length === 0}
              className="px-4 py-2 rounded-xl bg-primary text-canvas text-apple-13 font-semibold hover:opacity-90 disabled:opacity-50"
            >
              Create working paper
            </button>
            <button
              type="button"
              data-testid="workpaper-create-cancel"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="px-4 py-2 rounded-xl bg-surface border border-hairline text-apple-13 font-semibold text-secondary hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="workpaper-create-open"
          onClick={() => setOpen(true)}
          disabled={!canWrite}
          title={canWrite ? undefined : rightReason('perform_work')}
          className="px-4 py-2 rounded-xl bg-primary text-canvas text-apple-13 font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" /> New working paper
        </button>
      )}

      {!canWrite && (
        <div className="text-apple-11 text-secondary" data-testid="workpaper-create-reason">
          {rightReason('perform_work')}
        </div>
      )}
    </div>
  );
};
