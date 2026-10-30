import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PlanDeploymentPanel } from './PlanDeploymentPanel';
import { PriorYearRollforwardPanel } from './PriorYearRollforwardPanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const renderDeployment = (role: Role, props: Record<string, unknown> = {}) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <PlanDeploymentPanel {...props} />
      </AppProvider>
    </ThemeProvider>
  );

const renderRollforward = (role: Role, props: Record<string, unknown> = {}) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <PriorYearRollforwardPanel engagements={[]} {...props} />
      </AppProvider>
    </ThemeProvider>
  );

describe('PlanDeploymentPanel (owner 2026-10-30: file owner, deploy from plan, early approval)', () => {
  it('offers the deploy form to a caller with manage_engagements', async () => {
    renderDeployment('cia', { universeId: 'u1' });
    expect(await screen.findByTestId('deployment-plan-panel')).toBeTruthy();
    expect(screen.getByTestId('deployment-plan-submit')).toBeTruthy();
    expect(screen.getByTestId('deployment-plan-item')).toBeTruthy();
  });

  it('names the file-owner control only when an engagement is open', async () => {
    renderDeployment('cia', { engagementId: 'eng-1' });
    expect(await screen.findByTestId('deployment-plan-owner-save')).toBeTruthy();
  });

  it('gates the deploy form on the right, not a role name (bad path)', async () => {
    renderDeployment('preparer');
    expect(await screen.findByTestId('deployment-plan-readonly')).toBeTruthy();
    expect(screen.queryByTestId('deployment-plan-submit')).toBeNull();
  });

  it('shows the empty pending state and the empty suggestions state, never a dead end', async () => {
    renderDeployment('cia');
    expect(await screen.findByTestId('deployment-plan-pending-empty')).toBeTruthy();
    expect(screen.getByTestId('deployment-plan-suggestions-empty')).toBeTruthy();
    expect(screen.getByTestId('deployment-plan-owners-empty')).toBeTruthy();
  });
});

describe('PriorYearRollforwardPanel (owner 2026-10-30: roll-forward + export check)', () => {
  it('offers the build control to a caller with manage_engagements', async () => {
    renderRollforward('cia');
    expect(await screen.findByTestId('prior-year-rollforward-panel')).toBeTruthy();
    expect(screen.getByTestId('prior-year-rollforward-build')).toBeTruthy();
  });

  it('gates the build control on the right (bad path)', async () => {
    renderRollforward('preparer');
    expect(await screen.findByTestId('prior-year-rollforward-readonly')).toBeTruthy();
    expect(screen.queryByTestId('prior-year-rollforward-build')).toBeNull();
  });

  it('shows the empty roll-forward state when nothing has been built', async () => {
    renderRollforward('cia');
    expect(await screen.findByTestId('prior-year-rollforward-empty')).toBeTruthy();
  });

  it('never shows a check result before one has run', async () => {
    renderRollforward('cia');
    await screen.findByTestId('prior-year-rollforward-panel');
    await waitFor(() => expect(screen.queryByTestId('prior-year-rollforward-complete')).toBeNull());
    expect(screen.queryByTestId('prior-year-rollforward-incomplete')).toBeNull();
  });
});
