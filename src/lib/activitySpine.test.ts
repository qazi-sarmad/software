import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_RULES,
  activityAgeLabel,
  activityAgeMs,
  activityKind,
  activitySentence,
  mergeSpineRow,
  type ActivitySpineRow,
} from './activitySpine';

const row = (over: Partial<ActivitySpineRow> = {}): ActivitySpineRow => ({
  id: 'r1',
  actorId: 'u1',
  actorName: 'Ayesha K.',
  action: 'sira_cycle_published',
  objectType: 'sira_cycle',
  objectId: 'c1',
  summary: { title: 'SIRA 2026' },
  ts: '2026-01-01T10:00:00Z',
  ...over,
});

describe('activityKind', () => {
  it('classifies a seal, an approval and a publish from the table', () => {
    expect(activityKind('report_frozen')).toBe('seal');
    expect(activityKind('sira_acceptance_decided')).toBe('approval');
    expect(activityKind('sira_cycle_published')).toBe('publish');
  });

  it('an unknown action is a change, never silently an approval or a seal', () => {
    expect(activityKind('something_brand_new')).toBe('change');
    expect(ACTIVITY_RULES['something_brand_new']).toBeUndefined();
  });
});

describe('activitySentence', () => {
  it('names the actor, the verb and the subject', () => {
    expect(activitySentence(row())).toBe('Ayesha K. published the SIRA cycle · SIRA 2026');
  });

  it('falls back to the period, then the object type, when there is no title', () => {
    expect(activitySentence(row({ action: 'report_frozen', summary: { period: '2026-Q1' } }))).toBe(
      'Ayesha K. sealed report · 2026-Q1'
    );
    expect(
      activitySentence(row({ action: 'report_frozen', summary: {}, objectType: 'report' }))
    ).toBe('Ayesha K. sealed report · report');
  });

  it('an unknown action still renders, with its action made legible — never silent', () => {
    expect(activitySentence(row({ action: 'widget_frobbed', summary: { title: 'W' } }))).toBe(
      'Ayesha K. widget frobbed · W'
    );
  });

  it('a blank actor name reads as System', () => {
    expect(activitySentence(row({ actorName: '', summary: { title: 'R-1' } }))).toBe(
      'System published the SIRA cycle · R-1'
    );
  });
});

describe('activityAgeMs / activityAgeLabel', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');

  it('measures the age from the supplied clock, never the wall clock', () => {
    expect(activityAgeMs('2026-01-01T10:00:00Z', now)).toBe(2 * 3600 * 1000);
  });

  it('a future or unparseable timestamp never reads as a negative age', () => {
    expect(activityAgeMs('2026-01-02T00:00:00Z', now)).toBe(0);
    expect(activityAgeMs('not-a-date', now)).toBeNull();
    expect(activityAgeMs(null, now)).toBeNull();
  });

  it('labels the age compactly', () => {
    expect(activityAgeLabel('2026-01-01T11:59:30Z', now)).toBe('now');
    expect(activityAgeLabel('2026-01-01T11:30:00Z', now)).toBe('30m');
    expect(activityAgeLabel('2026-01-01T09:00:00Z', now)).toBe('3h');
    expect(activityAgeLabel('2025-12-29T12:00:00Z', now)).toBe('3d');
    expect(activityAgeLabel(null, now)).toBe('');
  });
});

describe('mergeSpineRow', () => {
  const older = row({ id: 'a', ts: '2026-01-01T09:00:00Z' });
  const newer = row({ id: 'b', ts: '2026-01-01T11:00:00Z' });

  it('prepends and keeps newest first', () => {
    expect(mergeSpineRow([older], newer).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('replaces a row with the same id in place, never duplicating it', () => {
    const updated = { ...newer, summary: { title: 'updated' } };
    const merged = mergeSpineRow([newer, older], updated);
    expect(merged.map((r) => r.id)).toEqual(['b', 'a']);
    expect(merged[0].summary.title).toBe('updated');
  });

  it('a row with no timestamp sorts last, never jumping the stream', () => {
    const noTs = row({ id: 'z', ts: null });
    expect(mergeSpineRow([newer, older], noTs).map((r) => r.id)).toEqual(['b', 'a', 'z']);
  });

  it('caps the stream', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      row({ id: `r${i}`, ts: `2026-01-01T0${i}:00:00Z` })
    );
    const merged = many.reduce<ActivitySpineRow[]>((acc, r) => mergeSpineRow(acc, r, 3), []);
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.id)).toEqual(['r4', 'r3', 'r2']);
  });
});
