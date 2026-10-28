import React, { useEffect, useState } from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { useApp } from '../../context/AppContext';
import { HoverPreview } from '../common/HoverPreview';
import { StandardsAffordance } from '../explain/StandardsAffordance';
import { AuditEntity } from '../../types';
import { Shield, AlertTriangle, Layers, ArrowRight, Activity, CheckCircle2 } from '../common/Icons';
import { hasRight } from '../../lib/rights';
import { listEntities, type EntityRow } from '../../data/universe';

/**
 * Audit Universe & entity heatmap (spec §6). Every entity card opens the entity-approval flow in the
 * sliding inspector; the approval itself is decided by rights in the database.
 */
export const AuditUniverseTab: React.FC = () => {
  const { scopedUniverses, scopedEntities, selectedUniverseId } = useScopedData();
  const { openInspector, addEntity, currentUser } = useApp();
  const canAdd = hasRight(currentUser, 'edit_config');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', code: '', department: '', headOfDepartment: '', inherentRisk: 'medium' as 'low' | 'medium' | 'high' | 'critical' });
  const [dbEntities, setDbEntities] = useState<EntityRow[]>([]);

  const currentUniverse =
    scopedUniverses.find((u) => u.id === selectedUniverseId) || scopedUniverses[0];

  // The approval flow reads the entities the database actually holds for this session (RLS decides
  // visibility). With no configured client the list is empty and the seeded cards are shown alone.
  useEffect(() => {
    let live = true;
    listEntities()
      .then((rows) => {
        if (live) setDbEntities(rows);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [currentUniverse?.id]);

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'high':
      case 'critical':
        return 'text-cinnabar bg-cinnabar-subtle border-cinnabar';
      case 'medium':
        return 'text-secondary bg-surface-sunken border-strong';
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
        <StandardsAffordance kind="screen" target="AU-01" screenId="AU-01" element="standards" className="mt-2" />
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

      {canAdd && (
        <div className="space-y-3">
          {!adding ? (
            <button type="button" data-testid="add-entity-open" onClick={() => setAdding(true)} className="px-4 py-2 rounded-xl bg-primary text-canvas text-apple-13 font-semibold hover:opacity-90">
              + Add auditable entity
            </button>
          ) : (
            <div data-testid="add-entity-form" className="p-5 rounded-2xl bg-surface border border-hairline shadow-apple space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {([['name', 'Entity name'], ['code', 'Code (e.g. FXD)'], ['department', 'Department'], ['headOfDepartment', 'Head of department']] as const).map(([k, label]) => (
                  <input key={k} aria-label={label} placeholder={label} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="h-9 px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
                ))}
                <select aria-label="Inherent risk" value={form.inherentRisk} onChange={(e) => setForm({ ...form, inherentRisk: e.target.value as typeof form.inherentRisk })} className="h-9 px-2 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary">
                  {['low', 'medium', 'high', 'critical'].map((r) => (<option key={r} value={r}>{r} inherent risk</option>))}
                </select>
              </div>
              {err && <p className="text-apple-12 text-cinnabar" role="alert">{err}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!currentUniverse) { setErr('No universe selected.'); return; }
                    const r = await addEntity({ ...form, universeId: currentUniverse.id });
                    if (!r.ok) { setErr(r.reason); return; }
                    setErr(null); setAdding(false);
                    setForm({ name: '', code: '', department: '', headOfDepartment: '', inherentRisk: 'medium' });
                  }}
                  className="px-4 py-2 rounded-xl bg-verdigris-subtle text-verdigris text-apple-13 font-semibold"
                >Add to {currentUniverse?.code ?? 'universe'}</button>
                <button type="button" onClick={() => { setAdding(false); setErr(null); }} className="px-4 py-2 rounded-xl border border-hairline text-apple-13 text-secondary">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

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
                ? ('neutral' as const)
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
              <div className="p-6 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors flex flex-col justify-between space-y-4">
                <div
                  onClick={() => openInspector('sira', { entity })}
                  className="cursor-pointer"
                >
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
                  <button
                    type="button"
                    data-testid={`entity-approval-open-${entity.id}`}
                    onClick={() => openInspector('entity_approval', { entity: { id: entity.id, name: entity.name, universeId: currentUniverse?.id ?? '', status: 'draft', approved: entity.inherentRisk !== 'critical', rejectionReason: null } })}
                    className="flex items-center gap-1 text-accent font-medium text-apple-11 hover:underline"
                  >
                    <span>Approval</span>
                    <ArrowRight className="w-3.5 h-3.5 stroke-[1.5]" />
                  </button>
                </div>
              </div>
            </HoverPreview>
          );
        })}
      </div>

      {/* Entities the database holds for this session, with their approval status. */}
      {dbEntities.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-apple-12 font-semibold text-secondary uppercase tracking-wider">
            Entities awaiting or holding approval ({dbEntities.length})
          </h2>
          <ul data-testid="db-entities" className="divide-y divide-hairline rounded-2xl bg-surface border border-hairline overflow-hidden">
            {dbEntities.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex items-center gap-2 text-apple-13 text-primary">
                  {e.status === 'approved' && <CheckCircle2 className="w-4 h-4 text-verdigris stroke-[1.5]" />}
                  {e.name}
                  <span
                    data-testid={`db-entity-status-${e.id}`}
                    className="px-2 py-0.5 rounded-full text-apple-11 font-semibold uppercase bg-surface-sunken text-secondary"
                  >
                    {e.status}
                  </span>
                </span>
                <button
                  type="button"
                  data-testid={`entity-approval-open-${e.id}`}
                  onClick={() => openInspector('entity_approval', { entity: e })}
                  className="px-3 py-1 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover"
                >
                  Open approval
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
