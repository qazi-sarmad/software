import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrilldownPanel } from './DrilldownPanel';
import type { DrillSource } from '../../lib/drilldown';

const source: DrillSource = {
  entities: [],
  engagements: [
    {
      id: 'g1',
      universeId: 'u1',
      entityId: 'e1',
      title: 'Treasury cycle count',
      stage: 'testing',
      status: 'in_progress',
      leadAuditorId: 'a1',
      reviewerId: 'r1',
      periodStart: '2026-01-01',
      periodEnd: '2026-06-30',
      dueDate: '2026-07-15',
      completionPercent: 40,
    },
  ],
  issues: [],
  workpapers: [],
  caps: [],
  observations: [],
  comments: [],
};

describe('DrilldownPanel (E5/U1)', () => {
  it('lists the exact records and is a complementary region, not a modal', () => {
    render(
      <DrilldownPanel
        target={{ kind: 'engagements', label: 'Engagements in Fieldwork', filterSummary: 'status is in_progress' }}
        source={source}
        screenId="DB-01"
        onClose={() => {}}
      />
    );
    const panel = screen.getByTestId('DB-01-drilldown');
    expect(panel.getAttribute('role')).toBe('complementary');
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(screen.getByTestId('DB-01-drilldown-row-g1').textContent).toMatch(/Treasury cycle count/);
    expect(screen.getByTestId('DB-01-drilldown-filter').textContent).toMatch(/status is in_progress/);
  });

  it('opens a record through the host callback', () => {
    const onOpenRecord = vi.fn();
    render(
      <DrilldownPanel
        target={{ kind: 'engagements', label: 'x', filterSummary: 'y' }}
        source={source}
        screenId="DB-01"
        onOpenRecord={onOpenRecord}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('DB-01-drilldown-row-g1'));
    expect(onOpenRecord).toHaveBeenCalledWith('engagements', 'g1');
  });

  it('shows an honest empty state rather than a blank panel', () => {
    render(
      <DrilldownPanel
        target={{ kind: 'caps', label: 'All CAPs in scope', filterSummary: 'none' }}
        source={source}
        screenId="DB-01"
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('DB-01-drilldown-empty').textContent).toMatch(/No records match/);
  });

  it('closes through the host callback', () => {
    const onClose = vi.fn();
    render(
      <DrilldownPanel
        target={{ kind: 'engagements', label: 'x', filterSummary: 'y' }}
        source={source}
        screenId="DB-01"
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId('DB-01-drilldown-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
