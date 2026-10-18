import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeploymentGatePanel } from './DeploymentGatePanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const renderAs = (role: Role, result: any, extra?: Record<string, unknown>) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <DeploymentGatePanel result={result} {...extra} />
      </AppProvider>
    </ThemeProvider>
  );

describe('DeploymentGatePanel', () => {
  it('shows an empty state with no result', () => {
    renderAs('cia', null);
    expect(screen.getByTestId('deployment-gate-empty')).toBeTruthy();
  });

  it('offers the deploy action when it has the ids and the right (D8)', () => {
    renderAs('cia', null, { deploy: { universeId: 'u1', entityId: 'e1' } });
    expect(screen.getByTestId('gate-deploy')).toBeTruthy();
  });

  it('offers no deploy action without an entity (D8)', () => {
    renderAs('cia', null, { deploy: { universeId: 'u1', entityId: null } });
    expect(screen.queryByTestId('gate-deploy')).toBeNull();
    expect(screen.getByTestId('deployment-gate-empty')).toBeTruthy();
  });

  it('shows an approved deployment outcome', () => {
    renderAs('cia', { outcome: 'deployed', step: 5 });
    expect(screen.getByTestId('gate-outcome').textContent).toMatch(/deployed/i);
    expect(screen.getByTestId('gate-step').textContent).toBe('Step 5');
  });

  it('offers a route to the new audit file once deployed (D8)', () => {
    renderAs('cia', { outcome: 'deployed', step: 5, engagementId: 'eng-1' });
    expect(screen.getByTestId('gate-view-engagement')).toBeTruthy();
    expect(screen.queryByTestId('gate-deploy')).toBeNull();
  });

  it('names the required right in plain language when a step blocks (D14)', () => {
    renderAs('preparer', { outcome: 'approval_required', step: 3, requiredRight: 'approve_plan' });
    expect(screen.getByTestId('gate-outcome').textContent).toMatch(/approval is required/i);
    const reason = screen.getByTestId('gate-required-right').textContent ?? '';
    expect(reason).toMatch(/approve plans/i);
    expect(reason).not.toMatch(/approve_plan/);
  });
});
