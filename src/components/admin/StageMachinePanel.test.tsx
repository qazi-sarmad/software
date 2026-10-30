import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const getFn = vi.fn();
const saveFn = vi.fn();
const resetFn = vi.fn();

vi.mock('../../data/lifecycle', async (orig) => {
  const actual = await orig<typeof import('../../data/lifecycle')>();
  return {
    ...actual,
    getStageMachine: () => getFn(),
    saveStageMachine: (s: unknown) => saveFn(s),
    resetStageMachine: () => resetFn(),
  };
});

import { StageMachinePanel } from './StageMachinePanel';

const defaults = [
  { key: 'planning', label: 'Planning', position: 1, anchor: 'planning' as const },
  { key: 'testing', label: 'Testing', position: 2, anchor: 'testing' as const },
  { key: 'conclusion', label: 'Conclusion', position: 3, anchor: 'conclusion' as const },
];

beforeEach(() => { getFn.mockReset(); saveFn.mockReset(); resetFn.mockReset(); });

describe('OA-22 stage machine (F30, R5)', () => {
  it('shows the default machine and marks it as the default', async () => {
    getFn.mockResolvedValue({ custom: false, stages: defaults, inUse: [] });
    render(<StageMachinePanel />);
    await waitFor(() => expect(screen.getByTestId('oa-governance-stage-list')).toBeTruthy());
    expect(screen.getByTestId('oa-governance-stage-custom').textContent).toBe('Default');
    expect(screen.getByTestId('oa-governance-stage-planning')).toBeTruthy();
    expect(screen.getByTestId('oa-governance-stage-conclusion')).toBeTruthy();
  });

  it('says so when the reader fails, rather than showing an empty machine', async () => {
    getFn.mockRejectedValue(new Error('not signed in'));
    render(<StageMachinePanel />);
    await waitFor(() => expect(screen.getByTestId('oa-governance-stage-error').textContent).toContain('not signed in'));
  });

  it('adds a tenant stage and saves the whole machine', async () => {
    getFn.mockResolvedValue({ custom: false, stages: defaults, inUse: [] });
    saveFn.mockResolvedValue({ ok: true });
    render(<StageMachinePanel />);
    await waitFor(() => expect(screen.getByTestId('oa-governance-stage-list')).toBeTruthy());

    fireEvent.change(screen.getByTestId('oa-governance-stage-new-key'), { target: { value: 'fieldwork' } });
    fireEvent.change(screen.getByTestId('oa-governance-stage-new-label'), { target: { value: 'Fieldwork' } });
    fireEvent.change(screen.getByTestId('oa-governance-stage-new-anchor'), { target: { value: 'testing' } });
    fireEvent.click(screen.getByTestId('oa-governance-stage-add'));
    expect(screen.getByTestId('oa-governance-stage-fieldwork')).toBeTruthy();

    fireEvent.click(screen.getByTestId('oa-governance-stage-save'));
    await waitFor(() => expect(saveFn).toHaveBeenCalledTimes(1));
    const sent = saveFn.mock.calls[0][0] as { key: string; anchor: string }[];
    expect(sent.map((s) => s.key)).toEqual(['planning', 'testing', 'conclusion', 'fieldwork']);
  });

  it('surfaces a refused save inline and keeps the machine on screen', async () => {
    getFn.mockResolvedValue({ custom: true, stages: defaults, inUse: [] });
    saveFn.mockResolvedValue({ ok: false, reason: 'the machine must carry planning, testing and conclusion' });
    render(<StageMachinePanel />);
    await waitFor(() => expect(screen.getByTestId('oa-governance-stage-list')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-governance-stage-save'));
    await waitFor(() => expect(screen.getByTestId('oa-governance-stage-result').textContent)
      .toContain('must carry planning, testing and conclusion'));
    expect(screen.getByTestId('oa-governance-stage-list')).toBeTruthy();
  });

  it('shows a stage as in use, so the tenant knows it cannot be dropped blindly', async () => {
    getFn.mockResolvedValue({ custom: true, stages: defaults,
      inUse: [{ stage: 'testing', count: 3 }] });
    render(<StageMachinePanel />);
    await waitFor(() => expect(screen.getByTestId('oa-governance-stage-inuse-testing').textContent).toContain('3 in use'));
  });
});
