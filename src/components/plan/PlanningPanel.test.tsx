import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const populate = vi.fn();
const reconcile = vi.fn();
const signedOff = vi.fn();
const decide = vi.fn();
const sign = vi.fn();
const ack = vi.fn();

vi.mock('../../data/planning', () => ({
  populateSuggestions: () => populate(),
  checkReconciliation: () => reconcile(),
  isPlanningSignedOff: () => signedOff(),
  decideSuggestion: (...a: unknown[]) => decide(...a),
  signPlanning: (...a: unknown[]) => sign(...a),
  acknowledgeDiscrepancy: (...a: unknown[]) => ack(...a),
}));

const userRef = { current: { role: 'cia', rights: { review_and_approve: true } } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { PlanningPanel } from './PlanningPanel';

const suggestion = {
  suggestionId: 's1',
  riskId: 'R-1',
  inherentRating: 12,
  suggestedControls: [],
  priorFindingCount: 2,
  riskBand: 'high',
};

describe('PlanningPanel (4I, §10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = { role: 'cia', rights: { review_and_approve: true } } as never;
    populate.mockResolvedValue([suggestion]);
    reconcile.mockResolvedValue(true);
    signedOff.mockResolvedValue(false);
    decide.mockResolvedValue({ ok: true });
    sign.mockResolvedValue({ ok: true });
    ack.mockResolvedValue({ ok: true });
  });

  it('shows suggestions with Accept/Reject and a reconciling banner', async () => {
    render(<PlanningPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('suggestion-s1')).toBeTruthy());
    expect(screen.getByTestId('suggestion-accept-s1')).toBeTruthy();
    expect(screen.getByTestId('suggestion-reject-s1')).toBeTruthy();
    expect(screen.getByTestId('planning-reconciliation').textContent).toMatch(/reconciles/);
  });

  it('disables sign-off with an inline reason when reconciliation fails', async () => {
    reconcile.mockResolvedValue(false);
    render(<PlanningPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('planning-signoff')).toBeTruthy());
    expect((screen.getByTestId('planning-signoff') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('planning-signoff-reason').textContent).toMatch(/reconciliation gate/i);
  });

  it('disables sign-off without the review_and_approve right', async () => {
    userRef.current = { role: 'preparer', rights: {} } as never;
    render(<PlanningPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('planning-signoff')).toBeTruthy());
    expect((screen.getByTestId('planning-signoff') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('planning-signoff-reason').textContent).toMatch(/review_and_approve/);
  });

  it('accepts a suggestion and removes it from the list', async () => {
    render(<PlanningPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('suggestion-accept-s1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('suggestion-accept-s1'));
    await waitFor(() => expect(screen.queryByTestId('suggestion-s1')).toBeNull());
    expect(decide).toHaveBeenCalledWith('e1', 's1', true, undefined);
  });

  it('shows a designed empty state when no SIRA cycle is published', async () => {
    populate.mockResolvedValue([]);
    render(<PlanningPanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('planning-suggestions-empty')).toBeTruthy());
  });
});
