import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EngagementGantt } from './EngagementGantt';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { AuditEngagement, Role } from '../../types';

const planItemForEngagement = vi.fn();
const updatePlanItemDates = vi.fn();

vi.mock('../../data/plan', () => ({
  planItemForEngagement: (...a: unknown[]) => planItemForEngagement(...a),
  updatePlanItemDates: (...a: unknown[]) => updatePlanItemDates(...a),
}));

const engagement: AuditEngagement = {
  id: '50000000-0000-0000-0000-0000000000a1',
  universeId: 'u1',
  entityId: 'e1',
  title: 'A-Eng1',
  stage: 'testing',
  status: 'in_progress',
  leadAuditorId: '10000000-0000-0000-0000-0000000000a1',
  reviewerId: '10000000-0000-0000-0000-0000000000a2',
  periodStart: '2026-01-01',
  periodEnd: '2026-06-30',
  dueDate: '2026-06-30',
  completionPercent: 40,
};

const wrap = (role: Role, onRescheduled?: () => void) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <EngagementGantt engagements={[engagement]} onRescheduled={onRescheduled} />
      </AppProvider>
    </ThemeProvider>
  );

// jsdom's PointerEvent drops clientX, so pointer moves are dispatched as MouseEvents of the
// pointer type; React's onPointerMove still receives them with a usable clientX.
const pointer = (el: Element, type: string, clientX: number) =>
  fireEvent(el, new MouseEvent(type, { clientX, bubbles: true }));

beforeEach(() => {
  planItemForEngagement.mockReset();
  updatePlanItemDates.mockReset();
});

describe('EngagementGantt reschedule persistence (D9)', () => {
  it('stages a pending change when a manager drags a bar', () => {
    wrap('cia');
    const bar = screen.getByTestId(`gantt-bar-${engagement.id}`);
    pointer(bar, 'pointerdown', 100);
    pointer(bar, 'pointermove', 148);
    pointer(bar, 'pointerup', 148);
    // A ~48px drag is ~10 days at the fixed density; the chip names the engagement.
    expect(screen.getByText(/Pending milestone change/).textContent).toMatch(/A-Eng1/);
  });

  it('persists the staged change through the RPC and refetches on success', async () => {
    const onRescheduled = vi.fn();
    planItemForEngagement.mockResolvedValue({ id: 'item-1' });
    updatePlanItemDates.mockResolvedValue({ ok: true });
    wrap('cia', onRescheduled);

    const bar = screen.getByTestId(`gantt-bar-${engagement.id}`);
    pointer(bar, 'pointerdown', 100);
    pointer(bar, 'pointermove', 148);
    pointer(bar, 'pointerup', 148);
    fireEvent.click(screen.getByTestId('gantt-approve-shift'));

    await waitFor(() => expect(onRescheduled).toHaveBeenCalled());
    expect(planItemForEngagement).toHaveBeenCalledWith(engagement.id);
    expect(updatePlanItemDates).toHaveBeenCalledWith('item-1', expect.any(String), expect.any(String));
    expect(onRescheduled).toHaveBeenCalledWith(expect.objectContaining({ engagementId: engagement.id }));
  });

  it('shows the RPC refusal inline and does not refetch', async () => {
    const onRescheduled = vi.fn();
    planItemForEngagement.mockResolvedValue({ id: 'item-1' });
    updatePlanItemDates.mockResolvedValue({ ok: false, reason: 'an approved plan cannot be changed without a new version' });
    wrap('cia', onRescheduled);

    const bar = screen.getByTestId(`gantt-bar-${engagement.id}`);
    pointer(bar, 'pointerdown', 100);
    pointer(bar, 'pointermove', 148);
    pointer(bar, 'pointerup', 148);
    fireEvent.click(screen.getByTestId('gantt-approve-shift'));

    await waitFor(() => expect(screen.getByTestId('gantt-shift-error')).toBeTruthy());
    expect(screen.getByTestId('gantt-shift-error').textContent).toMatch(/approved plan cannot be changed/);
    expect(onRescheduled).not.toHaveBeenCalled();
  });

  it('does not stage a drag for a role without the reschedule right', () => {
    wrap('preparer');
    const bar = screen.getByTestId(`gantt-bar-${engagement.id}`);
    pointer(bar, 'pointerdown', 100);
    pointer(bar, 'pointermove', 160);
    pointer(bar, 'pointerup', 160);
    expect(screen.queryByText(/Pending milestone change/)).toBeNull();
  });
});
