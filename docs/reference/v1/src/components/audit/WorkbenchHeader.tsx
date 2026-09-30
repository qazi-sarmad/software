import React from 'react';
import { WorkingPaper, AuditEngagement } from '../../types';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { ShieldCheck, Lock, Unlock, Share2, CheckCircle2, RotateCcw, AlertCircle } from '../common/Icons';

interface WorkbenchHeaderProps {
  workpaper: WorkingPaper;
  engagement?: AuditEngagement;
}

export const WorkbenchHeader: React.FC<WorkbenchHeaderProps> = ({ workpaper, engagement }) => {
  const { signOffWorkpaper, reopenWorkpaper, openInspector, currentUser } = useApp();
  const { can } = useScopedData();

  const handleSignOff = async () => {
    await signOffWorkpaper(workpaper.id);
  };

  const handleReopen = async () => {
    const reason = prompt('Enter mandatory reopening justification (minimum 10 characters):');
    if (!reason || reason.trim().length < 10) {
      alert('Reopen requires at least 10 characters justification.');
      return;
    }
    await reopenWorkpaper(workpaper.id, reason);
  };

  return (
    <div className="p-6 bg-surface border-b border-hairline flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-apple-12 font-bold px-2 py-0.5 rounded bg-surface-sunken border border-hairline text-secondary">
            {workpaper.refCode}
          </span>
          <h1 className="text-apple-20 font-bold text-primary">{workpaper.title}</h1>
          {workpaper.sealed && (
            <span className="px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Sealed &amp; Attested
            </span>
          )}
        </div>
        <div className="text-apple-12 text-secondary flex items-center gap-3">
          <span>Objective: {workpaper.objective}</span>
          <span>•</span>
          <span>Population: {workpaper.populationCount.toLocaleString()} items</span>
          {workpaper.populationSha256 && (
            <>
              <span>•</span>
              <span className="font-mono text-apple-11 text-tertiary">
                SHA: {workpaper.populationSha256.slice(0, 12)}...
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => openInspector('glassbox_share', { workpaper })}
          className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-medium text-primary transition-colors flex items-center gap-1.5"
          title="Share auditee portal"
        >
          <Share2 className="w-3.5 h-3.5 text-accent" />
          <span>GlassBox Link</span>
        </button>

        {workpaper.sealed ? (
          <button
            type="button"
            onClick={handleReopen}
            className="px-3 py-1.5 rounded-lg bg-cinnabar-subtle border border-cinnabar text-apple-12 font-semibold text-cinnabar hover:bg-surface-hover transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reopen Paper</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSignOff}
            className="px-4 py-1.5 rounded-lg bg-verdigris text-white text-apple-12 font-semibold hover:opacity-90 transition-opacity flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Seal &amp; Attest (4-Eyes)</span>
          </button>
        )}
      </div>
    </div>
  );
};
