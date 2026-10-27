import React, { useMemo, useState } from 'react';
import { figureSvg, figureError, type FigureSpec } from '../../lib/render/figure';
import { FORMULA_FUNCTIONS, FORMULA_BINARY_FUNCTIONS, FORMULA_CONSTANTS, FORMULA_LIMITS } from '../../lib/render/formula';
import { REPORT_PALETTE } from '../../lib/writing/reportFormat';

/**
 * Formula figure studio (WP-G).
 *
 * A report may carry a deterministic graphic drawn from a formula. This panel is the whole surface: a
 * client types an expression, picks a domain and a colour, and sees the figure live. Every value the
 * client can set is validated by the pure engine before it is drawn, so the preview can never show a
 * figure the printed page would refuse — and because the same engine feeds the PDF and the DOCX, what
 * is previewed here is exactly what is printed.
 *
 * The panel is presentational: it computes through `figureSvg`/`figureError` only, writes nothing, and
 * calls no data function. The chosen figure is handed back through `onPick` for the caller to store.
 */
export interface FigureStudioProps {
  prefix?: string;
  /** Called with a renderable figure when the client adds it to the report. */
  onPick?: (figure: FigureSpec) => void;
  /** The colour the figure starts on: the org's accent, resolved by the caller. */
  defaultColour?: string;
}

/** The colour a new figure starts on: the curated palette's verdigris, so no component writes a
 *  colour literal (the token guard rejects one) while the figure is still branded by default. */
const DEFAULT_COLOUR = REPORT_PALETTE.find((c) => c.name === 'Verdigris')!.value;

const DEFAULT_SPEC: FigureSpec = {
  expression: 'sin(x) * x',
  minX: -6,
  maxX: 6,
  label: 'Modelled exposure',
  colour: DEFAULT_COLOUR,
  title: 'Exposure curve',
};

/** A curated set of ready-made figures, so a client can start from something that reads well. */
const PRESETS: Array<{ name: string; spec: FigureSpec }> = [
  { name: 'Exposure curve', spec: DEFAULT_SPEC },
  { name: 'Growth trend', spec: { ...DEFAULT_SPEC, expression: '2 ^ x', minX: 0, maxX: 8, title: 'Growth trend', label: 'Compounded value' } },
  { name: 'Decay to control', spec: { ...DEFAULT_SPEC, expression: '10 * e ^ (-0.4 * x)', minX: 0, maxX: 10, title: 'Decay to control', label: 'Residual risk' } },
  { name: 'Materiality band', spec: { ...DEFAULT_SPEC, expression: 'abs(sin(x)) * 5', minX: 0, maxX: 12, title: 'Materiality band', label: 'Threshold' } },
];

export const FigureStudio: React.FC<FigureStudioProps> = ({
  prefix = 'wk-report-builder', onPick, defaultColour,
}) => {
  const [spec, setSpec] = useState<FigureSpec>({ ...DEFAULT_SPEC, colour: defaultColour || DEFAULT_SPEC.colour });
  const [added, setAdded] = useState<string | null>(null);

  const error = useMemo(() => figureError(spec), [spec]);
  const svg = useMemo(() => (error ? null : figureSvg(spec)), [spec, error]);

  const set = <K extends keyof FigureSpec>(key: K, value: FigureSpec[K]) => setSpec((s) => ({ ...s, [key]: value }));

  return (
    <div className="space-y-3" data-testid={`${prefix}-figure-studio`}>
      <div className="text-apple-11 text-secondary" data-testid={`${prefix}-figure-note`}>
        Draw a figure from a formula. The same engine prints it in the PDF and the DOCX, so the preview is the printed figure.
      </div>

      <div className="flex items-center gap-2 flex-wrap" data-testid={`${prefix}-figure-presets`}>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" data-testid={`${prefix}-figure-preset-${p.name.toLowerCase().replace(/\s+/g, '-')}`}
            className="px-3 py-1 rounded-lg bg-surface-hover text-apple-12 text-primary"
            onClick={() => setSpec({ ...p.spec, colour: spec.colour })}>{p.name}</button>
        ))}
      </div>

      <label className="block text-apple-11 text-secondary">
        Expression
        <input type="text" spellCheck={false} className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary font-mono"
          data-testid={`${prefix}-figure-expression`} value={spec.expression}
          aria-describedby={`${prefix}-figure-help`}
          onChange={(e) => set('expression', e.target.value)} />
      </label>
      <div id={`${prefix}-figure-help`} className="text-apple-11 text-secondary" data-testid={`${prefix}-figure-help`}>
        Use <code>x</code>, numbers, <code>+ - * / ^</code> and the functions {FORMULA_FUNCTIONS.join(', ')} and {FORMULA_BINARY_FUNCTIONS.join(', ')}; the constants {Object.keys(FORMULA_CONSTANTS).join(', ')}.
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="space-y-1 text-apple-11 text-secondary">
          Left end of domain
          <input type="number" className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
            data-testid={`${prefix}-figure-min-x`} value={spec.minX} onChange={(e) => set('minX', Number(e.target.value))} />
        </label>
        <label className="space-y-1 text-apple-11 text-secondary">
          Right end of domain
          <input type="number" className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
            data-testid={`${prefix}-figure-max-x`} value={spec.maxX} onChange={(e) => set('maxX', Number(e.target.value))} />
        </label>
        <label className="space-y-1 text-apple-11 text-secondary">
          Figure title
          <input type="text" className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
            data-testid={`${prefix}-figure-title`} value={spec.title} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="space-y-1 text-apple-11 text-secondary">
          Caption
          <input type="text" className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
            data-testid={`${prefix}-figure-label`} value={spec.label} onChange={(e) => set('label', e.target.value)} />
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap" data-testid={`${prefix}-figure-colours`}>
        <span className="text-apple-11 text-secondary">Line colour</span>
        {REPORT_PALETTE.map((c) => (
          <button key={c.name} type="button" title={c.name} aria-label={c.name}
            data-testid={`${prefix}-figure-colour-${c.name}`} onClick={() => set('colour', c.value)}
            className={`w-6 h-6 rounded-full border ${spec.colour === c.value ? 'border-accent ring-2 ring-accent' : 'border-hairline'}`}
            style={{ background: c.value }} />
        ))}
      </div>

      {error ? (
        <div className="p-3 rounded-xl bg-cinnabar-subtle text-cinnabar text-apple-12" data-testid={`${prefix}-figure-error`}>{error}</div>
      ) : (
        <div className="p-3 rounded-2xl border border-hairline bg-surface" data-testid={`${prefix}-figure-preview`}>
          {svg && <div data-testid={`${prefix}-figure-preview-svg`} dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="button" disabled={Boolean(error)} data-testid={`${prefix}-figure-add`}
          className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-13 font-semibold disabled:opacity-40"
          onClick={() => { onPick?.(spec); setAdded(spec.title); }}>
          Add figure to report
        </button>
        <span className="text-apple-11 text-secondary" data-testid={`${prefix}-figure-added`}>{added ? `Added: ${added}` : ''}</span>
      </div>

      <div className="text-apple-11 text-secondary" data-testid={`${prefix}-figure-limits`}>
        At most {FORMULA_LIMITS.samples} points are sampled, so the same formula always draws the same figure.
      </div>
    </div>
  );
};
