import React from 'react';
import { THEME_PRESETS, ThemePreset } from '../../context/ThemeContext';

const PRESET_LABELS: Record<ThemePreset, string> = {
  ledger: 'Ledger (default)',
  porcelain: 'Porcelain',
  bone: 'Bone',
};

const Swatch: React.FC<{ label: string; color: string; bordered?: boolean }> = ({
  label,
  color,
  bordered,
}) => (
  <div className="flex flex-col items-start gap-1">
    <div
      className={`w-14 h-9 rounded-lg ${bordered ? 'border border-hairline' : ''}`}
      style={{ backgroundColor: color }}
    />
    <span className="text-apple-11 text-secondary">{label}</span>
  </div>
);

const PresetCell: React.FC<{ preset: ThemePreset; mode: 'light' | 'dark' }> = ({
  preset,
  mode,
}) => (
  <div
    data-preset={preset}
    data-testid={`palette-${preset}-${mode}`}
    className={`${mode === 'dark' ? 'dark ' : ''}rounded-2xl p-5 space-y-4 border border-hairline`}
    style={{ backgroundColor: 'var(--canvas)', color: 'var(--text-primary)' }}
  >
    <div className="flex items-baseline justify-between">
      <h3 className="font-serif-title text-apple-20 font-bold" style={{ color: 'var(--text-primary)' }}>
        {PRESET_LABELS[preset]}
      </h3>
      <span className="text-apple-11 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        {mode}
      </span>
    </div>

    <div
      className="rounded-xl p-4 space-y-2 border border-hairline"
      style={{ backgroundColor: 'var(--surface)' }}
    >
      <div className="text-apple-13 font-semibold" style={{ color: 'var(--text-primary)' }}>
        Primary text on surface
      </div>
      <div className="text-apple-12" style={{ color: 'var(--text-secondary)' }}>
        Secondary text on surface
      </div>
      <div className="text-apple-12" style={{ color: 'var(--text-tertiary)' }}>
        Tertiary text on surface
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <span
          className="px-2 py-0.5 rounded text-apple-11 font-semibold"
          style={{ color: 'var(--accent-verdigris)', backgroundColor: 'var(--accent-verdigris-subtle)' }}
        >
          Sealed / pass
        </span>
        <span
          className="px-2 py-0.5 rounded text-apple-11 font-semibold"
          style={{ color: 'var(--accent-cinnabar)', backgroundColor: 'var(--accent-cinnabar-subtle)' }}
        >
          Exception / overdue
        </span>
      </div>
      <button
        type="button"
        className="mt-1 px-4 py-2 rounded-xl text-apple-13 font-semibold"
        style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
      >
        Primary button
      </button>
    </div>

    <div className="flex flex-wrap gap-3">
      <Swatch label="canvas" color="var(--canvas)" bordered />
      <Swatch label="surface" color="var(--surface)" bordered />
      <Swatch label="sunken" color="var(--surface-sunken)" bordered />
      <Swatch label="text" color="var(--text-primary)" />
      <Swatch label="verdigris" color="var(--accent-verdigris)" />
      <Swatch label="cinnabar" color="var(--accent-cinnabar)" />
      <Swatch label="button" color="var(--btn-primary-bg)" />
    </div>
  </div>
);

/** /dev/palette: every preset in light and dark, side by side (Guide v7 11.4). */
export const DevPalettePage: React.FC = () => (
  <div className="min-h-screen bg-canvas text-primary px-6 py-8">
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="font-serif-title text-apple-28 font-bold tracking-tight">Palette presets</h1>
        <p className="text-apple-13 text-secondary mt-1">
          3 presets × light / dark = 6 variants. Verdigris = pass / sealed. Cinnabar = exception /
          overdue. Brass is reserved for money.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {THEME_PRESETS.map((preset) => (
          <React.Fragment key={preset}>
            <PresetCell preset={preset} mode="light" />
            <PresetCell preset={preset} mode="dark" />
          </React.Fragment>
        ))}
      </div>
    </div>
  </div>
);
