import React from 'react';
import { WorkingPaper } from '../../types';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { AlertCircle, AlertTriangle, Plus, ArrowRight, GitCommit } from '../common/Icons';

interface FindingsTabProps {
  workpaper: WorkingPaper;
}

export const FindingsTab: React.FC<FindingsTabProps> = ({ workpaper }) => {
  const { openInspector } = useApp();
  const { scopedObservations } = useScopedData();

  const paperObservations = scopedObservations.filter((o) => o.workpaperId === workpaper.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-apple-15 font-semibold text-primary">
            Documented Audit Observations ({paperObservations.length})
          </h3>
          <p className="text-apple-12 text-secondary">
            Exceptions raised during substantive testing with 5C standard (Condition, Criteria, Cause, Consequence, Recommendation).
          </p>
        </div>
        {!workpaper.sealed && (
          <button
            type="button"
            onClick={() =>
              openInspector('observation', {
                workpaperId: workpaper.id,
                controlId: workpaper.controlId,
                entityId: workpaper.entityId,
                universeId: workpaper.universeId,
              })
            }
            className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Raise Finding</span>
          </button>
        )}
      </div>

      <div className="space-y-4">
        {paperObservations.map((obs) => (
          <div
            key={obs.id}
            className="p-5 rounded-xl bg-surface border border-hairline shadow-soft space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-apple-11 font-semibold ${
                    obs.severity === 'critical'
                      ? 'bg-cinnabar text-white'
                      : obs.severity === 'high'
                      ? 'bg-cinnabar-subtle text-cinnabar border border-cinnabar'
                      : 'bg-surface-sunken text-secondary border border-strong'
                  }`}
                >
                  {obs.severity.toUpperCase()}
                </span>
                <span className="font-mono text-apple-12 text-secondary">{obs.id}</span>
              </div>
              <button
                type="button"
                onClick={() => openInspector('red_thread', { observation: obs })}
                className="text-apple-12 text-secondary hover:text-primary flex items-center gap-1"
              >
                <GitCommit className="w-3.5 h-3.5 text-accent" />
                <span>Lineage Trace</span>
              </button>
            </div>

            <h4 className="text-apple-14 font-semibold text-primary">{obs.title}</h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-apple-12">
              <div className="p-3 rounded-lg bg-surface-sunken space-y-1">
                <span className="font-semibold text-secondary uppercase text-apple-11">Condition</span>
                <p className="text-primary">{obs.condition}</p>
              </div>
              <div className="p-3 rounded-lg bg-surface-sunken space-y-1">
                <span className="font-semibold text-secondary uppercase text-apple-11">Criteria</span>
                <p className="text-primary">{obs.criteria}</p>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between text-apple-11 text-secondary border-t border-hairline">
              <span>Raised by {obs.raisedBy}</span>
              <button
                type="button"
                onClick={() => openInspector('observation', { observation: obs })}
                className="text-primary font-medium hover:underline flex items-center gap-1"
              >
                <span>Edit Full 5C Analysis</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}

        {paperObservations.length === 0 && (
          <div className="p-8 text-center rounded-xl border border-dashed border-hairline text-secondary text-apple-12">
            No audit exceptions or observations recorded for this working paper.
          </div>
        )}
      </div>
    </div>
  );
};
