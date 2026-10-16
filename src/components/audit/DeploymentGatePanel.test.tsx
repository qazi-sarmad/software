import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeploymentGatePanel } from './DeploymentGatePanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const renderAs = (role: Role, result: any) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <DeploymentGatePanel result={result} />
      </AppProvider>
    </ThemeProvider>
  );

describe('DeploymentGatePanel', () => {
  it('shows an empty state with no result', () => {
    renderAs('cia', null);
    expect(screen.getByTestId('deployment-gate-empty')).toBeTruthy();
  });

  it('shows an approved deployment outcome', () => {
    renderAs('cia', { outcome: 'deployed', step: 5 });
    expect(screen.getByTestId('gate-outcome').textContent).toMatch(/deployed/i);
    expect(screen.getByTestId('gate-step').textContent).toBe('Step 5');
  });

  it('names the required right when a step blocks', () => {
    renderAs('preparer', { outcome: 'approval_required', step: 3, requiredRight: 'approve_plan' });
    expect(screen.getByTestId('gate-outcome').textContent).toMatch(/approval is required/i);
    expect(screen.getByTestId('gate-required-right').textContent).toMatch(/approve_plan/);
  });
});
