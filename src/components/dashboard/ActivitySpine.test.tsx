import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const listSpine = vi.fn();
const subscribe = vi.fn();

vi.mock('../../data/activity', () => ({
  listActivitySpine: (...a: unknown[]) => listSpine(...a),
  subscribeActivity: (...a: unknown[]) => subscribe(...a),
}));

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: { orgId: 'org-1' } }),
}));

import { ActivitySpine } from './ActivitySpine';
import type { ActivitySpineRow } from '../../lib/activitySpine';

const row = (over: Partial<ActivitySpineRow> = {}): ActivitySpineRow => ({
  id: 'r1',
  actorId: 'u1',
  actorName: 'Ayesha K.',
  action: 'sira_cycle_published',
  objectType: 'sira_cycle',
  objectId: 'c1',
  summary: { title: 'SIRA 2026' },
  ts: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  listSpine.mockReset().mockResolvedValue([]);
  subscribe.mockReset().mockReturnValue(null);
});

describe('ActivitySpine (U4, DB-01)', () => {
  it('renders the quiet empty state when the stream is empty', async () => {
    render(<ActivitySpine />);
    await waitFor(() => expect(screen.getByTestId('DB-01-activity-spine-empty')).toBeTruthy());
    expect(screen.getByTestId('DB-01-activity-spine').getAttribute('data-transport')).toBe('poll');
  });

  it('renders one sentence per row, with its kind', async () => {
    listSpine.mockResolvedValue([
      row(),
      row({ id: 'r2', action: 'report_frozen', summary: { title: 'R-2026-014' } }),
    ]);
    render(<ActivitySpine />);
    await waitFor(() => expect(screen.getByTestId('DB-01-activity-spine-list')).toBeTruthy());
    const first = screen.getByTestId('DB-01-activity-spine-row-r1');
    expect(first.textContent).toContain('Ayesha K. published the SIRA cycle · SIRA 2026');
    expect(first.getAttribute('data-kind')).toBe('publish');
    expect(screen.getByTestId('DB-01-activity-spine-row-r2').getAttribute('data-kind')).toBe('seal');
  });

  it('reports the transport as live once the subscription reports subscribed', async () => {
    subscribe.mockReturnValue({ isLive: () => true, close: vi.fn() });
    render(<ActivitySpine />);
    await waitFor(() =>
      expect(screen.getByTestId('DB-01-activity-spine-transport').textContent).toBe('Live')
    );
  });
});
