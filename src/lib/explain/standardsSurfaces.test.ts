import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_STEP_STANDARDS,
  REPORT_SECTION_STANDARDS,
  standardsForReportSection,
  standardsForScreen,
  standardsForStep,
} from './standardsSurfaces';
import { IIA_STANDARDS, iiaStandard } from './iia';

/**
 * E6/E7 surfaces (docs/EXPLAIN-LAYER.md §5.4). The standards must appear on the thing itself, on the
 * lifecycle step, on the screen, in the full view and in the report. These tests pin the authored
 * mapping so a chip can never claim a standard the catalogue does not carry, and so every mapped
 * number is one of the verified numbers.
 */
const known = new Set(IIA_STANDARDS.map((s) => s.id));

describe('standards surfaces (E6)', () => {
  it('every lifecycle step maps only to verified standard numbers', () => {
    for (const row of LIFECYCLE_STEP_STANDARDS) {
      expect(row.standards.length, `${row.step} carries no standards`).toBeGreaterThan(0);
      for (const n of row.standards) expect(known.has(n), `${row.step} cites unknown ${n}`).toBe(true);
    }
  });

  it('every report section maps only to verified standard numbers', () => {
    for (const row of REPORT_SECTION_STANDARDS) {
      expect(row.standards.length, `${row.section} carries no standards`).toBeGreaterThan(0);
      for (const n of row.standards) expect(known.has(n), `${row.section} cites unknown ${n}`).toBe(true);
    }
  });

  it('the report section keys match the report editor SECTION_ORDER', () => {
    const expected = ['executive_summary', 'scope', 'findings', 'opinion', 'appendices'];
    expect(REPORT_SECTION_STANDARDS.map((r) => r.section)).toEqual(expected);
  });

  it('standardsForScreen returns the standards whose implementedBy names the screen', () => {
    for (const s of IIA_STANDARDS) {
      for (const id of s.implementedBy) {
        expect(standardsForScreen(id).map((x) => x.id)).toContain(s.id);
      }
    }
    expect(standardsForScreen('NOT-A-SCREEN')).toEqual([]);
  });

  it('standardsForStep and standardsForReportSection resolve to real objects', () => {
    expect(standardsForStep('testing').every((s) => known.has(s.id))).toBe(true);
    expect(standardsForReportSection('findings').every((s) => known.has(s.id))).toBe(true);
    expect(standardsForStep('unknown-step')).toEqual([]);
    expect(standardsForReportSection('unknown-section')).toEqual([]);
  });

  it('the lifecycle steps and the report sections cover the Domain V lifecycle numbers', () => {
    const all = new Set([
      ...LIFECYCLE_STEP_STANDARDS.flatMap((r) => r.standards),
      ...REPORT_SECTION_STANDARDS.flatMap((r) => r.standards),
    ]);
    for (const n of ['13.2', '13.3', '13.4', '13.6', '14.1', '14.2', '14.3', '14.4', '14.5', '14.6', '15.1', '15.2', '9.4']) {
      expect(all.has(n), `${n} appears on no step or section`).toBe(true);
    }
  });

  it('a mapped number resolves through iiaStandard', () => {
    for (const n of LIFECYCLE_STEP_STANDARDS.flatMap((r) => r.standards)) {
      expect(iiaStandard(n), `${n} does not resolve`).toBeTruthy();
    }
  });
});
