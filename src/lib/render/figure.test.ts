import { describe, expect, it } from 'vitest';
import { figureChart, figurePng, figureSvg, figureError, FIGURE_PIXELS, type FigureSpec } from './figure';
import { renderChartPng, renderChartSvg } from './chart';

/**
 * WP-G: the one bridge between a stored formula figure and every output.
 *
 * The invariant these tests pin: a figure is a pure function of its spec. The on-screen SVG and the
 * printed PNG come from the same sampled chart, so they cannot disagree, and the same spec always
 * draws the same bytes — which is what lets the figure sit inside a byte-reproducible report.
 */
const spec: FigureSpec = {
  expression: 'sin(x) * x',
  minX: -6,
  maxX: 6,
  label: 'Exposure',
  colour: '#2f6f6a',
  title: 'Exposure curve',
};

describe('figureChart', () => {
  it('builds a one-series line chart from a valid expression', () => {
    const r = figureChart(spec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chart.kind).toBe('line');
    expect(r.chart.series).toHaveLength(1);
    expect(r.chart.series[0].label).toBe('Exposure');
    expect(r.chart.categories.length).toBeGreaterThan(1);
  });

  it('refuses an unparseable expression with a formula error', () => {
    const r = figureChart({ ...spec, expression: 'sin(' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('formula');
  });

  it('refuses an unusable domain with a domain error', () => {
    const r = figureChart({ ...spec, minX: 5, maxX: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('domain');
  });
});

describe('figureSvg and figurePng agree', () => {
  it('renders both outputs from the same chart', () => {
    const chart = figureChart(spec);
    expect(chart.ok).toBe(true);
    if (!chart.ok) return;
    const colours = { background: '#ffffff', axis: '#888888', text: '#222222' };
    expect(figureSvg(spec)).toBe(renderChartSvg(chart.chart, colours, FIGURE_PIXELS));
    expect(Array.from(figurePng(spec) ?? [])).toEqual(
      Array.from(renderChartPng(chart.chart, colours, FIGURE_PIXELS)),
    );
  });

  it('is deterministic: the same spec draws the same bytes and the same svg', () => {
    expect(Array.from(figurePng(spec)!)).toEqual(Array.from(figurePng(spec)!));
    expect(figureSvg(spec)).toBe(figureSvg(spec));
  });

  it('returns null for a figure that cannot be rendered, never a fake', () => {
    expect(figurePng({ ...spec, expression: 'nope(' })).toBeNull();
    expect(figureSvg({ ...spec, expression: 'nope(' })).toBeNull();
  });

  it('the svg is real SVG text', () => {
    const svg = figureSvg(spec);
    expect(svg?.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });
});

describe('figureError', () => {
  it('is null for a renderable spec', () => {
    expect(figureError(spec)).toBeNull();
  });

  it('names the problem for a broken spec', () => {
    const message = figureError({ ...spec, expression: '1..2' });
    expect(typeof message).toBe('string');
    expect(message!.length).toBeGreaterThan(0);
  });
});
