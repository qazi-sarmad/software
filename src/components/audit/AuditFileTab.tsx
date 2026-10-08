import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { Folder, ShieldCheck } from '../common/Icons';
import { Select } from '../common/Select';
import { isCommentOpen } from '../../lib/comments';

const STAGES = ['planning', 'testing', 'conclusion'] as const;

/**
 * Audit File tab (Guide v7 §5.6): one card per engagement in scope, filterable by entity.
 * Opening a card launches the Audit File workspace (centre-stage, per owner decision).
 */
export const AuditFileTab: React.FC = () => {
  const { openInspector, selectedEngagementId } = useApp();
  const { scopedEngagements, scopedEntities, scopedWorkpapers, scopedComments } = useScopedData();
  const [entityId, setEntityId] = useState<string>('all');

  const entityName = (id: string) => scopedEntities.find((e) => e.id === id)?.name ?? 'Entity';
  const list = useMemo(
    () => scopedEngagements.filter((e) => entityId === 'all' || e.entityId === entityId),
    [scopedEngagements, entityId]
  );

  return (
    <section data-testid="tab-audit-file" className="max-w-7xl mx-auto px-6 py-8 min-h-[60vh] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-secondary text-apple-12 font-medium uppercase tracking-wider">
            <Folder className="w-4 h-4 stroke-[1.3]" />
            <span>Audit File</span>
          </div>
          <h1 className="font-serif-title text-apple-28 font-bold text-primary tracking-tight">Engagement files</h1>
          <p className="text-apple-13 text-secondary">
            {list.length} {list.length === 1 ? 'engagement' : 'engagements'} · open one to work on its planning, testing and conclusion.
          </p>
        </div>
        <Select
          ariaLabel="Filter by audit entity"
          value={entityId}
          onChange={setEntityId}
          align="right"
          options={[
            { value: 'all', label: 'All entities', hint: `${scopedEntities.length} in scope` },
            ...scopedEntities.map((e) => ({ value: e.id, label: e.name })),
          ]}
        />
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline p-10 text-center text-secondary text-apple-13">
          No engagements available for this selection.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((eng) => {
            const wps = scopedWorkpapers.filter((w) => w.engagementId === eng.id);
            const wpIds = new Set(wps.map((w) => w.id));
            const open = scopedComments.filter((c) => wpIds.has(c.workpaperId) && isCommentOpen(c)).length;
            const stageIdx = Math.max(0, STAGES.indexOf(eng.stage as (typeof STAGES)[number]));
            const signed = eng.status === 'signed_off';
            const overdue = !signed && eng.dueDate < '2026-09-30';
            return (
              <button
                key={eng.id}
                type="button"
                data-testid={`audit-card-${eng.id}`}
                onClick={() => openInspector('audit_file', { engagement: eng })}
                className={`text-left rounded-2xl bg-surface border p-5 shadow-apple space-y-4 transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent ${
                  selectedEngagementId === eng.id ? 'border-accent' : 'border-hairline'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-apple-11 text-tertiary font-mono">{eng.id}</div>
                    <h2 className="text-apple-15 font-semibold text-primary leading-snug">{eng.title}</h2>
                    <div className="text-apple-12 text-secondary truncate">{entityName(eng.entityId)}</div>
                  </div>
                  {signed ? (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-verdigris-subtle text-verdigris flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" /> Sealed
                    </span>
                  ) : overdue ? (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar">Overdue</span>
                  ) : null}
                </div>

                <div>
                  <div className="flex gap-1.5">
                    {STAGES.map((s, i) => (
                      <div key={s} className={`h-1.5 flex-1 rounded-full ${i < stageIdx || signed ? 'bg-verdigris' : i === stageIdx ? 'bg-primary' : 'bg-surface-sunken'}`} />
                    ))}
                  </div>
                  <div className="flex justify-between mt-1.5 text-apple-11 text-tertiary capitalize">
                    {STAGES.map((s) => (<span key={s} className={s === eng.stage ? 'text-primary font-semibold' : ''}>{s}</span>))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-hairline text-apple-11 text-secondary tabular-nums">
                  <span>Due {eng.dueDate}</span>
                  <span>{wps.length} papers</span>
                  <span className={open > 0 ? 'text-cinnabar font-semibold' : ''}>{open} open comments</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
