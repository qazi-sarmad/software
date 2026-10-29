import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import {
  emergentRiskIsValid,
  initialFactorValues,
  modelMaxPoint,
  previewScore,
  scoreMatrix,
  summariseCycle,
  validateFactorValues,
  type ExistingScore,
  type ScoringModel,
} from '../../lib/siraScoring';
import { Plus, CheckCircle2 } from '../common/Icons';

export interface SiraScoringPanelProps {
  /** The draft cycle being scored. Published cycles are frozen, so no scoring control is offered. */
  cycle: { id: string; year: number; status: 'draft' | 'published' } | null;
  universeId: string | null;
  model: ScoringModel | null;
  entities: { id: string; name: string }[];
  risks: { id: string; name: string }[];
  scores: ExistingScore[];
  onRecordScore?: (cycleId: string, entityId: string, riskId: string, factorValues: Record<string, number>) => void;
  onSubmitEmergentRisk?: (universeId: string, title: string, description: string | null) => void;
}

/**
 * S18 scoring surface. This is the panel that actually DRIVES the SIRA write path: it calls
 * `recordSiraScore` (the factor matrix, scored against a risk in the library) and
 * `submitEmergentRisk` (a manual emergent risk). Both RPCs existed and had no caller, so the
 * carry-forward pack had no scores to carry — the engine was complete and unfed.
 *
 * Pure by construction: the matrix, the counts and the preview come from `src/lib/siraScoring.ts`;
 * this component only renders them and forwards a click. It is read-only for a session without
 * `manage_engagements` (the right the RPC itself requires), never a dead button.
 */
export const SiraScoringPanel: React.FC<SiraScoringPanelProps> = ({
  cycle, universeId, model, entities, risks, scores, onRecordScore, onSubmitEmergentRisk,
}) => {
  const { currentUser } = useApp();
  const canScore = hasRight(currentUser, 'manage_engagements');
  const [entityId, setEntityId] = useState<string>('');
  const [riskId, setRiskId] = useState<string>('');
  const [values, setValues] = useState<Record<string, number>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const cells = useMemo(
    () => scoreMatrix(entities.map((e) => e.id), risks.map((r) => r.id), scores),
    [entities, risks, scores]
  );
  const summary = useMemo(() => summariseCycle(cells), [cells]);

  const effectiveValues = useMemo(() => {
    if (!model) return {};
    const base = initialFactorValues(model);
    return { ...base, ...values };
  }, [model, values]);

  const max = model ? modelMaxPoint(model) : 5;
  const validation = model ? validateFactorValues(model, effectiveValues) : { ok: false as const, reason: 'No model.' };
  const preview = model ? previewScore(model, effectiveValues) : null;

  const entityName = (id: string) => entities.find((e) => e.id === id)?.name ?? id;
  const riskName = (id: string) => risks.find((r) => r.id === id)?.name ?? id;

  const submitScore = () => {
    if (!cycle || cycle.status !== 'draft' || !onRecordScore) return;
    if (!entityId || !riskId || !validation.ok) return;
    onRecordScore(cycle.id, entityId, riskId, effectiveValues);
    setValues({});
  };

  const submitRisk = () => {
    if (!universeId || !onSubmitEmergentRisk) return;
    if (!emergentRiskIsValid(title)) return;
    onSubmitEmergentRisk(universeId, title.trim(), description.trim() || null);
    setTitle('');
    setDescription('');
  };

  return (
    <div data-testid="sira-scoring-panel" className="space-y-4 p-1">
      <div className="flex items-center justify-between">
        <h3 className="text-apple-15 font-semibold text-primary">Score a cycle</h3>
        <span data-testid="sira-scoring-summary" className="text-apple-11 text-secondary tabular-nums">
          {summary.scored} / {summary.cells} scored
          {summary.meanScore !== null ? ` · mean ${summary.meanScore}` : ''}
        </span>
      </div>

      {!cycle ? (
        <p data-testid="sira-scoring-no-cycle" className="text-apple-13 text-tertiary">
          Create a cycle first — a score belongs to one.
        </p>
      ) : cycle.status !== 'draft' ? (
        <p data-testid="sira-scoring-frozen" className="text-apple-13 text-tertiary">
          Cycle {cycle.year} is published and frozen; its scores can no longer change.
        </p>
      ) : !model ? (
        <p data-testid="sira-scoring-no-model" className="text-apple-13 text-tertiary">
          No SIRA model is configured, so there is nothing to score against.
        </p>
      ) : (
        <div className="rounded-lg border border-hairline bg-surface-sunken p-3 space-y-3">
          {!canScore ? (
            <p data-testid="sira-scoring-locked" className="text-apple-12 text-tertiary">
              {rightReason('manage_engagements')}
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-apple-11 text-secondary">
                  Entity
                  <select
                    data-testid="sira-score-entity"
                    value={entityId}
                    onChange={(e) => setEntityId(e.target.value)}
                    className="mt-1 w-full px-2 py-1 rounded border border-hairline bg-surface text-apple-12 text-primary"
                  >
                    <option value="">Select an entity</option>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-apple-11 text-secondary">
                  Risk
                  <select
                    data-testid="sira-score-risk"
                    value={riskId}
                    onChange={(e) => setRiskId(e.target.value)}
                    className="mt-1 w-full px-2 py-1 rounded border border-hairline bg-surface text-apple-12 text-primary"
                  >
                    <option value="">Select a risk</option>
                    {risks.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-1.5">
                {model.factors.map((f) => (
                  <div key={f.key} className="flex items-center justify-between gap-3">
                    <span className="text-apple-12 text-primary">{f.label}</span>
                    <div data-testid={`sira-factor-${f.key}`} className="flex gap-1">
                      {Array.from({ length: max }, (_, i) => i + 1).map((point) => (
                        <button
                          key={point}
                          type="button"
                          data-testid={`sira-factor-${f.key}-${point}`}
                          aria-pressed={effectiveValues[f.key] === point}
                          onClick={() => setValues((v) => ({ ...v, [f.key]: point }))}
                          className={`w-6 h-6 rounded text-apple-11 font-semibold tabular-nums border ${
                            effectiveValues[f.key] === point
                              ? 'bg-primary text-canvas border-primary'
                              : 'border-hairline text-secondary hover:bg-surface-hover'
                          }`}
                        >
                          {point}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <span data-testid="sira-score-preview" className="text-apple-12 text-secondary">
                  Preview:{' '}
                  <span className="font-semibold text-primary tabular-nums">
                    {preview !== null ? preview : '—'}
                  </span>
                  {!validation.ok && <span className="ml-2 text-cinnabar">{validation.reason}</span>}
                </span>
                <button
                  type="button"
                  data-testid="sira-record-score"
                  disabled={!entityId || !riskId || !validation.ok}
                  onClick={submitScore}
                  className="px-3 py-1 rounded-lg bg-primary text-canvas text-apple-12 font-semibold disabled:opacity-50"
                >
                  Record score
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* S18: a manual emergent risk — the other half of the write path that had no caller. */}
      <div className="rounded-lg border border-hairline bg-surface-sunken p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Plus className="w-3.5 h-3.5 stroke-[1.5] text-secondary" />
          <span className="text-apple-13 font-semibold text-primary">Submit an emergent risk</span>
        </div>
        {!universeId || !canScore ? (
          <p data-testid="emergent-submit-locked" className="text-apple-11 text-tertiary">
            {!universeId ? 'Select a universe first.' : rightReason('manage_engagements')}
          </p>
        ) : (
          <>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Risk title"
              data-testid="emergent-submit-title"
              className="w-full px-2 py-1 rounded border border-hairline bg-surface text-apple-12 text-primary"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why it emerged (optional)"
              data-testid="emergent-submit-description"
              rows={2}
              className="w-full px-2 py-1 rounded border border-hairline bg-surface text-apple-12 text-primary"
            />
            <button
              type="button"
              data-testid="emergent-submit"
              disabled={!emergentRiskIsValid(title)}
              onClick={submitRisk}
              className="px-3 py-1 rounded-lg bg-primary text-canvas text-apple-12 font-semibold disabled:opacity-50 flex items-center gap-1"
            >
              <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.5]" /> Submit
            </button>
          </>
        )}
      </div>

      {/* The scored cells, so the counts are explainable (E4/E5). */}
      {cells.some((c) => c.score !== null) && (
        <ul data-testid="sira-score-list" className="space-y-1 text-apple-11">
          {cells.filter((c) => c.score !== null).map((c) => (
            <li key={`${c.entityId}::${c.riskId}`} className="flex justify-between gap-3 text-secondary">
              <span className="truncate">{entityName(c.entityId)} · {riskName(c.riskId)}</span>
              <span className="tabular-nums">{c.score}{c.band ? ` · ${c.band}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
