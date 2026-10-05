import React from 'react';
import { WorkingPaper } from '../../../types';
import { ArrowRight, ShieldCheck } from '../../common/Icons';

interface ExecutionTabProps {
  workpapers: WorkingPaper[];
  highlightId?: string;
  onOpen: (workpaperId: string) => void;
}

export const ExecutionTab: React.FC<ExecutionTabProps> = ({ workpapers, highlightId, onOpen }) => (
  <div className="space-y-3" data-testid="audit-file-execution">
    <div className="flex items-center justify-between">
      <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">Working papers</h3>
      <span className="text-apple-11 text-secondary">
        {workpapers.filter((w) => w.sealed).length} of {workpapers.length} sealed
      </span>
    </div>
    <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
      {workpapers.map((wp) => (
        <button
          key={wp.id}
          type="button"
          data-testid={`wp-row-${wp.id}`}
          onClick={() => onOpen(wp.id)}
          className={`w-full text-left p-4 flex items-center justify-between hover:bg-surface-hover transition-colors ${
            wp.id === highlightId ? 'bg-surface-sunken' : ''
          }`}
        >
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-apple-11 font-bold text-secondary">{wp.refCode}</span>
              <span className="text-apple-13 font-medium text-primary truncate">{wp.title}</span>
              {wp.sealed && (
                <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Sealed
                </span>
              )}
            </div>
            <div className="text-apple-11 text-secondary truncate capitalize">
              {wp.status.replace(/_/g, ' ')}
              {wp.objective ? ` · ${wp.objective}` : ''}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2 pl-3">
            <span className="text-apple-11 text-secondary">Open paper</span>
            <ArrowRight className="w-3.5 h-3.5 text-secondary" />
          </div>
        </button>
      ))}
      {workpapers.length === 0 && (
        <div className="p-6 text-center text-apple-12 text-secondary" data-testid="execution-empty">
          No working papers are assigned to this engagement yet.
        </div>
      )}
    </div>
  </div>
);
