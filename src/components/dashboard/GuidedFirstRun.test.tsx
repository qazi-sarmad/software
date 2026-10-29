import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { testUser } from '../../test/testUsers';

const getState = vi.fn();
const createUniverse = vi.fn();

vi.mock('../../data/guidedFirstRun', () => ({
  getOrgDataState: (...a: unknown[]) => getState(...a),
}));

vi.mock('../../hooks/useScopedData', () => ({
  useScopedData: () => ({ scopedUniverses: [], scopedEntities: [], scopedEngagements: [] }),
}));

let currentUser = testUser('cia');
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser, createUniverse: (...a: unknown[]) => createUniverse(...a) }),
}));

import { GuidedFirstRun } from './GuidedFirstRun';

beforeEach(() => {
  currentUser = testUser('cia');
  getState.mockReset().mockResolvedValue({ universes: 0, entities: 0, engagements: 0, isEmpty: true });
  createUniverse.mockReset().mockResolvedValue({ ok: true, id: 'u1' });
});

describe('GuidedFirstRun (U6, DB-01)', () => {
  it('shows the guided empty state with "Create your first universe" for a new org', async () => {
    render(<GuidedFirstRun screenId="DB-01" />);
    await waitFor(() => expect(screen.getByTestId('DB-01-guided-empty')).toBeTruthy());
    expect(screen.getByTestId('DB-01-guided-primary').textContent).toContain('Create a universe');
    expect(screen.getByTestId('DB-01-guided-step-universe').getAttribute('data-done')).toBe('false');
  });

  it('renders nothing once the org has a universe', async () => {
    getState.mockResolvedValue({ universes: 1, entities: 0, engagements: 0, isEmpty: false });
    const { container } = render(<GuidedFirstRun screenId="DB-01" />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="DB-01-guided-empty"]')).toBeNull());
  });

  it('creates a universe through the app context (not the client) and reports an inline error', async () => {
    render(<GuidedFirstRun screenId="DB-01" />);
    await waitFor(() => expect(screen.getByTestId('DB-01-guided-primary')).toBeTruthy());
    fireEvent.click(screen.getByTestId('DB-01-guided-primary'));
    fireEvent.change(screen.getByTestId('DB-01-guided-universe-name'), { target: { value: 'Treasury' } });
    createUniverse.mockResolvedValue({ ok: false, reason: 'not allowed: edit_config' });
    fireEvent.click(screen.getByTestId('DB-01-guided-universe-submit'));
    await waitFor(() => expect(screen.getByTestId('DB-01-guided-error')).toBeTruthy());
    expect(createUniverse).toHaveBeenCalledWith({ name: 'Treasury' });
  });

  it('never shows a create button to a member without edit_config', async () => {
    currentUser = { ...testUser('auditee'), rights: {} };
    render(<GuidedFirstRun screenId="DB-01" />);
    await waitFor(() => expect(screen.getByTestId('DB-01-guided-empty')).toBeTruthy());
    // The primary action falls through to the setup step, not a dead create button.
    expect(screen.getByTestId('DB-01-guided-primary').textContent).toContain('setup wizard');
  });
});
