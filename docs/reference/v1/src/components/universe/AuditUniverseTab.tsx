import React from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { useApp } from '../../context/AppContext';
import { HoverPreview } from '../common/HoverPreview';
import { AuditEntity } from '../../types';
import { Shield, AlertTriangle, Layers, ArrowRight, Activity } from 'lucide-react';

export const AuditUniverseTab: React.FC = () => {
  const { scopedUniverses, scopedEntities, selectedUniverseId } = useScopedData();
  const { openInspector } = useApp();

  const currentUniverse =
    scopedUniverses.find((u) => u.id === selectedUniverseId) || scopedUniverses[0];

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'high':
      case 'critical':
        return 'text-cinnabar bg-cinnabar-subtle border-cinnabar';
      case 'medium':
        return 'text-amber bg-amber-subtle border-amber';
      default:
        return 'text-verdigris bg-verdigris-subtle border-verdigris';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Editorial Header */}
      <div className="border-b border-hairline pb-6">
        <span className="text-apple-12 font-medium tracking-wide uppercase text-accent">
          Strategic Internal Risk Assessment (SIRA)
        </span>
        <h1 className="text-apple-28 font-bold text-primary tracking-tight mt-1">
          Audit Universe &amp; Entity Heatmap
        </h1>
        <p className="text-apple-15 text-secondary mt-1">
          {currentUniverse ? (
            <span>
              Universe:{' '}
              <strong className="text-primary font-semibold">{currentUniverse.name}</strong> (
              {currentUniverse.code}) • {scopedEntities.length} Auditable Entities Scoped
            </span>
          ) : (
            'Scoped auditable entities and quantitative risk profiles'
          )}
        </p>
      </div>

      {/* Entity Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {scopedEntities.map((entity) => {
          const previewData = {
            title: entity.name,
            category: `Department: ${entity.department} • Code: ${entity.code}`,
            subtitle: `Head of Department: ${entity.headOfDepartment}`,
            status: `SIRA Score: ${entity.siraScore}/100`,
            statusType:
              entity.siraScore >= 75
                ? ('cinnabar' as const)
                : entity.siraScore >= 50
                ? ('amber' as const)
                : ('verdigris' as const),
            metrics: [
              { label: 'Inherent Risk', value: entity.inherentRisk.toUpperCase() },
              { label: 'Residual Risk', value: entity.residualRisk.toUpperCase() },
              { label: 'Controls Active', value: entity.controlsCount },
              { label: 'Last Audit', value: entity.lastAuditDate },
            ],
            hint: 'Click to open SIRA factor matrix & RCM',
          };

          return (
            <HoverPreview key={entity.id} content={previewData} className="w-full">
              <div
                onClick={() => openInspector('sira', { entity })}
                className="p-6 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-apple-11 font-medium text-secondary uppercase tracking-wider">
                      {entity.department}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-apple-11 font-semibold uppercase ${getRiskBadge(
                        entity.inherentRisk
                      )}`}
                    >
                      {entity.inherentRisk} Risk
                    </span>
                  </div>
                  <h3 className="text-apple-15 font-semibold text-primary">{entity.name}</h3>
                  <p className="text-apple-12 text-secondary mt-1">
                    Head: {entity.headOfDepartment}
                  </p>
                </div>

                <div className="pt-4 border-t border-hairline flex items-center justify-between text-apple-12">
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-accent stroke-[1.5]" />
                    <span className="text-secondary">SIRA Index:</span>
                    <span className="font-semibold text-primary tabular-nums">
                      {entity.siraScore}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-accent font-medium text-apple-11">
                    <span>Inspect RCM</span>
                    <ArrowRight className="w-3.5 h-3.5 stroke-[1.5]" />
                  </div>
                </div>
              </div>
            </HoverPreview>
          );
        })}
      </div>
    </div>
  );
};
