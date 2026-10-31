import { describe, expect, it } from 'vitest';
import {
  chainOfCustody,
  evidenceFreshness,
  evidenceSufficiency,
  nextDay,
  populationProfile,
  prevDay,
  stratificationSuggestion,
  type EvidenceItem,
  type PopulationRecord,
} from './populationEvidence';

const HASH = 'a'.repeat(64);

function row(over: Partial<PopulationRecord>): PopulationRecord {
  return { rowRef: 1, amountCents: 100, date: '2026-06-01', category: 'Sales', ...over };
}

function item(over: Partial<EvidenceItem>): EvidenceItem {
  return { id: 'v1', name: 'invoice.pdf', attachedAt: '2026-06-01T00:00:00Z', attachedBy: 'u1', sha256: HASH, ...over };
}

describe('D2 — population and evidence intelligence', () => {
  it('nextDay and prevDay move one ISO day', () => {
    expect(nextDay('2026-06-30')).toBe('2026-07-01');
    expect(prevDay('2026-07-01')).toBe('2026-06-30');
    expect(nextDay('2026-02-28')).toBe('2026-03-01');
  });

  it('populationProfile describes the shape and flags implausibility', () => {
    const rows = [
      row({ rowRef: 1, amountCents: 100, date: '2026-06-01' }),
      row({ rowRef: 2, amountCents: 300, date: '2026-06-02' }),
      row({ rowRef: 3, amountCents: 100, date: '2026-06-01' }), // duplicate of 1
      row({ rowRef: 4, amountCents: null, date: null }),
    ];
    const p = populationProfile(rows);
    expect(p.rowCount).toBe(4);
    expect(p.withAmount).toBe(3);
    expect(p.totalCents).toBe(500);
    expect(p.minCents).toBe(100);
    expect(p.maxCents).toBe(300);
    expect(p.meanCents).toBe(167);
    expect(p.nullAmounts).toBe(1);
    expect(p.nullDates).toBe(1);
    expect(p.duplicateRows).toBe(1);
    expect(p.period).toEqual(['2026-06-01', '2026-06-02']);
    expect(p.categories).toEqual(['Sales']);
    expect(p.flags).toContain('null_amounts');
    expect(p.flags).toContain('duplicates');
  });

  it('populationProfile flags a single-date and an amount-less population', () => {
    const single = populationProfile([row({ date: '2026-06-01' }), row({ rowRef: 2, date: '2026-06-01' })]);
    expect(single.flags).toContain('single_date');
    const noAmounts = populationProfile([row({ amountCents: null })]);
    expect(noAmounts.flags).toContain('no_amounts');
    expect(noAmounts.meanCents).toBeNull();
  });

  it('stratificationSuggestion groups by category and floors each stratum sample at one', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => row({ rowRef: i, category: 'Sales' })),
      ...Array.from({ length: 2 }, (_, i) => row({ rowRef: 100 + i, category: 'Ops' })),
    ];
    const strata = stratificationSuggestion(rows, 5);
    expect(strata.map((s) => s.key)).toEqual(['Sales', 'Ops']);
    expect(strata[0].sample).toBe(4); // ceil(0.8 * 5)
    expect(strata[1].sample).toBe(1); // ceil(0.2 * 5) = 1
  });

  it('stratificationSuggestion bands by value when there is no category', () => {
    const rows = [
      row({ rowRef: 1, amountCents: 0, category: null }),
      row({ rowRef: 2, amountCents: 1000, category: null }),
    ];
    const strata = stratificationSuggestion(rows, 2);
    expect(strata.length).toBe(2);
    expect(strata.every((s) => s.sample >= 1)).toBe(true);
  });

  it('evidenceSufficiency finds the uncovered stretch of a period', () => {
    const res = evidenceSufficiency({
      items: [item({ coversFrom: '2026-06-01', coversTo: '2026-06-10' })],
      period: ['2026-06-01', '2026-06-20'],
    });
    expect(res.coversPeriod).toBe(false);
    expect(res.uncovered).toEqual([['2026-06-11', '2026-06-20']]);
    expect(res.reasons).toContain('period_not_covered');
  });

  it('evidenceSufficiency reports a fully covered period and value as sufficient', () => {
    const res = evidenceSufficiency({
      items: [item({ coversFrom: '2026-06-01', coversTo: '2026-06-30' })],
      period: ['2026-06-01', '2026-06-30'],
      populationTotalCents: 1000,
      coveredCents: 1000,
    });
    expect(res.coversPeriod).toBe(true);
    expect(res.coversValue).toBe(true);
    expect(res.sufficient).toBe(true);
    expect(res.uncovered).toEqual([]);
  });

  it('evidenceSufficiency reports no evidence as covering nothing', () => {
    const res = evidenceSufficiency({ items: [], period: ['2026-06-01', '2026-06-30'] });
    expect(res.sufficient).toBe(false);
    expect(res.reasons).toContain('no_evidence');
    expect(res.uncovered).toEqual([['2026-06-01', '2026-06-30']]);
  });

  it('evidenceFreshness flags evidence after the report and stale cover', () => {
    const findings = evidenceFreshness({
      items: [
        item({ id: 'late', attachedAt: '2026-07-05T00:00:00Z' }),
        item({ id: 'stale', coversTo: '2026-01-31' }),
      ],
      reportDate: '2026-07-01',
      period: ['2026-06-01', '2026-06-30'],
    });
    expect(findings.map((f) => [f.id, f.issue])).toEqual([
      ['late', 'after_report'],
      ['stale', 'before_period'],
    ]);
  });

  it('chainOfCustody reports a complete chain and names the broken links', () => {
    const good = chainOfCustody([item({ id: 'a' }), item({ id: 'b', attachedAt: '2026-06-02T00:00:00Z' })]);
    expect(good.complete).toBe(true);
    expect(good.entries[0].id).toBe('a');

    const bad = chainOfCustody([item({ id: 'a' }), item({ id: 'b', sha256: 'not-a-hash' }), item({ id: 'c', attachedBy: '' })]);
    expect(bad.complete).toBe(false);
    expect(bad.broken).toEqual(['b', 'c']);
  });
});
