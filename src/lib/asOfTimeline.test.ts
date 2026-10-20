import { describe, expect, it } from 'vitest';
import {
  asOfBanner, diffStates, eventLabel, formatWhen, nearestSnap, nextSnap, previousSnap, snapPoints,
  type AsOfEvent, type AsOfState,
} from './asOfTimeline';

function ev(over: Partial<AsOfEvent> & { action: string; at: string }): AsOfEvent {
  return { seq: '1', kind: 'activity', objectType: 'engagement', objectId: 'g1', detail: {}, ...over };
}

const events: AsOfEvent[] = [
  ev({ action: 'workpaper_signed_off', at: '2026-01-02T00:00:00Z' }),
  ev({ action: 'engagement_as_of_viewed', at: '2026-01-03T00:00:00Z' }),
  ev({ action: 'finding_promoted', at: '2026-01-04T00:00:00Z' }),
  ev({ action: 'conclusion_signed_off', at: '2026-01-05T00:00:00Z' }),
];

describe('snapPoints', () => {
  it('keeps only the state-changing events', () => {
    const points = snapPoints(events);
    expect(points.map((p) => p.action)).toEqual([
      'workpaper_signed_off', 'finding_promoted', 'conclusion_signed_off',
    ]);
  });
  it('is time-ordered', () => {
    const shuffled = [events[3], events[0], events[2]];
    const points = snapPoints(shuffled);
    expect(points.map((p) => p.at)).toEqual([
      '2026-01-02T00:00:00Z', '2026-01-04T00:00:00Z', '2026-01-05T00:00:00Z',
    ]);
  });
  it('gives a plain label per action', () => {
    expect(eventLabel(ev({ action: 'conclusion_signed_off', at: 'x' })))
      .toBe('Engagement sealed');
    expect(eventLabel(ev({ action: 'some_new_action', at: 'x' }))).toBe('some new action');
  });
});

describe('nextSnap / previousSnap', () => {
  const points = snapPoints(events);
  it('finds the next snap strictly after a moment', () => {
    expect(nextSnap(points, '2026-01-02T00:00:00Z')).toBe('2026-01-04T00:00:00Z');
  });
  it('returns null at the last snap', () => {
    expect(nextSnap(points, '2026-01-05T00:00:00Z')).toBeNull();
  });
  it('finds the previous snap strictly before a moment', () => {
    expect(previousSnap(points, '2026-01-05T00:00:00Z')).toBe('2026-01-04T00:00:00Z');
  });
  it('returns null at the first snap', () => {
    expect(previousSnap(points, '2026-01-02T00:00:00Z')).toBeNull();
  });
});

describe('nearestSnap', () => {
  const points = snapPoints(events);
  it('snaps to the closest event', () => {
    expect(nearestSnap(points, '2026-01-04T01:00:00Z')).toBe('2026-01-04T00:00:00Z');
  });
  it('breaks a tie toward the earlier event', () => {
    // Exactly halfway between 01-02 and 01-04 is 01-03; the earlier point wins.
    expect(nearestSnap(points, '2026-01-03T00:00:00Z')).toBe('2026-01-02T00:00:00Z');
  });
  it('returns null when there are no points', () => {
    expect(nearestSnap([], '2026-01-04T00:00:00Z')).toBeNull();
  });
});

describe('diffStates', () => {
  const before: AsOfState = {
    status: 'ok', asOf: '2026-01-02T00:00:00Z',
    workpapers: [{ id: 'w1', status: 'reviewed', at: '2026-01-01T00:00:00Z' }],
    seal: { sealed: false, at: null },
  };
  const after: AsOfState = {
    status: 'ok', asOf: '2026-01-05T00:00:00Z',
    workpapers: [
      { id: 'w1', status: 'signed_off', at: '2026-01-04T00:00:00Z' },
      { id: 'w2', status: 'signed_off', at: '2026-01-04T00:00:00Z' },
    ],
    seal: { sealed: true, at: '2026-01-05T00:00:00Z' },
  };

  it('reports added, changed and removed rows', () => {
    const rows = diffStates(before, after);
    expect(rows.find((r) => r.id === 'w1')?.kind).toBe('changed');
    expect(rows.find((r) => r.id === 'w2')?.kind).toBe('added');
    expect(rows.find((r) => r.id === 'seal')?.kind).toBe('added');
  });

  it('reports a removed workpaper', () => {
    const rows = diffStates(after, before);
    expect(rows.find((r) => r.id === 'w2')?.kind).toBe('removed');
    expect(rows.find((r) => r.id === 'seal')?.kind).toBe('changed');
  });

  it('is stable in order', () => {
    const a = diffStates(before, after);
    const b = diffStates(before, after);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('asOfBanner', () => {
  it('shows the as-of moment for an ok state', () => {
    expect(asOfBanner({ status: 'ok', asOf: '2026-01-05T13:30:00Z' })).toBe('As of 2026-01-05 13:30 UTC');
  });
  it('is honest when nothing was recorded', () => {
    expect(asOfBanner({ status: 'not_recorded_before', asOf: 'x', earliestRecorded: '2026-02-01T00:00:00Z' }))
      .toContain('Not recorded before');
  });
  it('says there is no history when none exists', () => {
    expect(asOfBanner({ status: 'not_recorded_before', asOf: 'x', earliestRecorded: null }))
      .toBe('This engagement has no recorded history.');
  });
  it('names the archived boundary', () => {
    expect(asOfBanner({ status: 'earliest_available', asOf: 'x', earliestAvailable: '2026-03-01T00:00:00Z' }))
      .toContain('archived');
  });
});

describe('formatWhen', () => {
  it('formats an ISO instant as a plain UTC string', () => {
    expect(formatWhen('2026-10-19T08:05:00Z')).toBe('2026-10-19 08:05 UTC');
  });
  it('passes an unparseable string through', () => {
    expect(formatWhen('not-a-date')).toBe('not-a-date');
  });
});
