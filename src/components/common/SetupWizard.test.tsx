import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listSetupSteps = vi.fn();
const saveSetupStep = vi.fn();
const listTutorialsFn = vi.fn();

vi.mock('../../data/setup', () => ({
  listSetupSteps: (scope: string) => listSetupSteps(scope),
  saveSetupStep: (...a: unknown[]) => saveSetupStep(...a),
  setupProgress: (steps: { status: string }[], total: number) => steps.filter((s) => s.status === 'done').length / total,
}));
vi.mock('../../data/tutorials', () => ({
  listTutorials: () => listTutorialsFn(),
  recordTutorialView: () => Promise.resolve({ ok: true }),
}));

import { SetupWizard } from './SetupWizard';

describe('guided setup wizard (F17)', () => {
  beforeEach(() => {
    listSetupSteps.mockResolvedValue([]);
    saveSetupStep.mockResolvedValue({ ok: true });
    listTutorialsFn.mockResolvedValue([]);
  });

  it('renders the Org Admin steps with what/why/skip text', async () => {
    render(<SetupWizard scope="org_admin" />);
    await waitFor(() => expect(screen.getByTestId('org_admin-wizard')).toBeTruthy());
    const body = screen.getByTestId('org_admin-wizard-body');
    expect(body.textContent).toContain('Organisation profile and branding');
    expect(body.textContent).toContain('Why it matters');
    expect(body.textContent).toContain('If you skip it');
  });

  it('marks a step done and moves to the next', async () => {
    render(<SetupWizard scope="org_admin" />);
    await waitFor(() => expect(screen.getByTestId('org_admin-wizard-next')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org_admin-wizard-next'));
    await waitFor(() => expect(saveSetupStep).toHaveBeenCalledWith('org_admin', 'org.profile', 'done'));
    await waitFor(() =>
      expect(screen.getByTestId('org_admin-wizard-body').textContent).toContain('Feature enablement')
    );
  });

  it('opens the tutorial drawer from Show me how', async () => {
    render(<SetupWizard scope="org_admin" />);
    await waitFor(() => expect(screen.getByTestId('org_admin-wizard-show-org.profile')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org_admin-wizard-show-org.profile'));
    await waitFor(() => expect(screen.getByTestId('tutorial-drawer')).toBeTruthy());
  });

  it('hides an optional step whose feature is off', async () => {
    render(<SetupWizard scope="org_admin" />);
    await waitFor(() => expect(screen.getByTestId('org_admin-wizard-steps')).toBeTruthy());
    expect(screen.queryByTestId('org_admin-wizard-step-org.ai')).toBeNull();
  });

  it('shows the AI step when ai_assist is enabled', async () => {
    render(<SetupWizard scope="org_admin" enabledFeatures={['ai_assist']} />);
    await waitFor(() => expect(screen.getByTestId('org_admin-wizard-step-org.ai')).toBeTruthy());
  });

  it('shows a resume banner when steps were already saved', async () => {
    listSetupSteps.mockResolvedValue([
      { stepKey: 'org.profile', status: 'done', answerRef: {}, updatedAt: '2026-01-01T00:00:00Z' },
    ]);
    render(<SetupWizard scope="org_admin" />);
    await waitFor(() => expect(screen.getByTestId('org_admin-wizard-resume')).toBeTruthy());
  });

  it('renders the Super Admin steps for the platform scope', async () => {
    render(<SetupWizard scope="super_admin" />);
    await waitFor(() => expect(screen.getByTestId('super_admin-wizard')).toBeTruthy());
    expect(screen.getByTestId('super_admin-wizard-body').textContent).toContain('Platform readiness check');
  });

  /**
   * T2. The default `enabledFeatures = []` was a new array on every render, so the `steps` useMemo
   * and the `load` useCallback were recreated each time and the load effect re-ran forever: the
   * wizard oscillated between `loading` and `ready` and a screenshot could catch the loading state.
   * The load effect must run a bounded number of times and the wizard must settle on its loaded
   * state. StrictMode is not used here, so one run is expected; three leaves room for a re-render.
   */
  it('loads once and settles, rather than reloading on every render (T2)', async () => {
    render(<SetupWizard scope="org_admin" />);
    await waitFor(() => expect(screen.getByTestId('org_admin-wizard')).toBeTruthy());
    // Let any runaway effect loop schedule its next pass before counting.
    await new Promise((r) => setTimeout(r, 250));
    expect(listSetupSteps.mock.calls.length, 'the load effect must not re-run every render').toBeLessThanOrEqual(3);
    expect(screen.getByTestId('org_admin-wizard')).toBeTruthy();
  });

  it('does not reload when the parent passes a fresh feature array each render (T2)', async () => {
    const { rerender } = render(<SetupWizard scope="org_admin" enabledFeatures={[...[]]} />);
    await waitFor(() => expect(screen.getByTestId('org_admin-wizard')).toBeTruthy());
    for (let i = 0; i < 5; i++) {
      // A new array identity each render, exactly as OrgControlPanel does with `[...enabled]`.
      rerender(<SetupWizard scope="org_admin" enabledFeatures={[...[]]} />);
    }
    await new Promise((r) => setTimeout(r, 250));
    expect(listSetupSteps.mock.calls.length, 'a new array identity must not re-run the load effect').toBeLessThanOrEqual(3);
  });
});
