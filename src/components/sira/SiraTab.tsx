import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { Shield, ChevronDown } from '../common/Icons';

const band = (score: number) => (score >= 75 ? 'Critical' : score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low');
const bandClass = (score: number) =>
  score >= 75 ? 'bg-cinnabar text-canvas' : score >= 50 ? 'bg-cinnabar-subtle text-cinnabar' : score >= 25 ? 'bg-surface-sunken text-secondary' : 'bg-verdigris-subtle text-verdigris';
const RATING = { low: 1, medium: 2, high: 3, critical: 4 } as const;

/**
 * SIRA (Guide v7 §5.5), first cut: every entity in the selected universe, ranked, with the inputs
 * we actually hold today (inherent/residual rating, control results, findings, time since last audit).
 * NOT yet the annual six-dimension weighted cycle, heatmap or emergent-risk queue.
 */
export const SiraTab: React.FC = () => {
  const { openInspector } = useApp();
  const { scopedUniverses, selectedUniverseId, scopedEntities, scopedControls, scopedObservations, scopedWorkpapers } = useScopedData();
  const [open, setOpen] = useState<string | null>(null);
  const universe = scopedUniverses.find((u) => u.id === selectedUniverseId) ?? scopedUniverses[0];

  const rows = useMemo(
    () =>
      [...scopedEntities]
        .sort((a, b) => b.siraScore - a.siraScore)
        .map((e) => {
          const controls = scopedControls.filter((c) => c.entityId === e.id);
          const wpIds = new Set(scopedWorkpapers.filter((w) => w.entityId === e.id).map((w) => w.id));
          const findings = scopedObservations.filter((o) => o.entityId === e.id || wpIds.has(o.workpaperId));
          const weak = controls.filter((c) => c.effectiveness === 'ineffective' || c.effectiveness === 'needs_improvement').length;
          return { e, controls, findings, weak };
        }),
    [scopedEntities, scopedControls, scopedObservations, scopedWorkpapers]
  );

  return (
    <section data-testid="tab-sira" className="max-w-7xl mx-auto px-6 py-8 min-h-[60vh] space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-secondary text-apple-12 font-medium uppercase tracking-wider">
          <Shield className="w-4 h-4 stroke-[1.3]" /><span>Strategic Internal Risk Assessment</span>
        </div>
        <h1 className="font-serif-title text-apple-28 font-bold text-primary tracking-tight">SIRA</h1>
        <p className="text-apple-13 text-secondary">
          {universe ? `${universe.name} (${universe.code})` : 'No universe in scope'} · {rows.length} entities ranked by risk index
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline p-10 text-center text-secondary text-apple-13">No entities in scope.</div>
      ) : (
        <div className="rounded-2xl bg-surface border border-hairline shadow-apple overflow-x-auto" data-testid="sira-table">
          <table className="w-full text-apple-13 min-w-[720px]">
            <thead>
              <tr className="text-left text-apple-11 uppercase tracking-wider text-secondary border-b border-hairline">
                <th className="p-3 w-10">#</th><th className="p-3">Entity</th><th className="p-3">Inherent</th><th className="p-3">Residual</th>
                <th className="p-3">Controls weak / total</th><th className="p-3">Findings</th><th className="p-3">Last audit</th><th className="p-3">Index</th><th className="p-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, controls, findings, weak }, i) => (
                <React.Fragment key={e.id}>
                  <tr className="border-b border-hairline hover:bg-surface-hover cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <td className="p-3 text-tertiary tabular-nums">{i + 1}</td>
                    <td className="p-3"><div className="font-semibold text-primary">{e.name}</div><div className="text-apple-11 text-tertiary">{e.department}</div></td>
                    <td className="p-3 capitalize">{e.inherentRisk}</td>
                    <td className="p-3 capitalize">{e.residualRisk}{RATING[e.residualRisk] > RATING[e.inherentRisk] ? ' ↑' : ''}</td>
                    <td className="p-3 tabular-nums">{weak} / {controls.length}</td>
                    <td className="p-3 tabular-nums">{findings.length}</td>
                    <td className="p-3 tabular-nums text-secondary">{e.lastAuditDate}</td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-apple-11 font-semibold tabular-nums ${bandClass(e.siraScore)}`}>{e.siraScore} · {band(e.siraScore)}</span></td>
                    <td className="p-3"><ChevronDown className={`w-4 h-4 stroke-[1.5] text-secondary transition-transform ${open === e.id ? 'rotate-180' : ''}`} /></td>
                  </tr>
                  {open === e.id && (
                    <tr className="bg-surface-sunken border-b border-hairline" data-testid={`sira-detail-${e.id}`}>
                      <td colSpan={9} className="p-4 space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <h3 className="text-apple-12 font-semibold text-primary mb-2">Risks &amp; controls ({controls.length})</h3>
                            {controls.length === 0 ? <p className="text-apple-12 text-tertiary">No controls registered for this entity.</p> : (
                              <ul className="space-y-1">
                                {controls.map((c) => (
                                  <li key={c.id} className="flex justify-between gap-3 text-apple-12"><span className="text-primary truncate">{c.code} · {c.title}</span>
                                    <span className={`shrink-0 capitalize ${c.effectiveness === 'ineffective' ? 'text-cinnabar font-semibold' : 'text-secondary'}`}>{c.effectiveness.replace(/_/g, ' ')}</span></li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <h3 className="text-apple-12 font-semibold text-primary mb-2">Prior &amp; open findings ({findings.length})</h3>
                            {findings.length === 0 ? <p className="text-apple-12 text-tertiary">No findings recorded.</p> : (
                              <ul className="space-y-1">
                                {findings.map((o) => (<li key={o.id} className="flex justify-between gap-3 text-apple-12"><span className="text-primary truncate">{o.title}</span><span className="shrink-0 capitalize text-secondary">{o.severity} · {o.status}</span></li>))}
                              </ul>
                            )}
                          </div>
                        </div>
                        <button type="button" onClick={() => openInspector('sira', { entity: e })} className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover">Open factor matrix &amp; RCM</button>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
