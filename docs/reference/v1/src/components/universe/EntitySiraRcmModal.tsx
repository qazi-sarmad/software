import React from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { AuditEntity } from '../../types';
import { ShieldAlert, Activity, CheckCircle2, Sliders } from 'lucide-react';

interface SiraRcmProps {
  entity: AuditEntity;
  onClose?: () => void;
}

export const EntitySiraRcmModal: React.FC<SiraRcmProps> = ({ entity, onClose }) => {
  const { scopedControls } = useScopedData();
  const entityControls = scopedControls.filter((c) => c.entityId === entity.id);

  return (
    <div className="space-y-6">
      {/* SIRA Quantitative Breakdown */}
      <div className="p-5 rounded-2xl bg-surface-elevated border border-hairline space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">
              Composite Risk Score
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-serif-numeral text-apple-40 font-bold text-primary tabular-nums">
                {entity.siraScore}
              </span>
              <span className="text-apple-13 text-secondary font-medium">/ 100 SIRA Index</span>
            </div>
          </div>
          <span className="px-3 py-1 rounded-xl text-apple-12 font-bold uppercase text-cinnabar bg-cinnabar-subtle border border-cinnabar">
            {entity.inherentRisk} Inherent
          </span>
        </div>

        {/* Factors */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-hairline text-apple-12">
          <div>
            <span className="text-tertiary">Department: </span>
            <span className="text-primary font-medium">{entity.department}</span>
          </div>
          <div>
            <span className="text-tertiary">Head: </span>
            <span className="text-primary font-medium">{entity.headOfDepartment}</span>
          </div>
          <div>
            <span className="text-tertiary">Residual Rating: </span>
            <span className="text-primary font-medium uppercase">{entity.residualRisk}</span>
          </div>
          <div>
            <span className="text-tertiary">Last Audit: </span>
            <span className="text-primary font-medium tabular-nums">{entity.lastAuditDate}</span>
          </div>
        </div>
      </div>

      {/* Risk and Control Matrix (RCM) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
            Risk &amp; Control Matrix ({entityControls.length} Controls)
          </h4>
        </div>

        <div className="space-y-3">
          {entityControls.length === 0 ? (
            <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl">
              No controls currently indexed for this entity.
            </div>
          ) : (
            entityControls.map((ctrl) => (
              <div
                key={ctrl.id}
                className="p-4 rounded-xl bg-surface border border-hairline space-y-2 hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-apple-12 font-bold text-accent">
                    {ctrl.code}
                  </span>
                  <span
                    className={`text-apple-11 font-semibold px-2 py-0.5 rounded capitalize ${
                      ctrl.effectiveness === 'effective'
                        ? 'text-verdigris bg-verdigris-subtle'
                        : 'text-amber bg-amber-subtle'
                    }`}
                  >
                    {ctrl.effectiveness.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-apple-13 font-semibold text-primary">{ctrl.title}</div>
                <p className="text-apple-12 text-secondary">{ctrl.description}</p>
                <div className="flex items-center gap-4 text-apple-11 text-tertiary pt-2 border-t border-hairline">
                  <span>Type: {ctrl.controlType}</span>
                  <span>•</span>
                  <span>Frequency: {ctrl.frequency}</span>
                  <span>•</span>
                  <span>Sample Size: {ctrl.sampleSize}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
