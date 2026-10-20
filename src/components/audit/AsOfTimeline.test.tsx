import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getEngagementAsOf = vi.fn();
const listAsOfEvents = vi.fn();

vi.mock('../../data/timeTravel', () => ({
  getEngagementAsOf: (id: string, ts: string) => getEngagementAsOf(id, ts),
  listAsOfEvents: (id: string, ts: string) => listAsOfEvents(id, ts),
}));

import { AsOfTimeline } from './AsOfTimeline';

const EVENTS = [
  { seq: '1', kind: 'activity', action: 'workpaper_signed_off', at: '2026-01-10T09:00:00.000Z', objectType: 'workpaper', objectId: 'w1', detail: { workpaper_id: 'w1' } },
  { seq: '2', kind: 'activity', action: 'finding_promoted', at: '2026-02-01T09:00:00.000Z', objectType: 'workpaper', objectId: 'w1', detail: { finding_id: 'f1' } },
  { seq: '3', kind: 'ledger', action: 'conclusion_signed_off', at: '2026-03-01T09:00:00.000Z', objectType: null, objectId: null, detail: {} },
];

const STATE_OK = {
  status: 'ok' as const,
  asOf: '2026-02-01T09:00:00.000Z',
  earliestRecorded: '2026-01-10T09:00:00.000Z',
  earliestAvailable: null,
  workpapers: [{ id: 'w1', status: 'signed_off', at: '2026-01-10T09:00:00.000Z' }],
  findings: [{ id: 'f1', at: '2026-02-01T09:00:00.000Z', observationId: 'o1' }],
  seal: { sealed: false, at: null },
  statuses: [],
};

describe('WK-09 time-travel (F14)', () => {
  beforeEach(() => {
    listAsOfEvents.mockResolvedValue(EVENTS);
    getEngagementAsOf.mockResolvedValue(STATE_OK);
  });

  it('renders the timeline with a handle and the snap events', async () => {
    render(<AsOfTimeline engagementId="eng-1" />);
    await waitFor(() => expect(screen.getByTestId('wk-timetravel')).toBeTruthy());
    expect(screen.getByTestId('wk-timetravel-track')).toBeTruthy();
    expect(screen.getByTestId('wk-timetravel-handle')).toBeTruthy();
    expect(screen.getByTestId('wk-timetravel-event-conclusion_signed_off')).toBeTruthy();
    expect(screen.getByTestId('wk-timetravel-state')).toBeTruthy();
  });

  it('moves to the previous recorded event when the handle is stepped back', async () => {
    render(<AsOfTimeline engagementId="eng-1" />);
    await waitFor(() => expect(screen.getByTestId('wk-timetravel-prev')).toBeTruthy());
    getEngagementAsOf.mockClear();
    fireEvent.click(screen.getByTestId('wk-timetravel-event-finding_promoted'));
    await waitFor(() => expect(getEngagementAsOf).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('wk-timetravel-prev'));
    await waitFor(() =>
      expect(getEngagementAsOf.mock.calls.some((c) => c[1] === '2026-01-10T09:00:00.000Z')).toBe(true));
  });

  it('shows the honesty note when history does not reach that far', async () => {
    getEngagementAsOf.mockResolvedValue({
      ...STATE_OK, status: 'not_recorded_before', earliestRecorded: '2026-01-10T09:00:00.000Z',
      note: 'Not recorded before this date.', workpapers: [], findings: [],
    });
    render(<AsOfTimeline engagementId="eng-1" />);
    await waitFor(() => expect(screen.getByTestId('wk-timetravel-not-recorded')).toBeTruthy());
    expect(screen.getByTestId('wk-timetravel-not-recorded').textContent).toContain('Not recorded before');
  });

  it('compares the as-of state with now', async () => {
    render(<AsOfTimeline engagementId="eng-1" />);
    await waitFor(() => expect(screen.getByTestId('wk-timetravel-compare')).toBeTruthy());
    getEngagementAsOf.mockResolvedValue({ ...STATE_OK, seal: { sealed: true, at: '2026-03-01T09:00:00.000Z' } });
    fireEvent.click(screen.getByTestId('wk-timetravel-compare'));
    await waitFor(() => expect(screen.getByTestId('wk-timetravel-diff')).toBeTruthy());
  });

  it('shows a server refusal in place, not a blocking dialog', async () => {
    getEngagementAsOf.mockRejectedValue(new Error('This feature is not included in your plan.'));
    render(<AsOfTimeline engagementId="eng-1" />);
    await waitFor(() => expect(screen.getByTestId('wk-timetravel-error')).toBeTruthy());
    expect(screen.getByTestId('wk-timetravel-error').textContent).toContain('not included in your plan');
  });
});
