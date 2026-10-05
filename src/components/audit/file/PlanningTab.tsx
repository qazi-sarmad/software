import React from 'react';
import { AuditEngagement, AuditEntity } from '../../../types';
import { PlanningCoverage } from '../../../lib/auditFile';
import { AlertTriangle, CheckCircle2, ShieldCheck } from '../../common/Icons';

interface PlanningTabProps {
  engagement: AuditEngagement;
  entity?: AuditEntity;
  coverage: PlanningCoverage;
}

export const PlanningTab: React.FC<PlanningTabProps> = ({ engagement, entity, coverage }) => (
  <div className="space-y-6" data-testid="audit-file-planning">
    {/* SIRA context (entity level; no second risk engine) */}
    {entity ? (
      <div className="p-5 rounded-2xl bg-surface-elevated border border-hairline space-y-3" data-testid="planning-sira">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">Entity risk (SIRA)</div>
            <div className="text-apple-15 font-semibold text-primary mt-1">{entity.name}</div>
          </div>
          <div className="text-right">
            <span className="font-serif-numeral text-apple-28 font-bold text-primary tabular-nums">{entity.siraScore}</span>
            <span className="text-apple-12 text-secondary"> / 100</span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-apple-12">
          <div><span className="text-tertiary">Inherent: </span><span className="text-primary font-medium capitalize">{entity.inherentRisk}</span></div>
          <div><span className="text-tertiary">Residual: </span><span className="text-primary font-medium capitalize">{entity.residualRisk}</span></div>
          <div><span className="text-tertiary">Department: </span><span className="text-primary font-medium">{entity.department}</span></div>
          <div><span className="text-tertiary">Last audit: </span><span className="text-primary font-medium tabular-nums">{entity.lastAuditDate}</span></div>
        </div>
        <p className="text-apple-11 text-tertiary">
          Individual risk statements are not recorded for this entity yet. The ratings above and the control matrix
          below are the planning basis for {engagement.id}.
        </p>
      </div>
    ) : (
      <div className="p-5 rounded-2xl bg-surface-elevated border border-hairline text-apple-12 text-secondary" data-testid="planning-no-entity">
        No entity risk profile is available for this engagement.
      </div>
    )}

    {/* RCM with coverage */}
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
          Risk &amp; control matrix ({coverage.controlCount})
        </h3>
        {coverage.controlCount > 0 && (
          <span className="text-apple-11 text-secondary" data-testid="planning-coverage-summary">
            {coverage.coveredCount} of {coverage.controlCount} controls have a working paper
            {coverage.gapCount > 0 ? ` · ${coverage.gapCount} gap${coverage.gapCount === 1 ? '' : 's'}` : ''}
          </span>
        )}
      </div>
      {coverage.rows.length === 0 ? (
        <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="planning-empty">
          No controls are indexed for this entity yet, so key risk–control links cannot be shown.
        </div>
      ) : (
        <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
          {coverage.rows.map((r) => (
            <div key={r.control.id} className="p-4 space-y-1.5" data-testid={`rcm-row-${r.control.id}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-apple-12 font-bold text-secondary">{r.control.code}</span>
                  <span className="text-apple-13 font-medium text-primary truncate">{r.control.title}</span>
                </div>
                {r.gap ? (
                  <span
                    className="shrink-0 px-2 py-0.5 rounded text-apple-11 font-semibold text-cinnabar bg-cinnabar-subtle border border-cinnabar flex items-center gap-1"
                    data-testid={`rcm-gap-${r.control.id}`}
                  >
                    <AlertTriangle className="w-3 h-3" /> No working paper linked
                  </span>
                ) : (
                  <span className="shrink-0 px-2 py-0.5 rounded text-apple-11 font-semibold text-verdigris bg-verdigris-subtle border border-verdigris flex items-center gap-1">
                    {r.sealedCount === r.workpapers.length ? <ShieldCheck className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                    {r.workpapers.length} paper{r.workpapers.length === 1 ? '' : 's'} · {r.sealedCount} sealed
                  </span>
                )}
              </div>
              <div className="text-apple-11 text-tertiary capitalize">
                {r.control.controlType} · {r.control.frequency} · {r.control.effectiveness.replace('_', ' ')}
              </div>
              {!r.gap && (
                <div className="text-apple-11 text-secondary">
                  Tested by: {r.workpapers.map((w) => w.refCode).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);
