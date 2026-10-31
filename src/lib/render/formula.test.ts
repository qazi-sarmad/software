import { describe, expect, it } from 'vitest';
import {
  FORMULA_CONSTANTS, FORMULA_FUNCTIONS, FORMULA_LIMITS, compileFormula, evaluateFormula,
  isConstantFormula,
} from './formula';
import { PLOT_LIMITS, formulaToChart, formatTick } from './formulaPlot';

describe('formula: the grammar accepts arithmetic, precedence and functions', () => {
  it('evaluates arithmetic with correct precedence', () => {
    const f = compileFormula('2 + 3 * 4');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(evaluateFormula(f.formula, 0)).toBe(14);
  });

  it('treats power as right-associative', () => {
    const f = compileFormula('2 ^ 3 ^ 2');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(evaluateFormula(f.formula, 0)).toBe(512); // 2^(3^2), not (2^3)^2
  });

  it('honours parentheses over precedence', () => {
    const f = compileFormula('(2 + 3) * 4');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(evaluateFormula(f.formula, 0)).toBe(20);
  });

  it('evaluates the variable x', () => {
    const f = compileFormula('x^2 + 1');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(evaluateFormula(f.formula, 3)).toBe(10);
    expect(f.formula.variables).toEqual(['x']);
  });

  it('accepts every declared unary function and the constants', () => {
    for (const fn of FORMULA_FUNCTIONS) {
      const arg = fn === 'sqrt' || fn === 'ln' || fn === 'log' || fn === 'log2' ? '1' : '0';
      const f = compileFormula(`${fn}(${arg})`);
      expect(f.ok, `${fn} should parse`).toBe(true);
    }
    for (const name of Object.keys(FORMULA_CONSTANTS)) {
      const f = compileFormula(name);
      expect(f.ok, `${name} should parse`).toBe(true);
      if (!f.ok) return;
      expect(evaluateFormula(f.formula, 0)).toBeCloseTo(FORMULA_CONSTANTS[name], 12);
    }
  });

  it('accepts the two-argument functions with a comma', () => {
    const f = compileFormula('max(3, 7) + min(1, 2)');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(evaluateFormula(f.formula, 0)).toBe(8);
  });

  it('records the functions it calls, in first-use order', () => {
    const f = compileFormula('sin(x) + cos(x) + sin(x)');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.formula.functions).toEqual(['sin', 'cos']);
  });
});

describe('formula: hostile and malformed input is rejected with a reason, never executed', () => {
  const bad = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['1 +', 'unexpected'],
    ['(1 + 2', 'unexpected'],
    ['1 + 2)', 'unexpected'],
    ['foo(1)', 'unknown_name'],
    ['y + 1', 'unknown_name'],
    ['sin()', 'bad_arity'],
    ['sin(1, 2)', 'bad_arity'],
    ['max(1)', 'bad_arity'],
    ['1 $ 2', 'bad_character'],
    ['[1]', 'bad_character'],
    ['1..2', 'unexpected'],
  ] as const;

  it.each(bad)('rejects %j with code %s', (src, code) => {
    const f = compileFormula(src);
    expect(f.ok).toBe(false);
    if (f.ok) return;
    expect(f.error.code).toBe(code);
    expect(f.error.message.length).toBeGreaterThan(0);
  });

  it('rejects a formula longer than the limit', () => {
    const f = compileFormula('1+'.repeat(FORMULA_LIMITS.maxLength) + '1');
    expect(f.ok).toBe(false);
    if (f.ok) return;
    expect(f.error.code).toBe('too_long');
  });

  it('rejects a formula with too many nodes', () => {
    // A valid expression under the length cap whose node count exceeds the engine's limit.
    const src = Array.from({ length: 200 }, () => 'x').join('+');
    expect(src.length).toBeLessThanOrEqual(FORMULA_LIMITS.maxLength);
    const f = compileFormula(src);
    expect(f.ok).toBe(false);
    if (f.ok) return;
    expect(f.error.code).toBe('too_complex');
  });

  it('never calls eval or the Function constructor', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/render/formula.ts'), 'utf8');
    expect(/\beval\s*\(/.test(source)).toBe(false);
    expect(/new\s+Function\s*\(/.test(source)).toBe(false);
  });
});

describe('formula: domain gaps yield NaN, which the sampler treats as a hole', () => {
  it('returns NaN for sqrt of a negative', () => {
    const f = compileFormula('sqrt(x)');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(Number.isNaN(evaluateFormula(f.formula, -1))).toBe(true);
    expect(evaluateFormula(f.formula, 4)).toBe(2);
  });

  it('returns NaN for ln of a non-positive value and division by zero', () => {
    const ln = compileFormula('ln(x)');
    const div = compileFormula('1 / x');
    expect(ln.ok && div.ok).toBe(true);
    if (!ln.ok || !div.ok) return;
    expect(Number.isNaN(evaluateFormula(ln.formula, 0))).toBe(true);
    expect(Number.isNaN(evaluateFormula(div.formula, 0))).toBe(true);
  });

  it('is deterministic: the same input always yields the same value', () => {
    const f = compileFormula('sin(x) * exp(-x/10)');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    const a = Array.from({ length: 32 }, (_, i) => evaluateFormula(f.formula, i / 4));
    const b = Array.from({ length: 32 }, (_, i) => evaluateFormula(f.formula, i / 4));
    expect(a).toEqual(b);
  });

  it('treats a formula with no variable as constant', () => {
    const f = compileFormula('pi * 2');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(isConstantFormula(f.formula)).toBe(true);
  });
});

describe('formulaPlot: a formula becomes a chart the existing renderers draw', () => {
  it('samples a line series over the domain, deterministically', () => {
    const r = formulaToChart({ expression: 'x^2', minX: 0, maxX: 10, title: 'Growth', label: 'x squared', colour: '#2F6F5E' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chart.kind).toBe('line');
    expect(r.chart.series).toHaveLength(1);
    expect(r.chart.series[0].values).toHaveLength(PLOT_LIMITS.samples);
    expect(r.chart.categories).toHaveLength(PLOT_LIMITS.samples);
    expect(r.chart.series[0].colour).toBe('#2F6F5E');
    // The first and last samples are the domain ends, squared.
    expect(r.chart.series[0].values[0]).toBe(0);
    expect(r.chart.series[0].values[PLOT_LIMITS.samples - 1]).toBeCloseTo(100, 9);

    const again = formulaToChart({ expression: 'x^2', minX: 0, maxX: 10, title: 'Growth', label: 'x squared', colour: '#2F6F5E' });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.points).toEqual(r.points);
  });

  it('skips undefined points, so a curve never crosses a discontinuity', () => {
    const r = formulaToChart({ expression: 'ln(x)', minX: -5, maxX: 5, title: 'Log', label: 'ln', colour: '#14161B' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.points.every((p) => p.x > 0)).toBe(true);
    expect(r.points.length).toBeLessThan(PLOT_LIMITS.samples);
  });

  it('rejects a bad formula with the underlying reason', () => {
    const r = formulaToChart({ expression: 'foo(x)', minX: 0, maxX: 1, title: 't', label: 'l', colour: '#000000' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('formula');
    expect(r.error.formula?.code).toBe('unknown_name');
  });

  it('rejects an unusable domain', () => {
    const zero = formulaToChart({ expression: 'x', minX: 1, maxX: 1, title: 't', label: 'l', colour: '#000000' });
    const huge = formulaToChart({ expression: 'x', minX: 0, maxX: PLOT_LIMITS.maxSpan + 1, title: 't', label: 'l', colour: '#000000' });
    expect(zero.ok).toBe(false);
    expect(huge.ok).toBe(false);
    if (zero.ok || huge.ok) return;
    expect(zero.error.code).toBe('domain');
    expect(huge.error.code).toBe('domain');
  });

  it('formats axis ticks compactly and deterministically', () => {
    expect(formatTick(3)).toBe('3');
    expect(formatTick(0.5)).toBe('0.5');
    expect(formatTick(1 / 3)).toBe('0.333');
  });
});
