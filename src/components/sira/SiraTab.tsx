import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { Shield, ChevronDown } from '../common/Icons';
import { InlineError } from '../common/InlineError';
import { StandardsAffordance } from '../explain/StandardsAffordance';
import { listCycles, listEmergentRisks, siraModelSnapshot, type SiraCycle, type SiraEmergentRisk, type SiraModel } from '../../data/sira';
import { latestPlanForUniverse, planHistory, type PlanRow, type PlanVersionRow } from '../../data/plan';
import { isUuid } from '../../lib/ids';

interface PersistedSira {
  model: SiraModel | null;
  cycles: SiraCycle[];
  emergent: SiraEmergentRisk[];
  plan: PlanRow | null;
  versions: PlanVersionRow[];
}

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
  const { currentUser, scopedUniverses, selectedUniverseId, scopedEntities, scopedControls, scopedObservations, scopedWorkpapers } = useScopedData();
  const [open, setOpen] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<PersistedSira | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const universe = scopedUniverses.find((u) => u.id === selectedUniverseId) ?? scopedUniverses[0];

  // R6a: load the persisted SIRA model, cycles and plan for the selected universe through src/data.
  // Every read is org-scoped by RLS; a failure shows an inline error, never a blocking dialog.
  // The development demo seed uses readable universe ids (e.g. `u-gbm`) that are not database ids;
  // sending one to a uuid column is a Postgres error, so those reads are skipped, not attempted.
  useEffect(() => {
    const universeId = isUuid(universe?.id) ? universe!.id : null;
    const orgId = isUuid(currentUser.orgId) ? currentUser.orgId! : null;
    if (!universeId && !orgId) {
      setPersisted(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const model = orgId ? await siraModelSnapshot(orgId) : null;
        const cycles = universeId ? await listCycles(universeId) : [];
        const emergent = universeId ? await listEmergentRisks(universeId) : [];
        const plan = universeId ? await latestPlanForUniverse(universeId) : null;
        const versions = plan ? await planHistory(plan.id) : [];
        if (!cancelled) setPersisted({ model, cycles, emergent, plan, versions });
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load SIRA records.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [universe?.id, currentUser.orgId]);

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
        <StandardsAffordance kind="screen" target="SR-01" screenId="SR-01" element="standards" className="mt-2" />
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            data-testid="sira-open-model"
            onClick={() => openInspector('sira_model', { model: null })}
            className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover"
          >
            SIRA model
          </button>
          <button
            type="button"
            data-testid="sira-open-cycles"
            onClick={() => openInspector('sira_cycles', { universeId: isUuid(universe?.id) ? universe!.id : undefined })}
            className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover"
          >
            Cycles &amp; emergent risks
          </button>
        </div>
      </div>

      <InlineError message={loadError} testId="sira-load-error" />

      {/* R6a: the persisted records for this universe, read through src/data. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="sira-persisted">
        <div className="rounded-2xl bg-surface border border-hairline p-4" data-testid="sira-persisted-model">
          <div className="text-apple-11 uppercase tracking-wider text-secondary">SIRA model</div>
          {persisted?.model ? (
            <p className="mt-1 text-apple-13 text-primary">
              v{persisted.model.version} · {persisted.model.aggregation} · {persisted.model.factors.length} factors
            </p>
          ) : (
            <p className="mt-1 text-apple-13 text-tertiary">No model loaded.</p>
          )}
        </div>
        <div className="rounded-2xl bg-surface border border-hairline p-4" data-testid="sira-persisted-cycles">
          <div className="text-apple-11 uppercase tracking-wider text-secondary">Annual cycles</div>
          {persisted && persisted.cycles.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-apple-13 text-primary">
              {persisted.cycles.slice(0, 4).map((c) => (
                <li key={c.id}>{c.year} · <span className="capitalize text-secondary">{c.status}</span></li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-apple-13 text-tertiary">No cycles yet.</p>
          )}
        </div>
        <div className="rounded-2xl bg-surface border border-hairline p-4" data-testid="sira-persisted-plan">
          <div className="text-apple-11 uppercase tracking-wider text-secondary">Audit plan</div>
          {persisted?.plan ? (
            <>
              <p className="mt-1 text-apple-13 text-primary">
                {persisted.plan.period ?? '—'} · <span className="capitalize text-secondary">{persisted.plan.status}</span> · v{persisted.plan.currentVersion}
              </p>
              <p className="text-apple-11 text-tertiary">{persisted.versions.length} version{persisted.versions.length === 1 ? '' : 's'} recorded</p>
            </>
          ) : (
            <p className="mt-1 text-apple-13 text-tertiary">No plan for this universe yet.</p>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline p-10 text-center text-secondary text-apple-13">No entities in scope.</div>
      ) : (
        <div className="rounded-2xl bg-surface border border-hairline shadow-apple overflow-x-auto" data-testid="sira-table">
          <table className="w-full text-apple-13 min-w-[720px]">
            <thead>
              <tr className="text-left text-apple-11 uppercase tracking-wider text-secondary border-b border-hairline">
                <th className="p-3 w-10">#</th><th className="p-3">Entity</th><th className="p-3">Inherent</th><th className="p-3">Residual</th>
                <th className="p-3">Controls weak / total</th><th className="p-3">Observations</th><th className="p-3">Last audit</th><th className="p-3">Index</th><th className="p-3 w-8" />
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
                            <h3 className="text-apple-12 font-semibold text-primary mb-2">Prior &amp; open observations ({findings.length})</h3>
                            {findings.length === 0 ? <p className="text-apple-12 text-tertiary">No observations recorded.</p> : (
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
