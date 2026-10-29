import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { Lock, Sliders } from '../common/Icons';
import { ExplainPopout } from '../explain/ExplainPopout';
import { StandardsAffordance } from '../explain/StandardsAffordance';
import { InlineError } from '../common/InlineError';

/** The aggregation methods the database accepts (0019_sira_model.sql `admin_set_sira_aggregation`). */
export const SIRA_AGGREGATIONS = [
  'weighted_sum',
  'maximum',
  'weighted_average',
  'weighted_average_floor',
] as const;

export interface SiraFactor {
  key: string;
  label: string;
  weight: number;
  ordinal: number;
}

export interface SiraBand {
  name: string;
  min: number;
  max: number;
  ordinal: number;
}

export interface SiraModelView {
  aggregation: string;
  version: number;
  factors: SiraFactor[];
  scales: { point: number; label: string }[];
  bands: SiraBand[];
}

export interface SiraModelEditorProps {
  model: SiraModelView | null;
  /** A write is in flight. The controls are disabled so a double-submit cannot fire. */
  busy?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  onSetAggregation?: (method: string) => void;
  onUpsertFactor?: (key: string, label: string, weight: number, ordinal: number) => void;
  onSetBand?: (name: string, min: number, max: number, ordinal: number) => void;
}

const field =
  'w-full px-2.5 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12';

/**
 * SIRA model editor (spec §8.2, S18). Read-only for a session without `edit_config`; the editable
 * controls only appear with the right, and each one is a real write — the three setters
 * (`admin_set_sira_aggregation`, `admin_upsert_sira_factor`, `admin_set_sira_band`) are handed in by
 * the connected inspector, so this component stays presentational and testable without a database.
 * Every change is versioned by the database, so a change is never silent.
 */
export const SiraModelEditor: React.FC<SiraModelEditorProps> = ({
  model,
  busy = false,
  error = null,
  onDismissError,
  onSetAggregation,
  onUpsertFactor,
  onSetBand,
}) => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');
  const [factorDraft, setFactorDraft] = useState<SiraFactor>({ key: '', label: '', weight: 1, ordinal: 0 });
  const [bandDraft, setBandDraft] = useState<SiraBand>({ name: '', min: 0, max: 0, ordinal: 0 });

  if (!model) {
    return (
      <div data-testid="sira-model-empty" className="p-4 text-apple-13 text-secondary">
        No SIRA model is configured for this organisation yet.
      </div>
    );
  }

  const editable = canEdit && !!onSetAggregation && !!onUpsertFactor && !!onSetBand;

  return (
    <div data-testid="sira-model" className="space-y-4 p-1">
      <div className="flex items-center gap-2">
        <Sliders className="w-5 h-5 text-accent stroke-[1.5]" />
        <span className="text-apple-15 font-semibold text-primary">SIRA model</span>
        <span data-testid="sira-model-version" className="px-2 py-0.5 rounded-full text-apple-11 font-semibold tabular-nums bg-surface-sunken text-secondary">
          v{model.version}
        </span>
        {!canEdit && (
          <span data-testid="sira-model-locked" className="flex items-center gap-1 text-apple-11 text-tertiary">
            <Lock className="w-3.5 h-3.5 stroke-[1.5]" /> Read only
          </span>
        )}
      </div>

      <StandardsAffordance kind="screen" target="SR-02" screenId="SR-02" element="standards" />

      <InlineError message={error} testId="sira-model-error" onDismiss={onDismissError} />

      <div>
        {editable ? (
          <label className="block text-apple-12 text-secondary space-y-1">
            <ExplainPopout explainId="field.sira.aggregation" screenId="SR-02" element="explain-aggregation">
              <span>Aggregation</span>
            </ExplainPopout>
            <select
              data-testid="sira-model-aggregation"
              value={model.aggregation}
              disabled={busy}
              onChange={(e) => onSetAggregation!(e.target.value)}
              className={field}
            >
              {SIRA_AGGREGATIONS.map((m) => (
                <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
        ) : (
          <span data-testid="sira-aggregation" className="text-apple-12 text-secondary">
            Aggregation: <span className="font-semibold text-primary">{model.aggregation}</span>
          </span>
        )}
      </div>

      <div>
        <h3 className="text-apple-12 font-semibold text-primary mb-2">Factors</h3>
        <ul data-testid="sira-factors" className="space-y-1 text-apple-12">
          {model.factors.map((f) => (
            <li key={f.key} className="flex justify-between gap-3 border-b border-hairline pb-1">
              <span className="text-primary">{f.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-secondary tabular-nums">weight {f.weight}</span>
                {editable && (
                  <button
                    type="button"
                    data-testid={`sira-factor-edit-${f.key}`}
                    disabled={busy}
                    onClick={() => setFactorDraft({ ...f })}
                    className="text-apple-11 font-medium underline text-secondary hover:text-primary"
                  >
                    Edit
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {editable && (
          <div className="mt-2 space-y-2 rounded-xl border border-hairline bg-surface p-2" data-testid="sira-factor-form">
            <div className="grid grid-cols-2 gap-2">
              <input data-testid="sira-factor-key" aria-label="Factor key" placeholder="key" value={factorDraft.key} disabled={busy}
                onChange={(e) => setFactorDraft({ ...factorDraft, key: e.target.value })} className={field} />
              <input data-testid="sira-factor-label" aria-label="Factor label" placeholder="label" value={factorDraft.label} disabled={busy}
                onChange={(e) => setFactorDraft({ ...factorDraft, label: e.target.value })} className={field} />
              <input data-testid="sira-factor-weight" aria-label="Factor weight" type="number" placeholder="weight" value={factorDraft.weight} disabled={busy}
                onChange={(e) => setFactorDraft({ ...factorDraft, weight: Number(e.target.value) })} className={field} />
              <input data-testid="sira-factor-ordinal" aria-label="Factor ordinal" type="number" placeholder="ordinal" value={factorDraft.ordinal} disabled={busy}
                onChange={(e) => setFactorDraft({ ...factorDraft, ordinal: Number(e.target.value) })} className={field} />
            </div>
            <button
              type="button"
              data-testid="sira-factor-save"
              disabled={busy || factorDraft.key.trim() === ''}
              onClick={() => onUpsertFactor!(factorDraft.key.trim(), factorDraft.label.trim() || factorDraft.key.trim(), factorDraft.weight, factorDraft.ordinal)}
              className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              Save factor
            </button>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-apple-12 font-semibold text-primary mb-2">Bands</h3>
        <ul data-testid="sira-bands" className="space-y-1 text-apple-12">
          {model.bands.map((b) => (
            <li key={b.name} className="flex justify-between gap-3 border-b border-hairline pb-1">
              <span className="text-primary">{b.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-secondary tabular-nums">
                  {b.min}–{b.max}
                </span>
                {editable && (
                  <button
                    type="button"
                    data-testid={`sira-band-edit-${b.name}`}
                    disabled={busy}
                    onClick={() => setBandDraft({ ...b })}
                    className="text-apple-11 font-medium underline text-secondary hover:text-primary"
                  >
                    Edit
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {editable && (
          <div className="mt-2 space-y-2 rounded-xl border border-hairline bg-surface p-2" data-testid="sira-band-form">
            <div className="grid grid-cols-2 gap-2">
              <input data-testid="sira-band-name" aria-label="Band name" placeholder="name" value={bandDraft.name} disabled={busy}
                onChange={(e) => setBandDraft({ ...bandDraft, name: e.target.value })} className={field} />
              <input data-testid="sira-band-ordinal" aria-label="Band ordinal" type="number" placeholder="ordinal" value={bandDraft.ordinal} disabled={busy}
                onChange={(e) => setBandDraft({ ...bandDraft, ordinal: Number(e.target.value) })} className={field} />
              <input data-testid="sira-band-min" aria-label="Band minimum" type="number" placeholder="min" value={bandDraft.min} disabled={busy}
                onChange={(e) => setBandDraft({ ...bandDraft, min: Number(e.target.value) })} className={field} />
              <input data-testid="sira-band-max" aria-label="Band maximum" type="number" placeholder="max" value={bandDraft.max} disabled={busy}
                onChange={(e) => setBandDraft({ ...bandDraft, max: Number(e.target.value) })} className={field} />
            </div>
            <button
              type="button"
              data-testid="sira-band-save"
              disabled={busy || bandDraft.name.trim() === '' || bandDraft.min >= bandDraft.max}
              onClick={() => onSetBand!(bandDraft.name.trim(), bandDraft.min, bandDraft.max, bandDraft.ordinal)}
              className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              Save band
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
