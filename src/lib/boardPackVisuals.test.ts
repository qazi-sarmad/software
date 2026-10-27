import { describe, expect, it } from 'vitest';
import {
  barPercentages,
  daysBetween,
  ganttChart,
  ganttLayout,
  ganttLegend,
  heatmapChart,
  heatmapGrid,
} from './boardPackVisuals';

const cell = (entity: string, band: string, value: number) => ({
  entity, band, value, refs: value ? [{ type: 'sira_score', id: `${entity}-${band}` }] : [],
});

describe('heatmapGrid', () => {
  it('builds a dense grid in the snapshot order and reports max and total', () => {
    const grid = heatmapGrid({
      entities: ['Payroll', 'Treasury'],
      bands: ['Low', 'High'],
      cells: [cell('Payroll', 'High', 3), cell('Treasury', 'Low', 1)],
    });
    expect(grid.entities).toEqual(['Payroll', 'Treasury']);
    expect(grid.bands).toEqual(['Low', 'High']);
    expect(grid.value('Payroll', 'High')).toBe(3);
    expect(grid.value('Payroll', 'Low')).toBe(0);
    expect(grid.max).toBe(3);
    expect(grid.total).toBe(4);
  });

  it('discovers an entity or band that only appears in a cell, so nothing is dropped', () => {
    const grid = heatmapGrid({ entities: [], bands: [], cells: [cell('Legal', 'Critical', 2)] });
    expect(grid.entities).toEqual(['Legal']);
    expect(grid.bands).toEqual(['Critical']);
    expect(grid.total).toBe(2);
  });

  it('is empty and safe for a null heatmap', () => {
    const grid = heatmapGrid(null);
    expect(grid.total).toBe(0);
    expect(grid.value('anything', 'anything')).toBe(0);
  });

  it('is deterministic: the same input always gives the same total', () => {
    const input = { entities: ['A'], bands: ['Low'], cells: [cell('A', 'Low', 5)] };
    expect(heatmapGrid(input).total).toBe(heatmapGrid(input).total);
  });
});

describe('heatmapChart', () => {
  it('makes one series per band over the entity categories', () => {
    const model = heatmapChart(
      { entities: ['Payroll', 'Treasury'], bands: ['Low', 'High'], cells: [cell('Payroll', 'High', 3)] },
      { High: '#aa0000' }, '#cccccc',
    );
    expect(model).not.toBeNull();
    expect(model!.categories).toEqual(['Payroll', 'Treasury']);
    expect(model!.series.map((s) => s.label)).toEqual(['Low', 'High']);
    expect(model!.series[1].values).toEqual([3, 0]);
    expect(model!.series[1].colour).toBe('#aa0000');
    expect(model!.series[0].colour).toBe('#cccccc');
    expect(model!.kind).toBe('bar');
  });

  it('returns null for an empty heatmap, so no empty chart is drawn', () => {
    expect(heatmapChart(null, {}, '#cccccc')).toBeNull();
    expect(heatmapChart({ entities: ['A'], bands: ['Low'], cells: [] }, {}, '#cccccc')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts whole days and clamps a reversed order to zero', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-02-01', '2026-01-01')).toBe(0);
    expect(daysBetween('not-a-date', '2026-01-01')).toBe(0);
  });
});

describe('ganttLayout', () => {
  const rows = [
    { title: 'Payroll audit', start: '2026-03-01', end: '2026-03-11', status: 'approved' },
    { title: 'Treasury review', start: '2026-03-05', end: '2026-03-06', status: 'proposed' },
  ];

  it('places each bar by its offset from the earliest start', () => {
    const layout = ganttLayout(rows, '2026-03-10');
    expect(layout.minStart).toBe('2026-03-01');
    expect(layout.maxEnd).toBe('2026-03-11');
    expect(layout.bars[0].offsetDays).toBe(0);
    expect(layout.bars[0].widthDays).toBe(10);
    expect(layout.bars[1].offsetDays).toBe(4);
    expect(layout.bars[1].widthDays).toBe(1);
    expect(layout.spanDays).toBe(10);
  });

  it('marks a bar future or open against the injected as-of day, never the clock', () => {
    const layout = ganttLayout(rows, '2026-03-10');
    expect(layout.bars[0].open).toBe(true); // ends 03-11, on/after as-of
    expect(layout.bars[0].future).toBe(false); // started 03-01
    const later = ganttLayout(rows, '2026-03-20');
    expect(later.bars[0].open).toBe(false); // ended before the as-of day
  });

  it('drops a row with no start and never throws on an empty list', () => {
    expect(ganttLayout([{ title: 'x', start: null }], '2026-01-01').bars).toEqual([]);
    expect(ganttLayout(null, '2026-01-01').spanDays).toBe(1);
  });

  it('gives a same-day item a width of one day, so it is still visible', () => {
    const layout = ganttLayout([{ title: 'one day', start: '2026-05-01', end: '2026-05-01' }], '2026-05-01');
    expect(layout.bars[0].widthDays).toBe(1);
  });

  it('is deterministic for the same input and the same as-of day', () => {
    expect(ganttLayout(rows, '2026-03-10')).toEqual(ganttLayout(rows, '2026-03-10'));
  });
});

describe('barPercentages', () => {
  it('returns a bounded left and width as percentages of the span', () => {
    const layout = ganttLayout(
      [{ title: 'a', start: '2026-01-01', end: '2026-01-11' }, { title: 'b', start: '2026-01-06', end: '2026-01-11' }],
      '2026-01-11',
    );
    const first = barPercentages(layout.bars[0], layout.spanDays);
    expect(first.left).toBe(0);
    expect(first.width).toBe(100);
    const second = barPercentages(layout.bars[1], layout.spanDays);
    expect(second.left).toBe(50);
    expect(second.width).toBe(50);
    expect(second.left + second.width).toBeLessThanOrEqual(100);
  });

  it('never exceeds the axis even for a zero span', () => {
    const bar = { title: 'a', status: 'proposed', start: '2026-01-01', end: '2026-01-01', offsetDays: 0, widthDays: 1, future: false, open: true };
    const pct = barPercentages(bar, 0);
    expect(pct.width).toBeLessThanOrEqual(100);
    expect(pct.left + pct.width).toBeLessThanOrEqual(100);
  });
});

describe('ganttChart', () => {
  it('charts the planned days per item', () => {
    const model = ganttChart(
      [{ title: 'a', start: '2026-01-01', end: '2026-01-11' }, { title: 'b', start: '2026-01-01', end: '2026-01-04' }],
      '2026-01-11', '#123456',
    );
    expect(model!.categories).toEqual(['a', 'b']);
    expect(model!.series[0].values).toEqual([10, 3]);
    expect(model!.series[0].colour).toBe('#123456');
  });

  it('returns null when there is nothing to chart', () => {
    expect(ganttChart([], '2026-01-01', '#000000')).toBeNull();
  });
});

describe('ganttLegend', () => {
  it('counts by status in the plan-status order and appends any unknown status', () => {
    const legend = ganttLegend([
      { status: 'proposed' }, { status: 'approved' }, { status: 'proposed' }, { status: 'weird' },
    ]);
    expect(legend).toEqual([
      { status: 'approved', count: 1 },
      { status: 'proposed', count: 2 },
      { status: 'weird', count: 1 },
    ]);
  });
});
