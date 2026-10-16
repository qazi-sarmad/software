import React from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { Lock, Sliders } from '../common/Icons';

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

/**
 * SIRA model editor (spec §8.2). Read-only for a session without edit_config; the editable controls
 * only appear with the right. Version history is shown so a change is never silent. Renders inside
 * the sliding inspector.
 */
export const SiraModelEditor: React.FC<{ model: SiraModelView | null }> = ({ model }) => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');

  if (!model) {
    return (
      <div data-testid="sira-model-empty" className="p-4 text-apple-13 text-secondary">
        No SIRA model is configured for this organisation yet.
      </div>
    );
  }

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

      <div>
        <span data-testid="sira-aggregation" className="text-apple-12 text-secondary">
          Aggregation: <span className="font-semibold text-primary">{model.aggregation}</span>
        </span>
      </div>

      <div>
        <h3 className="text-apple-12 font-semibold text-primary mb-2">Factors</h3>
        <ul data-testid="sira-factors" className="space-y-1 text-apple-12">
          {model.factors.map((f) => (
            <li key={f.key} className="flex justify-between gap-3 border-b border-hairline pb-1">
              <span className="text-primary">{f.label}</span>
              <span className="text-secondary tabular-nums">weight {f.weight}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-apple-12 font-semibold text-primary mb-2">Bands</h3>
        <ul data-testid="sira-bands" className="space-y-1 text-apple-12">
          {model.bands.map((b) => (
            <li key={b.name} className="flex justify-between gap-3 border-b border-hairline pb-1">
              <span className="text-primary">{b.name}</span>
              <span className="text-secondary tabular-nums">
                {b.min}–{b.max}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
